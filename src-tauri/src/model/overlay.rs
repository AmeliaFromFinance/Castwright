use super::chat::{ChatFilterSource, ChatRules};
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

/// What happens when text is wider than its box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TextOverflow {
    #[default]
    Wrap,
    /// One line, cut off with "…".
    Cut,
    /// One line that scrolls sideways when it doesn't fit.
    Scroll,
}

/// `font_family` value that means "the project's default font". Empty means the same.
pub const DEFAULT_FONT: &str = "Default";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct TextStyle {
    /// A font name, or `Default` for the project's default font.
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
    pub overflow: TextOverflow,
    /// Scroll speed in px per second.
    pub scroll_speed: f64,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font_family: DEFAULT_FONT.into(),
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
            overflow: TextOverflow::Wrap,
            scroll_speed: 60.0,
        }
    }
}

/// Outline of a box.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BoxShape {
    /// Square corners.
    Rect,
    /// Uses `radius` (or `corners`). Square when the radius is 0.
    #[default]
    Rounded,
    Pill,
    /// Rounded with a speech tail.
    Bubble,
    /// Parallelogram, leaning by `slant` degrees.
    Slanted,
    /// Corners cut off by `cut` px.
    Cut,
    /// Stepped 8-bit corners, `pixel` px per step.
    Pixel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BoxSide {
    #[default]
    None,
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FillKind {
    #[default]
    Solid,
    Gradient,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BoxPattern {
    #[default]
    None,
    Halftone,
    Stripes,
    Grid,
    Noise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BorderStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
    Double,
    /// Thick ink outline.
    Comic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ShadowKind {
    None,
    Soft,
    /// Solid offset shadow without blur.
    Hard,
    Glow,
    Layered,
    /// The CSS in `shadow`. Older projects use this.
    #[default]
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GradientStop {
    pub color: String,
    /// 0 to 100.
    pub at: f64,
}

impl Default for GradientStop {
    fn default() -> Self {
        GradientStop {
            color: "#000000".into(),
            at: 0.0,
        }
    }
}

/// Box styling every layer can use, also used for chat and event cards and alert cards.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct BoxStyle {
    /// Fill colour when `fill` is solid.
    pub background: String,
    pub border_color: String,
    pub border_width: f64,
    pub radius: f64,
    /// Vertical padding, and horizontal too unless `padding_x` is set.
    pub padding: f64,
    /// CSS box-shadow, used when `shadow_kind` is custom.
    pub shadow: String,
    pub backdrop_blur: f64,
    pub shape: BoxShape,
    /// Top left, top right, bottom right, bottom left. Overrides `radius`.
    pub corners: Option<[f64; 4]>,
    pub tail_side: BoxSide,
    /// Along the side, 0 to 100.
    pub tail_pos: f64,
    pub tail_size: f64,
    pub slant: f64,
    pub cut: f64,
    pub pixel: f64,
    pub fill: FillKind,
    pub gradient: Vec<GradientStop>,
    pub gradient_angle: f64,
    /// 0 to 1.
    pub fill_opacity: f64,
    pub pattern: BoxPattern,
    pub pattern_color: String,
    /// 0 to 1.
    pub pattern_opacity: f64,
    pub pattern_size: f64,
    pub border_style: BorderStyle,
    pub stripe: BoxSide,
    pub stripe_width: f64,
    pub stripe_color: String,
    /// Use the chatter's name colour for the stripe where there is one.
    pub stripe_name_color: bool,
    pub shadow_kind: ShadowKind,
    pub shadow_x: f64,
    pub shadow_y: f64,
    pub shadow_blur: f64,
    pub shadow_color: String,
    /// Tilt in degrees.
    pub lean: f64,
    pub padding_x: Option<f64>,
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
            shape: BoxShape::Rounded,
            corners: None,
            tail_side: BoxSide::Bottom,
            tail_pos: 20.0,
            tail_size: 16.0,
            slant: 12.0,
            cut: 14.0,
            pixel: 6.0,
            fill: FillKind::Solid,
            gradient: vec![
                GradientStop {
                    color: "#5b8def".into(),
                    at: 0.0,
                },
                GradientStop {
                    color: "#c9b3ff".into(),
                    at: 100.0,
                },
            ],
            gradient_angle: 135.0,
            fill_opacity: 1.0,
            pattern: BoxPattern::None,
            pattern_color: "#000000".into(),
            pattern_opacity: 0.18,
            pattern_size: 8.0,
            border_style: BorderStyle::Solid,
            stripe: BoxSide::None,
            stripe_width: 4.0,
            stripe_color: "#9db8ff".into(),
            stripe_name_color: false,
            shadow_kind: ShadowKind::Custom,
            shadow_x: 0.0,
            shadow_y: 8.0,
            shadow_blur: 24.0,
            shadow_color: "rgba(0,0,0,0.35)".into(),
            lean: 0.0,
            padding_x: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CardAround {
    /// The whole line: badges, name and message.
    #[default]
    Message,
    /// Only the message text.
    Words,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CardWidth {
    #[default]
    Full,
    Fit,
}

/// How the card around each chat message or event row behaves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct ItemCard {
    /// Lean every other card the other way.
    pub alternate: bool,
    /// Wash of the chatter's name colour over the fill, 0 to 1.
    pub tint: f64,
    pub around: CardAround,
    pub width: CardWidth,
    /// Space between cards in px.
    pub gap: f64,
}

impl Default for ItemCard {
    fn default() -> Self {
        ItemCard {
            alternate: false,
            tint: 0.0,
            around: CardAround::Message,
            width: CardWidth::Full,
            gap: 6.0,
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

/// Which edge of the box a list sits against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ListStack {
    /// The edge new items come in at.
    #[default]
    Auto,
    Top,
    Bottom,
}

/// Which way a ticker moves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TickerDirection {
    #[default]
    Left,
    Right,
}

/// Which way credits move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CreditScroll {
    #[default]
    Up,
    Down,
}

/// What a poll layer shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PollSource {
    /// Whichever is running; the newest wins.
    #[default]
    Both,
    Poll,
    Prediction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum NowPlayingLayout {
    /// One line with a small cover.
    Compact,
    #[default]
    Card,
    /// A spinning record.
    Vinyl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HypeTrainLayout {
    /// A thin strip, made for the top of the screen.
    Bar,
    #[default]
    Card,
}

/// A group of names in the credits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CreditKind {
    Followers,
    Subscribers,
    Gifters,
    Cheerers,
    Raiders,
    Moderators,
    Vips,
    Chatters,
}

impl CreditKind {
    pub const ALL: [CreditKind; 8] = [
        CreditKind::Followers,
        CreditKind::Subscribers,
        CreditKind::Gifters,
        CreditKind::Cheerers,
        CreditKind::Raiders,
        CreditKind::Moderators,
        CreditKind::Vips,
        CreditKind::Chatters,
    ];

    pub fn title(self) -> &'static str {
        match self {
            CreditKind::Followers => "New followers",
            CreditKind::Subscribers => "Subscribers",
            CreditKind::Gifters => "Gifted subs",
            CreditKind::Cheerers => "Cheers",
            CreditKind::Raiders => "Raids",
            CreditKind::Moderators => "Moderators",
            CreditKind::Vips => "VIPs",
            CreditKind::Chatters => "Top chatters",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreditSection {
    pub kind: CreditKind,
    pub title: String,
    #[serde(default = "yes")]
    pub on: bool,
}

pub fn default_credit_sections() -> Vec<CreditSection> {
    CreditKind::ALL
        .iter()
        .map(|&kind| CreditSection {
            kind,
            title: kind.title().into(),
            on: true,
        })
        .collect()
}

/// How names in the credits look.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CreditNames {
    #[default]
    Plain,
    /// Chat colour and badges where known, and 7TV paints.
    Chat,
}

/// When the credits start rolling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CreditStart {
    /// When the layer appears.
    #[default]
    OnLoad,
    /// From the Roll credits step.
    Trigger,
}

#[allow(clippy::large_enum_variant)]
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
        /// Twitch badges.
        #[serde(default = "yes")]
        show_badges: bool,
        #[serde(default = "yes")]
        hide_commands: bool,
        #[serde(default)]
        hide_users: Vec<String>,
        #[serde(default)]
        style: TextStyle,
        /// The card around each message.
        #[serde(default)]
        bubble: BoxStyle,
        #[serde(default)]
        newest_on_top: bool,
        #[serde(default)]
        stack: ListStack,
        #[serde(default = "yes")]
        seventv_emotes: bool,
        #[serde(default = "yes")]
        bttv_emotes: bool,
        #[serde(default = "yes")]
        ffz_emotes: bool,
        #[serde(default = "yes")]
        seventv_paints: bool,
        #[serde(default = "yes")]
        seventv_badges: bool,
        #[serde(default)]
        item_card: ItemCard,
        /// Which hide and highlight rules apply.
        #[serde(default)]
        filters: ChatFilterSource,
        /// Used when `filters` is own.
        #[serde(default)]
        own_rules: ChatRules,
        #[serde(default = "yes")]
        hide_bots: bool,
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
        #[serde(default = "yes")]
        newest_on_top: bool,
        #[serde(default)]
        ticker_dir: TickerDirection,
        /// Template per item, e.g. `{{name}} · {{kind}}`.
        #[serde(default)]
        item_format: String,
        #[serde(default)]
        style: TextStyle,
        /// The card around each row.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// The running poll or prediction, with a bar per choice.
    Poll {
        #[serde(default)]
        show: PollSource,
        /// Seconds the result stays on screen after it ends.
        #[serde(default = "default_result_s")]
        result_s: u32,
        #[serde(default = "yes")]
        show_title: bool,
        /// Time left while it runs.
        #[serde(default = "yes")]
        show_timer: bool,
        /// Votes or points per choice and in total.
        #[serde(default = "yes")]
        show_totals: bool,
        #[serde(default)]
        bar_color: String,
        #[serde(default)]
        track_color: String,
        #[serde(default)]
        style: TextStyle,
        /// The card around each choice.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// End-of-stream credits: everyone who followed, subbed, cheered, raided or chatted.
    Credits {
        #[serde(default = "default_credit_sections")]
        sections: Vec<CreditSection>,
        /// Scroll speed in px per second.
        #[serde(default = "default_credit_speed")]
        speed: u32,
        /// Fit one pass into this many seconds instead (0 = use speed).
        #[serde(default)]
        fit_s: u32,
        /// Start again after the end; otherwise stop with the last names on screen.
        #[serde(default)]
        repeat: bool,
        #[serde(default)]
        start: CreditStart,
        #[serde(default)]
        scroll: CreditScroll,
        /// Template text above the names.
        #[serde(default)]
        heading: String,
        /// Template text below the names.
        #[serde(default)]
        footer: String,
        #[serde(default)]
        names: CreditNames,
        /// 1 or 2.
        #[serde(default = "default_credit_columns")]
        columns: u8,
        #[serde(default = "yes")]
        fade_edges: bool,
        /// Months, gifts, bits, viewers and messages next to names.
        #[serde(default = "yes")]
        show_amounts: bool,
        /// Most names under Top chatters.
        #[serde(default = "default_credit_chatters")]
        max_chatters: u32,
        /// Seconds per page when motion is reduced.
        #[serde(default = "default_credit_page_s")]
        page_s: u32,
        /// Names.
        #[serde(default)]
        style: TextStyle,
        /// Section titles.
        #[serde(default)]
        title_style: TextStyle,
        /// Heading and footer.
        #[serde(default)]
        heading_style: TextStyle,
        /// The card around each section.
        #[serde(default)]
        section_box: BoxStyle,
    },
    /// A heads-up for viewers before and during an ad break. Hidden the rest of the time.
    AdBreak {
        /// Seconds before an ad to start showing. 0 = only during the ad.
        #[serde(default = "default_ad_soon_s")]
        soon_s: u32,
        /// Before the ad. `{{time}}` is the countdown. Empty = don't show before.
        #[serde(default = "default_ad_soon_text")]
        soon_text: String,
        /// During the ad. Empty = don't show during.
        #[serde(default = "default_ad_running_text")]
        running_text: String,
        #[serde(default)]
        style: TextStyle,
        /// The card around the message.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// The song playing now, from Settings → Music.
    NowPlaying {
        #[serde(default)]
        layout: NowPlayingLayout,
        /// Hide while nothing plays.
        #[serde(default = "yes")]
        only_playing: bool,
        /// Seconds to wait after a pause before hiding.
        #[serde(default = "default_np_hide_s")]
        hide_after_s: u32,
        #[serde(default = "yes")]
        show_art: bool,
        #[serde(default)]
        show_album: bool,
        #[serde(default = "yes")]
        show_progress: bool,
        #[serde(default = "yes")]
        show_times: bool,
        /// Animate the change to a new song.
        #[serde(default = "yes")]
        animate: bool,
        #[serde(default)]
        bar_color: String,
        #[serde(default)]
        track_color: String,
        /// The title. Artist, album and times are drawn smaller.
        #[serde(default)]
        style: TextStyle,
        /// The card around the song.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// The running hype train: level, progress, time left and top contributors.
    HypeTrain {
        #[serde(default)]
        layout: HypeTrainLayout,
        #[serde(default = "yes")]
        show_timer: bool,
        #[serde(default = "yes")]
        show_total: bool,
        /// Top bits and sub contributors.
        #[serde(default = "yes")]
        show_top: bool,
        /// "Level up!" with an animation when a level is reached.
        #[serde(default = "yes")]
        celebrate: bool,
        /// Seconds the end text stays after the train ends (0 = hide right away).
        #[serde(default = "default_hype_after_s")]
        after_s: u32,
        /// Shown after the end. `{{level}}` is the level reached.
        #[serde(default = "default_hype_end_text")]
        end_text: String,
        #[serde(default)]
        bar_color: String,
        #[serde(default)]
        track_color: String,
        /// The level line. Everything else is drawn smaller.
        #[serde(default)]
        style: TextStyle,
        /// The card around the train.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// The running giveaway: prize and entries, then a spin that lands on the winner.
    Giveaway {
        /// Hide while no giveaway runs.
        #[serde(default = "yes")]
        hide_idle: bool,
        /// Shown under the prize while entries are open. Templates: `{{keyword}}`, `{{entries}}`.
        #[serde(default = "default_giveaway_text")]
        open_text: String,
        #[serde(default = "yes")]
        show_entries: bool,
        /// Seconds the spin takes.
        #[serde(default = "default_spin_s")]
        spin_s: u32,
        #[serde(default = "yes")]
        show_badges: bool,
        #[serde(default = "yes")]
        seventv_paints: bool,
        /// Highlight on the winner and the spin window.
        #[serde(default)]
        accent_color: String,
        #[serde(default)]
        style: TextStyle,
        /// The card.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
    },
    /// Who's playing now and who's next in the viewer queue.
    Queue {
        #[serde(default = "yes")]
        show_playing: bool,
        /// People in line to list.
        #[serde(default = "default_list_max")]
        next_count: u32,
        /// First in line at the top; otherwise at the bottom.
        #[serde(default = "yes")]
        first_on_top: bool,
        #[serde(default = "yes")]
        show_positions: bool,
        /// Notes like in-game names.
        #[serde(default = "yes")]
        show_notes: bool,
        /// Hide while nobody is playing or waiting.
        #[serde(default = "yes")]
        hide_empty: bool,
        #[serde(default = "default_playing_label")]
        playing_label: String,
        #[serde(default = "default_next_label")]
        next_label: String,
        #[serde(default)]
        style: TextStyle,
        /// The card around each person.
        #[serde(default)]
        item_box: BoxStyle,
        #[serde(default)]
        item_card: ItemCard,
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
fn default_result_s() -> u32 {
    8
}
fn default_credit_speed() -> u32 {
    60
}
fn default_credit_columns() -> u8 {
    1
}
fn default_credit_chatters() -> u32 {
    10
}
fn default_credit_page_s() -> u32 {
    6
}
fn default_np_hide_s() -> u32 {
    5
}
fn default_hype_after_s() -> u32 {
    10
}
pub const DEFAULT_HYPE_END_TEXT: &str = "Hype train reached level {{level}}!";
fn default_hype_end_text() -> String {
    DEFAULT_HYPE_END_TEXT.into()
}
fn default_ad_soon_s() -> u32 {
    30
}
pub const DEFAULT_AD_SOON_TEXT: &str = "Ads in {{time}}, back soon";
pub const DEFAULT_AD_RUNNING_TEXT: &str = "Thanks for sticking around! Back in {{time}}";
fn default_ad_soon_text() -> String {
    DEFAULT_AD_SOON_TEXT.into()
}
fn default_ad_running_text() -> String {
    DEFAULT_AD_RUNNING_TEXT.into()
}
fn default_giveaway_text() -> String {
    "Type {{keyword}} to enter".into()
}
fn default_spin_s() -> u32 {
    6
}
fn default_playing_label() -> String {
    "Playing now".into()
}
fn default_next_label() -> String {
    "Up next".into()
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
            LayerKind::Poll { .. } => "poll",
            LayerKind::Credits { .. } => "credits",
            LayerKind::AdBreak { .. } => "ad_break",
            LayerKind::NowPlaying { .. } => "now_playing",
            LayerKind::HypeTrain { .. } => "hype_train",
            LayerKind::Giveaway { .. } => "giveaway",
            LayerKind::Queue { .. } => "queue",
            LayerKind::Custom { .. } => "custom",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SceneMode {
    #[default]
    All,
    Only,
    Hide,
}

/// Used for scene changes when the layer has no enter or exit animation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SceneTransition {
    None,
    #[default]
    Fade,
    Slide,
    Scale,
}

/// Which OBS scenes (program output) show the layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct SceneRule {
    pub mode: SceneMode,
    /// Scene names, matched exactly.
    pub scenes: Vec<String>,
    pub transition: SceneTransition,
    pub duration_ms: u32,
}

impl Default for SceneRule {
    fn default() -> Self {
        SceneRule {
            mode: SceneMode::All,
            scenes: Vec::new(),
            transition: SceneTransition::Fade,
            duration_ms: 300,
        }
    }
}

impl SceneRule {
    /// Whether the rule lets the layer show in `scene`. An unknown scene (OBS not
    /// connected) shows it.
    pub fn allows(&self, scene: &str) -> bool {
        if scene.is_empty() {
            return true;
        }
        let listed = self.scenes.iter().any(|s| s == scene);
        match self.mode {
            SceneMode::All => true,
            SceneMode::Only => listed,
            SceneMode::Hide => !listed,
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
    /// Shown only in some OBS scenes. Applies on top of `visible` and `visible_when`.
    pub scenes: SceneRule,
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
            scenes: SceneRule::default(),
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
            ..BoxStyle::default()
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
                        stack: ListStack::Auto,
                        seventv_emotes: true,
                        bttv_emotes: true,
                        ffz_emotes: true,
                        seventv_paints: true,
                        seventv_badges: true,
                        item_card: ItemCard::default(),
                        filters: ChatFilterSource::App,
                        own_rules: ChatRules::default(),
                        hide_bots: true,
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
                        newest_on_top: true,
                        ticker_dir: TickerDirection::Left,
                        item_format: "{{name}} · {{label}}".into(),
                        style: small,
                        item_box: BoxStyle::default(),
                        item_card: ItemCard::default(),
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
                seventv_emotes,
                bttv_emotes,
                ffz_emotes,
                seventv_paints,
                seventv_badges,
                ..
            } => {
                assert_eq!(*max_messages, 12);
                assert!(*show_badges);
                assert!(*seventv_emotes && *bttv_emotes && *ffz_emotes);
                assert!(*seventv_paints && *seventv_badges);
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(o.layers[0].visible);
        assert_eq!(o.layers[0].opacity, 1.0);
        assert_eq!(o.layers[0].scenes, SceneRule::default());
    }

    #[test]
    fn list_order_defaults_keep_old_layers_as_they_were() {
        let kinds = [
            r#"{"type":"chat"}"#,
            r#"{"type":"event_list"}"#,
            r#"{"type":"credits"}"#,
            r#"{"type":"queue"}"#,
        ];
        let parsed: Vec<LayerKind> = kinds
            .iter()
            .map(|k| serde_json::from_str(k).unwrap())
            .collect();
        assert!(matches!(
            parsed[0],
            LayerKind::Chat {
                newest_on_top: false,
                stack: ListStack::Auto,
                ..
            }
        ));
        assert!(matches!(
            parsed[1],
            LayerKind::EventList {
                newest_on_top: true,
                ticker_dir: TickerDirection::Left,
                ..
            }
        ));
        assert!(matches!(
            parsed[2],
            LayerKind::Credits {
                scroll: CreditScroll::Up,
                ..
            }
        ));
        assert!(matches!(
            parsed[3],
            LayerKind::Queue {
                first_on_top: true,
                ..
            }
        ));
        let json = serde_json::to_value(&parsed[1]).unwrap();
        assert_eq!(json["ticker_dir"], "left");
        assert_eq!(json["newest_on_top"], true);
    }

    #[test]
    fn hype_train_layer_defaults() {
        let kind: LayerKind = serde_json::from_str(r#"{"type":"hype_train"}"#).unwrap();
        match kind {
            LayerKind::HypeTrain {
                layout,
                show_top,
                celebrate,
                after_s,
                end_text,
                ..
            } => {
                assert_eq!(layout, HypeTrainLayout::Card);
                assert!(show_top && celebrate);
                assert_eq!(after_s, 10);
                assert_eq!(end_text, DEFAULT_HYPE_END_TEXT);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn scene_rules() {
        let only = SceneRule {
            mode: SceneMode::Only,
            scenes: vec!["Gameplay".into()],
            ..SceneRule::default()
        };
        assert!(only.allows("Gameplay"));
        assert!(!only.allows("BRB"));
        assert!(!only.allows("gameplay"), "names match exactly");
        assert!(only.allows(""), "no OBS: shown");
        let hide = SceneRule {
            mode: SceneMode::Hide,
            ..only.clone()
        };
        assert!(!hide.allows("Gameplay"));
        assert!(hide.allows("BRB"));
        assert!(SceneRule::default().allows("Anything"));
        // An empty "only" list hides the layer in every known scene.
        let none = SceneRule {
            mode: SceneMode::Only,
            ..SceneRule::default()
        };
        assert!(!none.allows("BRB"));
    }

    #[test]
    fn scene_rule_round_trips_and_partial_rules_load() {
        let json = r#"{"id":"l","scenes":{"mode":"hide","scenes":["BRB"]}}"#;
        let l: Layer = serde_json::from_str(json).unwrap();
        assert_eq!(l.scenes.mode, SceneMode::Hide);
        assert_eq!(l.scenes.scenes, vec!["BRB".to_string()]);
        assert_eq!(l.scenes.transition, SceneTransition::Fade);
        assert_eq!(l.scenes.duration_ms, 300);
        let back: Layer = serde_json::from_str(&serde_json::to_string(&l).unwrap()).unwrap();
        assert_eq!(back, l);
    }

    fn same_json(a: &serde_json::Value, b: &serde_json::Value) -> bool {
        use serde_json::Value::*;
        match (a, b) {
            (Number(x), Number(y)) => (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-9,
            (Array(x), Array(y)) => {
                x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
            }
            (Object(x), Object(y)) => x
                .iter()
                .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w))),
            _ => a == b,
        }
    }

    /// Every key in `partial` must survive a round trip through `T`, so typos and bad values fail.
    fn assert_strict<T: serde::de::DeserializeOwned + Serialize>(
        partial: &serde_json::Value,
        what: &str,
    ) {
        let parsed: T =
            serde_json::from_value(partial.clone()).unwrap_or_else(|e| panic!("{what}: {e}"));
        let back = serde_json::to_value(&parsed).unwrap();
        for (k, v) in partial.as_object().unwrap() {
            let got = back
                .get(k)
                .unwrap_or_else(|| panic!("{what}: unknown field {k}"));
            let same = same_json(v, got);
            assert!(same, "{what}: {k} became {got}");
        }
    }

    #[test]
    fn box_presets_are_valid() {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/lib/overlay/box-presets.json"))
                .unwrap();
        let list = raw.as_array().unwrap();
        assert!(list.len() >= 11);
        for p in list {
            let id = p["id"].as_str().unwrap();
            let base = p["box"].as_object().unwrap().clone();
            assert_strict::<BoxStyle>(&p["box"], id);
            for extra in ["item", "alert"] {
                if let Some(e) = p.get(extra).and_then(|v| v.as_object()) {
                    let mut merged = base.clone();
                    merged.extend(e.clone());
                    assert_strict::<BoxStyle>(&merged.into(), &format!("{id}.{extra}"));
                }
            }
            if let Some(c) = p.get("card") {
                assert_strict::<ItemCard>(c, &format!("{id}.card"));
            }
            for t in ["text", "title", "message"] {
                if let Some(v) = p.get(t) {
                    assert_strict::<TextStyle>(v, &format!("{id}.{t}"));
                }
            }
        }
    }

    #[test]
    fn built_in_templates_load() {
        let presets: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/lib/overlay/box-presets.json"))
                .unwrap();
        let known: Vec<&str> = presets
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["id"].as_str().unwrap())
            .collect();
        for (file, raw) in [
            (
                "just-chatting",
                include_str!("../../../src/lib/overlay/templates/just-chatting.json"),
            ),
            (
                "gameplay",
                include_str!("../../../src/lib/overlay/templates/gameplay.json"),
            ),
            (
                "starting-soon",
                include_str!("../../../src/lib/overlay/templates/starting-soon.json"),
            ),
            (
                "brb",
                include_str!("../../../src/lib/overlay/templates/brb.json"),
            ),
            (
                "ending",
                include_str!("../../../src/lib/overlay/templates/ending.json"),
            ),
            (
                "vertical",
                include_str!("../../../src/lib/overlay/templates/vertical.json"),
            ),
        ] {
            // Wrong enum values or field types fail here; the app fills in the rest.
            let o: Overlay = serde_json::from_str(raw).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert!(!o.layers.is_empty(), "{file}");
            let v: serde_json::Value = serde_json::from_str(raw).unwrap();
            for l in v["layers"].as_array().unwrap() {
                for key in ["box", "items"] {
                    if let Some(id) = l.get(key) {
                        let id = id.as_str().unwrap();
                        assert!(known.contains(&id), "{file}: unknown preset {id}");
                    }
                }
            }
        }
    }

    #[test]
    fn boxes_from_before_frames_keep_their_look() {
        let json = r##"{"background":"#000","border_color":"#fff","border_width":2,"radius":12,"padding":16,"shadow":"0 0 4px #000","backdrop_blur":8}"##;
        let b: BoxStyle = serde_json::from_str(json).unwrap();
        assert_eq!(b.shape, BoxShape::Rounded);
        assert_eq!(b.shadow_kind, ShadowKind::Custom);
        assert_eq!(b.shadow, "0 0 4px #000");
        assert_eq!(b.fill, FillKind::Solid);
        assert_eq!(b.fill_opacity, 1.0);
        assert_eq!(b.padding_x, None);
        assert_eq!(b.corners, None);
        assert_eq!(b.lean, 0.0);
        assert_eq!(b.pattern, BoxPattern::None);
        assert_eq!(b.stripe, BoxSide::None);
    }

    #[test]
    fn saved_project_without_frame_fields_loads() {
        let p: crate::model::project::Project = serde_json::from_str(include_str!(
            "../../../src/lib/api/fixtures/starter-project.json"
        ))
        .unwrap();
        let o = &p.overlays[0];
        for l in &o.layers {
            assert_eq!(l.scenes, SceneRule::default());
            assert_eq!(l.box_style.shape, BoxShape::Rounded);
            assert_eq!(l.box_style.shadow_kind, ShadowKind::Custom);
            match &l.kind {
                LayerKind::Chat {
                    bubble, item_card, ..
                } => {
                    assert_eq!(*bubble, BoxStyle::default());
                    assert_eq!(*item_card, ItemCard::default());
                }
                LayerKind::EventList {
                    item_box,
                    item_card,
                    ..
                } => {
                    assert_eq!(*item_box, BoxStyle::default());
                    assert_eq!(*item_card, ItemCard::default());
                }
                _ => {}
            }
        }
        assert!(
            p.actions
                .iter()
                .all(|a| a.graph.notes.is_empty() && a.graph.frames.is_empty())
        );
        assert!(
            p.alerts
                .types
                .iter()
                .flat_map(|t| &t.variations)
                .all(|v| v.card.is_none())
        );
    }
}
