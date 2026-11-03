//! Giveaways and the viewer queue: chat entries, draws, picks, replies, the
//! `giveaway.*` and `queue.*` variables overlays read, and a saved copy so a
//! crash doesn't lose them.

pub mod chat;
pub mod giveaway;
pub mod history;
pub mod queue;

#[cfg(test)]
mod tests;

use crate::error::{AppError, AppResult, user_err};
use crate::hub::{Hub, PlayTrigger, Signal, ui};
use crate::model::event::{Event, EventKind};
use crate::model::play::{
    Audience, EntryVia, Giveaway, GiveawayRecord, GiveawaySettings, PlayState, QueueEntry,
    QueueSettings, Viewer, ViewerQueue, WinnerLine,
};
use crate::model::runtime::LogLevel;
use crate::services::{PlayActions, TwitchActions};
use crate::store::settings::SettingsStore;
use async_trait::async_trait;
use chat::{Batched, ChatBudget, ReplyBatch};
use giveaway::{Entered, Follow};
use queue::Joined;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;

/// Names the giveaway layer spins through before it lands.
const REEL_LEN: usize = 32;
/// Queue people the `queue.lineup` variable lists.
const LINEUP_KEEP: usize = 20;
/// Lines of a winner's earlier chat shown after the draw.
const SAID_BEFORE: usize = 3;

#[async_trait]
pub trait FollowLookup: Send + Sync {
    /// When `user_id` followed the channel (ms), None when they don't follow.
    async fn followed_at(&self, user_id: &str) -> AppResult<Option<i64>>;
}

/// Saved between runs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct Saved {
    saved_at: i64,
    giveaway: Option<Giveaway>,
    queue: ViewerQueue,
}

enum Out {
    Chat(String),
    Redemption {
        reward_id: String,
        id: String,
        refund: bool,
    },
}

/// Work to do once the state lock is let go.
#[derive(Default)]
struct Fx {
    out: Vec<Out>,
    signals: Vec<(PlayTrigger, Map<String, Value>)>,
    logs: Vec<String>,
}

impl Fx {
    fn chat(&mut self, text: Option<String>) {
        if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
            self.out.push(Out::Chat(t));
        }
    }
}

#[derive(Default)]
struct Inner {
    giveaway: Option<Giveaway>,
    queue: ViewerQueue,
    batch: ReplyBatch,
    budget: ChatBudget,
    follows: HashMap<String, Follow>,
    follow_warned: bool,
    /// The overlay's copy of the last draw.
    draw: Value,
    bot_ids: Vec<String>,
    bot_login: String,
}

