use super::music::MusicSettings;
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

/// What a global hotkey does.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum HotkeyAction {
    ReplayLastAlert,
    SkipAlert,
    /// Pause the alert queue, or resume it when paused.
    ToggleAlertPause,
    ToggleAlertMute,
    OpenGoLive,
    /// Add a stream marker with an automatic description.
    AddMarker,
    CreateClip,
    RunAction {
        action_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HotkeyBinding {
    pub action: HotkeyAction,
    /// Like `Ctrl+Shift+F1`. Empty = not set.
    #[serde(default)]
    pub keys: String,
}

pub const DEFAULT_SOCIAL_TEMPLATE: &str = "Thanks for hanging out! {{duration}} of {{category | default:\"streaming\"}} with a peak of {{peak_viewers | number}} viewers.\n{{follows}} new follows, {{subs}} subs and {{bits | number}} bits. Top chatter: {{top_chatter | default:\"nobody yet\"}}.";

/// Most characters the "Copy for socials" template may have.
pub const MAX_SOCIAL_TEMPLATE: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct HotkeySettings {
    pub enabled: bool,
    pub bindings: Vec<HotkeyBinding>,
}

impl Default for HotkeySettings {
    fn default() -> Self {
        HotkeySettings {
            enabled: true,
            bindings: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct SummarySettings {
    /// Text copied by "Copy for socials". Uses `{{placeholders}}`.
    pub social_template: String,
}

impl Default for SummarySettings {
    fn default() -> Self {
        SummarySettings {
            social_template: DEFAULT_SOCIAL_TEMPLATE.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct AdSettings {
    /// Show a heads-up before each ad.
    pub warn: bool,
    /// Minutes before the ad, 1 to 15.
    pub warn_minutes: u32,
}

impl Default for AdSettings {
    fn default() -> Self {
        AdSettings {
            warn: true,
            warn_minutes: 1,
        }
    }
}

impl AdSettings {
    pub fn clamped(self) -> Self {
        AdSettings {
            warn: self.warn,
            warn_minutes: self.warn_minutes.clamp(1, 15),
        }
    }

    /// Seconds before an ad to warn; 0 when warnings are off.
    pub fn lead_s(&self) -> u32 {
        if self.warn {
            self.warn_minutes.clamp(1, 15) * 60
        } else {
            0
        }
    }
}

pub const DEFAULT_DISCORD_LIVE: &str =
    "{{channel}} is live with {{category | default:\"a new stream\"}}!";
pub const DEFAULT_DISCORD_END: &str =
    "Thanks for watching! {{duration}} of {{category | default:\"streaming\"}}.";

/// A Discord webhook. Its URL is a secret and is kept in the keychain, never here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct DiscordWebhook {
    pub id: String,
    /// Shown in the app only, like "#announcements".
    pub name: String,
    /// Post when the stream goes live.
    pub on_live: bool,
    /// Post a summary when the stream ends.
    pub on_end: bool,
    pub live_template: String,
    pub end_template: String,
    /// `<@&role id>`, `@everyone`, `@here` or empty for no ping.
    pub mention: String,
    /// Change the go-live post to "ended" when the stream ends.
    pub edit_on_end: bool,
    /// Whether a URL is saved. Filled in from the keychain.
    pub has_url: bool,
}

impl Default for DiscordWebhook {
    fn default() -> Self {
        DiscordWebhook {
            id: crate::util::new_id(),
            name: "Discord".into(),
            on_live: true,
            on_end: false,
            live_template: DEFAULT_DISCORD_LIVE.into(),
            end_template: DEFAULT_DISCORD_END.into(),
            mention: String::new(),
            edit_on_end: false,
            has_url: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct DiscordSettings {
    pub webhooks: Vec<DiscordWebhook>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum UpdateChannel {
    #[default]
    Stable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct UpdateSettings {
    /// Download updates in the background and install them when Castwright closes.
    pub auto_install: bool,
    pub channel: UpdateChannel,
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
    /// Global hotkeys. Kept per computer, not in the project.
    pub hotkeys: HotkeySettings,
    pub summary: SummarySettings,
    pub ads: AdSettings,
    pub discord: DiscordSettings,
    pub updates: UpdateSettings,
    pub music: MusicSettings,
}
