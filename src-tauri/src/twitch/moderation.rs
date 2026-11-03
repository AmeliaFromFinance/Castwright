//! Moderation from the chat panel and automation: delete, timeout, ban, chat modes
//! and the viewer card.

use super::TwitchService;
use super::helix::HelixError;
use super::normalize::{parse_rfc3339, str_of};
use crate::error::{AppResult, user_err};
use crate::hub::ui;
use crate::model::automation::Toggle;
use crate::model::moderation::{ChatMode, ChatModes, ViewerCard, follow_minutes, slow_wait};
use crate::model::runtime::AccountRole;
use reqwest::Method;
use serde_json::{Value, json};

const MAX_TIMEOUT_S: u32 = 1_209_600;
const MAX_REASON: usize = 500;

/// Scopes the mod tools need. Older sign-ins may lack some of them.
pub const MOD_SCOPES: &[&str] = &[
    "moderator:manage:banned_users",
    "moderator:manage:chat_messages",
    "moderator:manage:chat_settings",
    "moderator:manage:shield_mode",
    "moderator:read:followers",
];

/// Body for PATCH /chat/settings.
pub(crate) fn settings_patch(mode: ChatMode, on: bool, value: u32) -> Value {
    match mode {
        ChatMode::Shield => json!({}),
        ChatMode::Slow if on => {
            json!({ "slow_mode": true, "slow_mode_wait_time": slow_wait(value) })
        }
        ChatMode::Slow => json!({ "slow_mode": false }),
        ChatMode::Followers if on => json!({
            "follower_mode": true,
            "follower_mode_duration": follow_minutes(value),
        }),
        ChatMode::Followers => json!({ "follower_mode": false }),
        ChatMode::Subscribers => json!({ "subscriber_mode": on }),
        ChatMode::Emotes => json!({ "emote_mode": on }),
        ChatMode::Unique => json!({ "unique_chat_mode": on }),
    }
}

/// Reads a /chat/settings reply. Shield mode comes from elsewhere.
pub(crate) fn modes_from(v: &Value) -> ChatModes {
    let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    let num = |k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0) as u32;
    ChatModes {
        shield: false,
        slow: flag("slow_mode"),
        slow_wait_s: num("slow_mode_wait_time"),
        followers: flag("follower_mode"),
        followers_minutes: num("follower_mode_duration"),
        subscribers: flag("subscriber_mode"),
        emotes: flag("emote_mode"),
        unique: flag("unique_chat_mode"),
    }
}

fn clean_id(id: &str, what: &str) -> AppResult<String> {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 {
        return user_err(format!("No {what} given."));
    }
    Ok(id.to_string())
}

impl TwitchService {
    fn mod_ids(&self) -> AppResult<(String, String)> {
        let me = self
            .broadcaster_id()
            .ok_or_else(|| HelixError::NotSignedIn.into_app(""))?;
        Ok((me.clone(), me))
    }

    async fn mod_call(
        &self,
        method: Method,
        path: &str,
        mut query: Vec<(&str, String)>,
        body: Option<&Value>,
        what: &str,
    ) -> AppResult<Value> {
        let (broadcaster, moderator) = self.mod_ids()?;
        query.insert(0, ("broadcaster_id", broadcaster));
        query.insert(1, ("moderator_id", moderator));
        self.helix(AccountRole::Broadcaster, method, path, &query, body)
            .await
            .map_err(|e| e.into_app(what))
    }

    pub async fn delete_chat_message(&self, message_id: &str) -> AppResult<()> {
        let id = clean_id(message_id, "chat message")?;
        self.mod_call(
            Method::DELETE,
            "/moderation/chat",
            vec![("message_id", id.clone())],
            None,
            "delete chat messages",
        )
        .await?;
        // Don't wait for EventSub: it may be missing or slow.
        self.hub.delete_chat(&id);
        Ok(())
    }

    /// `duration_s` None = permanent ban.
    pub async fn ban(&self, user_id: &str, duration_s: Option<u32>, reason: &str) -> AppResult<()> {
        let user_id = clean_id(user_id, "user")?;
        let mut data = json!({
            "user_id": user_id,
            "reason": reason.trim().chars().take(MAX_REASON).collect::<String>(),
        });
        if let Some(d) = duration_s {
            data["duration"] = json!(d.clamp(1, MAX_TIMEOUT_S));
        }
        let what = if duration_s.is_some() {
            "time out users"
        } else {
            "ban users"
        };
        self.mod_call(
            Method::POST,
            "/moderation/bans",
            vec![],
            Some(&json!({ "data": data })),
            what,
        )
        .await?;
        self.hub.clear_chat_user(&user_id);
        Ok(())
    }

    pub async fn unban(&self, user_id: &str) -> AppResult<()> {
        let user_id = clean_id(user_id, "user")?;
        self.mod_call(
            Method::DELETE,
            "/moderation/bans",
            vec![("user_id", user_id)],
            None,
            "unban users",
        )
        .await
        .map(|_| ())
    }