pub struct PlayService {
    hub: Arc<Hub>,
    settings: Arc<SettingsStore>,
    file: Option<PathBuf>,
    twitch: RwLock<Option<Arc<dyn TwitchActions>>>,
    follows: RwLock<Option<Arc<dyn FollowLookup>>>,
    tx: Mutex<Option<mpsc::UnboundedSender<Out>>>,
    inner: Mutex<Inner>,
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// The viewer who sent a chat message, with their colour, badges and sub tier.
pub fn viewer_of(e: &Event) -> Option<Viewer> {
    let u = e.user.as_ref()?;
    let id = if u.id.is_empty() { &u.login } else { &u.id };
    if id.is_empty() {
        return None;
    }
    let d = Value::Object(e.data.clone());
    let list = |k: &str| {
        d.get(k)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let tier = d.get("sub_tier").and_then(Value::as_u64).unwrap_or(0) as u8;
    Some(Viewer {
        id: id.clone(),
        login: u.login.clone(),
        name: if u.display_name.is_empty() {
            u.login.clone()
        } else {
            u.display_name.clone()
        },
        color: s(&d, "color"),
        badges: list("badges")
            .iter()
            .filter_map(|b| b.as_str().map(String::from))
            .collect(),
        badge_images: list("badge_images"),
        roles: e.roles.clone(),
        sub_tier: if tier == 0 && e.roles.subscriber {
            1
        } else {
            tier.min(3)
        },
    })
}

fn viewer_json(v: &Viewer) -> Value {
    json!({
        "id": v.id,
        "login": v.login,
        "name": v.name,
        "color": v.color,
        "badges": v.badges,
        "badge_images": v.badge_images,
        "roles": v.roles,
    })
}

fn how_to_enter(g: &GiveawaySettings) -> String {
    let word = g.keyword.trim();
    let reward = g.reward_title.trim();
    match (
        word.is_empty(),
        reward.is_empty() || g.reward_id.trim().is_empty(),
    ) {
        (false, false) => format!("Type {word} or redeem \"{reward}\" to enter."),
        (false, true) => format!("Type {word} to enter."),
        (true, false) => format!("Redeem \"{reward}\" to enter."),
        (true, true) => String::new(),
    }
}

fn giveaway_ctx(g: &Giveaway, winner: &str, previous: &str) -> Value {
    let winners: Vec<String> = g
        .winners
        .iter()
        .filter(|w| w.standing())
        .map(|w| w.viewer.name.clone())
        .collect();
    json!({
        "title": g.settings.title,
        "keyword": g.settings.keyword,
        "reward": g.settings.reward_title,
        "how": how_to_enter(&g.settings),
        "entries": g.entrants.len(),
        "tickets": g.total_entries(),
        "winner": winner,
        "winners": chat::name_list(&winners, 10),
        "previous": previous,
        "claim_s": g.settings.claim_s,
    })
}

fn line(text: Option<&str>, ctx: &Value) -> Option<String> {
    text.map(|t| crate::template::render(t, ctx).trim().to_string())
}

fn entry_json(e: &QueueEntry, position: Option<usize>) -> Value {
    json!({
        "id": e.viewer.id,
        "login": e.viewer.login,
        "name": e.viewer.name,
        "color": e.viewer.color,
        "note": e.note,
        "sub": e.sub,
        "position": position,
    })
}

impl PlayService {
    /// `file`: where the queue and giveaway are kept between runs (None in tests).
    pub fn new(hub: Arc<Hub>, settings: Arc<SettingsStore>, file: Option<PathBuf>) -> Arc<Self> {
        let me = Arc::new(PlayService {
            hub,
            settings,
            file,
            twitch: RwLock::new(None),
            follows: RwLock::new(None),
            tx: Mutex::new(None),
            inner: Mutex::default(),
        });
        me.load(crate::util::now_ms());
        me.publish_vars();
        me
    }

    pub fn set_twitch(&self, t: Arc<dyn TwitchActions>) {
        *self.twitch.write().unwrap() = Some(t);
    }

    pub fn set_follows(&self, f: Arc<dyn FollowLookup>) {
        *self.follows.write().unwrap() = Some(f);
    }

    /// The bot account, whose chat is never read as an entry.
    pub fn set_bot(&self, ids: Vec<String>, login: String) {
        let mut g = self.inner.lock().unwrap();
        g.bot_ids = ids;
        g.bot_login = login;
    }

    fn load(&self, now: i64) {
        let Some(file) = &self.file else { return };
        let Ok(bytes) = std::fs::read(file) else {
            return;
        };
        let Ok(saved) = serde_json::from_slice::<Saved>(&bytes) else {
            return;
        };
        let keep_h = self.settings.get().queue.keep_hours as i64;
        if keep_h == 0 || now - saved.saved_at > keep_h * 3_600_000 {
            return;
        }
        let mut g = self.inner.lock().unwrap();
        g.queue = saved.queue;
        g.giveaway = saved.giveaway;
    }

    fn save(&self, inner: &Inner) {
        let Some(file) = &self.file else { return };
        let saved = Saved {
            saved_at: crate::util::now_ms(),
            giveaway: inner.giveaway.clone(),
            queue: inner.queue.clone(),
        };
        let r = serde_json::to_vec(&saved)
            .map_err(AppError::from)
            .and_then(|b| crate::util::write_atomic(file, &b).map_err(AppError::from));
        if let Err(e) = r {
            tracing::warn!("couldn't save the queue: {e}");
        }
    }

    pub fn start(self: &Arc<Self>) {
        let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
        *self.tx.lock().unwrap() = Some(tx);
        let me = self.clone();
        crate::util::spawn(async move {
            while let Some(out) = rx.recv().await {
                me.send_out(out).await;
            }
        });
        let me = self.clone();
        let mut events = self.hub.subscribe_events();
        crate::util::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(e) => me.on_event(&e).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        crate::util::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(500));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                me.tick(crate::util::now_ms());
            }
        });
    }

    async fn send_out(&self, out: Out) {
        let Some(t) = self.twitch.read().unwrap().clone() else {
            return;
        };
        let r = match &out {
            Out::Chat(text) => t.send_chat(text, true, None).await,
            Out::Redemption {
                reward_id,
                id,
                refund,
            } => t.finish_redemption(reward_id, id, *refund).await,
        };
        if let Err(e) = r {
            self.hub.log(
                LogLevel::Warn,
                "giveaway",
                format!("Couldn't reach chat: {e}"),
            );
        }
    }

    pub fn state(&self) -> PlayState {
        let g = self.inner.lock().unwrap();
        self.state_of(&g)
    }

    fn state_of(&self, g: &Inner) -> PlayState {
        let s = self.settings.get();
        let open_kw = g
            .giveaway
            .as_ref()
            .filter(|x| x.open)
            .map(|x| x.settings.keyword.clone());
        PlayState {
            giveaway: g.giveaway.clone(),
            clash: open_kw.is_some_and(|k| chat::keyword_clash(&k, &s.queue.join_word, true)),
            queue_order: queue::order_ids(&g.queue, &s.queue),
            queue: g.queue.clone(),
            giveaway_settings: s.giveaway,
            queue_settings: s.queue,
        }
    }

    /// After every change: tell the app, update variables, save, then do `fx`.
    fn changed(&self, g: &Inner, fx: Fx) {
        self.hub.emit_ui(ui::PLAY, &self.state_of(g));
        self.publish_vars_of(g);
        self.save(g);
        self.run(fx);
    }

    fn run(&self, fx: Fx) {
        let tx = self.tx.lock().unwrap().clone();
        for out in fx.out {
            match &tx {
                Some(tx) => {
                    let _ = tx.send(out);
                }
                None => {
                    if let Out::Chat(t) = out {
                        tracing::info!("chat (not started): {t}");
                    }
                }
            }
        }
        for (trigger, args) in fx.signals {
            self.hub.signal(Signal::Play { trigger, args });
        }
        for l in fx.logs {
            self.hub.log(LogLevel::Info, "giveaway", l);
        }
    }

    fn publish_vars(&self) {
        let g = self.inner.lock().unwrap();
        self.publish_vars_of(&g);
    }

    fn publish_vars_of(&self, g: &Inner) {
        let s = self.settings.get();
        let gw = g.giveaway.as_ref();
        let winner = gw
            .and_then(|x| x.winners.iter().rev().find(|w| w.standing()))
            .map(|w| w.viewer.name.clone())
            .unwrap_or_default();
        let status = match gw {
            None => "idle",
            Some(x) if x.open => "open",
            Some(_) => "closed",
        };
        let order = queue::pick_order(&g.queue, &s.queue);
        let lineup: Vec<Value> = order
            .iter()
            .take(LINEUP_KEEP)
            .enumerate()
            .map(|(p, &i)| entry_json(&g.queue.waiting[i], Some(p + 1)))
            .collect();
        let next = order
            .first()
            .map(|&i| g.queue.waiting[i].viewer.name.clone())
            .unwrap_or_default();
        let playing: Vec<String> = g
            .queue
            .playing
            .iter()
            .map(|e| e.viewer.name.clone())
            .collect();
        let pairs: Vec<(&str, Value)> = vec![
            (
                "giveaway.title",
                json!(gw.map(|x| x.settings.title.as_str()).unwrap_or("")),
            ),
            ("giveaway.status", json!(status)),
            ("giveaway.open", json!(gw.is_some_and(|x| x.open))),
            (
                "giveaway.entries",
                json!(gw.map_or(0, |x| x.entrants.len())),
            ),
            (
                "giveaway.keyword",
                json!(gw.map(|x| x.settings.keyword.as_str()).unwrap_or("")),
            ),
            ("giveaway.winner", json!(winner)),
            ("giveaway.draw", g.draw.clone()),
            ("queue.size", json!(g.queue.waiting.len())),
            ("queue.open", json!(g.queue.open)),
            ("queue.next", json!(next)),
            ("queue.playing", json!(playing.join(", "))),
            ("queue.lineup", json!(lineup)),
            (
                "queue.party",
                json!(
                    g.queue
                        .playing
                        .iter()
                        .map(|e| entry_json(e, None))
                        .collect::<Vec<_>>()
                ),
            ),
        ];
        let mut changes = Map::new();
        for (k, v) in pairs {
            if self.hub.vars.get(k).as_ref() != Some(&v) {
                changes.extend(self.hub.vars.set(k, v, false));
            }
        }
        self.hub.broadcast_vars(changes);
    }

    // ---------- chat ----------

    fn is_own(&self, e: &Event) -> bool {
        if e.data.get("sent_by_castwright").and_then(Value::as_bool) == Some(true) {
            return true;
        }
        let Some(u) = &e.user else { return true };
        let g = self.inner.lock().unwrap();
        (!u.id.is_empty() && g.bot_ids.contains(&u.id))
            || (!g.bot_login.is_empty() && u.login.eq_ignore_ascii_case(&g.bot_login))
            || giveaway::is_known_bot(&u.login)
    }

    pub async fn on_event(&self, e: &Event) {
        if e.test {
            return;
        }
        match e.kind {
            EventKind::Chat if !self.is_own(e) => self.on_chat(e).await,
            EventKind::Redemption => self.on_redemption(e).await,
            _ => {}
        }
    }

    async fn on_chat(&self, e: &Event) {
        let Some(v) = viewer_of(e) else { return };
        let text = e.message.as_deref().unwrap_or("").trim().to_string();
        let now = crate::util::now_ms();
        self.winner_said(&v.id, &text, now);
        let keyword = {
            let g = self.inner.lock().unwrap();
            g.giveaway
                .as_ref()
                .filter(|x| x.open)
                .map(|x| x.settings.keyword.clone())
        };
        // The giveaway gets its word first, so a clash never joins the queue too.
        if let Some(k) = keyword.filter(|k| !k.trim().is_empty())
            && chat::command(&text, &k).is_some()
        {
            self.try_enter(v, EntryVia::Chat, None).await;
            return;
        }
        let qs = self.settings.get().queue;
        if let Some(rest) = chat::command(&text, &qs.join_word) {
            self.queue_join(v, rest, now);
        } else if !qs.leave_word.trim().is_empty() && chat::command(&text, &qs.leave_word).is_some()
        {
            self.queue_leave(&v, now);
        } else if !qs.position_word.trim().is_empty()
            && chat::command(&text, &qs.position_word).is_some()
        {
            self.queue_position(&v, now);
        }
    }

    fn winner_said(&self, user_id: &str, text: &str, now: i64) {
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return;
        };
        if !gw.winners.iter().any(|w| w.viewer.id == user_id) {
            return;
        }
        let claimed = giveaway::winner_chat(gw, user_id, text, now);
        let mut fx = Fx::default();
        if claimed {
            let name = gw
                .winners
                .iter()
                .find(|w| w.viewer.id == user_id)
                .map(|w| w.viewer.name.clone())
                .unwrap_or_default();
            fx.logs.push(format!("{name} claimed the prize."));
        }
        self.changed(&g, fx);
    }

    async fn on_redemption(&self, e: &Event) {
        let reward = e
            .data
            .get("reward_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        let id = e
            .data
            .get("redemption_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let wanted = {
            let g = self.inner.lock().unwrap();
            g.giveaway
                .as_ref()
                .is_some_and(|x| !x.settings.reward_id.is_empty() && x.settings.reward_id == reward)
        };
        if !wanted {
            return;
        }
        let Some(mut v) = viewer_of(e) else { return };
        // Redemptions don't carry badges; use the person's last chat message if there is one.
        if let Some(last) = self
            .hub
            .recent_chat()
            .iter()
            .rev()
            .find(|c| c.user.as_ref().is_some_and(|u| u.id == v.id))
            .and_then(viewer_of)
        {
            v = last;
        }
        let redemption = (!id.is_empty()).then(|| (reward.to_string(), id));
        self.try_enter(v, EntryVia::Points, redemption).await;
    }

    async fn follow_of(&self, user_id: &str) -> Follow {
        if let Some(f) = self.inner.lock().unwrap().follows.get(user_id) {
            return *f;
        }
        let Some(lookup) = self.follows.read().unwrap().clone() else {
            return Follow::Unknown;
        };
        let f = match lookup.followed_at(user_id).await {
            Ok(Some(t)) => Follow::Since(t),
            Ok(None) => Follow::No,
            Err(e) => {
                let mut g = self.inner.lock().unwrap();
                if !g.follow_warned {
                    g.follow_warned = true;
                    drop(g);
                    self.hub.log(
                        LogLevel::Warn,
                        "giveaway",
                        format!("Couldn't check follows, so everyone can enter: {e}"),
                    );
                }
                return Follow::Unknown;
            }
        };
        self.inner
            .lock()
            .unwrap()
            .follows
            .insert(user_id.to_string(), f);
        f
    }

    /// `redemption`: reward and redemption id, completed when they get in and refunded when not.
    async fn try_enter(&self, v: Viewer, via: EntryVia, redemption: Option<(String, String)>) {
        let (id, needs_follow) = {
            let g = self.inner.lock().unwrap();
            let Some(gw) = g.giveaway.as_ref().filter(|x| x.open) else {
                return;
            };
            let entered = gw.entrants.iter().any(|e| e.viewer.id == v.id);
            if entered && (via != EntryVia::Points || gw.settings.rules.one_entry) {
                drop(g);
                self.finish_redemption(redemption, true);
                return;
            }
            (
                gw.id.clone(),
                gw.settings.rules.audience == Audience::Followers && !v.roles.broadcaster,
            )
        };
        let follow = if needs_follow {
            self.follow_of(&v.id).await
        } else {
            Follow::Unknown
        };
        let now = crate::util::now_ms();
        let mut g = self.inner.lock().unwrap();
        let bot_login = g.bot_login.clone();
        let Some(gw) = g.giveaway.as_mut().filter(|x| x.open && x.id == id) else {
            drop(g);
            self.finish_redemption(redemption, true);
            return;
        };
        let mut fx = Fx::default();
        let ok = match giveaway::check_entry(&gw.settings.rules, &v, follow, &bot_login, now) {
            Ok(()) => matches!(
                giveaway::enter(gw, v, via, now),
                Entered::New | Entered::More
            ),
            Err(_) => false,
        };
        if let Some((reward_id, id)) = redemption {
            fx.out.push(Out::Redemption {
                reward_id,
                id,
                refund: !ok,
            });
        }
        if ok && giveaway::should_close(gw, now) {
            Self::close_in(gw, now, &mut fx);
        }
        self.changed(&g, fx);
    }

    fn finish_redemption(&self, redemption: Option<(String, String)>, refund: bool) {
        if let Some((reward_id, id)) = redemption {
            self.run(Fx {
                out: vec![Out::Redemption {
                    reward_id,
                    id,
                    refund,
                }],
                ..Fx::default()
            });
        }
    }

    // ---------- giveaways ----------

    pub fn save_giveaway_settings(&self, s: GiveawaySettings) -> AppResult<GiveawaySettings> {
        self.settings.update(|x| x.giveaway = s.clone())?;
        self.hub.emit_ui(ui::PLAY, &self.state());
        Ok(s)
    }

    /// Starts a giveaway with `settings`. A finished-but-not-cleared one goes to history first.
    pub fn open_giveaway(&self, settings: GiveawaySettings) -> AppResult<Giveaway> {
        settings.check().map_err(AppError::User)?;
        self.settings.update(|x| x.giveaway = settings.clone())?;
        let now = crate::util::now_ms();
        let mut g = self.inner.lock().unwrap();
        if g.giveaway.as_ref().is_some_and(|x| x.open) {
            return user_err("A giveaway is already taking entries. Close it first.");
        }
        if let Some(old) = g.giveaway.take() {
            self.store_record(&old, now);
        }
        let gw = Giveaway {
            id: crate::util::new_id(),
            settings,
            open: true,
            opened_at: now,
            closed_at: None,
            entrants: Vec::new(),
            winners: Vec::new(),
            draws: 0,
        };
        g.follows.clear();
        g.draw = Value::Null;
        self.store_record(&gw, 0);
        let mut fx = Fx::default();
        let ctx = giveaway_ctx(&gw, "", "");
        fx.chat(line(gw.settings.messages.opened.active(), &ctx));
        fx.signals
            .push((PlayTrigger::GiveawayOpened, Self::args(&gw)));
        g.giveaway = Some(gw.clone());
        self.changed(&g, fx);
        Ok(gw)
    }

    fn args(g: &Giveaway) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("title".into(), json!(g.settings.title));
        m.insert("entries".into(), json!(g.entrants.len()));
        m
    }

    fn store_record(&self, g: &Giveaway, ended_at: i64) {
        if let Err(e) = history::save(&self.hub.db, &history::record(g, ended_at)) {
            self.hub.log(
                LogLevel::Warn,
                "giveaway",
                format!("Couldn't save the giveaway history: {e}"),
            );
        }
    }

    fn close_in(gw: &mut Giveaway, now: i64, fx: &mut Fx) {
        if !gw.open {
            return;
        }
        gw.open = false;
        gw.closed_at = Some(now);
        let ctx = giveaway_ctx(gw, "", "");
        fx.chat(line(gw.settings.messages.closed.active(), &ctx));
        fx.signals
            .push((PlayTrigger::GiveawayClosed, Self::args(gw)));
    }

    /// Open or close entries of the current giveaway.
    pub fn set_giveaway_open(&self, open: bool) -> AppResult<Giveaway> {
        let now = crate::util::now_ms();
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return user_err("No giveaway is running.");
        };
        let mut fx = Fx::default();
        if open && !gw.open {
            gw.open = true;
            gw.closed_at = None;
        } else if !open {
            Self::close_in(gw, now, &mut fx);
        }
        let out = gw.clone();
        self.store_record(&out, 0);
        self.changed(&g, fx);
        Ok(out)
    }

    /// Draws `count` winners, closing entries first.
    pub fn draw(&self, count: u32) -> AppResult<Giveaway> {
        let now = crate::util::now_ms();
        let recent = self.hub.recent_chat();
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return user_err("No giveaway is running.");
        };
        if gw.entrants.is_empty() {
            return user_err("Nobody has entered yet.");
        }
        let mut fx = Fx::default();
        let before = gw.winners.len();
        let drawn = giveaway::draw(gw, count.clamp(1, 50), now, &mut rand::rng());
        if drawn == 0 {
            return user_err("Everyone who entered has already won.");
        }
        Self::close_in(gw, now, &mut fx);
        for i in before..gw.winners.len() {
            Self::fill_said(&mut gw.winners[i], &recent);
            let name = gw.winners[i].viewer.name.clone();
            let ctx = giveaway_ctx(gw, &name, "");
            fx.chat(line(gw.settings.messages.winner.active(), &ctx));
            fx.signals
                .push((PlayTrigger::GiveawayWinner, Self::winner_args(gw, i)));
        }
        let out = gw.clone();
        g.draw = Self::draw_json(&out, now);
        self.store_record(&out, 0);
        self.changed(&g, fx);
        Ok(out)
    }

    fn fill_said(w: &mut crate::model::play::Winner, recent: &[Event]) {
        let mut lines: Vec<WinnerLine> = recent
            .iter()
            .rev()
            .filter(|c| {
                c.user.as_ref().is_some_and(|u| u.id == w.viewer.id)
                    && c.data.get("sent_by_castwright").and_then(Value::as_bool) != Some(true)
            })
            .take(SAID_BEFORE)
            .map(|c| WinnerLine {
                ts: c.ts,
                text: c.message.clone().unwrap_or_default(),
            })
            .collect();
        lines.reverse();
        w.said = lines;
    }

    fn winner_args(gw: &Giveaway, i: usize) -> Map<String, Value> {
        let mut m = Self::args(gw);
        let w = &gw.winners[i];
        m.insert("winner".into(), json!(w.viewer.name));
        m.insert("winner_login".into(), json!(w.viewer.login));
        m.insert("winner_entries".into(), json!(w.entries));
        m
    }

    fn draw_json(gw: &Giveaway, now: i64) -> Value {
        let Some(w) = gw.winners.last() else {
            return Value::Null;
        };
        let names = giveaway::reel(gw, &w.viewer.name, REEL_LEN, &mut rand::rng());
        json!({
            "seq": gw.draws,
            "at": now,
            "names": names,
            "winner": viewer_json(&w.viewer),
        })
    }

    pub fn reroll(&self, user_id: &str) -> AppResult<Giveaway> {
        let now = crate::util::now_ms();
        let recent = self.hub.recent_chat();
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return user_err("No giveaway is running.");
        };
        let previous = gw
            .winners
            .iter()
            .find(|w| w.viewer.id == user_id)
            .map(|w| w.viewer.name.clone())
            .unwrap_or_default();
        if !giveaway::reroll(gw, user_id, now, &mut rand::rng()) {
            let out = gw.clone();
            self.store_record(&out, 0);
            self.changed(&g, Fx::default());
            return user_err("Nobody is left to draw.");
        }
        let i = gw.winners.len() - 1;
        Self::fill_said(&mut gw.winners[i], &recent);
        let name = gw.winners[i].viewer.name.clone();
        let mut fx = Fx::default();
        let ctx = giveaway_ctx(gw, &name, &previous);
        fx.chat(line(gw.settings.messages.reroll.active(), &ctx));
        fx.signals
            .push((PlayTrigger::GiveawayWinner, Self::winner_args(gw, i)));
        let out = gw.clone();
        g.draw = Self::draw_json(&out, now);
        self.store_record(&out, 0);
        self.changed(&g, fx);
        Ok(out)
    }

    pub fn claim(&self, user_id: &str) -> AppResult<Giveaway> {
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return user_err("No giveaway is running.");
        };
        if !giveaway::claim(gw, user_id) {
            return user_err("That person isn't a winner.");
        }
        let out = gw.clone();
        self.changed(&g, Fx::default());
        Ok(out)
    }

    pub fn remove_entrant(&self, user_id: &str) -> AppResult<Giveaway> {
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.as_mut() else {
            return user_err("No giveaway is running.");
        };
        gw.entrants.retain(|e| e.viewer.id != user_id);
        let out = gw.clone();
        self.store_record(&out, 0);
        self.changed(&g, Fx::default());
        Ok(out)
    }

    /// Saves the giveaway to history and clears it.
    pub fn finish(&self) -> AppResult<Option<GiveawayRecord>> {
        let now = crate::util::now_ms();
        let mut g = self.inner.lock().unwrap();
        let Some(gw) = g.giveaway.take() else {
            return Ok(None);
        };
        let rec = history::record(&gw, now);
        self.store_record(&gw, now);
        g.draw = Value::Null;
        self.changed(&g, Fx::default());
        Ok(Some(rec))
    }

    pub fn history(&self, limit: u32) -> AppResult<Vec<GiveawayRecord>> {
        history::list(&self.hub.db, limit.clamp(1, 1000))
    }

    pub fn delete_record(&self, id: &str) -> AppResult<()> {
        if self
            .inner
            .lock()
            .unwrap()
            .giveaway
            .as_ref()
            .is_some_and(|g| g.id == id)
        {
            return user_err("Finish the giveaway before deleting it.");
        }
        history::delete(&self.hub.db, id)
    }

    // ---------- queue ----------

    pub fn save_queue_settings(&self, s: QueueSettings) -> AppResult<QueueSettings> {
        s.check().map_err(AppError::User)?;
        self.settings.update(|x| x.queue = s.clone())?;
        let g = self.inner.lock().unwrap();
        self.changed(&g, Fx::default());
        Ok(s)
    }

    fn queue_join(&self, v: Viewer, rest: &str, now: i64) {
        let s = self.settings.get().queue;
        let mut g = self.inner.lock().unwrap();
        let name = v.name.clone();
        let r = queue::join(&mut g.queue, &s, v, rest, now);
        let mut fx = Fx::default();
        match r {
            Joined::Added(pos) => {
                if let Some(b) = g.batch.push(&name, pos, now) {
                    self.joined_reply(&mut g, &s, b, now, &mut fx);
                }
            }
            Joined::Full => {
                if g.budget.take(now) {
                    fx.chat(Some(format!("@{name} the queue is full right now.")));
                }
            }
            Joined::Already(pos) | Joined::NoteChanged(pos) => {
                self.position_reply(&mut g, &s, &name, Some(pos), now, &mut fx);
            }
            Joined::Playing | Joined::Closed => {}
        }
        if matches!(r, Joined::Added(_) | Joined::NoteChanged(_)) {
            self.changed(&g, fx);
        } else {
            self.run(fx);
        }
    }

    fn joined_reply(&self, g: &mut Inner, s: &QueueSettings, b: Batched, now: i64, fx: &mut Fx) {
        let Some(text) = s.messages.joined.active() else {
            return;
        };
        if !g.budget.take(now) {
            return;
        }
        let ctx = json!({ "name": b.name_text(), "position": b.position_text(), "size": g.queue.waiting.len() });
        fx.chat(line(Some(text), &ctx));
    }

    fn position_reply(
        &self,
        g: &mut Inner,
        s: &QueueSettings,
        name: &str,
        pos: Option<usize>,
        now: i64,
        fx: &mut Fx,
    ) {
        let text = match pos {
            Some(p) => {
                let Some(t) = s.messages.position.active() else {
                    return;
                };
                line(
                    Some(t),
                    &json!({ "name": name, "position": p, "size": g.queue.waiting.len() }),
                )
            }
            None => Some(format!("@{name} you're not in the queue.")),
        };
        if g.budget.take(now) {
            fx.chat(text);
        }
    }

    fn queue_leave(&self, v: &Viewer, now: i64) {
        let s = self.settings.get().queue;
        let mut g = self.inner.lock().unwrap();
        if !queue::leave(&mut g.queue, &v.id) {
            return;
        }
        let mut fx = Fx::default();
        if let Some(t) = s.messages.left.active()
            && g.budget.take(now)
        {
            fx.chat(line(Some(t), &json!({ "name": v.name })));
        }
        self.changed(&g, fx);
    }

    fn queue_position(&self, v: &Viewer, now: i64) {
        let s = self.settings.get().queue;
        let mut g = self.inner.lock().unwrap();
        let pos = queue::position(&g.queue, &s, &v.id);
        let mut fx = Fx::default();
        self.position_reply(&mut g, &s, &v.name, pos, now, &mut fx);
        self.run(fx);
    }

    pub fn set_queue_open(&self, open: bool) -> ViewerQueue {
        let mut g = self.inner.lock().unwrap();
        g.queue.open = open;
        let out = g.queue.clone();
        self.changed(&g, Fx::default());
        out
    }

    fn picked(&self, g: &Inner, s: &QueueSettings, picked: &[QueueEntry]) -> Fx {
        let mut fx = Fx::default();
        if picked.is_empty() {
            return fx;
        }
        let names: Vec<String> = picked
            .iter()
            .map(|e| format!("@{}", e.viewer.name))
            .collect();
        let all: Vec<String> = picked.iter().map(|e| e.viewer.name.clone()).collect();
        let ctx = json!({ "players": chat::name_list(&names, 20), "size": g.queue.waiting.len() });
        fx.chat(line(s.messages.up.active(), &ctx));
        for e in picked {
            let mut m = Map::new();
            m.insert("player".into(), json!(e.viewer.name));
            m.insert("player_login".into(), json!(e.viewer.login));
            m.insert("note".into(), json!(e.note));
            m.insert("players".into(), json!(all.join(", ")));
            fx.signals.push((PlayTrigger::PlayerPicked, m));
        }
        fx
    }

    /// The next players. `count` 0 = the party size.
    pub fn queue_next(&self, count: u32, random: bool) -> AppResult<Vec<QueueEntry>> {
        let s = self.settings.get().queue;
        let n = if count == 0 { s.party_size } else { count }.clamp(1, 50);
        let mut g = self.inner.lock().unwrap();
        if g.queue.waiting.is_empty() {
            return user_err("Nobody is waiting.");
        }
        let picked = if random {
            queue::random(&mut g.queue, n, &mut rand::rng())
        } else {
            queue::next(&mut g.queue, &s, n)
        };
        let fx = self.picked(&g, &s, &picked);
        self.changed(&g, fx);
        Ok(picked)
    }

    pub fn queue_remove(&self, user_id: &str) -> ViewerQueue {
        let mut g = self.inner.lock().unwrap();
        queue::remove(&mut g.queue, user_id);
        let out = g.queue.clone();
        self.changed(&g, Fx::default());
        out
    }

    pub fn queue_clear(&self) -> ViewerQueue {
        let mut g = self.inner.lock().unwrap();
        g.queue.waiting.clear();
        g.queue.playing.clear();
        g.queue.sub_turn = false;
        let out = g.queue.clone();
        self.changed(&g, Fx::default());
        out
    }

    pub fn queue_move(&self, user_id: &str, before: Option<&str>) -> ViewerQueue {
        let mut g = self.inner.lock().unwrap();
        queue::move_before(&mut g.queue, user_id, before);
        let out = g.queue.clone();
        self.changed(&g, Fx::default());
        out
    }

    pub fn queue_note(&self, user_id: &str, note: &str) -> ViewerQueue {
        let mut g = self.inner.lock().unwrap();
        queue::set_note(&mut g.queue, user_id, note);
        let out = g.queue.clone();
        self.changed(&g, Fx::default());
        out
    }

    /// Timers: auto-close, claim times and batched join replies.
    pub fn tick(&self, now: i64) {
        let s = self.settings.get().queue;
        let mut g = self.inner.lock().unwrap();
        let mut fx = Fx::default();
        let mut dirty = false;
        if let Some(gw) = g.giveaway.as_mut() {
            if giveaway::should_close(gw, now) {
                Self::close_in(gw, now, &mut fx);
                dirty = true;
            }
            for name in giveaway::expire_claims(gw, now) {
                fx.logs
                    .push(format!("{name} didn't claim in time. Draw again?"));
                dirty = true;
            }
            if dirty {
                let out = gw.clone();
                self.store_record(&out, 0);
            }
        }
        if let Some(b) = g.batch.due(now) {
            self.joined_reply(&mut g, &s, b, now, &mut fx);
        }
        if dirty {
            self.changed(&g, fx);
        } else {
            self.run(fx);
        }
    }
}

impl PlayActions for PlayService {
    fn open_giveaway(&self, title: &str) -> AppResult<()> {
        let mut s = self.settings.get().giveaway;
        if !title.trim().is_empty() {
            s.title = title.trim().to_string();
        }
        PlayService::open_giveaway(self, s).map(|_| ())
    }
    fn close_giveaway(&self) -> AppResult<()> {
        self.set_giveaway_open(false).map(|_| ())
    }
    fn draw_giveaway(&self, count: u32) -> AppResult<()> {
        self.draw(count).map(|_| ())
    }
    fn set_queue_open(&self, open: Option<bool>) -> AppResult<()> {
        let now_open = self.inner.lock().unwrap().queue.open;
        PlayService::set_queue_open(self, open.unwrap_or(!now_open));
        Ok(())
    }
    fn queue_next(&self, count: u32, random: bool) -> AppResult<()> {
        PlayService::queue_next(self, count, random).map(|_| ())
    }
    fn clear_queue(&self) -> AppResult<()> {
        self.queue_clear();
        Ok(())
    }
}
