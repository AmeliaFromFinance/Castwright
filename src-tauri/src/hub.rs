//! The hub connects every part of the app. Twitch publishes events here; alerts,
//! automation, overlays and the app window all listen.

use crate::model::ads::AdSchedule;
use crate::model::event::{Event, EventKind};
use crate::model::runtime::{LogEntry, LogLevel, OverlayMsg};
use crate::sessions::Sessions;
use crate::store::db::Db;
use crate::vars::{Changes, Vars};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// Names of the events pushed to the app window.
pub mod ui {
    pub const EVENT: &str = "cw://event";
    pub const VARS: &str = "cw://vars";
    pub const LOG: &str = "cw://log";
    pub const OBS: &str = "cw://obs";
    pub const OBS_LEVELS: &str = "cw://obs-levels";
    pub const TWITCH: &str = "cw://twitch";
    pub const QUEUE: &str = "cw://queue";
    pub const PROJECT: &str = "cw://project";
    pub const SERVER: &str = "cw://server";
    pub const CHAT_DELETE: &str = "cw://chat-delete";
    pub const CHAT_MODES: &str = "cw://chat-modes";
    pub const ACTION_RUN: &str = "cw://action-run";
    pub const ACTION_PROGRESS: &str = "cw://action-progress";
    pub const GOLIVE_OPEN: &str = "cw://golive-open";
    pub const SESSION: &str = "cw://session";
    pub const REDEMPTION: &str = "cw://redemption";
    pub const ADS: &str = "cw://ads";
    pub const AD_WARNING: &str = "cw://ad-warning";
}

/// Where window events go. The real app uses the Tauri handle; tests use a recorder.
pub trait UiSink: Send + Sync {
    fn emit(&self, name: &str, payload: serde_json::Value);
}

pub struct NullUi;
impl UiSink for NullUi {
    fn emit(&self, _: &str, _: serde_json::Value) {}
}

/// Records window events (for tests).
#[derive(Default)]
pub struct RecordingUi(pub Mutex<Vec<(String, serde_json::Value)>>);
impl UiSink for RecordingUi {
    fn emit(&self, name: &str, payload: serde_json::Value) {
        self.0.lock().unwrap().push((name.to_string(), payload));
    }
}

/// Things that happen inside the app (not Twitch events) that automation can react to.
#[derive(Debug, Clone, PartialEq)]
pub enum Signal {
    SceneChanged { scene: String },
    ObsConnected,
    ObsDisconnected,
    AdSchedule(AdSchedule),
    AdBegin { length_s: u32 },
    AdEnd { length_s: u32 },
}

/// A message for overlays. `target` = one overlay id, or None for all.
#[derive(Debug, Clone)]
pub struct OverlayOut {
    pub target: Option<String>,
    pub msg: OverlayMsg,
}

const CHAT_KEEP: usize = 200;
const RECENT_KEEP: usize = 50;
const LOG_KEEP: usize = 500;

pub struct Hub {
    ui: Arc<dyn UiSink>,
    pub vars: Arc<Vars>,
    pub db: Arc<Db>,
    pub sessions: Arc<Sessions>,
    events: broadcast::Sender<Event>,
    overlay: broadcast::Sender<OverlayOut>,
    signals: broadcast::Sender<Signal>,
    chat: Mutex<VecDeque<Event>>,
    recent: Mutex<VecDeque<Event>>,
    log: Mutex<VecDeque<LogEntry>>,
}

impl Hub {
    pub fn new(ui: Arc<dyn UiSink>, vars: Arc<Vars>, db: Arc<Db>) -> Arc<Hub> {
        let (events, _) = broadcast::channel(1024);
        let (overlay, _) = broadcast::channel(1024);
        let (signals, _) = broadcast::channel(256);
        let recent: VecDeque<Event> = db
            .recent_events(RECENT_KEEP as u32, &[], "", false)
            .unwrap_or_default()
            .into_iter()
            .rev()
            .collect();
        Arc::new(Hub {
            ui,
            vars,
            sessions: Arc::new(Sessions::load(db.clone())),
            db,
            events,
            overlay,
            signals,
            chat: Mutex::new(VecDeque::new()),
            recent: Mutex::new(recent),
            log: Mutex::new(VecDeque::new()),
        })
    }

