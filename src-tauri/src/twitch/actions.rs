//! Things the app and automation can do on Twitch.

use super::TwitchService;
use super::helix::HelixError;
use super::normalize::str_of;
use crate::error::{AppError, AppResult, user_err};
use crate::model::automation::Toggle;
use crate::model::interact::{
    PollDraft, PredictionAction, PredictionDraft, RedemptionRef, RewardState,
};
use crate::model::moderation::ChatMode;
use crate::model::runtime::AccountRole;
use crate::services::TwitchActions;
use async_trait::async_trait;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use ts_rs::TS;

const MAX_CHAT: usize = 500;
const MAX_TITLE: usize = 140;
const MAX_TAGS: usize = 10;
const MAX_TAG_LEN: usize = 25;
const MAX_TIMEOUT_S: u32 = 1_209_600;
const AD_LENGTHS: [u32; 6] = [30, 60, 90, 120, 150, 180];
const ANNOUNCE_COLORS: [&str; 5] = ["primary", "blue", "green", "orange", "purple"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub box_art_url: String,
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Trimmed and cut to Twitch's 500 character limit.
pub fn clean_message(s: &str) -> AppResult<String> {
    let t = s.trim();
    if t.is_empty() {
        return user_err("The message is empty.");
    }
    Ok(truncate(t, MAX_CHAT).trim_end().to_string())
}

pub fn snap_ad_length(seconds: u32) -> u32 {
    *AD_LENGTHS
        .iter()
        .min_by_key(|l| l.abs_diff(seconds))
        .unwrap_or(&30)
}

pub fn announce_color(color: &str) -> &'static str {
    let c = color.trim().to_lowercase();
    ANNOUNCE_COLORS
        .iter()
        .find(|x| **x == c)
        .copied()
        .unwrap_or("primary")
}

fn clean_login(login: &str) -> AppResult<String> {
    let l = login.trim().trim_start_matches('@').to_lowercase();
    if l.is_empty() || l.len() > 25 || !l.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return user_err(format!(
            "\"{}\" isn't a valid Twitch username.",
            login.trim()
        ));
    }
    Ok(l)
}

fn validate_tags(tags: &[String]) -> AppResult<Vec<String>> {
    let tags: Vec<String> = tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if tags.len() > MAX_TAGS {
        return user_err(format!("Twitch allows up to {MAX_TAGS} tags."));
    }
    for t in &tags {
        if t.chars().count() > MAX_TAG_LEN || !t.chars().all(char::is_alphanumeric) {
            return user_err(format!(
                "The tag \"{t}\" can't be used. Tags are up to {MAX_TAG_LEN} letters or \
                 numbers, without spaces or symbols."
            ));
        }
    }
    Ok(tags)
}

impl TwitchService {
    pub(crate) fn require_broadcaster(&self) -> AppResult<String> {
        self.broadcaster_id()
            .ok_or_else(|| HelixError::NotSignedIn.into_app(""))
    }

    pub async fn search_categories(&self, query: &str) -> AppResult<Vec<Category>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/search/categories",
                &[("query", q.to_string()), ("first", "20".into())],
                None,
            )
            .await
            .map_err(|e| e.into_app("search categories"))?;
        Ok(v.get("data")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .map(|c| Category {
                        id: str_of(c, "id"),
                        name: str_of(c, "name"),
                        box_art_url: str_of(c, "box_art_url"),
                    })
                    .filter(|c| !c.id.is_empty())
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Empty `title` or `category_id` leaves that field unchanged. `tags` replaces the tags.
    pub async fn update_stream_info(
        &self,
        title: &str,
        category_id: &str,
        tags: Vec<String>,
    ) -> AppResult<()> {
        let tags = validate_tags(&tags)?;
        let mut body = Map::new();
        body.insert("tags".into(), json!(tags));
        self.patch_channel(title, category_id, body).await
    }

    async fn patch_channel(
        &self,
        title: &str,
        category_id: &str,
        mut body: Map<String, Value>,
    ) -> AppResult<()> {
        let id = self.require_broadcaster()?;
        let title = title.trim();
        if title.chars().count() > MAX_TITLE {
            return user_err(format!(
                "Stream titles can be up to {MAX_TITLE} characters."
            ));
        }
        if !title.is_empty() {
            body.insert("title".into(), json!(title));
        }
        if !category_id.trim().is_empty() {
            body.insert("game_id".into(), json!(category_id.trim()));
        }
        if body.is_empty() {
            return Ok(());
        }
        self.helix(
            AccountRole::Broadcaster,
            Method::PATCH,
            "/channels",
            &[("broadcaster_id", id)],
            Some(&Value::Object(body)),
        )
        .await
        .map_err(|e| e.into_app("change the stream title and category"))?;
        self.poll_stream().await;
        Ok(())
    }

    async fn resolve_user(&self, login: &str) -> AppResult<(String, String)> {
        let login = clean_login(login)?;
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/users",
                &[("login", login.clone())],
                None,
            )
            .await
            .map_err(|e| e.into_app("look up users"))?;
        match Self::first(&v) {
            Some(u) if !str_of(u, "id").is_empty() => {
                Ok((str_of(u, "id"), str_of(u, "display_name")))
            }
            _ => user_err(format!("Couldn't find a Twitch user called {login}.")),
        }
    }
}

