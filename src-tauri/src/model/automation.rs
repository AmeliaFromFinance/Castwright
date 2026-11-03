use super::condition::ConditionGroup;
use super::event::EventKind;
use super::interact::{PredictionAction, RewardState};
use super::moderation::ChatMode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS, Default,
)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Permission {
    #[default]
    Everyone,
    Subscriber,
    Vip,
    Moderator,
    Broadcaster,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum Trigger {
    Event {
        kind: EventKind,
        #[serde(default)]
        conditions: ConditionGroup,
    },
    /// A chat command such as `!so`. `name` is stored without the `!`.
    Command {
        name: String,
        #[serde(default)]
        aliases: Vec<String>,
        #[serde(default)]
        permission: Permission,
        #[serde(default)]
        user_cooldown_s: u32,
    },
    Timer {
        interval_s: u32,
        #[serde(default)]
        only_when_live: bool,
        /// Skip a run unless at least this many chat messages arrived since the last one.
        #[serde(default)]
        min_chat_lines: u32,
    },
    StreamOnline,
    StreamOffline,
    SceneChanged {
        /// Empty = any scene.
        #[serde(default)]
        scene: String,
    },
    /// Run from the app, the local API or a Stream Deck button.
    Manual,
    /// A channel point reward is redeemed. No id and no title means any reward.
    Redemption {
        #[serde(default)]
        reward_id: String,
        /// Matched too, so actions shared from another channel find their reward.
        #[serde(default)]
        reward_title: String,
    },
    PollBegin,
    PollEnd,
    PredictionBegin,
    PredictionEnd,
    /// Some minutes before Twitch's next scheduled ad.
    AdSoon {
        #[serde(default = "default_ad_minutes")]
        minutes_before: u32,
    },
    AdBegin,
    AdEnd,
    /// A new song starts, from Settings → Music.
    SongChanged,
    HypeTrainBegin,
    /// A running hype train reaches a higher level.
    HypeTrainLevelUp,
    HypeTrainEnd,
    GiveawayOpened,
    GiveawayClosed,
    /// Runs once per winner, re-rolls included.
    GiveawayWinner,
    /// Runs once per player the queue picks.
    PlayerPicked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Toggle {
    #[default]
    On,
    Off,
    Toggle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HttpMethod {
    #[default]
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum Step {
    ChatSend {
        message: String,
        /// Send from the bot account when one is signed in.
        #[serde(default)]
        as_bot: bool,
        /// Reply to the message that triggered the action.
        #[serde(default)]
        reply: bool,
    },
    ChatAnnounce {
        message: String,
        /// primary, blue, green, orange or purple.
        #[serde(default)]
        color: String,
    },
    Shoutout {
        /// Login to shout out; templates allowed, e.g. `{{arg1}}`.
        user: String,
        /// Also post a chat message with their last game.
        #[serde(default)]
        message: String,
    },
    CreateClip,
    CreateMarker {
        #[serde(default)]
        description: String,
    },
    RunAd {
        length_s: u32,
    },
    SetStreamInfo {
        #[serde(default)]
        title: String,
        #[serde(default)]
        category: String,
    },
    TimeoutUser {
        user: String,
        duration_s: u32,
        #[serde(default)]
        reason: String,
    },
    DeleteMessage {
        /// Empty = the chat message that started the action.
        #[serde(default)]
        message_id: String,
    },
    SetChatMode {
        mode: ChatMode,
        #[serde(default)]
        state: Toggle,
        /// Slow mode seconds or follower-only minutes.
        #[serde(default)]
        value: u32,
    },
    Delay {
        ms: u32,
    },
    SetVariable {
        key: String,
        value: String,
        #[serde(default)]
        persist: bool,
    },
    AddToVariable {
        key: String,
        amount: f64,
        #[serde(default)]
        persist: bool,
    },
    SwitchScene {
        scene: String,
    },
    SetSourceVisible {
        /// Empty = current program scene.
        #[serde(default)]
        scene: String,
        source: String,
        #[serde(default)]
        state: Toggle,
    },
    SetInputMute {
        input: String,
        #[serde(default)]
        state: Toggle,
    },
    Recording {
        #[serde(default)]
        state: Toggle,
    },
    SaveReplay,
    SetLayerVisible {
        overlay_id: String,
        layer_id: String,
        #[serde(default)]
        state: Toggle,
    },
    /// Start or restart a credits layer. Shows the layer if it's hidden.
    RollCredits {
        overlay_id: String,
        layer_id: String,
    },
    /// Start, pause, resume or reset a countdown or stopwatch layer, or add time.
    TimerControl {
        overlay_id: String,
        layer_id: String,
        #[serde(default)]
        action: super::runtime::TimerAction,
        /// For add. Below 0 takes time off.
        #[serde(default)]
        seconds: f64,
    },
    PlayAlert {
        title: String,
        #[serde(default)]
        message: String,
        #[serde(default)]
        image: String,
        #[serde(default)]
        sound: String,
        #[serde(default = "default_alert_ms")]
        duration_ms: u32,
    },
    /// On = pause, Off = resume. The alert on screen still finishes.
    PauseAlerts {
        #[serde(default)]
        state: Toggle,
    },
    SkipAlert,
    PlaySound {
        src: String,
        #[serde(default = "default_volume")]
        volume: u8,
    },
    /// A button from the soundboard, with its own volume, output and cooldown.
    PlaySoundboardSound {
        sound_id: String,
    },
    HttpRequest {
        #[serde(default)]
        method: HttpMethod,
        url: String,
        #[serde(default)]
        body: String,
        /// Store the response text in this variable (optional).
        #[serde(default)]
        save_to: String,
    },
    RunScript {
        code: String,
    },
    If {
        conditions: ConditionGroup,
        #[serde(default)]
        then: Vec<Step>,
        #[serde(default, rename = "else")]
        otherwise: Vec<Step>,
    },
    RunAction {
        action_id: String,
    },
    /// Complete or refund the channel point redemption that started the run.
    FinishRedemption {
        #[serde(default)]
        refund: bool,
    },
    SetRewardState {
        #[serde(default)]
        reward_id: String,
        #[serde(default)]
        reward_title: String,
        #[serde(default)]
        state: RewardState,
    },
    SetRewardCost {
        #[serde(default)]
        reward_id: String,
        #[serde(default)]
        reward_title: String,
        /// A number; templates allowed.
        cost: String,
    },
    StartPoll {
        title: String,
        choices: Vec<String>,
        #[serde(default = "default_poll_s")]
        duration_s: u32,
        /// Extra votes for channel points. 0 = off.
        #[serde(default)]
        points_per_vote: u32,
    },
    /// End the running poll early and show the result.
    EndPoll,
    StartPrediction {
        title: String,
        outcomes: Vec<String>,
        #[serde(default = "default_poll_s")]
        window_s: u32,
    },
    EndPrediction {
        #[serde(default)]
        action: PredictionAction,
        /// Winning outcome when resolving: its title or number from 1.
        #[serde(default)]
        winner: String,
    },
    /// Push the next ad back 5 minutes, if a snooze is left.
    SnoozeAd,
    /// Post a message with one of the Discord webhooks from Settings. Nobody is pinged.
    PostToDiscord {
        webhook_id: String,
        message: String,
    },
    /// Start the giveaway set up on the Interact page.
    OpenGiveaway {
        /// Replaces the prize when set. Templates allowed.
        #[serde(default)]
        title: String,
    },
    /// Stop taking entries.
    CloseGiveaway,
    DrawGiveaway {
        #[serde(default = "default_one")]
        count: u32,
    },
    /// On = open, Off = close.
    SetQueueOpen {
        #[serde(default)]
        state: Toggle,
    },
    QueueNext {
        /// 0 = the party size from the Interact page.
        #[serde(default)]
        count: u32,
        /// Pick at random instead of in order.
        #[serde(default)]
        random: bool,
    },
    ClearQueue,
    /// Stop this run here.
    Stop,
    Log {
        message: String,
    },
}

fn default_alert_ms() -> u32 {
    6000
}
fn default_volume() -> u8 {
    70
}
fn default_poll_s() -> u32 {
    120
}
fn default_ad_minutes() -> u32 {
    1
}
fn default_one() -> u32 {
    1
}

/// Side of a node a line leaves or enters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EdgeSide {
    Top,
    Right,
    Bottom,
    Left,
}

/// Which way a line is taken. `then` and `otherwise` only matter on lines leaving an If.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EdgeBranch {
    #[default]
    Next,
    Then,
    Otherwise,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum NodeKind {
    Trigger {
        trigger: Trigger,
    },
    /// An If step keeps its `then` and `else` lists empty; its branches are lines.
    Step {
        step: Step,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub kind: NodeKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub from_side: EdgeSide,
    pub to: String,
    pub to_side: EdgeSide,
    #[serde(default)]
    pub branch: EdgeBranch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CanvasColor {
    #[default]
    Yellow,
    Orange,
    Pink,
    Purple,
    Blue,
    Green,
    Gray,
}

/// A sticky note on the canvas. Runs ignore it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GraphNote {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Bold, italics, links and lists, markdown style.
    pub text: String,
    pub color: CanvasColor,
}

impl Default for GraphNote {
    fn default() -> Self {
        GraphNote {
            id: crate::util::new_id(),
            x: 0.0,
            y: 0.0,
            w: 240.0,
            h: 160.0,
            text: String::new(),
            color: CanvasColor::Yellow,
        }
    }
}

/// A labelled box behind nodes that moves them together. Runs ignore it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct GraphFrame {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub label: String,
    pub color: CanvasColor,
    /// Only the title bar shows; the nodes inside are hidden.
    pub collapsed: bool,
    /// Ids of the nodes and notes inside.
    pub members: Vec<String>,
}

impl Default for GraphFrame {
    fn default() -> Self {
        GraphFrame {
            id: crate::util::new_id(),
            x: 0.0,
            y: 0.0,
            w: 400.0,
            h: 300.0,
            label: "Group".into(),
            color: CanvasColor::Blue,
            collapsed: false,
            members: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Comments and groups for people reading the flow. Added in 0.6, no format change.
    pub notes: Vec<GraphNote>,
    pub frames: Vec<GraphFrame>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub group: String,
    pub enabled: bool,
    /// The trigger nodes of `graph`, in node order. Kept in step by `normalize`.
    pub triggers: Vec<Trigger>,
    /// Steps of projects saved before the graph. Converted on load, then empty.
    pub steps: Vec<Step>,
    pub graph: Graph,
    /// Minimum seconds between runs (0 = none).
    pub cooldown_s: u32,
}

impl Default for Action {
    fn default() -> Self {
        Action {
            id: crate::util::new_id(),
            name: "New action".into(),
            group: "General".into(),
            enabled: true,
            triggers: Vec::new(),
            steps: Vec::new(),
            graph: Graph::default(),
            cooldown_s: 0,
        }
    }
}

impl Action {
    /// Actions a new project starts with.
    pub fn starters() -> Vec<Action> {
        use super::condition::{Condition, MatchMode, Op};
        let mut list = vec![
            Action {
                name: "!uptime".into(),
                group: "Chat commands".into(),
                triggers: vec![Trigger::Command {
                    name: "uptime".into(),
                    aliases: vec![],
                    permission: Permission::Everyone,
                    user_cooldown_s: 30,
                }],
                steps: vec![Step::ChatSend {
                    message: "Live for {{stream.uptime_text | default:\"0m\"}}".into(),
                    as_bot: true,
                    reply: true,
                }],
                cooldown_s: 5,
                ..Action::default()
            },
            Action {
                name: "!so".into(),
                group: "Chat commands".into(),
                triggers: vec![Trigger::Command {
                    name: "so".into(),
                    aliases: vec!["shoutout".into()],
                    permission: Permission::Moderator,
                    user_cooldown_s: 0,
                }],
                steps: vec![Step::Shoutout {
                    user: "{{arg1}}".into(),
                    message: "Go follow {{arg1}} at twitch.tv/{{arg1}}!".into(),
                }],
                ..Action::default()
            },
            Action {
                name: "Count deaths".into(),
                group: "Chat commands".into(),
                triggers: vec![Trigger::Command {
                    name: "death".into(),
                    aliases: vec!["deaths+".into()],
                    permission: Permission::Moderator,
                    user_cooldown_s: 0,
                }],
                steps: vec![
                    Step::AddToVariable {
                        key: "counter.deaths".into(),
                        amount: 1.0,
                        persist: true,
                    },
                    Step::ChatSend {
                        message: "Deaths: {{counter.deaths}}".into(),
                        as_bot: true,
                        reply: false,
                    },
                ],
                ..Action::default()
            },
            Action {
                name: "Big raid welcome".into(),
                group: "Stream events".into(),
                triggers: vec![Trigger::Event {
                    kind: EventKind::Raid,
                    conditions: ConditionGroup {
                        mode: MatchMode::All,
                        conditions: vec![Condition {
                            field: "amount".into(),
                            op: Op::Gte,
                            value: 20.into(),
                        }],
                    },
                }],
                steps: vec![
                    Step::Delay { ms: 4000 },
                    Step::ChatAnnounce {
                        message: "Welcome {{name}} and the {{amount}} raiders!".into(),
                        color: "purple".into(),
                    },
                    Step::Shoutout {
                        user: "{{user.login}}".into(),
                        message: String::new(),
                    },
                ],
                cooldown_s: 60,
                ..Action::default()
            },
            Action {
                name: "Hydrate reminder".into(),
                group: "Timers".into(),
                enabled: false,
                triggers: vec![Trigger::Timer {
                    interval_s: 45 * 60,
                    only_when_live: true,
                    min_chat_lines: 5,
                }],
                steps: vec![Step::ChatSend {
                    message: "Stay hydrated, chat!".into(),
                    as_bot: true,
                    reply: false,
                }],
                ..Action::default()
            },
        ];
        for a in &mut list {
            a.normalize();
        }
        list
    }
}
