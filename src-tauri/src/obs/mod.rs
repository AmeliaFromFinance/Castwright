//! OBS Studio over obs-websocket 5. Keeps a live snapshot for the app window,
//! reconnects on its own and runs commands for the UI and automation.

pub mod convert;
mod errors;
mod proto;
mod state;
#[cfg(test)]
mod tests;

use crate::error::{AppError, AppResult};
use crate::hub::{Hub, Signal, ui};
use crate::model::automation::Toggle;
use crate::model::runtime::{AudioInput, AudioLevel, ConnState, LogLevel, ObsSnapshot, SceneItem};
use crate::services::ObsActions;
use crate::store::secrets::{Secrets, keys};
use crate::store::settings::SettingsStore;
use async_trait::async_trait;
use convert::{KbpsMeter, percent, resolve_toggle};
use futures_util::future::join_all;
use proto::{Events, ObsClient, ObsEvent, ReqError, code, sub};
use serde_json::{Value, json};
use state::{bool_of, num_of, str_of, u64_of};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

const BACKOFF: [Duration; 4] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const STATS_EVERY: Duration = Duration::from_secs(2);
/// Missed stats polls in a row before the connection is treated as dead.
const STATS_MAX_MISSES: u32 = 3;
const EMIT_GAP: Duration = Duration::from_millis(100);
const LEVELS_GAP: Duration = Duration::from_millis(45);
const EVENT_BUFFER: usize = 1024;
const SCREENSHOT_QUALITY: u32 = 70;

pub struct ObsService {
    hub: Arc<Hub>,
    secrets: Arc<Secrets>,
    settings: Arc<SettingsStore>,
    me: Weak<ObsService>,
    live: Mutex<Live>,
    session: Mutex<Option<Session>>,
    /// Held while connecting or disconnecting so only one happens at a time.
    conn_lock: tokio::sync::Mutex<()>,
    next_sid: AtomicU64,
    levels: AtomicBool,
    last_levels: Mutex<Option<Instant>>,
    /// Set by disconnect(); stops automatic reconnects until connect() or start().
    manual_off: AtomicBool,
    wake: Arc<Notify>,
    retry: Mutex<Retry>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

struct Live {
    snap: ObsSnapshot,
    /// Session the snapshot belongs to (0 = none).
    sid: u64,
    dirty: Option<Arc<Notify>>,
    vars: Option<VarValues>,
}

#[derive(Clone, PartialEq)]
struct VarValues {
    connected: bool,
    scene: String,
    streaming: bool,
    recording: bool,
}

struct Session {
    sid: u64,
    client: Arc<ObsClient>,
    tasks: Vec<JoinHandle<()>>,
}

#[derive(Default)]
struct Retry {
    failures: usize,
    next: Option<Instant>,
    last_error: Option<String>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

async fn call(c: &ObsClient, kind: &str, data: Value) -> AppResult<Value> {
    c.request(kind, data).await.map_err(errors::request)
}

fn subscriptions(levels: bool) -> u32 {
    let base = sub::GENERAL
        | sub::CONFIG
        | sub::SCENES
        | sub::INPUTS
        | sub::TRANSITIONS
        | sub::OUTPUTS
        | sub::SCENE_ITEMS
        | sub::UI;
    if levels {
        base | sub::INPUT_VOLUME_METERS
    } else {
        base
    }
}

fn round1(v: f64) -> f64 {
    if v.is_finite() {
        (v * 10.0).round() / 10.0
    } else {
        0.0
    }
}

/// Treats one "already in that state" error as success.
fn ok_if(r: Result<Value, ReqError>, fine: u16) -> AppResult<()> {
    match r {
        Ok(_) => Ok(()),
        Err(e) if e.code() == Some(fine) => Ok(()),
        Err(e) => Err(errors::request(e)),
    }
}

fn replay_err(r: Result<Value, ReqError>) -> AppResult<()> {
    match r {
        Ok(_) => Ok(()),
        Err(e) => Err(match e.code() {
            Some(code::OUTPUT_DISABLED) => AppError::User(
                "The replay buffer is off in OBS. Turn it on in Settings → Output → Replay Buffer."
                    .into(),
            ),
            Some(code::OUTPUT_NOT_RUNNING) => {
                AppError::User("The replay buffer isn't running in OBS.".into())
            }
            _ => errors::request(e),
        }),
    }
}

impl ObsService {
    pub fn new(hub: Arc<Hub>, secrets: Arc<Secrets>, settings: Arc<SettingsStore>) -> Arc<Self> {
        let svc = Arc::new_cyclic(|me| ObsService {
            hub,
            secrets,
            settings,
            me: me.clone(),
            live: Mutex::new(Live {
                snap: ObsSnapshot::default(),
                sid: 0,
                dirty: None,
                vars: None,
            }),
            session: Mutex::new(None),
            conn_lock: tokio::sync::Mutex::new(()),
            next_sid: AtomicU64::new(0),
            levels: AtomicBool::new(false),
            last_levels: Mutex::new(None),
            manual_off: AtomicBool::new(false),
            wake: Arc::new(Notify::new()),
            retry: Mutex::new(Retry::default()),
            supervisor: Mutex::new(None),
        });
        svc.sync_vars(&mut lock(&svc.live));
        svc
    }

