use super::condition::ConditionGroup;
use super::event::EventKind;
use super::overlay::{Animation, TextStyle};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Variation {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub conditions: ConditionGroup,
    /// Higher plays first when several alerts are waiting.
    pub priority: i32,
    /// Templates, e.g. `{{name}} subscribed for {{months}} months`.
    pub title: String,
    pub message: String,
    /// Asset path inside the project (`assets/...`) or an http(s) URL.
    pub image: String,
    pub video: String,
    pub sound: String,
    /// 0 to 100.
    pub volume: u8,
    pub duration_ms: u32,
    pub enter: Animation,
    pub exit: Animation,
    pub layout: AlertLayout,
    pub title_style: TextStyle,
    pub message_style: TextStyle,
    pub accent: String,
    pub background: String,
    /// Read the viewer message aloud with the system voice in the overlay.
    pub tts: bool,
    /// Automation action to run when this variation plays.
    pub run_action: Option<String>,
}

impl Default for Variation {
    fn default() -> Self {
        Variation {
            id: crate::util::new_id(),
            name: "Default".into(),
            enabled: true,
            conditions: ConditionGroup::default(),
            priority: 0,
            title: "{{name}}".into(),
            message: String::new(),
            image: String::new(),
            video: String::new(),
            sound: String::new(),
            volume: 70,
            duration_ms: 6000,
            enter: Animation::preset(super::overlay::AnimPreset::SlideUp, 450),
            exit: Animation::preset(super::overlay::AnimPreset::Fade, 350),
            layout: AlertLayout::MediaAbove,
            title_style: TextStyle {
                font_size: 40.0,
                font_weight: 800,
                ..TextStyle::default()
            },
            message_style: TextStyle {
                font_size: 24.0,
                font_weight: 500,
                ..TextStyle::default()
            },
            accent: "#9db8ff".into(),
            background: "rgba(12,15,22,0.82)".into(),
            tts: false,
            run_action: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AlertLayout {
    #[default]
    MediaAbove,
    MediaLeft,
    MediaBehind,
    TextOnly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct AlertType {
    pub kind: EventKind,
    pub enabled: bool,
    /// Checked top to bottom; the first enabled match plays.
    pub variations: Vec<Variation>,
}

impl Default for AlertType {
    fn default() -> Self {
        AlertType {
            kind: EventKind::Follow,
            enabled: true,
            variations: vec![Variation::default()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct AlertSettings {
    /// Pause between one alert ending and the next starting.
    pub gap_ms: u32,
    /// Show one alert for a community gift instead of one per gifted sub.
    pub combine_gifts: bool,
    /// Ignore alerts whose viewer message contains any of these words.
    pub blocked_words: Vec<String>,
    /// Replace links in viewer messages with "[link]".
    pub hide_links: bool,
    /// Ignore cheers below this many bits (0 = all).
    pub min_bits: u32,
    /// Ignore raids below this many viewers (0 = all).
    pub min_raid_viewers: u32,
    /// Most alerts allowed to wait; older ones are dropped beyond this.
    pub max_queue: u32,
}

impl Default for AlertSettings {
    fn default() -> Self {
        AlertSettings {
            gap_ms: 800,
            combine_gifts: true,
            blocked_words: Vec::new(),
            hide_links: true,
            min_bits: 0,
            min_raid_viewers: 0,
            max_queue: 50,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct AlertConfig {
    pub settings: AlertSettings,
    pub types: Vec<AlertType>,
}

impl AlertConfig {
    pub fn starter() -> Self {
        use super::condition::{Condition, MatchMode, Op};
        let t = |kind: EventKind, title: &str, message: &str| AlertType {
            kind,
            enabled: true,
            variations: vec![Variation {
                title: title.into(),
                message: message.into(),
                ..Variation::default()
            }],
        };
        let mut sub = t(EventKind::Sub, "{{name}} subscribed!", "Tier {{tier}}");
        sub.variations.insert(
            0,
            Variation {
                name: "Tier 3".into(),
                priority: 2,
                title: "{{name}} is a legend!".into(),
                message: "Tier 3 sub".into(),
                accent: "#c9b3ff".into(),
                conditions: ConditionGroup {
                    mode: MatchMode::All,
                    conditions: vec![Condition {
                        field: "tier".into(),
                        op: Op::Eq,
                        value: 3.into(),
                    }],
                },
                ..Variation::default()
            },
        );
        AlertConfig {
            settings: AlertSettings::default(),
            types: vec![
                t(EventKind::Follow, "{{name}} followed", "Welcome in!"),
                sub,
                t(
                    EventKind::Resub,
                    "{{name}} resubscribed",
                    "{{months}} months · {{message}}",
                ),
                t(
                    EventKind::GiftSub,
                    "{{name}} gifted a sub",
                    "to {{recipient_name}}",
                ),
                t(
                    EventKind::CommunityGift,
                    "{{name}} gifted {{amount}} subs",
                    "Thank you!",
                ),
                t(
                    EventKind::Cheer,
                    "{{name}} cheered {{amount | number}} bits",
                    "{{message}}",
                ),
                t(
                    EventKind::Raid,
                    "{{name}} is raiding",
                    "with {{amount | number}} viewers",
                ),
                t(
                    EventKind::Redemption,
                    "{{name}} redeemed {{data.reward_title}}",
                    "{{message}}",
                ),
                t(
                    EventKind::PowerUp,
                    "{{name}} used a power-up",
                    "{{message}}",
                ),
                t(
                    EventKind::HypeTrainBegin,
                    "Hype train!",
                    "Level {{data.level}}",
                ),
                t(
                    EventKind::Charity,
                    "{{name}} donated {{amount | number}} {{currency}}",
                    "{{message}}",
                ),
                t(
                    EventKind::ShoutoutReceived,
                    "{{name}} gave us a shoutout",
                    "",
                ),
                t(EventKind::AdBreak, "Ad break", "Back in {{amount}} seconds"),
            ],
        }
    }

    pub fn type_for(&self, kind: EventKind) -> Option<&AlertType> {
        self.types.iter().find(|t| t.kind == kind)
    }
}
