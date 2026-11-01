//! Runs actions: a list of steps started by triggers (events, chat commands,
//! timers, OBS scene changes, buttons).

pub mod script;

use crate::alerts::AlertEngine;
use crate::error::{AppResult, user_err};
use crate::hub::{Hub, Signal, ui};
use crate::model::automation::{Action, HttpMethod, Permission, Step, Toggle, Trigger};
use crate::model::condition::stringify;
use crate::model::event::{Event, EventKind, UserRoles};
use crate::model::runtime::{LogLevel, OverlayMsg};
use crate::services::{ObsActions, TwitchActions};
use crate::store::project::ProjectStore;
use crate::template::render;
use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use ts_rs::TS;

/// Longest delay a single step may wait.
pub const MAX_DELAY_MS: u32 = 10 * 60 * 1000;
/// "Run action" may nest this deep.
const MAX_DEPTH: u32 = 6;
/// Loop breaker: an action can't run more than this many times in `BURST_WINDOW`.
const BURST_LIMIT: usize = 20;
const BURST_WINDOW: Duration = Duration::from_secs(10);
const HTTP_MAX_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct ActionRun {
    pub action_id: String,
    pub name: String,
    pub trigger: String,
    pub ok: bool,
    pub errors: Vec<String>,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

enum Flow {
    Continue,
    Stop,
}

struct RunCtx {
    /// Arguments plus variables, read by templates and conditions.
    ctx: Map<String, Value>,
    /// Chat message id that started the run (for replies).
    reply_to: Option<String>,
    errors: Vec<String>,
    depth: u32,
}

pub struct Automation {
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    alerts: Arc<AlertEngine>,
    twitch: RwLock<Option<Arc<dyn TwitchActions>>>,
    obs: RwLock<Option<Arc<dyn ObsActions>>>,
    http: reqwest::Client,
    last_run: Mutex<HashMap<String, Instant>>,
    user_cooldowns: Mutex<HashMap<(String, String), Instant>>,
    bursts: Mutex<HashMap<String, VecDeque<Instant>>>,
    timers: Mutex<HashMap<(String, usize), (Instant, u64)>>,
    chat_lines: AtomicU64,
    live: AtomicBool,
    /// Account ids whose chat messages never trigger commands (the bot).
    ignored_users: RwLock<Vec<String>>,
}

impl Automation {
    pub fn new(hub: Arc<Hub>, project: Arc<ProjectStore>, alerts: Arc<AlertEngine>) -> Arc<Self> {
        Arc::new(Automation {
            hub,
            project,
            alerts,
            twitch: RwLock::new(None),
            obs: RwLock::new(None),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("Castwright/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
            last_run: Mutex::new(HashMap::new()),
            user_cooldowns: Mutex::new(HashMap::new()),
            bursts: Mutex::new(HashMap::new()),
            timers: Mutex::new(HashMap::new()),
            chat_lines: AtomicU64::new(0),
            live: AtomicBool::new(false),
            ignored_users: RwLock::new(Vec::new()),
        })
    }

    pub fn set_twitch(&self, t: Arc<dyn TwitchActions>) {
        *self.twitch.write().unwrap() = Some(t);
    }

    pub fn set_obs(&self, o: Arc<dyn ObsActions>) {
        *self.obs.write().unwrap() = Some(o);
    }

    pub fn set_ignored_users(&self, ids: Vec<String>) {
        *self.ignored_users.write().unwrap() = ids;
    }

    pub fn set_live(&self, live: bool) {
        self.live.store(live, Ordering::SeqCst);
    }

    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        let mut events = self.hub.subscribe_events();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(e) => me.on_event(&e),
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        me.hub.log(
                            LogLevel::Warn,
                            "automation",
                            format!("Skipped {n} events (too many at once)."),
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        let mut signals = self.hub.subscribe_signals();
        tokio::spawn(async move {
            loop {
                match signals.recv().await {
                    Ok(s) => me.on_signal(&s),
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        let mut played = self.alerts.subscribe_played();
        tokio::spawn(async move {
            loop {
                match played.recv().await {
                    Ok(p) => {
                        if let Some(id) = p.run_action {
                            let ctx = p.play.event.as_context();
                            me.spawn_run(&id, "alert", ctx_from(&ctx), None);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(1));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                me.on_tick(Instant::now());
            }
        });
    }

    fn actions(&self) -> Vec<Action> {
        self.project
            .read(|p| p.actions.iter().filter(|a| a.enabled).cloned().collect())
    }

    pub fn on_event(self: &Arc<Self>, event: &Event) {
        match event.kind {
            EventKind::Chat => {
                self.chat_lines.fetch_add(1, Ordering::Relaxed);
            }
            EventKind::StreamOnline => self.set_live(true),
            EventKind::StreamOffline => self.set_live(false),
            _ => {}
        }
        let ctx = event.as_context();
        for action in self.actions() {
            let hit = action.triggers.iter().find_map(|trigger| match trigger {
                Trigger::Event { kind, conditions }
                    if *kind == event.kind && conditions.evaluate(&ctx) =>
                {
                    Some((event.kind.as_str().to_string(), Map::new(), None))
                }
                Trigger::StreamOnline if event.kind == EventKind::StreamOnline => {
                    Some(("stream online".to_string(), Map::new(), None))
                }
                Trigger::StreamOffline if event.kind == EventKind::StreamOffline => {
                    Some(("stream offline".to_string(), Map::new(), None))
                }
                Trigger::Command {
                    name,
                    aliases,
                    permission,
                    user_cooldown_s,
                } if event.kind == EventKind::Chat => {
                    let args = self.match_command(event, name, aliases, *permission)?;
                    self.user_cooldown_ok(&action.id, event, *user_cooldown_s)
                        .then(|| {
                            (
                                format!("!{}", name.trim_start_matches('!')),
                                args,
                                Some(event.id.clone()),
                            )
                        })
                }
                _ => None,
            });
            if let Some((label, extra, reply_to)) = hit {
                let mut c = ctx_from(&ctx);
                c.extend(extra);
                self.spawn_run(&action.id, &label, c, reply_to);
            }
        }
    }

    fn on_signal(self: &Arc<Self>, s: &Signal) {
        let Signal::SceneChanged { scene } = s else {
            return;
        };
        for action in self.actions() {
            let hit = action.triggers.iter().any(|t| {
                matches!(t, Trigger::SceneChanged { scene: want } if want.is_empty() || want.eq_ignore_ascii_case(scene))
            });
            if hit {
                let mut c = Map::new();
                c.insert("scene".into(), Value::String(scene.clone()));
                self.spawn_run(&action.id, "scene change", c, None);
            }
        }
    }

    fn on_tick(self: &Arc<Self>, now: Instant) {
        let lines = self.chat_lines.load(Ordering::Relaxed);
        let live = self.live.load(Ordering::SeqCst);
        let mut due = Vec::new();
        {
            let mut timers = self.timers.lock().unwrap();
            let mut seen = Vec::new();
            for action in self.actions() {
                for (i, t) in action.triggers.iter().enumerate() {
                    let Trigger::Timer {
                        interval_s,
                        only_when_live,
                        min_chat_lines,
                    } = t
                    else {
                        continue;
                    };
                    let key = (action.id.clone(), i);
                    seen.push(key.clone());
                    let interval = Duration::from_secs((*interval_s).max(10) as u64);
                    let entry = timers.entry(key).or_insert((now, lines));
                    if now.duration_since(entry.0) < interval {
                        continue;
                    }
                    if (*only_when_live && !live)
                        || lines.saturating_sub(entry.1) < *min_chat_lines as u64
                    {
                        // Not this time; check again next interval.
                        entry.0 = now;
                        continue;
                    }
                    *entry = (now, lines);
                    due.push(action.id.clone());
                }
            }
            timers.retain(|k, _| seen.contains(k));
        }
        for id in due {
            self.spawn_run(&id, "timer", Map::new(), None);
        }
    }

    /// If the chat message is this command and the sender may use it, the command arguments.
    fn match_command(
        &self,
        event: &Event,
        name: &str,
        aliases: &[String],
        permission: Permission,
    ) -> Option<Map<String, Value>> {
        if event
            .data
            .get("sent_by_castwright")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return None;
        }
        if let Some(u) = &event.user
            && self
                .ignored_users
                .read()
                .unwrap()
                .iter()
                .any(|id| *id == u.id && !u.id.is_empty())
        {
            return None;
        }
        let text = event.message.as_deref()?.trim();
        let rest = text.strip_prefix('!')?;
        let (word, input) = match rest.find(char::is_whitespace) {
            Some(i) => (&rest[..i], rest[i..].trim()),
            None => (rest, ""),
        };
        let matches = |n: &str| {
            let n = n.trim().trim_start_matches('!');
            !n.is_empty() && n.eq_ignore_ascii_case(word)
        };
        if !matches(name) && !aliases.iter().any(|a| matches(a)) {
            return None;
        }
        if rank(&event.roles) < permission {
            return None;
        }
        let mut args = Map::new();
        args.insert("command".into(), Value::String(word.to_lowercase()));
        args.insert("input".into(), Value::String(input.to_string()));
        let words: Vec<&str> = input.split_whitespace().collect();
        args.insert("arg_count".into(), Value::from(words.len()));
        for (i, w) in words.iter().enumerate() {
            args.insert(
                format!("arg{}", i + 1),
                Value::String(w.trim_start_matches('@').to_string()),
            );
        }
        Some(args)
    }

    fn user_cooldown_ok(&self, action_id: &str, event: &Event, cooldown_s: u32) -> bool {
        if cooldown_s == 0 || event.roles.broadcaster || event.roles.moderator {
            return true;
        }
        let Some(user) = &event.user else { return true };
        let key = (action_id.to_string(), user.id.clone());
        let mut map = self.user_cooldowns.lock().unwrap();
        let now = Instant::now();
        if let Some(last) = map.get(&key)
            && now.duration_since(*last) < Duration::from_secs(cooldown_s as u64)
        {
            return false;
        }
        map.insert(key, now);
        if map.len() > 10_000 {
            map.retain(|_, t| now.duration_since(*t) < Duration::from_secs(3600));
        }
        true
    }

    /// Run an action from a button, the local API or a Stream Deck.
    pub fn run_manual(self: &Arc<Self>, action_id: &str) -> AppResult<()> {
        if !self
            .project
            .read(|p| p.actions.iter().any(|a| a.id == action_id))
        {
            return user_err("That action no longer exists.");
        }
        self.spawn_run_inner(action_id, "manual", Map::new(), None, true);
        Ok(())
    }

    fn spawn_run(
        self: &Arc<Self>,
        action_id: &str,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
    ) {
        self.spawn_run_inner(action_id, trigger, args, reply_to, false);
    }

    fn spawn_run_inner(
        self: &Arc<Self>,
        action_id: &str,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
        manual: bool,
    ) {
        let Some(action) = self
            .project
            .read(|p| p.actions.iter().find(|a| a.id == action_id).cloned())
        else {
            return;
        };
        if !manual && (!action.enabled || !self.cooldown_ok(&action)) {
            return;
        }
        if !self.burst_ok(&action) {
            self.hub.log(
                LogLevel::Warn,
                "automation",
                format!(
                    "\"{}\" ran too many times in a row and was paused for a few seconds.",
                    action.name
                ),
            );
            return;
        }
        let me = self.clone();
        let trigger = trigger.to_string();
        tokio::spawn(async move {
            let run = me.execute(&action, &trigger, args, reply_to).await;
            me.hub.emit_ui(ui::ACTION_RUN, &run);
        });
    }

    fn cooldown_ok(&self, action: &Action) -> bool {
        if action.cooldown_s == 0 {
            return true;
        }
        let mut map = self.last_run.lock().unwrap();
        let now = Instant::now();
        if let Some(last) = map.get(&action.id)
            && now.duration_since(*last) < Duration::from_secs(action.cooldown_s as u64)
        {
            return false;
        }
        map.insert(action.id.clone(), now);
        true
    }

    fn burst_ok(&self, action: &Action) -> bool {
        let mut map = self.bursts.lock().unwrap();
        let q = map.entry(action.id.clone()).or_default();
        let now = Instant::now();
        while q
            .front()
            .is_some_and(|t| now.duration_since(*t) > BURST_WINDOW)
        {
            q.pop_front();
        }
        if q.len() >= BURST_LIMIT {
            return false;
        }
        q.push_back(now);
        true
    }

    /// Run all steps of `action` and report what happened.
    pub async fn execute(
        self: &Arc<Self>,
        action: &Action,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
    ) -> ActionRun {
        let started = Instant::now();
        let mut ctx = self.hub.vars.snapshot();
        ctx.extend(args);
        let mut run = RunCtx {
            ctx,
            reply_to,
            errors: Vec::new(),
            depth: 0,
        };
        self.run_steps(&action.steps, &mut run).await;
        for e in &run.errors {
            self.hub.log(
                LogLevel::Error,
                "automation",
                format!("{}: {e}", action.name),
            );
        }
        ActionRun {
            action_id: action.id.clone(),
            name: action.name.clone(),
            trigger: trigger.to_string(),
            ok: run.errors.is_empty(),
            errors: run.errors,
            duration_ms: started.elapsed().as_millis() as u64,
        }
    }

    fn run_steps<'a>(
        self: &'a Arc<Self>,
        steps: &'a [Step],
        run: &'a mut RunCtx,
    ) -> BoxFuture<'a, Flow> {
        Box::pin(async move {
            for step in steps {
                match self.run_step(step, run).await {
                    Ok(Flow::Continue) => {}
                    Ok(Flow::Stop) => return Flow::Stop,
                    Err(e) => run.errors.push(format!("{}: {e}", step_label(step))),
                }
            }
            Flow::Continue
        })
    }

    fn twitch(&self) -> AppResult<Arc<dyn TwitchActions>> {
        self.twitch
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| crate::error::AppError::User("Twitch isn't connected.".into()))
    }

    fn obs(&self) -> AppResult<Arc<dyn ObsActions>> {
        self.obs
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| crate::error::AppError::User("OBS isn't connected.".into()))
    }

    async fn run_step(self: &Arc<Self>, step: &Step, run: &mut RunCtx) -> AppResult<Flow> {
        let ctx = Value::Object(run.ctx.clone());
        let t = |s: &str| render(s, &ctx);
        match step {
            Step::ChatSend {
                message,
                as_bot,
                reply,
            } => {
                let msg = t(message);
                if !msg.trim().is_empty() {
                    let reply_to = if *reply {
                        run.reply_to.as_deref()
                    } else {
                        None
                    };
                    self.twitch()?.send_chat(&msg, *as_bot, reply_to).await?;
                }
            }
            Step::ChatAnnounce { message, color } => {
                let msg = t(message);
                if !msg.trim().is_empty() {
                    self.twitch()?.announce(&msg, color).await?;
                }
            }
            Step::Shoutout { user, message } => {
                let login = t(user).trim().trim_start_matches('@').to_lowercase();
                if login.is_empty() {
                    return user_err("No user to shout out.");
                }
                let tw = self.twitch()?;
                tw.shoutout(&login).await?;
                let msg = t(message);
                if !msg.trim().is_empty() {
                    tw.send_chat(&msg, true, None).await?;
                }
            }
            Step::CreateClip => {
                let url = self.twitch()?.create_clip().await?;
                self.set_var(run, "last.clip.url", Value::String(url), true);
            }
            Step::CreateMarker { description } => {
                self.twitch()?.create_marker(&t(description)).await?
            }
            Step::RunAd { length_s } => self.twitch()?.run_ad(*length_s).await?,
            Step::SetStreamInfo { title, category } => {
                self.twitch()?
                    .set_stream_info(&t(title), &t(category))
                    .await?
            }
            Step::TimeoutUser {
                user,
                duration_s,
                reason,
            } => {
                let login = t(user).trim().trim_start_matches('@').to_lowercase();
                if login.is_empty() {
                    return user_err("No user to time out.");
                }
                self.twitch()?
                    .timeout_user(&login, (*duration_s).clamp(1, 1_209_600), &t(reason))
                    .await?
            }
            Step::Delay { ms } => {
                tokio::time::sleep(Duration::from_millis((*ms).min(MAX_DELAY_MS) as u64)).await;
            }
            Step::SetVariable {
                key,
                value,
                persist,
            } => {
                let key = t(key);
                if !crate::vars::valid_key(&key) {
                    return user_err(format!("\"{key}\" isn't a valid variable name."));
                }
                let text = t(value);
                let v = crate::model::condition::parse_number(&text)
                    .map(crate::vars::num)
                    .unwrap_or(Value::String(text));
                self.set_var(run, &key, v, *persist);
            }
            Step::AddToVariable {
                key,
                amount,
                persist,
            } => {
                let key = t(key);
                if !crate::vars::valid_key(&key) {
                    return user_err(format!("\"{key}\" isn't a valid variable name."));
                }
                let n = self.hub.add_var(&key, *amount, *persist);
                run.ctx.insert(key, crate::vars::num(n));
            }
            Step::SwitchScene { scene } => self.obs()?.switch_scene(&t(scene)).await?,
            Step::SetSourceVisible {
                scene,
                source,
                state,
            } => {
                self.obs()?
                    .set_source_visible(&t(scene), &t(source), *state)
                    .await?
            }
            Step::SetInputMute { input, state } => {
                self.obs()?.set_input_mute(&t(input), *state).await?
            }
            Step::Recording { state } => self.obs()?.set_recording(*state).await?,
            Step::SaveReplay => self.obs()?.save_replay().await?,
            Step::SetLayerVisible {
                overlay_id,
                layer_id,
                state,
            } => self.set_layer_visible(overlay_id, layer_id, *state)?,
            Step::PlayAlert {
                title,
                message,
                image,
                sound,
                duration_ms,
            } => self
                .alerts
                .enqueue_custom(&t(title), &t(message), image, sound, *duration_ms),
            Step::PlaySound { src, volume } => self.hub.to_overlays(
                None,
                OverlayMsg::PlaySound {
                    src: t(src),
                    volume: (*volume).min(100),
                },
            ),
            Step::HttpRequest {
                method,
                url,
                body,
                save_to,
            } => {
                let text = self.http_request(*method, &t(url), &t(body)).await?;
                let key = t(save_to);
                if !key.is_empty() {
                    self.set_var(run, &key, Value::String(text), false);
                }
            }
            Step::RunScript { code } => {
                let args = run.ctx.clone();
                let vars = run.ctx.clone();
                let code = code.clone();
                let fx = tokio::task::spawn_blocking(move || script::run(&code, &args, vars))
                    .await
                    .map_err(|e| crate::error::AppError::User(e.to_string()))?
                    .map_err(crate::error::AppError::User)?;
                for (k, v, persist) in fx.set_vars {
                    self.set_var(run, &k, v, persist);
                }
                for l in fx.logs {
                    self.hub.log(LogLevel::Info, "script", l);
                }
                for m in fx.chat {
                    self.twitch()?.send_chat(&m, true, None).await?;
                }
            }
            Step::If {
                conditions,
                then,
                otherwise,
            } => {
                let branch = if conditions.evaluate(&ctx) {
                    then
                } else {
                    otherwise
                };
                if let Flow::Stop = self.run_steps(branch, run).await {
                    return Ok(Flow::Stop);
                }
            }
            Step::RunAction { action_id } => {
                if run.depth >= MAX_DEPTH {
                    return user_err("Actions call each other too deeply.");
                }
                let Some(other) = self
                    .project
                    .read(|p| p.actions.iter().find(|a| a.id == *action_id).cloned())
                else {
                    return user_err("The action to run no longer exists.");
                };
                run.depth += 1;
                let flow = self.run_steps(&other.steps, run).await;
                run.depth -= 1;
                if let Flow::Stop = flow {
                    return Ok(Flow::Stop);
                }
            }
            Step::Stop => return Ok(Flow::Stop),
            Step::Log { message } => self.hub.log(LogLevel::Info, "automation", t(message)),
        }
        Ok(Flow::Continue)
    }

    fn set_var(&self, run: &mut RunCtx, key: &str, value: Value, persist: bool) {
        self.hub.set_var(key, value.clone(), persist);
        run.ctx.insert(key.to_string(), value);
    }

    fn set_layer_visible(&self, overlay_id: &str, layer_id: &str, state: Toggle) -> AppResult<()> {
        let visible = self.project.update(|p| {
            let layer = p
                .overlays
                .iter_mut()
                .find(|o| o.id == overlay_id)?
                .layers
                .iter_mut()
                .find(|l| l.id == layer_id)?;
            layer.visible = match state {
                Toggle::On => true,
                Toggle::Off => false,
                Toggle::Toggle => !layer.visible,
            };
            Some(layer.visible)
        });
        let Some(visible) = visible else {
            return user_err("That overlay layer no longer exists.");
        };
        self.project.mark_dirty();
        self.hub.to_overlays(
            Some(overlay_id),
            OverlayMsg::LayerVisible {
                layer_id: layer_id.to_string(),
                visible,
            },
        );
        self.hub.emit_ui(
            ui::PROJECT,
            &serde_json::json!({ "overlay_id": overlay_id }),
        );
        Ok(())
    }

    async fn http_request(&self, method: HttpMethod, url: &str, body: &str) -> AppResult<String> {
        let parsed = url::Url::parse(url.trim())
            .map_err(|_| crate::error::AppError::User(format!("\"{url}\" isn't a web address.")))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return user_err("Only http and https addresses are allowed.");
        }
        let m = match method {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Delete => reqwest::Method::DELETE,
        };
        let mut req = self.http.request(m, parsed);
        if !body.is_empty() && !matches!(method, HttpMethod::Get) {
            let is_json = serde_json::from_str::<Value>(body).is_ok();
            req = req
                .header(
                    reqwest::header::CONTENT_TYPE,
                    if is_json {
                        "application/json"
                    } else {
                        "text/plain; charset=utf-8"
                    },
                )
                .body(body.to_string());
        }
        let resp = req.send().await?;
        let status = resp.status();
        let bytes = resp.bytes().await?;
        let slice = &bytes[..bytes.len().min(HTTP_MAX_BYTES)];
        let text = String::from_utf8_lossy(slice).into_owned();
        if !status.is_success() {
            return user_err(format!("The server answered {status}."));
        }
        Ok(text)
    }
}

fn rank(roles: &UserRoles) -> Permission {
    if roles.broadcaster {
        Permission::Broadcaster
    } else if roles.moderator {
        Permission::Moderator
    } else if roles.vip {
        Permission::Vip
    } else if roles.subscriber {
        Permission::Subscriber
    } else {
        Permission::Everyone
    }
}

fn ctx_from(v: &Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}

pub fn step_label(step: &Step) -> &'static str {
    match step {
        Step::ChatSend { .. } => "Send chat message",
        Step::ChatAnnounce { .. } => "Announcement",
        Step::Shoutout { .. } => "Shoutout",
        Step::CreateClip => "Create clip",
        Step::CreateMarker { .. } => "Stream marker",
        Step::RunAd { .. } => "Run ad",
        Step::SetStreamInfo { .. } => "Set stream info",
        Step::TimeoutUser { .. } => "Time out user",
        Step::Delay { .. } => "Wait",
        Step::SetVariable { .. } => "Set variable",
        Step::AddToVariable { .. } => "Add to variable",
        Step::SwitchScene { .. } => "Switch scene",
        Step::SetSourceVisible { .. } => "Show/hide source",
        Step::SetInputMute { .. } => "Mute/unmute",
        Step::Recording { .. } => "Recording",
        Step::SaveReplay => "Save replay",
        Step::SetLayerVisible { .. } => "Show/hide overlay layer",
        Step::PlayAlert { .. } => "Play alert",
        Step::PlaySound { .. } => "Play sound",
        Step::HttpRequest { .. } => "Web request",
        Step::RunScript { .. } => "Run script",
        Step::If { .. } => "If",
        Step::RunAction { .. } => "Run action",
        Step::Stop => "Stop",
        Step::Log { .. } => "Log",
    }
}

pub fn value_text(v: &Value) -> String {
    stringify(v)
}

#[cfg(test)]
mod tests;