    pub async fn chat_modes(&self) -> AppResult<ChatModes> {
        let settings = self
            .mod_call(
                Method::GET,
                "/chat/settings",
                vec![],
                None,
                "read chat settings",
            )
            .await?;
        let mut modes = Self::first(&settings).map(modes_from).unwrap_or_default();
        // Older sign-ins can't read shield mode; show it as off rather than fail.
        if let Ok(v) = self
            .mod_call(
                Method::GET,
                "/moderation/shield_mode",
                vec![],
                None,
                "read shield mode",
            )
            .await
        {
            modes.shield = Self::first(&v)
                .and_then(|s| s.get("is_active"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
        }
        Ok(modes)
    }

    /// Turns one chat mode on or off. `value` is slow mode seconds or follower minutes.
    pub async fn set_mode(&self, mode: ChatMode, on: bool, value: u32) -> AppResult<ChatModes> {
        if mode == ChatMode::Shield {
            self.mod_call(
                Method::PUT,
                "/moderation/shield_mode",
                vec![],
                Some(&json!({ "is_active": on })),
                "change shield mode",
            )
            .await?;
        } else {
            self.mod_call(
                Method::PATCH,
                "/chat/settings",
                vec![],
                Some(&settings_patch(mode, on, value)),
                "change chat settings",
            )
            .await?;
        }
        let modes = self.chat_modes().await.unwrap_or_else(|_| {
            let mut m = ChatModes::default();
            if mode == ChatMode::Shield {
                m.shield = on;
            }
            m
        });
        self.hub.emit_ui(ui::CHAT_MODES, &modes);
        Ok(modes)
    }

    /// For automation: `Toggle` flips the current state.
    pub async fn set_mode_toggle(
        &self,
        mode: ChatMode,
        state: Toggle,
        value: u32,
    ) -> AppResult<()> {
        let on = match state {
            Toggle::On => true,
            Toggle::Off => false,
            Toggle::Toggle => !self.chat_modes().await?.is_on(mode),
        };
        self.set_mode(mode, on, value).await.map(|_| ())
    }

    /// Facts for the viewer card. Parts Twitch won't share are left empty.
    pub async fn viewer(&self, user_id: &str) -> AppResult<ViewerCard> {
        let user_id = clean_id(user_id, "user")?;
        let (me, _) = self.mod_ids()?;
        let b = AccountRole::Broadcaster;
        let by_id = [("id", user_id.clone())];
        let pair = [("broadcaster_id", me), ("user_id", user_id.clone())];
        let (user, follow, sub, ban) = tokio::join!(
            self.helix(b, Method::GET, "/users", &by_id, None),
            self.helix(b, Method::GET, "/channels/followers", &pair, None),
            self.helix(b, Method::GET, "/subscriptions", &pair, None),
            self.helix(b, Method::GET, "/moderation/banned", &pair, None),
        );
        let user = user.map_err(|e| e.into_app("look up users"))?;
        let Some(u) = Self::first(&user) else {
            return user_err("Twitch doesn't know this user any more.");
        };
        let mut card = ViewerCard {
            id: str_of(u, "id"),
            login: str_of(u, "login"),
            display_name: str_of(u, "display_name"),
            profile_image_url: str_of(u, "profile_image_url"),
            created_at: parse_rfc3339(&str_of(u, "created_at")),
            ..Default::default()
        };
        if let Some(f) = follow.ok().as_ref().and_then(Self::first) {
            card.followed_at = parse_rfc3339(&str_of(f, "followed_at"));
        }
        if let Some(s) = sub.ok().as_ref().and_then(Self::first) {
            card.sub_tier = Some(str_of(s, "tier")).filter(|t| !t.is_empty());
            card.sub_gifted = s.get("is_gift").and_then(Value::as_bool).unwrap_or(false);
        }
        if let Some(x) = ban.ok().as_ref().and_then(Self::first) {
            card.banned = true;
            card.banned_until = parse_rfc3339(&str_of(x, "expires_at"));
        }
        Ok(card)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches() {
        assert_eq!(
            settings_patch(ChatMode::Slow, true, 0),
            json!({"slow_mode": true, "slow_mode_wait_time": 30})
        );
        assert_eq!(
            settings_patch(ChatMode::Followers, true, 10),
            json!({"follower_mode": true, "follower_mode_duration": 10})
        );
        assert_eq!(
            settings_patch(ChatMode::Followers, false, 10),
            json!({"follower_mode": false})
        );
        assert_eq!(
            settings_patch(ChatMode::Unique, true, 0),
            json!({"unique_chat_mode": true})
        );
    }

    #[test]
    fn reads_settings() {
        let m = modes_from(&json!({
            "slow_mode": true, "slow_mode_wait_time": 10,
            "follower_mode": true, "follower_mode_duration": 0,
            "subscriber_mode": false, "emote_mode": true, "unique_chat_mode": false
        }));
        assert!(m.slow && m.followers && m.emotes && !m.subscribers && !m.unique);
        assert_eq!(m.slow_wait_s, 10);
        assert_eq!(m.followers_minutes, 0);
    }

    #[test]
    fn mod_scopes_are_requested() {
        for s in MOD_SCOPES {
            assert!(
                super::super::auth::BROADCASTER_SCOPES.contains(s),
                "{s} missing from sign-in"
            );
        }
    }
}