    /// Starts the background loop that connects while `obs.auto_connect` is on and
    /// reconnects after OBS closes. Safe to call again, e.g. after settings change.
    pub fn start(self: &Arc<Self>) {
        self.manual_off.store(false, Ordering::SeqCst);
        let mut sup = lock(&self.supervisor);
        if sup.as_ref().is_some_and(|h| !h.is_finished()) {
            self.wake.notify_one();
            return;
        }
        *sup = Some(crate::util::spawn(supervise(
            Arc::downgrade(self),
            self.wake.clone(),
        )));
    }

    /// Stops all background work and closes the connection.
    pub async fn shutdown(&self) {
        self.manual_off.store(true, Ordering::SeqCst);
        if let Some(h) = lock(&self.supervisor).take() {
            h.abort();
        }
        let _g = self.conn_lock.lock().await;
        self.close_session().await;
        self.set_offline(ConnState::Disconnected, None);
    }

    /// Connects (or reconnects) with the saved settings.
    pub async fn connect(&self) -> AppResult<()> {
        self.manual_off.store(false, Ordering::SeqCst);
        let r = {
            let _g = self.conn_lock.lock().await;
            self.open_session().await
        };
        self.wake.notify_one();
        r
    }

    pub async fn disconnect(&self) -> AppResult<()> {
        self.manual_off.store(true, Ordering::SeqCst);
        let _g = self.conn_lock.lock().await;
        self.close_session().await;
        *lock(&self.retry) = Retry::default();
        self.set_offline(ConnState::Disconnected, None);
        Ok(())
    }

    pub fn snapshot(&self) -> ObsSnapshot {
        lock(&self.live).snap.clone()
    }

    pub fn is_connected(&self) -> bool {
        lock(&self.session).is_some()
    }

    /// Tries a connection without keeping it. Returns the OBS version.
    pub async fn test_connection(
        &self,
        host: &str,
        port: u16,
        password: Option<&str>,
    ) -> AppResult<String> {
        let (client, _events) = connect_client(host, port, password, 0).await?;
        let v = call(&client, "GetVersion", Value::Null).await?;
        client.close().await;
        Ok(str_of(&v, "obsVersion"))
    }

    /// Saves (Some) or forgets (None or empty) the OBS WebSocket password.
    pub fn save_password(&self, password: Option<String>) -> AppResult<()> {
        match password.filter(|p| !p.is_empty()) {
            Some(p) => {
                self.secrets.set(keys::OBS_PASSWORD, &p)?;
                self.settings.update(|s| s.obs.has_password = true)?;
            }
            None => {
                self.secrets.delete(keys::OBS_PASSWORD)?;
                self.settings.update(|s| s.obs.has_password = false)?;
            }
        }
        Ok(())
    }

    fn password(&self) -> Option<String> {
        if !self.settings.get().obs.has_password {
            return None;
        }
        self.secrets
            .get(keys::OBS_PASSWORD)
            .filter(|p| !p.is_empty())
    }

    /// Audio meters are only requested from OBS while the mixer is open.
    pub async fn set_levels_enabled(&self, on: bool) -> AppResult<()> {
        if self.levels.swap(on, Ordering::SeqCst) == on {
            return Ok(());
        }
        let client = lock(&self.session).as_ref().map(|s| s.client.clone());
        if let Some(client) = client {
            client
                .reidentify(subscriptions(on))
                .await
                .map_err(errors::request)?;
        }
        Ok(())
    }

    // ---- connection lifecycle ----

    fn wants_connection(&self) -> bool {
        !self.manual_off.load(Ordering::SeqCst)
            && self.settings.get().obs.auto_connect
            && !self.is_connected()
    }

    fn retry_wait(&self) -> Option<Duration> {
        let next = lock(&self.retry).next?;
        next.checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
    }

    /// Caller holds `conn_lock`.
    async fn open_session(&self) -> AppResult<()> {
        self.close_session().await;
        let cfg = self.settings.get().obs;
        let password = self.password();
        self.set_offline(ConnState::Connecting, None);

        let levels = self.levels.load(Ordering::SeqCst);
        let established = async {
            let (client, events) = connect_client(
                &cfg.host,
                cfg.port,
                password.as_deref(),
                subscriptions(levels),
            )
            .await?;
            let snap = fetch_all(&client).await?;
            Ok::<_, AppError>((client, events, snap))
        }
        .await;

        let (client, events, snap) = match established {
            Ok(v) => v,
            Err(e) => {
                self.note_failure(&e);
                self.set_offline(ConnState::Error, Some(e.to_string()));
                return Err(e);
            }
        };

        let client = Arc::new(client);
        let sid = self.next_sid.fetch_add(1, Ordering::SeqCst) + 1;
        let dirty = Arc::new(Notify::new());
        let version = snap.obs_version.clone();
        {
            let mut slot = lock(&self.session);
            self.set_connected(sid, snap, dirty.clone());
            let tasks = vec![
                crate::util::spawn(event_loop(self.me.clone(), sid, client.clone(), events)),
                crate::util::spawn(stats_loop(self.me.clone(), sid, client.clone())),
                crate::util::spawn(emit_loop(self.me.clone(), sid, dirty)),
            ];
            *slot = Some(Session { sid, client, tasks });
        }
        *lock(&self.retry) = Retry::default();
        self.hub
            .log(LogLevel::Info, "obs", format!("Connected to OBS {version}"));
        self.hub.signal(Signal::ObsConnected);
        Ok(())
    }

