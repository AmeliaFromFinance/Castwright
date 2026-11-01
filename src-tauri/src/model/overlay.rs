use super::condition::ConditionGroup;
use super::event::EventKind;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AnimPreset {
    #[default]
    None,
    Fade,
    SlideUp,
    SlideDown,
    SlideLeft,
    SlideRight,
    Zoom,
    Pop,
    Bounce,
    Flip,
    Pulse,
    Float,
    Shake,
    Spin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    #[default]
    EaseInOut,
    Spring,
    Back,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Animation {
    pub preset: AnimPreset,
    pub duration_ms: u32,
    pub delay_ms: u32,
    pub easing: Easing,
}

impl Animation {
    pub fn preset(preset: AnimPreset, duration_ms: u32) -> Self {
        Animation {
            preset,
            duration_ms,
            delay_ms: 0,
            easing: Easing::EaseOut,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u16,
    pub color: String,
    pub align: TextAlign,
    pub line_height: f64,
    pub letter_spacing: f64,
    pub uppercase: bool,
    pub italic: bool,
    /// CSS text-shadow, e.g. `0 2px 8px rgba(0,0,0,.6)`.
    pub shadow: String,
    /// Outline width in px (0 = none).
    pub stroke_width: f64,
    pub stroke_color: String,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font_family: "Inter".into(),
            font_size: 28.0,
            font_weight: 600,
            color: "#ffffff".into(),
            align: TextAlign::Left,
            line_height: 1.25,
            letter_spacing: 0.0,
            uppercase: false,
            italic: false,
            shadow: "0 2px 6px rgba(0,0,0,0.45)".into(),
            stroke_width: 0.0,
            stroke_color: "#000000".into(),
        }
    }
}

/// Box styling every layer can use.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct BoxStyle {
    pub background: String,
    pub border_color: String,
    pub border_width: f64,
    pub radius: f64,
    pub padding: f64,
    pub shadow: String,
    pub backdrop_blur: f64,
}