#[async_trait]
impl TwitchActions for TwitchService {
    async fn send_chat(
        &self,
        message: &str,
        as_bot: bool,
        reply_to: Option<&str>,
    ) -> AppResult<()> {
        let message = clean_message(message)?;
        let broadcaster = self.require_broadcaster()?;
        let bot = if as_bot {
            self.token(AccountRole::Bot)
        } else {
            None
        };
        let (role, sender) = match bot {
            Some(b) => (AccountRole::Bot, b.user_id),
            None => (AccountRole::Broadcaster, broadcaster.clone()),
        };
        let mut body = json!({
            "broadcaster_id": broadcaster,
            "sender_id": sender,
            "message": message,
        });
        if let Some(r) = reply_to.map(str::trim).filter(|r| !r.is_empty()) {
            body["reply_parent_message_id"] = json!(r);
        }
        self.remember_sending(&sender, &message);
        let v = self
            .helix(role, Method::POST, "/chat/messages", &[], Some(&body))
            .await
            .map_err(|e| e.into_app("send chat messages"))?;
        if let Some(r) = Self::first(&v)
            && r.get("is_sent").and_then(Value::as_bool) == Some(false)
        {
            let reason = r
                .pointer("/drop_reason/message")
                .and_then(Value::as_str)
                .unwrap_or("no reason given");
            return Err(AppError::Twitch(format!(
                "Twitch didn't post the message: {reason}"
            )));
        }
        if let Some(id) = Self::first(&v)
            .and_then(|r| r.get("message_id"))
            .and_then(Value::as_str)
        {
            self.remember_sent(id);
        }
        Ok(())
    }

    async fn announce(&self, message: &str, color: &str) -> AppResult<()> {
        let message = clean_message(message)?;
        let id = self.require_broadcaster()?;
        let body = json!({ "message": message, "color": announce_color(color) });
        self.helix(
            AccountRole::Broadcaster,
            Method::POST,
            "/chat/announcements",
            &[("broadcaster_id", id.clone()), ("moderator_id", id)],
            Some(&body),
        )
        .await
        .map_err(|e| e.into_app("send announcements"))?;
        Ok(())
    }