    /// Caller holds `conn_lock`.
    async fn close_session(&self) {
        let Some(sess) = lock(&self.session).take() else {
            return;
        };
        for t in &sess.tasks {
            t.abort();
        }
        for t in sess.tasks {
            let _ = t.await;
        }
        if self.set_offline(ConnState::Disconnected, None) {
            self.hub.log(LogLevel::Info, "obs", "Disconnected from OBS");
            self.hub.signal(Signal::ObsDisconnected);
        }
        sess.client.close().await;
    }

    /// The connection dropped (OBS closed, network gone).
    fn on_lost(&self, sid: u64) {
        let sess = {
            let mut slot = lock(&self.session);
            match slot.as_ref() {
                Some(s) if s.sid == sid => slot.take(),
                _ => return,
            }
        };
        if let Some(s) = sess {
            // Includes the task calling this; it ends right after.
            for t in &s.tasks {
                t.abort();
            }
        }
        if self.set_offline(ConnState::Disconnected, None) {
            self.hub
                .log(LogLevel::Warn, "obs", "Lost the connection to OBS");
            self.hub.signal(Signal::ObsDisconnected);
        }
        self.wake.notify_one();
    }

    fn note_failure(&self, e: &AppError) {
        let msg = e.to_string();
        let mut r = lock(&self.retry);
        let delay = BACKOFF[r.failures.min(BACKOFF.len() - 1)];
        r.failures += 1;
        r.next = Some(Instant::now() + delay);
        if r.last_error.as_deref() != Some(&msg) {
            self.hub.log(LogLevel::Warn, "obs", msg.clone());
            r.last_error = Some(msg);
        }
    }

    // ---- snapshot ----

    /// Replaces the snapshot with an offline one. Returns true if it was connected.
    fn set_offline(&self, state: ConnState, error: Option<String>) -> bool {
        let mut live = lock(&self.live);
        let was = live.snap.state == ConnState::Connected;
        let next = state::offline(state, error);
        live.sid = 0;
        live.dirty = None;
        if live.snap != next {
            live.snap = next;
            self.sync_vars(&mut live);
            self.hub.emit_ui(ui::OBS, &live.snap);
        }
        was
    }

    fn set_connected(&self, sid: u64, mut snap: ObsSnapshot, dirty: Arc<Notify>) {
        snap.state = ConnState::Connected;
        snap.error = None;
        let mut live = lock(&self.live);
        live.snap = snap;
        live.sid = sid;
        live.dirty = Some(dirty);
        self.sync_vars(&mut live);
        self.hub.emit_ui(ui::OBS, &live.snap);
    }

    /// Changes the snapshot of session `sid`. None when that session is gone.
    fn update<R>(&self, sid: u64, f: impl FnOnce(&mut ObsSnapshot) -> R) -> Option<R> {
        let mut live = lock(&self.live);
        if live.sid != sid {
            return None;
        }
        let before = live.snap.clone();
        let r = f(&mut live.snap);
        if live.snap != before {
            self.sync_vars(&mut live);
            if let Some(d) = &live.dirty {
                d.notify_one();
            }
        }
        Some(r)
    }

    fn sync_vars(&self, live: &mut Live) {
        let now = VarValues {
            connected: live.snap.state == ConnState::Connected,
            scene: live.snap.program_scene.clone(),
            streaming: live.snap.stream.active,
            recording: live.snap.record.active,
        };
        let old = live.vars.take();
        let old = old.as_ref();
        if old.map(|o| o.connected) != Some(now.connected) {
            self.hub
                .set_var("obs.connected", Value::Bool(now.connected), false);
        }
        if old.map(|o| &o.scene) != Some(&now.scene) {
            self.hub
                .set_var("obs.scene", Value::String(now.scene.clone()), false);
        }
        if old.map(|o| o.streaming) != Some(now.streaming) {
            self.hub
                .set_var("obs.streaming", Value::Bool(now.streaming), false);
        }
        if old.map(|o| o.recording) != Some(now.recording) {
            self.hub
                .set_var("obs.recording", Value::Bool(now.recording), false);
        }
        live.vars = Some(now);
    }

    // ---- events ----

    async fn handle_event(&self, sid: u64, c: &ObsClient, ev: ObsEvent) {
        if ev.kind == "InputVolumeMeters" {
            self.on_meters(&ev.data);
            return;
        }
        let Some(f) = self.update(sid, |s| state::apply(s, &ev.kind, &ev.data)) else {
            return;
        };
        if let Some(scene) = f.program_changed {
            self.hub.signal(Signal::SceneChanged { scene });
        }
        if f.everything {
            self.resync(sid, c).await;
            return;
        }
        if f.scenes
            && let Ok(list) = call(c, "GetSceneList", Value::Null).await
        {
            self.update(sid, |s| s.scenes = state::scene_names(&list["scenes"]));
        }
        let mut items = f.items;
        if f.preview
            && let Ok(p) = call(c, "GetCurrentPreviewScene", Value::Null).await
        {
            let name = preview_name(&p);
            self.update(sid, |s| {
                if s.studio_mode && !name.is_empty() {
                    s.preview_scene = Some(name);
                }
            });
            items = true;
        }
        if items {
            self.refresh_items(sid, c).await;
        }
        if let Some((name, kind)) = f.input
            && let Some(input) = fetch_audio_input(c, &name, &kind).await
        {
            self.update(sid, |s| {
                if !s.inputs.iter().any(|i| i.name == input.name) {
                    s.inputs.push(input);
                }
            });
        }
        if f.transition {
            let t = fetch_transitions(c).await;
            self.update(sid, |s| t.apply(s));
        }
    }

