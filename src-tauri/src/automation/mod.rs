//! Runs actions: graphs of steps started by triggers (events, chat commands,
//! timers, OBS scene changes, buttons).

pub mod interact;
pub mod script;

use crate::alerts::AlertEngine;
use crate::error::{AppResult, user_err};
use crate::hub::{Hub, PlayTrigger, Signal, ui};
use crate::model::ads::{AdAlarm, AdSchedule, clock};
use crate::model::automation::{
    Action, EdgeBranch, Graph, HttpMethod, NodeKind, Permission, Step, Toggle, Trigger,
};
use crate::model::condition::stringify;
use crate::model::event::{Event, EventKind, UserRoles};
use crate::model::interact::{PollDraft, PredictionAction, PredictionDraft};
use crate::model::music::NowPlaying;
use crate::model::overlay::LayerKind;
use crate::model::runtime::{LogLevel, OverlayMsg};
use crate::services::{DiscordActions, ObsActions, PlayActions, SoundActions, TwitchActions};
use crate::store::project::ProjectStore;
use crate::template::render;
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
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
/// Loop breaker inside one run: at most this many nodes run.
pub const MAX_NODE_RUNS: u32 = 500;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ActionRun {
    /// Matches the `run_id` of the progress sent while it ran.
    #[serde(default)]
    #[ts(type = "number")]
    pub run_id: u64,
    pub action_id: String,
    pub name: String,
    pub trigger: String,
    pub ok: bool,
    pub errors: Vec<String>,
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// What happened at each node, in the order they first ran. Nodes the run could
    /// have reached but didn't are `skipped`.
    #[serde(default)]
    pub nodes: Vec<NodeResult>,
    /// Every node run, in order, with the line taken to reach it.
    #[serde(default)]
    pub steps: Vec<RunStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunStep {
    pub node_id: String,
    /// Line the run took to get here; `None` where the run started.
    pub via: Option<String>,
    pub state: NodeState,
}

/// Sent when a node starts and again when it finishes, so the app can follow a run live.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunProgress {
    #[ts(type = "number")]
    pub run_id: u64,
    pub action_id: String,
    pub node_id: String,
    pub via: Option<String>,
    /// `None` while the node runs.
    pub state: Option<NodeState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum NodeState {
    Ok,
    Error,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NodeResult {
    pub node_id: String,
    pub state: NodeState,
    #[serde(default)]
    pub errors: Vec<String>,
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
    /// Nodes left before the run is stopped as a loop.
    budget: u32,
    nodes: Vec<NodeResult>,
    run_id: u64,
    action_id: String,
    steps: Vec<RunStep>,
}

impl RunCtx {
    /// Results are kept for the action that was started, not for ones it runs.
    fn record(&mut self, id: &str, error: Option<String>) {
        if self.depth > 0 {
            return;
        }
        match self.nodes.iter_mut().find(|n| n.node_id == id) {
            Some(n) => {
                if let Some(e) = error {
                    n.state = NodeState::Error;
                    n.errors.push(e);
                }
            }
            None => self.nodes.push(NodeResult {
                node_id: id.to_string(),
                state: if error.is_some() {
                    NodeState::Error
                } else {
                    NodeState::Ok
                },
                errors: error.into_iter().collect(),
            }),
        }
    }
}

pub struct Automation {
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    alerts: Arc<AlertEngine>,
    twitch: RwLock<Option<Arc<dyn TwitchActions>>>,
    obs: RwLock<Option<Arc<dyn ObsActions>>>,
    discord: RwLock<Option<Arc<dyn DiscordActions>>>,
    sounds: RwLock<Option<Arc<dyn SoundActions>>>,
    play: RwLock<Option<Arc<dyn PlayActions>>>,
    http: reqwest::Client,
    last_run: Mutex<HashMap<String, Instant>>,
    user_cooldowns: Mutex<HashMap<(String, String), Instant>>,
    bursts: Mutex<HashMap<String, VecDeque<Instant>>>,
    timers: Mutex<HashMap<(String, usize), (Instant, u64)>>,
    chat_lines: AtomicU64,
    live: AtomicBool,
    /// Account ids whose chat messages never trigger commands (the bot).
    ignored_users: RwLock<Vec<String>>,
    run_ids: AtomicU64,
    ads: Mutex<AdWatch>,
}

/// The latest ad schedule, and which "ad soon" triggers already ran for the next ad.
#[derive(Default)]
struct AdWatch {
    schedule: AdSchedule,
    alarms: HashMap<(String, usize), AdAlarm>,
}

/// Values ad triggers give an action.
fn ad_args(length_s: u32, seconds_left: u32) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("ad.length_s".into(), length_s.into());
    m.insert("ad.length".into(), clock(length_s).into());
    m.insert("ad.seconds_left".into(), seconds_left.into());
    m.insert("ad.time".into(), clock(seconds_left).into());
    m
}

fn song_args(song: &NowPlaying) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("title".into(), song.title.clone().into());
    m.insert("artist".into(), song.artist.clone().into());
    m.insert("album".into(), song.album.clone().into());
    m.insert("art_url".into(), song.art_url.clone().into());
    m
}

