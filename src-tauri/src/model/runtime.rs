//! Live state the backend pushes to the app window and to overlays.

use super::alert::AlertLayout;
use super::event::{Event, EventKind};
use super::overlay::{Animation, BoxStyle, Overlay, TextStyle};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ConnState {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct SceneItem {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub visible: bool,
    pub locked: bool,
    pub is_group: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct AudioInput {
    pub name: String,
    pub kind: String,
    /// Volume fader position in dB (-100 = silent).
    pub volume_db: f64,
    pub muted: bool,
    pub monitoring: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct OutputState {
    pub active: bool,
    pub paused: bool,
    /// Milliseconds since the output started.
    #[ts(type = "number")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ObsStats {
    pub cpu_percent: f64,
    pub memory_mb: f64,
    pub active_fps: f64,
    pub render_skipped_percent: f64,
    pub output_skipped_percent: f64,
    /// Stream bitrate, worked out from bytes sent.
    pub stream_kbps: f64,
    pub stream_dropped_percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ObsSnapshot {
    pub state: ConnState,
    pub error: Option<String>,
    pub obs_version: String,
    pub websocket_version: String,
    pub scenes: Vec<String>,
    pub program_scene: String,
    pub preview_scene: Option<String>,
    pub studio_mode: bool,
    /// Items in the scene being edited (preview in Studio Mode, program otherwise).
    pub scene_items: Vec<SceneItem>,
    pub inputs: Vec<AudioInput>,
    pub stream: OutputState,
    pub record: OutputState,
    /// None when the replay buffer is not enabled in OBS.
    pub replay_buffer: Option<bool>,
    pub virtual_cam: bool,
    pub transitions: Vec<String>,
    pub current_transition: String,
    pub transition_ms: u32,
    pub stats: ObsStats,
    pub base_width: u32,
    pub base_height: u32,
}

/// Peak level per input, sent about 20 times a second while the mixer is open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct AudioLevel {
    pub name: String,
    /// Peak per channel in dB (-100 = silent).
    pub peaks_db: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct TwitchAccount {
    pub id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: String,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct StreamInfo {
    pub live: bool,
    pub viewers: u32,
    pub title: String,
    pub category: String,
    pub category_id: String,
    pub tags: Vec<String>,
    /// ms since epoch, 0 when offline.
    #[ts(type = "number")]
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct TwitchStatus {
    pub broadcaster: Option<TwitchAccount>,
    pub bot: Option<TwitchAccount>,
    pub eventsub: ConnState,
    pub error: Option<String>,
    /// Event types Twitch refused (usually a missing permission).
    pub failed_subscriptions: Vec<String>,
    pub stream: StreamInfo,
    /// Whether a client ID is available (built in or set by the user).
    pub has_client_id: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeviceLogin {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in_s: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AccountRole {
    Broadcaster,
    Bot,
}

/// A fully rendered alert, ready for an overlay to show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AlertPlay {
    pub id: String,
    pub kind: EventKind,
    pub event: Event,
    pub variation_id: String,
    pub priority: i32,
    pub title: String,
    pub message: String,
    /// URLs the overlay can load directly.
    pub image: String,
    pub video: String,
    pub sound: String,
    pub volume: u8,
    pub duration_ms: u32,
    pub enter: Animation,
    pub exit: Animation,
    pub layout: AlertLayout,
    pub title_style: TextStyle,
    pub message_style: TextStyle,
    pub accent: String,
    pub background: String,
    #[serde(default)]
    pub card: Option<BoxStyle>,
    pub tts: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct QueueState {
    pub paused: bool,
    /// Alert sounds, videos and speech are silent while muted.
    pub muted: bool,
    pub playing: Option<AlertPlay>,
    pub waiting: Vec<AlertPlay>,
    /// The alert that played most recently, for "Replay last".
    pub last: Option<AlertPlay>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogEntry {
    #[ts(type = "number")]
    pub ts: i64,
    pub level: LogLevel,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ServerInfo {
    pub running: bool,
    pub port: u16,
    pub base_url: String,
    pub token: String,
    /// Opens `/assets/` only, so asset links never carry the real token.
    pub asset_key: String,
    pub error: Option<String>,
}

/// Messages from the app to an overlay page over the WebSocket.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum OverlayMsg {
    Hello {
        overlay: Overlay,
        #[ts(type = "Record<string, unknown>")]
        vars: serde_json::Map<String, serde_json::Value>,
        recent: Vec<Event>,
        chat: Vec<Event>,
        #[ts(type = "Record<string, Record<string, unknown>>")]
        widget_state: serde_json::Map<String, serde_json::Value>,
    },
    Overlay {
        overlay: Overlay,
    },
    Vars {
        #[ts(type = "Record<string, unknown>")]
        changes: serde_json::Map<String, serde_json::Value>,
    },
    Event {
        event: Event,
    },
    ChatDelete {
        message_id: String,
    },
    ChatClearUser {
        user_id: String,
    },
    ChatClear,
    AlertPlay {
        play: AlertPlay,
    },
    AlertStop {
        id: String,
    },
    PlaySound {
        src: String,
        volume: u8,
    },
    LayerVisible {
        layer_id: String,
        visible: bool,
    },
    Reload,
}

/// Messages from an overlay page back to the app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum OverlayClientMsg {
    /// A custom widget saved a value (`SE_API.store.set`).
    StoreSet {
        layer_id: String,
        key: String,
        #[ts(type = "unknown")]
        value: serde_json::Value,
    },
    StoreDelete {
        layer_id: String,
        key: String,
    },
    /// Keep-alive sent by the page every 25 seconds.
    Ping,
}
