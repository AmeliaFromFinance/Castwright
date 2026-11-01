use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Every Twitch notification is turned into one of these before anything else sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EventKind {
    Follow,
    Sub,
    Resub,
    GiftSub,
    CommunityGift,
    Cheer,
    Raid,
    Redemption,
    PowerUp,
    HypeTrainBegin,
    HypeTrainProgress,
    HypeTrainEnd,
    PollBegin,
    PollProgress,
    PollEnd,
    PredictionBegin,
    PredictionProgress,
    PredictionLock,
    PredictionEnd,
    ShoutoutReceived,
    AdBreak,
    Charity,
    StreamOnline,
    StreamOffline,
    ChannelUpdate,
    Chat,
    Custom,
}

impl EventKind {
    pub const ALL: [EventKind; 27] = [
        EventKind::Follow,
        EventKind::Sub,
        EventKind::Resub,
        EventKind::GiftSub,
        EventKind::CommunityGift,
        EventKind::Cheer,
        EventKind::Raid,
        EventKind::Redemption,
        EventKind::PowerUp,
        EventKind::HypeTrainBegin,
        EventKind::HypeTrainProgress,
        EventKind::HypeTrainEnd,
        EventKind::PollBegin,
        EventKind::PollProgress,
        EventKind::PollEnd,
        EventKind::PredictionBegin,
        EventKind::PredictionProgress,
        EventKind::PredictionLock,
        EventKind::PredictionEnd,
        EventKind::ShoutoutReceived,
        EventKind::AdBreak,
        EventKind::Charity,
        EventKind::StreamOnline,
        EventKind::StreamOffline,
        EventKind::ChannelUpdate,
        EventKind::Chat,
        EventKind::Custom,
    ];

    /// Kinds that can trigger an on-screen alert.
    pub fn is_alertable(self) -> bool {
        matches!(
            self,
            EventKind::Follow
                | EventKind::Sub
                | EventKind::Resub
                | EventKind::GiftSub
                | EventKind::CommunityGift
                | EventKind::Cheer
                | EventKind::Raid
                | EventKind::Redemption
                | EventKind::PowerUp
                | EventKind::HypeTrainBegin
                | EventKind::HypeTrainEnd
                | EventKind::ShoutoutReceived
                | EventKind::AdBreak
                | EventKind::Charity
                | EventKind::Custom
        )
    }

    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Follow => "follow",
            EventKind::Sub => "sub",
            EventKind::Resub => "resub",
            EventKind::GiftSub => "gift_sub",
            EventKind::CommunityGift => "community_gift",
            EventKind::Cheer => "cheer",
            EventKind::Raid => "raid",
            EventKind::Redemption => "redemption",
            EventKind::PowerUp => "power_up",
            EventKind::HypeTrainBegin => "hype_train_begin",
            EventKind::HypeTrainProgress => "hype_train_progress",
            EventKind::HypeTrainEnd => "hype_train_end",
            EventKind::PollBegin => "poll_begin",
            EventKind::PollProgress => "poll_progress",
            EventKind::PollEnd => "poll_end",
            EventKind::PredictionBegin => "prediction_begin",
            EventKind::PredictionProgress => "prediction_progress",
            EventKind::PredictionLock => "prediction_lock",
            EventKind::PredictionEnd => "prediction_end",
            EventKind::ShoutoutReceived => "shoutout_received",
            EventKind::AdBreak => "ad_break",
            EventKind::Charity => "charity",
            EventKind::StreamOnline => "stream_online",
            EventKind::StreamOffline => "stream_offline",
            EventKind::ChannelUpdate => "channel_update",
            EventKind::Chat => "chat",
            EventKind::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct EventUser {
    pub id: String,
    pub login: String,
    pub display_name: String,
}

/// Chat badges and roles, filled in for chat events (and when Twitch provides them).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct UserRoles {
    pub broadcaster: bool,
    pub moderator: bool,
    pub vip: bool,
    pub subscriber: bool,
}