    async fn refresh_items(&self, sid: u64, c: &ObsClient) {
        let scene = {
            let live = lock(&self.live);
            if live.sid != sid {
                return;
            }
            state::edited_scene(&live.snap).to_string()
        };
        if scene.is_empty() {
            return;
        }
        match fetch_items(c, &scene).await {
            Ok(items) => {
                self.update(sid, |s| {
                    if state::edited_scene(s) == scene {
                        s.scene_items = items;
                    }
                });
            }
            Err(e) => tracing::debug!("obs: couldn't list items of {scene}: {e}"),
        }
    }

    async fn resync(&self, sid: u64, c: &ObsClient) {
        match fetch_all(c).await {
            Ok(mut fresh) => {
                self.update(sid, |s| {
                    fresh.state = ConnState::Connected;
                    fresh.stats = s.stats.clone();
                    *s = fresh;
                });
            }
            Err(e) => tracing::debug!("obs: resync failed: {e}"),
        }
    }

    fn on_meters(&self, data: &Value) {
        if !self.levels.load(Ordering::Relaxed) {
            return;
        }
        {
            let mut last = lock(&self.last_levels);
            let now = Instant::now();
            if last.is_some_and(|t| now.duration_since(t) < LEVELS_GAP) {
                return;
            }
            *last = Some(now);
        }
        let inputs = data["inputs"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let levels: Vec<AudioLevel> = inputs
            .iter()
            .map(|m| AudioLevel {
                name: str_of(m, "inputName"),
                peaks_db: convert::meter_peaks(&m["inputLevelsMul"]),
            })
            .collect();
        self.hub.emit_ui(ui::OBS_LEVELS, &levels);
    }

    /// Returns false when OBS didn't answer (the connection may be dead).
    async fn poll_stats(
        &self,
        sid: u64,
        c: &ObsClient,
        meter: &mut KbpsMeter,
        t0: Instant,
    ) -> bool {
        let stats = match c.request("GetStats", Value::Null).await {
            Ok(s) => s,
            Err(ReqError::Api { .. }) => return true,
            Err(_) => return false,
        };
        let (streaming, recording) = {
            let live = lock(&self.live);
            (live.snap.stream.active, live.snap.record.active)
        };
        let stream = if streaming {
            c.request("GetStreamStatus", Value::Null).await.ok()
        } else {
            None
        };
        let record = if recording {
            c.request("GetRecordStatus", Value::Null).await.ok()
        } else {
            None
        };
        let replay = match c.request("GetReplayBufferStatus", Value::Null).await {
            Ok(v) => Some(Some(bool_of(&v, "outputActive"))),
            Err(ReqError::Api { .. }) => Some(None),
            Err(_) => None,
        };
        let at = t0.elapsed().as_millis() as u64;
        let kbps = match &stream {
            Some(st) if bool_of(st, "outputActive") => meter.update(u64_of(st, "outputBytes"), at),
            _ => {
                meter.reset();
                0.0
            }
        };
        self.update(sid, |s| {
            s.stats.cpu_percent = round1(num_of(&stats, "cpuUsage"));
            s.stats.memory_mb = round1(num_of(&stats, "memoryUsage"));
            s.stats.active_fps = round1(num_of(&stats, "activeFps"));
            s.stats.render_skipped_percent = round1(percent(
                u64_of(&stats, "renderSkippedFrames"),
                u64_of(&stats, "renderTotalFrames"),
            ));
            s.stats.output_skipped_percent = round1(percent(
                u64_of(&stats, "outputSkippedFrames"),
                u64_of(&stats, "outputTotalFrames"),
            ));
            s.stats.stream_kbps = kbps;
            match &stream {
                Some(st) => {
                    s.stream.active = bool_of(st, "outputActive");
                    s.stream.duration_ms = u64_of(st, "outputDuration");
                    s.stats.stream_dropped_percent = round1(percent(
                        u64_of(st, "outputSkippedFrames"),
                        u64_of(st, "outputTotalFrames"),
                    ));
                }
                None => s.stats.stream_dropped_percent = 0.0,
            }
            if let Some(r) = &record {
                s.record.active = bool_of(r, "outputActive");
                s.record.paused = bool_of(r, "outputPaused");
                s.record.duration_ms = u64_of(r, "outputDuration");
            }
            if let Some(rb) = replay {
                s.replay_buffer = rb;
            }
        });
        true
    }

    // ---- commands ----

    fn client(&self) -> AppResult<Arc<ObsClient>> {
        lock(&self.session)
            .as_ref()
            .map(|s| s.client.clone())
            .ok_or_else(errors::not_connected)
    }

    async fn run(&self, kind: &str, data: Value) -> AppResult<Value> {
        let c = self.client()?;
        call(&c, kind, data).await
    }

    async fn run_raw(&self, kind: &str, data: Value) -> AppResult<Result<Value, ReqError>> {
        let c = self.client()?;
        Ok(c.request(kind, data).await)
    }

    pub async fn set_program_scene(&self, scene: &str) -> AppResult<()> {
        self.run("SetCurrentProgramScene", json!({ "sceneName": scene }))
            .await
            .map(drop)
    }

    pub async fn set_preview_scene(&self, scene: &str) -> AppResult<()> {
        self.run("SetCurrentPreviewScene", json!({ "sceneName": scene }))
            .await
            .map(drop)
    }

    pub async fn set_studio_mode(&self, on: bool) -> AppResult<()> {
        self.run("SetStudioModeEnabled", json!({ "studioModeEnabled": on }))
            .await
            .map(drop)
    }

    /// Moves the preview to program (Studio Mode).
    pub async fn trigger_transition(&self) -> AppResult<()> {
        self.run("TriggerStudioModeTransition", Value::Null)
            .await
            .map(drop)
    }

    pub async fn set_transition(&self, name: &str) -> AppResult<()> {
        self.run(
            "SetCurrentSceneTransition",
            json!({ "transitionName": name }),
        )
        .await
        .map(drop)
    }

    pub async fn set_transition_duration(&self, ms: u32) -> AppResult<()> {
        let ms = ms.clamp(50, 20_000);
        self.run(
            "SetCurrentSceneTransitionDuration",
            json!({ "transitionDuration": ms }),
        )
        .await
        .map(drop)
    }

    pub async fn toggle_stream(&self) -> AppResult<()> {
        self.run("ToggleStream", Value::Null).await.map(drop)
    }

    pub async fn start_stream(&self) -> AppResult<()> {
        ok_if(
            self.run_raw("StartStream", Value::Null).await?,
            code::OUTPUT_RUNNING,
        )
    }

    pub async fn stop_stream(&self) -> AppResult<()> {
        ok_if(
            self.run_raw("StopStream", Value::Null).await?,
            code::OUTPUT_NOT_RUNNING,
        )
    }

    pub async fn toggle_record(&self) -> AppResult<()> {
        self.run("ToggleRecord", Value::Null).await.map(drop)
    }

    pub async fn start_record(&self) -> AppResult<()> {
        ok_if(
            self.run_raw("StartRecord", Value::Null).await?,
            code::OUTPUT_RUNNING,
        )
    }

    pub async fn stop_record(&self) -> AppResult<()> {
        ok_if(
            self.run_raw("StopRecord", Value::Null).await?,
            code::OUTPUT_NOT_RUNNING,
        )
    }

    pub async fn pause_record(&self) -> AppResult<()> {
        let not_running = || AppError::User("Recording isn't running.".into());
        let c = self.client()?;
        // OBS accepts a pause just after a recording stops, so check first.
        if !self.snapshot().record.active {
            return Err(not_running());
        }
        match c.request("PauseRecord", Value::Null).await {
            Err(e) if e.code() == Some(code::OUTPUT_NOT_RUNNING) => Err(not_running()),
            r => ok_if(r, code::OUTPUT_PAUSED),
        }
    }

    pub async fn resume_record(&self) -> AppResult<()> {
        ok_if(
            self.run_raw("ResumeRecord", Value::Null).await?,
            code::OUTPUT_NOT_PAUSED,
        )
    }

    pub async fn toggle_replay_buffer(&self) -> AppResult<()> {
        replay_err(self.run_raw("ToggleReplayBuffer", Value::Null).await?)
    }

    pub async fn save_replay(&self) -> AppResult<()> {
        replay_err(self.run_raw("SaveReplayBuffer", Value::Null).await?)
    }

    pub async fn toggle_virtual_cam(&self) -> AppResult<()> {
        self.run("ToggleVirtualCam", Value::Null).await.map(drop)
    }

    pub async fn set_input_volume_db(&self, input: &str, db: f64) -> AppResult<()> {
        let db = convert::clamp_volume_db(db);
        self.run(
            "SetInputVolume",
            json!({ "inputName": input, "inputVolumeDb": db }),
        )
        .await
        .map(drop)
    }

    pub async fn set_input_mute(&self, input: &str, muted: bool) -> AppResult<()> {
        self.run(
            "SetInputMute",
            json!({ "inputName": input, "inputMuted": muted }),
        )
        .await
        .map(drop)
    }

    /// On = monitor and output, so the streamer hears it and it still goes out.
    pub async fn set_input_monitoring(&self, input: &str, on: bool) -> AppResult<()> {
        let t = if on {
            "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT"
        } else {
            "OBS_MONITORING_TYPE_NONE"
        };
        self.run(
            "SetInputAudioMonitorType",
            json!({ "inputName": input, "monitorType": t }),
        )
        .await
        .map(drop)
    }

    pub async fn set_scene_item_enabled(
        &self,
        scene: &str,
        item_id: i64,
        on: bool,
    ) -> AppResult<()> {
        self.run(
            "SetSceneItemEnabled",
            json!({ "sceneName": scene, "sceneItemId": item_id, "sceneItemEnabled": on }),
        )
        .await
        .map(drop)
    }

    pub async fn set_scene_item_locked(
        &self,
        scene: &str,
        item_id: i64,
        on: bool,
    ) -> AppResult<()> {
        self.run(
            "SetSceneItemLocked",
            json!({ "sceneName": scene, "sceneItemId": item_id, "sceneItemLocked": on }),
        )
        .await
        .map(drop)
    }

    /// JPEG of a source or scene as a `data:` URL, `width` wide, canvas aspect ratio.
    pub async fn screenshot(&self, source: &str, width: u32) -> AppResult<String> {
        let c = self.client()?;
        let (bw, bh) = self.base_size(&c).await;
        let (w, h) = convert::screenshot_size(width, bw, bh);
        let v = call(
            &c,
            "GetSourceScreenshot",
            json!({
                "sourceName": source,
                "imageFormat": "jpeg",
                "imageWidth": w,
                "imageHeight": h,
                "imageCompressionQuality": SCREENSHOT_QUALITY,
            }),
        )
        .await?;
        let data = str_of(&v, "imageData");
        match data.split_once(";base64,") {
            Some((_, b64)) => Ok(format!("data:image/jpeg;base64,{b64}")),
            None if !data.is_empty() => Ok(format!("data:image/jpeg;base64,{data}")),
            None => Err(AppError::Obs("sent an empty screenshot.".into())),
        }
    }

    /// Adds an overlay as a browser source covering the canvas, or updates the one
    /// already called `name`.
    pub async fn ensure_browser_source(
        &self,
        scene: &str,
        name: &str,
        url: &str,
        width: u32,
        height: u32,
    ) -> AppResult<()> {
        let settings = convert::browser_settings(url, width, height);
        self.ensure_input(scene, name, "browser_source", settings, true)
            .await
    }

    async fn ensure_input(
        &self,
        scene: &str,
        name: &str,
        kind: &str,
        settings: Value,
        fill: bool,
    ) -> AppResult<()> {
        let c = self.client()?;
        match c
            .request("GetInputSettings", json!({ "inputName": name }))
            .await
        {
            Ok(existing) => {
                if existing["inputKind"] != kind {
                    return Err(AppError::User(format!(
                        "OBS already has a source called \"{name}\" of a different type. \
                         Pick another name."
                    )));
                }
                call(
                    &c,
                    "SetInputSettings",
                    json!({ "inputName": name, "inputSettings": settings, "overlay": true }),
                )
                .await
                .map(drop)
            }
            Err(e) if e.code() == Some(code::RESOURCE_NOT_FOUND) => {
                let created = c
                    .request(
                        "CreateInput",
                        json!({
                            "sceneName": scene,
                            "inputName": name,
                            "inputKind": kind,
                            "inputSettings": settings,
                            "sceneItemEnabled": true,
                        }),
                    )
                    .await;
                let created = match created {
                    Ok(v) => v,
                    Err(e)
                        if kind == "browser_source"
                            && e.code() == Some(code::INVALID_INPUT_KIND) =>
                    {
                        return Err(AppError::User(
                            "This OBS doesn't have the Browser Source plugin. Install OBS from \
                             obsproject.com, which includes it."
                                .into(),
                        ));
                    }
                    Err(e) => return Err(errors::request(e)),
                };
                if fill {
                    let (bw, bh) = self.base_size(&c).await;
                    call(
                        &c,
                        "SetSceneItemTransform",
                        json!({
                            "sceneName": scene,
                            "sceneItemId": created["sceneItemId"],
                            "sceneItemTransform": convert::fill_canvas(bw, bh),
                        }),
                    )
                    .await?;
                }
                Ok(())
            }
            Err(e) => Err(errors::request(e)),
        }
    }

    async fn base_size(&self, c: &ObsClient) -> (u32, u32) {
        let (w, h) = {
            let live = lock(&self.live);
            (live.snap.base_width, live.snap.base_height)
        };
        if w > 0 && h > 0 {
            return (w, h);
        }
        match call(c, "GetVideoSettings", Value::Null).await {
            Ok(v) => (
                u64_of(&v, "baseWidth") as u32,
                u64_of(&v, "baseHeight") as u32,
            ),
            Err(_) => (1920, 1080),
        }
    }

    async fn item_id(&self, c: &ObsClient, scene: &str, source: &str) -> AppResult<i64> {
        match c
            .request(
                "GetSceneItemId",
                json!({ "sceneName": scene, "sourceName": source }),
            )
            .await
        {
            Ok(v) => v["sceneItemId"]
                .as_i64()
                .ok_or_else(|| AppError::Obs("sent no scene item id.".into())),
            Err(e) if e.code() == Some(code::RESOURCE_NOT_FOUND) => Err(AppError::User(format!(
                "There's no source \"{source}\" in the OBS scene \"{scene}\"."
            ))),
            Err(e) => Err(errors::request(e)),
        }
    }
}

#[async_trait]
impl ObsActions for ObsService {
    async fn switch_scene(&self, scene: &str) -> AppResult<()> {
        self.set_program_scene(scene).await
    }

