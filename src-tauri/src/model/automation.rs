use super::condition::ConditionGroup;
use super::event::EventKind;
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
    PlaySound {
        src: String,
        #[serde(default = "default_volume")]
        volume: u8,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
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
