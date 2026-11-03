use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What told the app the stream was live.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SessionSource {
    #[default]
    Twitch,
    Obs,
}

impl SessionSource {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionSource::Twitch => "twitch",
            SessionSource::Obs => "obs",
        }
    }

    pub fn parse(s: &str) -> Self {
        if s == "obs" {
            SessionSource::Obs
        } else {
            SessionSource::Twitch
        }
    }
}

/// One stream, from going live to going offline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct StreamSession {
    #[ts(type = "number")]
    pub id: i64,
    /// ms since epoch.
    #[ts(type = "number")]
    pub started_at: i64,
    /// None while the stream is still live.
    #[ts(type = "number | null")]
    pub ended_at: Option<i64>,
    pub source: SessionSource,
    /// The last title seen while live.
    pub title: String,
    /// Every category used, in order.
    pub categories: Vec<String>,
    pub peak_viewers: u32,
    pub avg_viewers: u32,
}

/// A name with a total: top chatters, gifters, cheerers, donors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct Ranked {
    pub name: String,
    pub amount: f64,
}

/// A raid in or out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct RaidEntry {
    #[ts(type = "number")]
    pub ts: i64,
    pub name: String,
    pub viewers: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct MarkerEntry {
    #[ts(type = "number")]
    pub ts: i64,
    pub description: String,
}

/// A non-chat event on the timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct TimelineMark {
    #[ts(type = "number")]
    pub ts: i64,
    pub kind: String,
}

/// Chat messages in one minute (`minute` = start of the minute, ms since epoch).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ChatMinute {
    #[ts(type = "number")]
    pub minute: i64,
    pub count: u32,
}

/// Everything shown on the summary card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct SessionSummary {
    pub session: StreamSession,
    #[ts(type = "number")]
    pub duration_ms: i64,
    pub follows: u32,
    pub new_subs: u32,
    pub resubs: u32,
    /// Single gifted subs, including the ones inside a community gift.
    pub gifted_subs: u32,
    pub top_gifters: Vec<Ranked>,
    #[ts(type = "number")]
    pub bits: u64,
    pub top_cheerers: Vec<Ranked>,
    pub raids_in: Vec<RaidEntry>,
    pub raids_out: Vec<RaidEntry>,
    pub donation_count: u32,
    /// Total per currency, e.g. `{ name: "USD", amount: 25 }`.
    pub donation_totals: Vec<Ranked>,
    pub top_donors: Vec<Ranked>,
    pub chat_messages: u32,
    pub chatters: u32,
    pub top_chatters: Vec<Ranked>,
    /// People whose first message Castwright ever saw was during this stream.
    pub first_chatters: Vec<String>,
    pub alerts: u32,
    pub actions: u32,
    pub markers: Vec<MarkerEntry>,
    pub timeline: Vec<TimelineMark>,
    pub chat_minutes: Vec<ChatMinute>,
}

/// One row in the Sessions list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct SessionListItem {
    pub session: StreamSession,
    pub follows: u32,
    pub subs: u32,
    #[ts(type = "number")]
    pub bits: u64,
    pub chat_messages: u32,
}

/// Sent to the window when a stream starts or ends.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum SessionChange {
    Started { session: StreamSession },
    Ended { session: StreamSession },
}

/// One name in the credits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct CreditName {
    pub name: String,
    pub login: String,
    /// Twitch user id when known, for chat colours, badges and 7TV paints.
    pub user_id: String,
    /// Months, gifts, bits, viewers or messages; 0 when there's nothing to show.
    pub amount: f64,
}

/// Everyone to thank at the end of a stream. Names are in the order they appear.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Credits {
    /// The session the names come from; 0 when there was none.
    #[ts(type = "number")]
    pub session_id: i64,
    pub followers: Vec<CreditName>,
    /// New subs (amount 0) and resubs (amount = months).
    pub subscribers: Vec<CreditName>,
    pub gifters: Vec<CreditName>,
    pub cheerers: Vec<CreditName>,
    pub raiders: Vec<CreditName>,
    /// Moderators and VIPs who chatted.
    pub moderators: Vec<CreditName>,
    pub vips: Vec<CreditName>,
    pub chatters: Vec<CreditName>,
}