    async fn set_source_visible(&self, scene: &str, source: &str, state: Toggle) -> AppResult<()> {
        let c = self.client()?;
        let scene = if scene.is_empty() {
            let program = self.snapshot().program_scene;
            if program.is_empty() {
                program_name(&call(&c, "GetCurrentProgramScene", Value::Null).await?)
            } else {
                program
            }
        } else {
            scene.to_string()
        };
        let id = self.item_id(&c, &scene, source).await?;
        let current = if state == Toggle::Toggle {
            let v = call(
                &c,
                "GetSceneItemEnabled",
                json!({ "sceneName": scene, "sceneItemId": id }),
            )
            .await?;
            bool_of(&v, "sceneItemEnabled")
        } else {
            false
        };
        self.set_scene_item_enabled(&scene, id, resolve_toggle(state, current))
            .await
    }

    async fn set_input_mute(&self, input: &str, state: Toggle) -> AppResult<()> {
        match state {
            Toggle::Toggle => self
                .run("ToggleInputMute", json!({ "inputName": input }))
                .await
                .map(drop),
            s => ObsService::set_input_mute(self, input, resolve_toggle(s, false)).await,
        }
    }

    async fn set_recording(&self, state: Toggle) -> AppResult<()> {
        match state {
            Toggle::On => self.start_record().await,
            Toggle::Off => self.stop_record().await,
            Toggle::Toggle => self.toggle_record().await,
        }
    }

