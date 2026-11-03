use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const DEFAULT_SERVER_PORT: u16 = 7470;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ObsSettings {
    pub host: String,
    pub port: u16,
    pub auto_connect: bool,
    /// Whether a password is saved in the system keychain (the password itself never leaves it).
    pub has_password: bool,
}

impl Default for ObsSettings {
    fn default() -> Self {
        ObsSettings {
            host: "127.0.0.1".into(),
            port: 4455,
            auto_connect: true,
            has_password: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct TwitchSettings {
    /// Client ID of a Twitch application set to the "Public" client type.
    /// Empty = use the one built into this release.
    pub client_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ServerSettings {
    pub port: u16,
    /// Secret in every overlay URL so other programs on the network can't read them.
    pub token: String,
    /// Allow other devices on the local network (phones, a second PC) to connect.
    pub allow_lan: bool,
}

impl Default for ServerSettings {
    fn default() -> Self {
        ServerSettings {
            port: DEFAULT_SERVER_PORT,
            token: crate::util::random_token(),
            allow_lan: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WindowEffect {
    /// Mica on Windows 11, nothing elsewhere.
    #[default]
    Auto,
    Mica,
    Acrylic,
    Vibrancy,
    Solid,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct AppearanceSettings {
    /// Id of the active theme (`dark`, `light`, `high_contrast`, `system` or a custom one).
    pub theme: String,
    /// User-made themes, stored as the JSON the theme editor produces.
    #[ts(type = "Array<Record<string, unknown>>")]
    pub custom_themes: Vec<serde_json::Value>,
    pub window_effect: WindowEffect,
    /// 50 to 250 (percent).
    pub ui_scale: u16,
    pub reduce_motion: bool,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        AppearanceSettings {
            theme: "system".into(),
            custom_themes: Vec::new(),
            window_effect: WindowEffect::Auto,
            ui_scale: 100,
            reduce_motion: false,
        }
    }
}

/// A tick box the user adds to the go-live check, like "Mic on".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct ChecklistItem {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GoLiveSettings {
    /// Open the go-live check when the stream starts and something fails.
    pub open_on_live: bool,
    pub items: Vec<ChecklistItem>,
}

impl Default for GoLiveSettings {
    fn default() -> Self {
        GoLiveSettings {
            open_on_live: true,
            items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct BackupSettings {
    /// Days to keep a startup or daily backup for (one per day).
    pub keep_daily: u32,
    /// Backups made by hand or before a restore, import or upgrade.
    pub keep_other: u32,
}

impl Default for BackupSettings {
    fn default() -> Self {
        BackupSettings {
            keep_daily: 14,
            keep_other: 5,
        }
    }
}

impl BackupSettings {
    pub fn clamped(self) -> Self {
        BackupSettings {
            keep_daily: self.keep_daily.clamp(1, 365),
            keep_other: self.keep_other.clamp(1, 100),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Settings {
    pub first_run_done: bool,
    /// Folder holding project.json, variables and assets. Empty = default location.
    pub project_dir: String,
    pub obs: ObsSettings,
    pub twitch: TwitchSettings,
    pub server: ServerSettings,
    pub appearance: AppearanceSettings,
    /// Kept between runs. Pausing is not, so alerts always play after a restart.
    pub alerts_muted: bool,
    pub golive: GoLiveSettings,
    pub backups: BackupSettings,
}