impl Automation {
    pub fn new(hub: Arc<Hub>, project: Arc<ProjectStore>, alerts: Arc<AlertEngine>) -> Arc<Self> {
        Arc::new(Automation {
            hub,
            project,
            alerts,
            twitch: RwLock::new(None),
            obs: RwLock::new(None),
            discord: RwLock::new(None),
            sounds: RwLock::new(None),
            play: RwLock::new(None),
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
            run_ids: AtomicU64::new(0),
            ads: Mutex::default(),
        })
    }

    pub fn alerts(&self) -> &Arc<AlertEngine> {
        &self.alerts
    }

    pub fn set_twitch(&self, t: Arc<dyn TwitchActions>) {
        *self.twitch.write().unwrap() = Some(t);
    }

    pub fn set_obs(&self, o: Arc<dyn ObsActions>) {
        *self.obs.write().unwrap() = Some(o);
    }

    pub fn set_discord(&self, d: Arc<dyn DiscordActions>) {
        *self.discord.write().unwrap() = Some(d);
    }

    pub fn set_sounds(&self, s: Arc<dyn SoundActions>) {
        *self.sounds.write().unwrap() = Some(s);
    }
    pub fn set_play(&self, p: Arc<dyn PlayActions>) {
        *self.play.write().unwrap() = Some(p);
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
        crate::util::spawn(async move {
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
        crate::util::spawn(async move {
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
        crate::util::spawn(async move {
            loop {
                match played.recv().await {
                    Ok(p) => {
                        if let Some(id) = p.run_action {
                            if p.play.event.test {
                                me.skip_for_test(&id);
                                continue;
                            }
                            let ctx = p.play.event.as_context();
                            me.spawn_run(&id, None, "alert", ctx_from(&ctx), None);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        crate::util::spawn(async move {
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

    /// Test buttons make sample events with made-up viewers; running real
    /// Twitch steps for them (shoutouts, timeouts) would hit real people.
    fn skip_for_test(&self, action_id: &str) {
        let name = self.project.read(|p| {
            p.actions
                .iter()
                .find(|a| a.id == action_id)
                .map(|a| a.name.clone())
        });
        if let Some(name) = name {
            self.hub.log(
                LogLevel::Info,
                "automation",
                format!(
                    "Test event: \"{name}\" wasn't run. Use Test on the Automation page to try it."
                ),
            );
        }
    }

    pub fn on_event(self: &Arc<Self>, event: &Event) {
        match event.kind {
            EventKind::Chat if !self.is_own_chat(event) => {
                self.chat_lines.fetch_add(1, Ordering::Relaxed);
            }
            EventKind::StreamOnline => self.set_live(true),
            EventKind::StreamOffline => self.set_live(false),
            _ => {}
        }
        let ctx = event.as_context();
        let extra_args = interact::args(event);
        for action in self.actions() {
            let hit =
                action
                    .triggers
                    .iter()
                    .enumerate()
                    .find_map(|(index, trigger)| match trigger {
                        Trigger::Event { kind, conditions }
                            if *kind == event.kind
                                && !(event.kind == EventKind::Chat && self.is_own_chat(event))
                                && conditions.evaluate(&ctx) =>
                        {
                            Some((index, event.kind.as_str().to_string(), Map::new(), None))
                        }
                        Trigger::StreamOnline if event.kind == EventKind::StreamOnline => {
                            Some((index, "stream online".to_string(), Map::new(), None))
                        }
                        Trigger::StreamOffline if event.kind == EventKind::StreamOffline => {
                            Some((index, "stream offline".to_string(), Map::new(), None))
                        }
                        Trigger::Redemption {
                            reward_id,
                            reward_title,
                        } if event.kind == EventKind::Redemption
                            && interact::reward_matches(event, reward_id, reward_title) =>
                        {
                            Some((index, "redemption".to_string(), Map::new(), None))
                        }
                        Trigger::PollBegin if event.kind == EventKind::PollBegin => {
                            Some((index, "poll starts".to_string(), Map::new(), None))
                        }
                        Trigger::PollEnd
                            if event.kind == EventKind::PollEnd && interact::is_real_end(event) =>
                        {
                            Some((index, "poll ends".to_string(), Map::new(), None))
                        }
                        Trigger::PredictionBegin if event.kind == EventKind::PredictionBegin => {
                            Some((index, "prediction starts".to_string(), Map::new(), None))
                        }
                        Trigger::PredictionEnd if event.kind == EventKind::PredictionEnd => {
                            Some((index, "prediction ends".to_string(), Map::new(), None))
                        }
                        Trigger::HypeTrainBegin if event.kind == EventKind::HypeTrainBegin => {
                            Some((index, "hype train begins".to_string(), Map::new(), None))
                        }
                        Trigger::HypeTrainEnd if event.kind == EventKind::HypeTrainEnd => {
                            Some((index, "hype train ends".to_string(), Map::new(), None))
                        }
                        Trigger::Command {
                            name,
                            aliases,
                            permission,
                            user_cooldown_s,
                        } if event.kind == EventKind::Chat => {
                            let args = self.match_command(event, name, aliases, *permission)?;
                            // Don't use up the viewer's cooldown when the action can't run anyway.
                            if !action.enabled || !self.cooldown_ready(&action) {
                                return None;
                            }
                            self.user_cooldown_ok(&action.id, event, *user_cooldown_s)
                                .then(|| {
                                    (
                                        index,
                                        format!("!{}", name.trim_start_matches('!')),
                                        args,
                                        Some(event.id.clone()),
                                    )
                                })
                        }
                        _ => None,
                    });
            if let Some((index, label, extra, reply_to)) = hit {
                if event.test {
                    self.skip_for_test(&action.id);
                    continue;
                }
                let mut c = ctx_from(&ctx);
                c.extend(extra_args.clone());
                c.extend(extra);
                self.spawn_run(&action.id, Some(index), &label, c, reply_to);
            }
        }
    }

    fn on_signal(self: &Arc<Self>, s: &Signal) {
        let scene = match s {
            Signal::SceneChanged { scene } => scene,
            Signal::AdSchedule(schedule) => {
                self.ads.lock().unwrap().schedule = schedule.clone();
                return;
            }
            Signal::AdBegin { length_s } => {
                self.run_ad_triggers(true, *length_s);
                return;
            }
            Signal::AdEnd { length_s } => {
                self.run_ad_triggers(false, *length_s);
                return;
            }
            Signal::SongChanged(song) => {
                self.run_song_triggers(song);
                return;
            }
            Signal::HypeLevelUp { from, event } => {
                self.run_level_up_triggers(*from, event);
                return;
            }
            Signal::Play { trigger, args } => {
                self.run_play_triggers(*trigger, args);
                return;
            }
            _ => return,
        };
        for action in self.actions() {
            let hit = action.triggers.iter().position(|t| {
                matches!(t, Trigger::SceneChanged { scene: want } if want.is_empty() || want.eq_ignore_ascii_case(scene))
            });
            if let Some(index) = hit {
                let mut c = Map::new();
                c.insert("scene".into(), Value::String(scene.clone()));
                self.spawn_run(&action.id, Some(index), "scene change", c, None);
            }
        }
    }

    fn run_ad_triggers(self: &Arc<Self>, begin: bool, length_s: u32) {
        let (label, left) = if begin {
            ("ad break begins", length_s)
        } else {
            ("ad break ends", 0)
        };
        for action in self.actions() {
            let hit = action.triggers.iter().position(|t| {
                if begin {
                    matches!(t, Trigger::AdBegin)
                } else {
                    matches!(t, Trigger::AdEnd)
                }
            });
            if let Some(index) = hit {
                self.spawn_run(
                    &action.id,
                    Some(index),
                    label,
                    ad_args(length_s, left),
                    None,
                );
            }
        }
    }

    fn run_song_triggers(self: &Arc<Self>, song: &NowPlaying) {
        for action in self.actions() {
            let hit = action
                .triggers
                .iter()
                .position(|t| matches!(t, Trigger::SongChanged));
            if let Some(index) = hit {
                self.spawn_run(
                    &action.id,
                    Some(index),
                    "song change",
                    song_args(song),
                    None,
                );
            }
        }
    }

    fn run_level_up_triggers(self: &Arc<Self>, from: u64, event: &Event) {
        for action in self.actions() {
            let hit = action
                .triggers
                .iter()
                .position(|t| matches!(t, Trigger::HypeTrainLevelUp));
            if let Some(index) = hit {
                let mut args = ctx_from(&event.as_context());
                args.extend(interact::args(event));
                args.insert("previous_level".into(), from.into());
                self.spawn_run(&action.id, Some(index), "hype train level up", args, None);
            }
        }
    }
    fn run_play_triggers(self: &Arc<Self>, which: PlayTrigger, args: &Map<String, Value>) {
        let (label, hit): (&str, fn(&Trigger) -> bool) = match which {
            PlayTrigger::GiveawayOpened => {
                ("giveaway opened", |t| matches!(t, Trigger::GiveawayOpened))
            }
            PlayTrigger::GiveawayClosed => {
                ("giveaway closed", |t| matches!(t, Trigger::GiveawayClosed))
            }
            PlayTrigger::GiveawayWinner => {
                ("winner drawn", |t| matches!(t, Trigger::GiveawayWinner))
            }
            PlayTrigger::PlayerPicked => ("player picked", |t| matches!(t, Trigger::PlayerPicked)),
        };
        for action in self.actions() {
            if let Some(index) = action.triggers.iter().position(hit) {
                self.spawn_run(&action.id, Some(index), label, args.clone(), None);
            }
        }
    }

    /// Whether an enabled action waits for song changes.
    pub fn wants_songs(&self) -> bool {
        self.actions()
            .iter()
            .any(|a| a.triggers.iter().any(|t| matches!(t, Trigger::SongChanged)))
    }

    /// Runs "ad soon" triggers once per ad, each at its own number of minutes before.
    fn check_ad_soon(self: &Arc<Self>, now_ms: i64) {
        let mut due = Vec::new();
        {
            let mut w = self.ads.lock().unwrap();
            let AdWatch { schedule, alarms } = &mut *w;
            let mut seen = Vec::new();
            for action in self.actions() {
                for (i, t) in action.triggers.iter().enumerate() {
                    let Trigger::AdSoon { minutes_before } = t else {
                        continue;
                    };
                    let key = (action.id.clone(), i);
                    seen.push(key.clone());
                    let lead = (*minutes_before).clamp(1, 60) * 60;
                    if alarms.entry(key).or_default().check(schedule, now_ms, lead) {
                        let left = schedule.seconds_to_next(now_ms).unwrap_or(0);
                        due.push((action.id.clone(), i, ad_args(schedule.length_s, left)));
                    }
                }
            }
            alarms.retain(|k, _| seen.contains(k));
        }
        for (id, index, args) in due {
            self.spawn_run(&id, Some(index), "ad soon", args, None);
        }
    }

    fn on_tick(self: &Arc<Self>, now: Instant) {
        self.check_ad_soon(crate::util::now_ms());
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
                    due.push((action.id.clone(), i));
                }
            }
            timers.retain(|k, _| seen.contains(k));
        }
        for (id, index) in due {
            self.spawn_run(&id, Some(index), "timer", Map::new(), None);
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
        if self.is_own_chat(event) {
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

    /// Chat sent by Castwright or by the bot account; never triggers actions.
    fn is_own_chat(&self, event: &Event) -> bool {
        if event
            .data
            .get("sent_by_castwright")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return true;
        }
        event
            .user
            .as_ref()
            .is_some_and(|u| !u.id.is_empty() && self.ignored_users.read().unwrap().contains(&u.id))
    }

    /// Whether the action's own cooldown has passed, without starting it.
    fn cooldown_ready(&self, action: &Action) -> bool {
        action.cooldown_s == 0
            || self
                .last_run
                .lock()
                .unwrap()
                .get(&action.id)
                .is_none_or(|last| last.elapsed() >= Duration::from_secs(action.cooldown_s as u64))
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
        self.spawn_run_inner(action_id, None, "manual", Map::new(), None, true);
        Ok(())
    }

    /// `start` is the index of the trigger that fired; `None` runs it as by hand.
    fn spawn_run(
        self: &Arc<Self>,
        action_id: &str,
        start: Option<usize>,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
    ) {
        self.spawn_run_inner(action_id, start, trigger, args, reply_to, false);
    }

    fn spawn_run_inner(
        self: &Arc<Self>,
        action_id: &str,
        start: Option<usize>,
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
        crate::util::spawn(async move {
            let run = me
                .execute_from(&action, start, &trigger, args, reply_to)
                .await;
            me.hub.sessions.on_action(&run.name);
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

    /// Run `action` as by hand and report what happened.
    pub async fn execute(
        self: &Arc<Self>,
        action: &Action,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
    ) -> ActionRun {
        self.execute_from(action, None, trigger, args, reply_to)
            .await
    }

    /// Run `action` from trigger `start` (`None`: as by hand) and report what happened.
    pub async fn execute_from(
        self: &Arc<Self>,
        action: &Action,
        start: Option<usize>,
        trigger: &str,
        args: Map<String, Value>,
        reply_to: Option<String>,
    ) -> ActionRun {
        let started = Instant::now();
        let action = action.normalized();
        let mut ctx = self.hub.vars.snapshot();
        ctx.extend(args);
        let mut run = RunCtx {
            ctx,
            reply_to,
            errors: Vec::new(),
            depth: 0,
            budget: MAX_NODE_RUNS,
            nodes: Vec::new(),
            run_id: self.run_ids.fetch_add(1, Ordering::Relaxed) + 1,
            action_id: action.id.clone(),
            steps: Vec::new(),
        };
        let g = &action.graph;
        let plan = g.start_plan(start);
        for id in &plan.fired {
            run.record(id, None);
            self.progress(&mut run, id, None, Some(NodeState::Ok));
        }
        let first = plan
            .first
            .iter()
            .map(|id| {
                let via = g
                    .edges
                    .iter()
                    .find(|e| e.to == *id && plan.fired.contains(&e.from))
                    .map(|e| e.id.clone());
                (id.clone(), via)
            })
            .collect();
        self.run_graph(g, first, &mut run).await;
        // Nodes this run could have reached but didn't.
        let reach = g.reachable(plan.fired.iter().chain(&plan.first).map(String::as_str));
        for n in &g.nodes {
            if reach.contains(n.id.as_str()) && !run.nodes.iter().any(|r| r.node_id == n.id) {
                run.nodes.push(NodeResult {
                    node_id: n.id.clone(),
                    state: NodeState::Skipped,
                    errors: Vec::new(),
                });
            }
        }
        for e in &run.errors {
            self.hub.log(
                LogLevel::Error,
                "automation",
                format!("{}: {e}", action.name),
            );
        }
        ActionRun {
            run_id: run.run_id,
            action_id: action.id.clone(),
            name: action.name.clone(),
            trigger: trigger.to_string(),
            ok: run.errors.is_empty(),
            errors: run.errors,
            duration_ms: started.elapsed().as_millis() as u64,
            nodes: run.nodes,
            steps: run.steps,
        }
    }

    /// Report a node starting (`state: None`) or finishing. Only for the action that was started.
    fn progress(&self, run: &mut RunCtx, id: &str, via: Option<&str>, state: Option<NodeState>) {
        if run.depth > 0 {
            return;
        }
        if let Some(state) = state {
            run.steps.push(RunStep {
                node_id: id.to_string(),
                via: via.map(str::to_string),
                state,
            });
        }
        self.hub.emit_ui(
            ui::ACTION_PROGRESS,
            &RunProgress {
                run_id: run.run_id,
                action_id: run.action_id.clone(),
                node_id: id.to_string(),
                via: via.map(str::to_string),
                state,
            },
        );
    }

    /// Run nodes depth first: everything after one line finishes before the next line
    /// is followed. Lines are taken top to bottom, then left to right.
    fn run_graph<'a>(
        self: &'a Arc<Self>,
        g: &'a Graph,
        first: Vec<(String, Option<String>)>,
        run: &'a mut RunCtx,
    ) -> BoxFuture<'a, Flow> {
        Box::pin(async move {
            // Each entry is a node and the line that led to it.
            let mut stack: Vec<(String, Option<String>)> = first.into_iter().rev().collect();
            while let Some((id, via)) = stack.pop() {
                let Some(node) = g.node(&id) else { continue };
                if run.budget == 0 {
                    run.errors.push(format!(
                        "Stopped after {MAX_NODE_RUNS} steps. The flow probably loops back on itself."
                    ));
                    return Flow::Stop;
                }
                run.budget -= 1;
                let via = via.as_deref();
                let mut branch = None;
                let mut stop = false;
                let mut error = None;
                match &node.kind {
                    NodeKind::Trigger { .. } => {}
                    NodeKind::Step {
                        step: Step::If { conditions, .. },
                    } => {
                        branch = Some(conditions.evaluate(&Value::Object(run.ctx.clone())));
                    }
                    NodeKind::Step { step } => {
                        self.progress(run, &id, via, None);
                        match self.run_step(step, run).await {
                            Ok(Flow::Continue) => {}
                            Ok(Flow::Stop) => stop = true,
                            Err(e) => {
                                run.errors.push(format!("{}: {e}", step_label(step)));
                                error = Some(e.to_string());
                            }
                        }
                    }
                }
                let state = if error.is_some() {
                    NodeState::Error
                } else {
                    NodeState::Ok
                };
                run.record(&id, error);
                self.progress(run, &id, via, Some(state));
                if stop {
                    return Flow::Stop;
                }
                let next = g
                    .outgoing(&id)
                    .into_iter()
                    .filter(|e| match (branch, e.branch) {
                        (_, EdgeBranch::Next) | (None, _) => true,
                        (Some(yes), EdgeBranch::Then) => yes,
                        (Some(yes), EdgeBranch::Otherwise) => !yes,
                    });
                let next: Vec<(String, Option<String>)> =
                    next.map(|e| (e.to.clone(), Some(e.id.clone()))).collect();
                stack.extend(next.into_iter().rev());
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

    fn discord(&self) -> AppResult<Arc<dyn DiscordActions>> {
        self.discord
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| crate::error::AppError::User("Discord isn't set up.".into()))
    }

    fn play(&self) -> AppResult<Arc<dyn PlayActions>> {
        self.play
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| crate::error::AppError::User("Giveaways aren't ready yet.".into()))
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
            Step::DeleteMessage { message_id } => {
                let mut id = t(message_id).trim().to_string();
                if id.is_empty() && run.ctx.get("kind").and_then(Value::as_str) == Some("chat") {
                    id = run
                        .ctx
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into();
                }
                if id.is_empty() {
                    return user_err(
                        "No chat message to delete. Start this action from chat or a command.",
                    );
                }
                self.twitch()?.delete_message(&id).await?
            }
            Step::SetChatMode { mode, state, value } => {
                self.twitch()?.set_chat_mode(*mode, *state, *value).await?
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
            Step::RollCredits {
                overlay_id,
                layer_id,
            } => self.roll_credits(overlay_id, layer_id)?,
            Step::PlayAlert {
                title,
                message,
                image,
                sound,
                duration_ms,
            } => self
                .alerts
                .enqueue_custom(&t(title), &t(message), image, sound, *duration_ms),
            Step::PauseAlerts { state } => {
                let paused = match state {
                    Toggle::On => true,
                    Toggle::Off => false,
                    Toggle::Toggle => !self.alerts.queue_state().paused,
                };
                self.alerts.set_paused(paused);
            }
            Step::SkipAlert => self.alerts.skip(),
            Step::PlaySound { src, volume } => self.hub.to_overlays(
                None,
                OverlayMsg::PlaySound {
                    src: t(src),
                    volume: (*volume).min(100),
                },
            ),
            Step::PlaySoundboardSound { sound_id } => {
                let sounds = self.sounds.read().unwrap().clone().ok_or_else(|| {
                    crate::error::AppError::User("The soundboard isn't ready.".into())
                })?;
                sounds.play_sound(sound_id)?;
            }
            Step::HttpRequest {
                method,
                url,
                body,
                save_to,
            } => {
                let text = self.http_request(*method, &t(url), &t(body)).await?;
                let key = t(save_to);
                if !key.is_empty() {
                    if !crate::vars::valid_key(&key) {
                        return Err(crate::error::AppError::User(format!(
                            "\"{key}\" isn't a valid variable name."
                        )));
                    }
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
            // Branches are lines in the graph; run_graph follows them.
            Step::If { .. } => {}
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
                let other = other.normalized();
                let first = other
                    .graph
                    .start_plan(None)
                    .first
                    .into_iter()
                    .map(|id| (id, None))
                    .collect();
                run.depth += 1;
                let flow = self.run_graph(&other.graph, first, run).await;
                run.depth -= 1;
                if let Flow::Stop = flow {
                    return Ok(Flow::Stop);
                }
            }
            Step::FinishRedemption { refund } => {
                let get = |k: &str| {
                    run.ctx
                        .get(k)
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                };
                let (reward, id) = (get("reward_id"), get("redemption_id"));
                if reward.is_empty() || id.is_empty() {
                    return user_err(
                        "This step needs a channel point redemption to start the action.",
                    );
                }
                self.twitch()?
                    .finish_redemption(&reward, &id, *refund)
                    .await?
            }
            Step::SetRewardState {
                reward_id,
                reward_title,
                state,
            } => {
                self.twitch()?
                    .set_reward_state(reward_id, &t(reward_title), *state)
                    .await?
            }
            Step::SetRewardCost {
                reward_id,
                reward_title,
                cost,
            } => {
                let text = t(cost);
                let Some(n) = crate::model::condition::parse_number(&text)
                    .filter(|n| *n >= 1.0 && *n <= u32::MAX as f64)
                else {
                    return user_err(format!("\"{}\" isn't a cost in points.", text.trim()));
                };
                self.twitch()?
                    .set_reward_cost(reward_id, &t(reward_title), n.round() as u32)
                    .await?
            }
            Step::StartPoll {
                title,
                choices,
                duration_s,
                points_per_vote,
            } => {
                let draft = PollDraft {
                    title: t(title),
                    choices: rendered_list(choices, &t),
                    duration_s: *duration_s,
                    points_per_vote: *points_per_vote,
                };
                draft.check().map_err(crate::error::AppError::User)?;
                self.twitch()?.start_poll(&draft).await?
            }
            Step::EndPoll => self.twitch()?.end_poll().await?,
            Step::StartPrediction {
                title,
                outcomes,
                window_s,
            } => {
                let draft = PredictionDraft {
                    title: t(title),
                    outcomes: rendered_list(outcomes, &t),
                    window_s: *window_s,
                };
                draft.check().map_err(crate::error::AppError::User)?;
                self.twitch()?.start_prediction(&draft).await?
            }
            Step::EndPrediction { action, winner } => {
                let winner = t(winner);
                if *action == PredictionAction::Resolve && winner.trim().is_empty() {
                    return user_err("Say which outcome won.");
                }
                self.twitch()?.end_prediction(*action, &winner).await?
            }
            Step::SnoozeAd => self.twitch()?.snooze_next_ad().await?,
            Step::PostToDiscord {
                webhook_id,
                message,
            } => {
                let text = t(message);
                if text.trim().is_empty() {
                    return user_err("The Discord message is empty.");
                }
                self.discord()?.post_text(webhook_id, &text).await?
            }
            Step::OpenGiveaway { title } => self.play()?.open_giveaway(&t(title))?,
            Step::CloseGiveaway => self.play()?.close_giveaway()?,
            Step::DrawGiveaway { count } => self.play()?.draw_giveaway(*count)?,
            Step::SetQueueOpen { state } => self.play()?.set_queue_open(match state {
                Toggle::On => Some(true),
                Toggle::Off => Some(false),
                Toggle::Toggle => None,
            })?,
            Step::QueueNext { count, random } => self.play()?.queue_next(*count, *random)?,
            Step::ClearQueue => self.play()?.clear_queue()?,
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

    fn roll_credits(&self, overlay_id: &str, layer_id: &str) -> AppResult<()> {
        let found = self.project.read(|p| {
            p.overlays
                .iter()
                .find(|o| o.id == overlay_id)?
                .layers
                .iter()
                .find(|l| l.id == layer_id)
                .map(|l| (matches!(l.kind, LayerKind::Credits { .. }), l.visible))
        });
        let visible = match found {
            None => return user_err("That overlay layer no longer exists."),
            Some((false, _)) => return user_err("That layer isn't a credits layer."),
            Some((true, visible)) => visible,
        };
        let credits = self.hub.sessions.credits()?;
        if !visible {
            self.set_layer_visible(overlay_id, layer_id, Toggle::On)?;
        }
        self.hub.to_overlays(
            Some(overlay_id),
            OverlayMsg::CreditsRoll {
                layer_id: layer_id.to_string(),
                credits,
            },
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
        let mut resp = req.send().await?;
        let status = resp.status();
        // Read only what's kept, so a huge response can't fill memory.
        let mut bytes = Vec::new();
        while bytes.len() < HTTP_MAX_BYTES {
            let Some(chunk) = resp.chunk().await? else {
                break;
            };
            bytes.extend_from_slice(&chunk);
        }
        bytes.truncate(HTTP_MAX_BYTES);
        let text = String::from_utf8_lossy(&bytes).into_owned();
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
        Step::CreateMarker { .. } => "Add stream marker",
        Step::RunAd { .. } => "Run ad",
        Step::SetStreamInfo { .. } => "Set stream info",
        Step::TimeoutUser { .. } => "Time out user",
        Step::DeleteMessage { .. } => "Delete message",
        Step::SetChatMode { .. } => "Set chat mode",
        Step::Delay { .. } => "Wait",
        Step::SetVariable { .. } => "Set variable",
        Step::AddToVariable { .. } => "Add to variable",
        Step::SwitchScene { .. } => "Switch scene",
        Step::SetSourceVisible { .. } => "Show/hide source",
        Step::SetInputMute { .. } => "Mute/unmute",
        Step::Recording { .. } => "Recording",
        Step::SaveReplay => "Save replay",
        Step::SetLayerVisible { .. } => "Show/hide overlay layer",
        Step::RollCredits { .. } => "Roll credits",
        Step::PlayAlert { .. } => "Play alert",
        Step::PauseAlerts { .. } => "Pause alerts",
        Step::SkipAlert => "Skip alert",
        Step::PlaySound { .. } => "Play sound",
        Step::PlaySoundboardSound { .. } => "Play soundboard sound",
        Step::HttpRequest { .. } => "Web request",
        Step::RunScript { .. } => "Run script",
        Step::If { .. } => "If",
        Step::RunAction { .. } => "Run action",
        Step::FinishRedemption { .. } => "Complete or refund redemption",
        Step::SetRewardState { .. } => "Enable or pause reward",
        Step::SetRewardCost { .. } => "Change reward cost",
        Step::StartPoll { .. } => "Start poll",
        Step::EndPoll => "End poll",
        Step::StartPrediction { .. } => "Start prediction",
        Step::EndPrediction { .. } => "Lock or resolve prediction",
        Step::SnoozeAd => "Snooze ad",
        Step::PostToDiscord { .. } => "Post to Discord",
        Step::OpenGiveaway { .. } => "Open giveaway",
        Step::CloseGiveaway => "Close giveaway",
        Step::DrawGiveaway { .. } => "Draw winner",
        Step::SetQueueOpen { .. } => "Open or close queue",
        Step::QueueNext { .. } => "Next in queue",
        Step::ClearQueue => "Clear queue",
        Step::Stop => "Stop",
        Step::Log { .. } => "Log",
    }
}

/// Templates filled in; empty entries dropped.
fn rendered_list(list: &[String], t: &impl Fn(&str) -> String) -> Vec<String> {
    list.iter()
        .map(|s| t(s).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn value_text(v: &Value) -> String {
    stringify(v)
}

#[cfg(test)]
mod tests;