    async fn save_replay(&self) -> AppResult<()> {
        ObsService::save_replay(self).await
    }
}

// ---- background tasks ----

async fn supervise(weak: Weak<ObsService>, wake: Arc<Notify>) {
    loop {
        let wait = {
            let Some(svc) = weak.upgrade() else {
                return;
            };
            if svc.wants_connection() {
                match svc.retry_wait() {
                    Some(d) => Some(d),
                    None => {
                        let _g = svc.conn_lock.lock().await;
                        if svc.wants_connection() {
                            let _ = svc.open_session().await;
                        }
                        continue;
                    }
                }
            } else {
                None
            }
        };
        match wait {
            Some(d) => {
                tokio::select! {
                    _ = tokio::time::sleep(d) => {}
                    _ = wake.notified() => {}
                }
            }
            None => wake.notified().await,
        }
    }
}

async fn event_loop(weak: Weak<ObsService>, sid: u64, client: Arc<ObsClient>, mut events: Events) {
    while let Some(ev) = events.next().await {
        let Some(svc) = weak.upgrade() else {
            return;
        };
        if events.take_lagged() {
            // Some events were dropped; read the whole state again.
            svc.resync(sid, &client).await;
        }
        svc.handle_event(sid, &client, ev).await;
    }
    if let Some(svc) = weak.upgrade() {
        svc.on_lost(sid);
    }
}

async fn stats_loop(weak: Weak<ObsService>, sid: u64, client: Arc<ObsClient>) {
    let mut meter = KbpsMeter::default();
    let t0 = Instant::now();
    let mut misses = 0;
    let mut tick = tokio::time::interval(STATS_EVERY);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        let Some(svc) = weak.upgrade() else {
            return;
        };
        if svc.poll_stats(sid, &client, &mut meter, t0).await {
            misses = 0;
        } else {
            misses += 1;
            if misses >= STATS_MAX_MISSES {
                svc.on_lost(sid);
                return;
            }
        }
    }
}

/// Sends the snapshot to the window at most every EMIT_GAP.
async fn emit_loop(weak: Weak<ObsService>, sid: u64, dirty: Arc<Notify>) {
    loop {
        dirty.notified().await;
        {
            let Some(svc) = weak.upgrade() else {
                return;
            };
            let live = lock(&svc.live);
            if live.sid != sid {
                return;
            }
            svc.hub.emit_ui(ui::OBS, &live.snap);
        }
        tokio::time::sleep(EMIT_GAP).await;
    }
}

// ---- reading state from OBS ----

async fn connect_client(
    host: &str,
    port: u16,
    password: Option<&str>,
    subscriptions: u32,
) -> AppResult<(ObsClient, Events)> {
    match proto::connect(
        host,
        port,
        password,
        subscriptions,
        EVENT_BUFFER,
        CONNECT_TIMEOUT,
        REQUEST_TIMEOUT,
    )
    .await
    {
        Ok(v) => Ok(v),
        Err(e) => {
            let running =
                if e.failure == proto::ConnectFailure::Refused && convert::is_local_host(host) {
                    tokio::task::spawn_blocking(errors::obs_process_running)
                        .await
                        .ok()
                        .flatten()
                } else {
                    None
                };
            Err(AppError::User(errors::connect_message(
                e.failure,
                host,
                port,
                password.is_some(),
                running,
                &e.detail,
            )))
        }
    }
}

/// Older obs-websocket releases use `currentProgramSceneName`, newer ones also `sceneName`.
fn program_name(v: &Value) -> String {
    v["currentProgramSceneName"]
        .as_str()
        .or(v["sceneName"].as_str())
        .unwrap_or_default()
        .to_string()
}

fn preview_name(v: &Value) -> String {
    v["currentPreviewSceneName"]
        .as_str()
        .or(v["sceneName"].as_str())
        .unwrap_or_default()
        .to_string()
}

#[derive(Default)]
struct Transitions {
    names: Vec<String>,
    current: Option<String>,
    ms: Option<u32>,
}

impl Transitions {
    fn apply(self, s: &mut ObsSnapshot) {
        if !self.names.is_empty() {
            s.transitions = self.names;
        }
        if let Some(c) = self.current {
            s.current_transition = c;
        }
        if let Some(ms) = self.ms {
            s.transition_ms = ms;
        }
    }
}

async fn fetch_transitions(c: &ObsClient) -> Transitions {
    let list = call(c, "GetSceneTransitionList", Value::Null).await.ok();
    let current = call(c, "GetCurrentSceneTransition", Value::Null).await.ok();
    let names = list
        .as_ref()
        .and_then(|l| l["transitions"].as_array())
        .map(|ts| ts.iter().map(|t| str_of(t, "transitionName")).collect())
        .unwrap_or_default();
    let name = current
        .as_ref()
        .and_then(|t| t["transitionName"].as_str())
        .or_else(|| {
            list.as_ref()
                .and_then(|l| l["currentSceneTransitionName"].as_str())
        })
        .map(String::from);
    // Fixed transitions (Cut) have no duration.
    let ms = current
        .as_ref()
        .and_then(|t| t["transitionDuration"].as_u64())
        .map(|ms| ms.min(u64::from(u32::MAX)) as u32);
    Transitions {
        names,
        current: name,
        ms,
    }
}

async fn fetch_all(c: &ObsClient) -> AppResult<ObsSnapshot> {
    let v = call(c, "GetVersion", Value::Null).await?;
    let list = call(c, "GetSceneList", Value::Null).await?;
    let opt = |kind: &'static str| async move { call(c, kind, Value::Null).await.ok() };
    let studio = opt("GetStudioModeEnabled")
        .await
        .is_some_and(|v| bool_of(&v, "studioModeEnabled"));
    let video = opt("GetVideoSettings").await.unwrap_or_default();
    let stream = opt("GetStreamStatus").await.unwrap_or_default();
    let record = opt("GetRecordStatus").await.unwrap_or_default();
    let replay = opt("GetReplayBufferStatus").await;
    let vcam = opt("GetVirtualCamStatus").await.unwrap_or_default();
    let preview = list["currentPreviewSceneName"]
        .as_str()
        .filter(|_| studio)
        .map(String::from);

    let mut snap = ObsSnapshot {
        state: ConnState::Connected,
        obs_version: str_of(&v, "obsVersion"),
        websocket_version: str_of(&v, "obsWebSocketVersion"),
        scenes: state::scene_names(&list["scenes"]),
        program_scene: str_of(&list, "currentProgramSceneName"),
        preview_scene: preview,
        studio_mode: studio,
        replay_buffer: replay.map(|r| bool_of(&r, "outputActive")),
        virtual_cam: bool_of(&vcam, "outputActive"),
        base_width: u64_of(&video, "baseWidth") as u32,
        base_height: u64_of(&video, "baseHeight") as u32,
        ..ObsSnapshot::default()
    };
    snap.stream.active = bool_of(&stream, "outputActive");
    snap.stream.duration_ms = u64_of(&stream, "outputDuration");
    snap.record.active = bool_of(&record, "outputActive");
    snap.record.paused = bool_of(&record, "outputPaused");
    snap.record.duration_ms = u64_of(&record, "outputDuration");
    fetch_transitions(c).await.apply(&mut snap);
    snap.inputs = fetch_inputs(c).await?;
    let edited = state::edited_scene(&snap).to_string();
    if !edited.is_empty() {
        snap.scene_items = fetch_items(c, &edited).await.unwrap_or_default();
    }
    Ok(snap)
}

async fn fetch_items(c: &ObsClient, scene: &str) -> AppResult<Vec<SceneItem>> {
    let v = call(c, "GetSceneItemList", json!({ "sceneName": scene })).await?;
    let list = v["sceneItems"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let items = list
        .iter()
        .map(|it| {
            let is_group = bool_of(it, "isGroup");
            let kind = match it["inputKind"].as_str() {
                Some(k) => k.to_string(),
                None if is_group => "group".into(),
                None if it["sourceType"] == "OBS_SOURCE_TYPE_SCENE" => "scene".into(),
                None => String::new(),
            };
            (
                u64_of(it, "sceneItemIndex") as usize,
                SceneItem {
                    id: it["sceneItemId"].as_i64().unwrap_or(0),
                    name: str_of(it, "sourceName"),
                    kind,
                    visible: it["sceneItemEnabled"].as_bool().unwrap_or(true),
                    locked: bool_of(it, "sceneItemLocked"),
                    is_group,
                },
            )
        })
        .collect();
    Ok(convert::top_first(items))
}

async fn fetch_inputs(c: &ObsClient) -> AppResult<Vec<AudioInput>> {
    let v = call(c, "GetInputList", Value::Null).await?;
    let list = v["inputs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let found = join_all(list.iter().map(|i| async move {
        fetch_audio_input(c, &str_of(i, "inputName"), &str_of(i, "inputKind")).await
    }))
    .await;
    Ok(found.into_iter().flatten().collect())
}

/// None when the input has no audio.
async fn fetch_audio_input(c: &ObsClient, name: &str, kind: &str) -> Option<AudioInput> {
    let input = json!({ "inputName": name });
    let vol = c.request("GetInputVolume", input.clone()).await.ok()?;
    let muted = c.request("GetInputMute", input.clone()).await.ok();
    let monitor = c.request("GetInputAudioMonitorType", input).await.ok();
    Some(AudioInput {
        name: name.to_string(),
        kind: kind.to_string(),
        volume_db: state::volume_db(&vol),
        muted: muted.is_some_and(|m| bool_of(&m, "inputMuted")),
        monitoring: monitor.is_some_and(|m| state::monitoring(&m)),
    })
}
