//! Chat moderation: chat modes and what the viewer card shows.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A chat setting that can be turned on and off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ChatMode {
    Shield,
    #[default]
    Slow,
    Followers,
    Subscribers,
    Emotes,
    Unique,
}

/// Current chat settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ChatModes {
    pub shield: bool,
    pub slow: bool,
    /// Seconds between messages while slow mode is on.
    pub slow_wait_s: u32,
    pub followers: bool,
    /// How long someone must follow before chatting. 0 = any follower.
    pub followers_minutes: u32,
    pub subscribers: bool,
    pub emotes: bool,
    pub unique: bool,
}

impl ChatModes {
    pub fn is_on(&self, mode: ChatMode) -> bool {
        match mode {
            ChatMode::Shield => self.shield,
            ChatMode::Slow => self.slow,
            ChatMode::Followers => self.followers,
            ChatMode::Subscribers => self.subscribers,
            ChatMode::Emotes => self.emotes,
            ChatMode::Unique => self.unique,
        }
    }
}

/// Slow mode wait, 3 to 120 seconds. 0 picks 30.
pub fn slow_wait(value: u32) -> u32 {
    if value == 0 { 30 } else { value.clamp(3, 120) }
}

/// Follower-only minimum, up to 3 months.
pub fn follow_minutes(value: u32) -> u32 {
    value.min(129_600)
}

/// What Twitch knows about one viewer, for the viewer card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ViewerCard {
    pub id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: String,
    /// Account creation, ms since epoch.
    #[ts(type = "number | null")]
    pub created_at: Option<i64>,
    /// When they followed, ms since epoch. None = not following or unknown.
    #[ts(type = "number | null")]
    pub followed_at: Option<i64>,
    /// "1000", "2000" or "3000". None = not subscribed or unknown.
    pub sub_tier: Option<String>,
    pub sub_gifted: bool,
    pub banned: bool,
    /// End of a timeout, ms since epoch. None with `banned` = permanent ban.
    #[ts(type = "number | null")]
    pub banned_until: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits() {
        assert_eq!(slow_wait(0), 30);
        assert_eq!(slow_wait(1), 3);
        assert_eq!(slow_wait(500), 120);
        assert_eq!(follow_minutes(10), 10);
        assert_eq!(follow_minutes(1_000_000), 129_600);
        let m = ChatModes {
            emotes: true,
            ..Default::default()
        };
        assert!(m.is_on(ChatMode::Emotes));
        assert!(!m.is_on(ChatMode::Slow));
    }
}