    pub fn test() -> Arc<Hub> {
        Hub::new(
            Arc::new(NullUi),
            Arc::new(Vars::new()),
            Arc::new(Db::open_in_memory()),
        )
    }

    pub fn emit_ui<T: Serialize>(&self, name: &str, payload: &T) {
        match serde_json::to_value(payload) {
            Ok(v) => self.ui.emit(name, v),
            Err(e) => tracing::error!("couldn't serialise {name}: {e}"),
        }
    }

    /// Send an event to everything that listens. Duplicates (same id) are dropped.
    /// Returns false when the event was a duplicate.
    pub fn publish(&self, mut event: Event) -> bool {
        if event.kind == EventKind::Chat {
            if self.chat.lock().unwrap().iter().any(|c| c.id == event.id) {
                return false;
            }
            if self.sessions.on_chat(&event) {
                event.data.insert("first_chat".into(), true.into());
            }
            let mut chat = self.chat.lock().unwrap();
            chat.push_back(event.clone());
            while chat.len() > CHAT_KEEP {
                chat.pop_front();
            }
        } else {
            match self.db.insert_event(&event) {
                Ok(false) => return false,
                Ok(true) => {}
                Err(e) => self.log(
                    LogLevel::Warn,
                    "history",
                    format!("Couldn't save event: {e}"),
                ),
            }
            if !event.test {
                let changes = self.vars.apply_event(&event);
                self.broadcast_vars(changes);
            }
            let mut recent = self.recent.lock().unwrap();
            recent.push_back(event.clone());
            while recent.len() > RECENT_KEEP {
                recent.pop_front();
            }
        }
        self.emit_ui(ui::EVENT, &event);
        self.to_overlays(
            None,
            OverlayMsg::Event {
                event: event.clone(),
            },
        );
        let _ = self.events.send(event);
        true
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    pub fn signal(&self, s: Signal) {
        let _ = self.signals.send(s);
    }

    pub fn subscribe_signals(&self) -> broadcast::Receiver<Signal> {
        self.signals.subscribe()
    }

    pub fn to_overlays(&self, target: Option<&str>, msg: OverlayMsg) {
        let _ = self.overlay.send(OverlayOut {
            target: target.map(String::from),
            msg,
        });
    }

    pub fn subscribe_overlays(&self) -> broadcast::Receiver<OverlayOut> {
        self.overlay.subscribe()
    }

    pub fn recent_chat(&self) -> Vec<Event> {
        self.chat.lock().unwrap().iter().cloned().collect()
    }

    pub fn recent_events(&self) -> Vec<Event> {
        self.recent.lock().unwrap().iter().cloned().collect()
    }

    /// Remove a chat message everywhere (moderator deleted it on Twitch).
    pub fn delete_chat(&self, message_id: &str) {
        self.chat.lock().unwrap().retain(|c| c.id != message_id);
        self.emit_ui(
            ui::CHAT_DELETE,
            &serde_json::json!({ "message_id": message_id }),
        );
        self.to_overlays(
            None,
            OverlayMsg::ChatDelete {
                message_id: message_id.to_string(),
            },
        );
    }

    /// Remove every chat message from one user (timeout or ban).
    pub fn clear_chat_user(&self, user_id: &str) {
        self.chat
            .lock()
            .unwrap()
            .retain(|c| c.user.as_ref().is_none_or(|u| u.id != user_id));
        self.emit_ui(ui::CHAT_DELETE, &serde_json::json!({ "user_id": user_id }));
        self.to_overlays(
            None,
            OverlayMsg::ChatClearUser {
                user_id: user_id.to_string(),
            },
        );
    }

    pub fn clear_chat(&self) {
        self.chat.lock().unwrap().clear();
        self.emit_ui(ui::CHAT_DELETE, &serde_json::json!({ "all": true }));
        self.to_overlays(None, OverlayMsg::ChatClear);
    }

    pub fn set_var(&self, key: &str, value: serde_json::Value, persist: bool) {
        let ch = self.vars.set(key, value, persist);
        self.broadcast_vars(ch);
    }

    pub fn add_var(&self, key: &str, amount: f64, persist: bool) -> f64 {
        let (n, ch) = self.vars.add(key, amount, persist);
        self.broadcast_vars(ch);
        n
    }

    pub fn delete_var(&self, key: &str) {
        let ch = self.vars.delete(key);
        self.broadcast_vars(ch);
    }

    pub fn broadcast_vars(&self, changes: Changes) {
        if changes.is_empty() {
            return;
        }
        self.emit_ui(ui::VARS, &changes);
        self.to_overlays(None, OverlayMsg::Vars { changes });
    }

    pub fn log(&self, level: LogLevel, source: &str, message: impl Into<String>) {
        let entry = LogEntry {
            ts: crate::util::now_ms(),
            level,
            source: source.to_string(),
            message: message.into(),
        };
        match level {
            LogLevel::Info => tracing::info!("[{}] {}", entry.source, entry.message),
            LogLevel::Warn => tracing::warn!("[{}] {}", entry.source, entry.message),
            LogLevel::Error => tracing::error!("[{}] {}", entry.source, entry.message),
        }
        {
            let mut log = self.log.lock().unwrap();
            log.push_back(entry.clone());
            while log.len() > LOG_KEEP {
                log.pop_front();
            }
        }
        self.emit_ui(ui::LOG, &entry);
    }

    pub fn logs(&self) -> Vec<LogEntry> {
        self.log.lock().unwrap().iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publish_fans_out_and_dedupes() {
        let rec = Arc::new(RecordingUi::default());
        let hub = Hub::new(
            rec.clone(),
            Arc::new(Vars::new()),
            Arc::new(Db::open_in_memory()),
        );
        let mut rx = hub.subscribe_events();
        let mut ov = hub.subscribe_overlays();
        let e = Event::new(EventKind::Follow).with_user("a", "A");
        assert!(hub.publish(e.clone()));
        assert!(!hub.publish(e.clone()), "duplicate dropped");
        assert_eq!(rx.recv().await.unwrap().id, e.id);
        assert!(rx.try_recv().is_err());
        // vars change first, then the event
        let first = ov.recv().await.unwrap();
        assert!(matches!(first.msg, OverlayMsg::Vars { .. }));
        let second = ov.recv().await.unwrap();
        assert!(matches!(second.msg, OverlayMsg::Event { .. }));
        assert_eq!(hub.vars.get("last.follow.name"), Some("A".into()));
        assert!(rec.0.lock().unwrap().iter().any(|(n, _)| n == ui::EVENT));
    }

    #[test]
    fn test_events_do_not_change_counters() {
        let hub = Hub::test();
        let mut e = Event::new(EventKind::Sub).with_user("a", "A");
        e.test = true;
        hub.publish(e);
        assert!(hub.vars.get("session.subs").is_none());
    }

    #[test]
    fn chat_is_kept_in_memory_and_deletable() {
        let hub = Hub::test();
        let mut ids = Vec::new();
        for i in 0..(CHAT_KEEP + 10) {
            let mut e = Event::new(EventKind::Chat).with_user("u", "U");
            e.user.as_mut().unwrap().id = format!("{}", i % 2);
            ids.push(e.id.clone());
            hub.publish(e);
        }
        assert_eq!(hub.recent_chat().len(), CHAT_KEEP);
        hub.delete_chat(ids.last().unwrap());
        assert_eq!(hub.recent_chat().len(), CHAT_KEEP - 1);
        hub.clear_chat_user("1");
        assert!(
            hub.recent_chat()
                .iter()
                .all(|c| c.user.as_ref().unwrap().id == "0")
        );
        hub.clear_chat();
        assert!(hub.recent_chat().is_empty());
        assert!(
            hub.db.recent_events(10, &[], "", true).unwrap().is_empty(),
            "chat isn't stored"
        );
    }
}