impl Default for BoxStyle {
    fn default() -> Self {
        BoxStyle {
            background: "transparent".into(),
            border_color: "transparent".into(),
            border_width: 0.0,
            radius: 0.0,
            padding: 0.0,
            shadow: String::new(),
            backdrop_blur: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MediaFit {
    #[default]
    Contain,
    Cover,
    Fill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ShapeKind {
    #[default]
    Rect,
    Ellipse,
    Line,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TimerMode {
    #[default]
    Countdown,
    Stopwatch,
    Clock,
    Uptime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ListDirection {
    #[default]
    Vertical,
    Ticker,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum LayerKind {
    Text {
        #[serde(default)]
        text: String,
        #[serde(default)]
        style: TextStyle,
    },
    Shape {
        #[serde(default)]
        shape: ShapeKind,
        #[serde(default)]
        fill: String,
        #[serde(default)]
        stroke: String,
        #[serde(default)]
        stroke_width: f64,
    },
    Image {
        #[serde(default)]
        src: String,
        #[serde(default)]
        fit: MediaFit,
    },
    Video {
        #[serde(default)]
        src: String,
        #[serde(default)]
        fit: MediaFit,
        #[serde(default = "yes")]
        looped: bool,
        #[serde(default = "yes")]
        muted: bool,
        #[serde(default)]
        volume: u8,
    },
    /// Plays the alert queue.
    Alerts {},
    Chat {
        #[serde(default = "default_chat_max")]
        max_messages: u32,
        /// Seconds before a message fades out (0 = never).
        #[serde(default)]
        fade_after_s: u32,
        #[serde(default = "yes")]
        show_badges: bool,
        #[serde(default = "yes")]
        hide_commands: bool,
        #[serde(default)]
        hide_users: Vec<String>,
        #[serde(default)]
        style: TextStyle,
        #[serde(default)]
        bubble: BoxStyle,
        #[serde(default)]
        newest_on_top: bool,
    },
    Goal {
        #[serde(default)]
        title: String,
        /// Variable holding the current value, e.g. `session.subs`.
        #[serde(default)]
        current_var: String,
        #[serde(default = "default_goal_target")]
        target: f64,
        #[serde(default)]
        bar_color: String,
        #[serde(default)]
        track_color: String,
        #[serde(default)]
        style: TextStyle,
        #[serde(default = "yes")]
        show_numbers: bool,
    },
    Counter {
        #[serde(default)]
        var: String,
        /// Template around the value, e.g. `Deaths: {{value}}`.
        #[serde(default)]
        format: String,
        #[serde(default)]
        style: TextStyle,
    },
    Timer {
        #[serde(default)]
        mode: TimerMode,
        /// Countdown length in seconds.
        #[serde(default)]
        duration_s: u32,
        /// Variable with a start/end timestamp in ms (optional).
        #[serde(default)]
        anchor_var: String,
        #[serde(default)]
        style: TextStyle,
        #[serde(default)]
        prefix: String,
    },
    EventList {
        #[serde(default)]
        kinds: Vec<EventKind>,
        #[serde(default = "default_list_max")]
        max_items: u32,
        #[serde(default)]
        direction: ListDirection,
        /// Template per item, e.g. `{{name}} · {{kind}}`.
        #[serde(default)]
        item_format: String,
        #[serde(default)]
        style: TextStyle,
    },
    /// HTML/CSS/JS widget with a StreamElements-compatible API.
    Custom {
        #[serde(default)]
        html: String,
        #[serde(default)]
        css: String,
        #[serde(default)]
        js: String,
        /// Field definitions in StreamElements "Fields" format.
        #[serde(default)]
        #[ts(type = "Record<string, unknown>")]
        fields: serde_json::Map<String, serde_json::Value>,
        /// Current field values.
        #[serde(default)]
        #[ts(type = "Record<string, unknown>")]
        values: serde_json::Map<String, serde_json::Value>,
    },
}

fn yes() -> bool {
    true
}
fn default_chat_max() -> u32 {
    12
}
fn default_goal_target() -> f64 {
    10.0
}
fn default_list_max() -> u32 {
    5
}

impl LayerKind {
    pub fn type_name(&self) -> &'static str {
        match self {
            LayerKind::Text { .. } => "text",
            LayerKind::Shape { .. } => "shape",
            LayerKind::Image { .. } => "image",
            LayerKind::Video { .. } => "video",
            LayerKind::Alerts {} => "alerts",
            LayerKind::Chat { .. } => "chat",
            LayerKind::Goal { .. } => "goal",
            LayerKind::Counter { .. } => "counter",
            LayerKind::Timer { .. } => "timer",
            LayerKind::EventList { .. } => "event_list",
            LayerKind::Custom { .. } => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub kind: LayerKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
    /// 0 to 1.
    pub opacity: f64,
    pub visible: bool,
    pub locked: bool,
    /// Shown only while these conditions match the current variables.
    pub visible_when: ConditionGroup,
    pub box_style: BoxStyle,
    pub enter: Animation,
    pub exit: Animation,
    pub idle: Animation,
    /// Extra CSS, scoped to this layer.
    pub css: String,
}

impl Default for Layer {
    fn default() -> Self {
        Layer {
            id: crate::util::new_id(),
            name: "Layer".into(),
            kind: LayerKind::Text {
                text: "Text".into(),
                style: TextStyle::default(),
            },
            x: 0.0,
            y: 0.0,
            w: 400.0,
            h: 100.0,
            rotation: 0.0,
            opacity: 1.0,
            visible: true,
            locked: false,
            visible_when: ConditionGroup::default(),
            box_style: BoxStyle::default(),
            enter: Animation::default(),
            exit: Animation::default(),
            idle: Animation::default(),
            css: String::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Overlay {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    /// Layers in paint order: first is at the back.
    pub layers: Vec<Layer>,
    /// Google Fonts families to load in the overlay.
    pub fonts: Vec<String>,
    #[ts(type = "number")]
    pub updated_at: i64,
}

impl Default for Overlay {
    fn default() -> Self {
        Overlay {
            id: crate::util::new_id(),
            name: "Overlay".into(),
            width: 1920,
            height: 1080,
            layers: Vec::new(),
            fonts: vec!["Inter".into()],
            updated_at: 0,
        }
    }
}

impl Overlay {
    /// The overlay a new project starts with: alerts, chat, a sub goal and a ticker.
    pub fn starter() -> Self {
        let panel = BoxStyle {
            background: "rgba(12,15,22,0.78)".into(),
            border_color: "rgba(255,255,255,0.08)".into(),
            border_width: 1.0,
            radius: 12.0,
            padding: 16.0,
            shadow: "0 12px 40px rgba(0,0,0,0.35)".into(),
            backdrop_blur: 10.0,
        };
        let small = TextStyle {
            font_size: 22.0,
            font_weight: 500,
            ..TextStyle::default()
        };
        Overlay {
            id: crate::util::new_id(),
            name: "Gameplay HUD".into(),
            layers: vec![
                Layer {
                    name: "Sub goal".into(),
                    kind: LayerKind::Goal {
                        title: "Sub goal".into(),
                        current_var: "session.subs".into(),
                        target: 20.0,
                        bar_color: "#5b8def".into(),
                        track_color: "rgba(255,255,255,0.14)".into(),
                        style: small.clone(),
                        show_numbers: true,
                    },
                    x: 48.0,
                    y: 48.0,
                    w: 560.0,
                    h: 110.0,
                    box_style: panel.clone(),
                    enter: Animation::preset(AnimPreset::SlideDown, 500),
                    ..Layer::default()
                },
                Layer {
                    name: "Chat".into(),
                    kind: LayerKind::Chat {
                        max_messages: 10,
                        fade_after_s: 0,
                        show_badges: true,
                        hide_commands: true,
                        hide_users: Vec::new(),
                        style: small.clone(),
                        bubble: BoxStyle::default(),
                        newest_on_top: false,
                    },
                    x: 1392.0,
                    y: 200.0,
                    w: 480.0,
                    h: 640.0,
                    box_style: panel.clone(),
                    ..Layer::default()
                },
                Layer {
                    name: "Recent events".into(),
                    kind: LayerKind::EventList {
                        kinds: vec![
                            EventKind::Follow,
                            EventKind::Sub,
                            EventKind::Resub,
                            EventKind::GiftSub,
                            EventKind::CommunityGift,
                            EventKind::Cheer,
                            EventKind::Raid,
                        ],
                        max_items: 6,
                        direction: ListDirection::Ticker,
                        item_format: "{{name}} · {{label}}".into(),
                        style: small,
                    },
                    x: 560.0,
                    y: 984.0,
                    w: 800.0,
                    h: 56.0,
                    box_style: BoxStyle {
                        padding: 12.0,
                        ..panel
                    },
                    ..Layer::default()
                },
                Layer {
                    name: "Alerts".into(),
                    kind: LayerKind::Alerts {},
                    x: 560.0,
                    y: 80.0,
                    w: 800.0,
                    h: 420.0,
                    ..Layer::default()
                },
            ],
            ..Overlay::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_round_trips() {
        let o = Overlay::starter();
        let json = serde_json::to_string(&o).unwrap();
        let back: Overlay = serde_json::from_str(&json).unwrap();
        assert_eq!(o, back);
    }

    #[test]
    fn old_files_with_missing_fields_still_load() {
        let json = r#"{"id":"a","layers":[{"id":"l","kind":{"type":"chat"}}]}"#;
        let o: Overlay = serde_json::from_str(json).unwrap();
        assert_eq!(o.width, 1920);
        match &o.layers[0].kind {
            LayerKind::Chat {
                max_messages,
                show_badges,
                ..
            } => {
                assert_eq!(*max_messages, 12);
                assert!(*show_badges);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(o.layers[0].visible);
        assert_eq!(o.layers[0].opacity, 1.0);
    }
}