    async fn shoutout(&self, login: &str) -> AppResult<()> {
        let me = self.require_broadcaster()?;
        let (target, name) = self.resolve_user(login).await?;
        if target == me {
            return user_err("You can't shout out your own channel.");
        }
        let res = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/chat/shoutouts",
                &[
                    ("from_broadcaster_id", me.clone()),
                    ("to_broadcaster_id", target),
                    ("moderator_id", me),
                ],
                None,
            )
            .await;
        match res {
            Ok(_) => Ok(()),
            Err(e) if e.status() == Some(429) => Err(AppError::Twitch(
                "Shoutouts are on cooldown. Twitch allows one every 2 minutes, and the same \
                 streamer once an hour."
                    .into(),
            )),
            Err(e) if e.status() == Some(400) => Err(AppError::Twitch(format!(
                "Couldn't shout out {name}: {}",
                e.message()
            ))),
            Err(e) => Err(e.into_app("send shoutouts")),
        }
    }

    async fn create_clip(&self) -> AppResult<String> {
        let clip = self.start_clip().await?;
        Ok(clip.edit_url)
    }

    async fn create_marker(&self, description: &str) -> AppResult<()> {
        self.add_marker(description).await.map(|_| ())
    }

    async fn run_ad(&self, length_s: u32) -> AppResult<()> {
        let id = self.require_broadcaster()?;
        let body = json!({ "broadcaster_id": id, "length": snap_ad_length(length_s) });
        self.helix(
            AccountRole::Broadcaster,
            Method::POST,
            "/channels/commercial",
            &[],
            Some(&body),
        )
        .await
        .map_err(|e| match e.status() {
            Some(429) => AppError::Twitch("Ads are on cooldown. Try again later.".into()),
            _ => e.into_app("run ads"),
        })?;
        self.poke_ads();
        Ok(())
    }

    async fn set_stream_info(&self, title: &str, category: &str) -> AppResult<()> {
        let category = category.trim();
        let mut category_id = String::new();
        if !category.is_empty() {
            let found = self.search_categories(category).await?;
            let pick = found
                .iter()
                .find(|c| c.name.eq_ignore_ascii_case(category))
                .or_else(|| found.first());
            match pick {
                Some(c) => category_id = c.id.clone(),
                None => {
                    return user_err(format!(
                        "Couldn't find a Twitch category called {category}."
                    ));
                }
            }
        }
        self.patch_channel(title, &category_id, Map::new()).await
    }

    async fn timeout_user(&self, login: &str, duration_s: u32, reason: &str) -> AppResult<()> {
        let me = self.require_broadcaster()?;
        let (user_id, _) = self.resolve_user(login).await?;
        let body = json!({
            "data": {
                "user_id": user_id,
                "duration": duration_s.clamp(1, MAX_TIMEOUT_S),
                "reason": truncate(reason.trim(), MAX_CHAT),
            }
        });
        self.helix(
            AccountRole::Broadcaster,
            Method::POST,
            "/moderation/bans",
            &[("broadcaster_id", me.clone()), ("moderator_id", me)],
            Some(&body),
        )
        .await
        .map_err(|e| e.into_app("time out users"))?;
        Ok(())
    }

    async fn delete_message(&self, message_id: &str) -> AppResult<()> {
        self.delete_chat_message(message_id).await
    }

    async fn set_chat_mode(&self, mode: ChatMode, state: Toggle, value: u32) -> AppResult<()> {
        self.set_mode_toggle(mode, state, value).await
    }
    async fn finish_redemption(
        &self,
        reward_id: &str,
        redemption_id: &str,
        refund: bool,
    ) -> AppResult<()> {
        let item = RedemptionRef {
            id: redemption_id.to_string(),
            reward_id: reward_id.to_string(),
        };
        self.finish_redemptions(&[item], refund).await?;
        Ok(())
    }

    async fn set_reward_state(&self, id: &str, title: &str, state: RewardState) -> AppResult<()> {
        self.reward_state(id, title, state).await
    }

    async fn set_reward_cost(&self, id: &str, title: &str, cost: u32) -> AppResult<()> {
        self.reward_cost(id, title, cost).await
    }

    async fn start_poll(&self, draft: &PollDraft) -> AppResult<()> {
        self.create_poll(draft).await.map(|_| ())
    }

    async fn end_poll(&self) -> AppResult<()> {
        self.stop_poll().await.map(|_| ())
    }

    async fn start_prediction(&self, draft: &PredictionDraft) -> AppResult<()> {
        self.create_prediction(draft).await.map(|_| ())
    }

    async fn end_prediction(&self, action: PredictionAction, winner: &str) -> AppResult<()> {
        self.finish_prediction(action, winner).await.map(|_| ())
    }

    async fn snooze_next_ad(&self) -> AppResult<()> {
        self.snooze_ad().await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_trimmed_and_cut() {
        assert!(clean_message("   ").is_err());
        assert_eq!(clean_message("  hi  ").unwrap(), "hi");
        let long = "é".repeat(600);
        let cut = clean_message(&long).unwrap();
        assert_eq!(cut.chars().count(), 500);
    }

    #[test]
    fn ad_lengths_snap() {
        assert_eq!(snap_ad_length(0), 30);
        assert_eq!(snap_ad_length(44), 30);
        assert_eq!(snap_ad_length(46), 60);
        assert_eq!(snap_ad_length(180), 180);
        assert_eq!(snap_ad_length(999), 180);
    }

    #[test]
    fn colors() {
        assert_eq!(announce_color("Purple"), "purple");
        assert_eq!(announce_color("pink"), "primary");
        assert_eq!(announce_color(""), "primary");
    }

    #[test]
    fn logins_and_tags() {
        assert_eq!(clean_login(" @Some_User ").unwrap(), "some_user");
        assert!(clean_login("bad name").is_err());
        assert!(validate_tags(&["English".into(), "Cozy".into()]).is_ok());
        assert!(validate_tags(&["no spaces".into()]).is_err());
        assert!(validate_tags(&vec!["a".to_string(); 11]).is_err());
    }
}