/// One piece of a chat message: plain text, an emote, a cheermote or a mention.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum MessagePart {
    Text {
        text: String,
    },
    Emote {
        text: String,
        id: String,
    },
    Cheermote {
        text: String,
        prefix: String,
        bits: u32,
    },
    Mention {
        text: String,
        login: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    /// Twitch message id where available, otherwise a random id.
    pub id: String,
    pub kind: EventKind,
    /// Milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub ts: i64,
    pub user: Option<EventUser>,
    /// Bits, gifted sub count, raid viewers, points cost or donation amount.
    pub amount: Option<f64>,
    pub currency: Option<String>,
    /// 1, 2 or 3. Prime subs are tier 1 with `is_prime` set in `data`.
    pub tier: Option<u8>,
    /// Cumulative months for subs and resubs.
    pub months: Option<u32>,
    pub message: Option<String>,
    pub message_parts: Vec<MessagePart>,
    pub roles: UserRoles,
    pub is_gift: bool,
    pub is_anonymous: bool,
    pub recipient: Option<EventUser>,
    /// Anything kind-specific (reward title, hype train level, poll choices...).
    #[ts(type = "Record<string, unknown>")]
    pub data: serde_json::Map<String, serde_json::Value>,
    /// Created by a "Test" button rather than by Twitch.
    pub test: bool,
}

impl Event {
    pub fn new(kind: EventKind) -> Self {
        Event {
            id: uuid::Uuid::new_v4().to_string(),
            kind,
            ts: crate::util::now_ms(),
            user: None,
            amount: None,
            currency: None,
            tier: None,
            months: None,
            message: None,
            message_parts: Vec::new(),
            roles: UserRoles::default(),
            is_gift: false,
            is_anonymous: false,
            recipient: None,
            data: serde_json::Map::new(),
            test: false,
        }
    }

    pub fn with_user(mut self, login: &str, display_name: &str) -> Self {
        self.user = Some(EventUser {
            id: String::new(),
            login: login.to_string(),
            display_name: display_name.to_string(),
        });
        self
    }

    /// The JSON shape conditions and templates read from. Adds a few
    /// convenience keys so users can write `name` instead of `user.display_name`.
    pub fn as_context(&self) -> serde_json::Value {
        let mut v = serde_json::to_value(self).unwrap_or(serde_json::Value::Null);
        if let serde_json::Value::Object(map) = &mut v {
            let name = self
                .user
                .as_ref()
                .map(|u| u.display_name.clone())
                .unwrap_or_else(|| {
                    if self.is_anonymous {
                        "Anonymous".to_string()
                    } else {
                        String::new()
                    }
                });
            map.insert("name".into(), serde_json::Value::String(name));
            map.insert(
                "recipient_name".into(),
                serde_json::Value::String(
                    self.recipient
                        .as_ref()
                        .map(|u| u.display_name.clone())
                        .unwrap_or_default(),
                ),
            );
            map.insert(
                "kind".into(),
                serde_json::Value::String(self.kind.as_str().into()),
            );
        }
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_list_is_complete_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for k in EventKind::ALL {
            assert!(seen.insert(k.as_str()), "duplicate {}", k.as_str());
            let json = serde_json::to_string(&k).unwrap();
            assert_eq!(json, format!("\"{}\"", k.as_str()));
        }
        assert_eq!(seen.len(), EventKind::ALL.len());
    }

    #[test]
    fn context_has_convenience_keys() {
        let mut e = Event::new(EventKind::Sub).with_user("nova_kat", "nova_kat");
        e.tier = Some(3);
        let ctx = e.as_context();
        assert_eq!(ctx["name"], "nova_kat");
        assert_eq!(ctx["tier"], 3);
        assert_eq!(ctx["kind"], "sub");
    }

    #[test]
    fn anonymous_name() {
        let mut e = Event::new(EventKind::GiftSub);
        e.is_anonymous = true;
        assert_eq!(e.as_context()["name"], "Anonymous");
    }
}
