//! Channel point rewards and redemptions.

use super::TwitchService;
use super::helix::HelixError;
use super::normalize::{num_of, parse_rfc3339, str_of, user as user_of};
use crate::error::{AppError, AppResult};
use crate::hub::ui;
use crate::model::interact::{
    Redemption, RedemptionRef, RedemptionStatus, RedemptionUpdate, Reward, RewardState,
};
use crate::model::runtime::AccountRole;
use reqwest::Method;
use serde_json::{Value, json};

const REWARDS: &str = "/channel_points/custom_rewards";
const REDEMPTIONS: &str = "/channel_points/custom_rewards/redemptions";
/// Twitch takes up to 50 redemption ids per update.
const BATCH: usize = 50;

/// What a Twitch feature is called in messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Feature {
    ChannelPoints,
    Polls,
    Predictions,
}

impl Feature {
    fn name(self) -> &'static str {
        match self {
            Feature::ChannelPoints => "Channel points",
            Feature::Polls => "Polls",
            Feature::Predictions => "Predictions",
        }
    }
}

/// Turns a Helix error into a message, with the cases these features add:
/// no Affiliate or Partner status, a reward made elsewhere, and old sign-ins
/// without the newer permissions.
pub(crate) fn feature_error(e: HelixError, feature: Feature, what: &str) -> AppError {
    let msg = e.message().to_lowercase();
    match e.status() {
        Some(403) if msg.contains("partner") || msg.contains("affiliate") => {
            AppError::Twitch(format!("{} need Affiliate or Partner.", feature.name()))
        }
        Some(403) if msg.contains("client") => {
            AppError::Twitch("This reward was made on Twitch, so only Twitch can change it.".into())
        }
        Some(401 | 403) if msg.contains("scope") => AppError::Twitch(format!(
            "{} need a newer sign-in. Sign out and in again in Settings → Twitch.",
            feature.name()
        )),
        _ => e.into_app(what),
    }
}

fn points_err(what: &'static str) -> impl Fn(HelixError) -> AppError {
    move |e| feature_error(e, Feature::ChannelPoints, what)
}

fn int_of(v: &Value, key: &str) -> u32 {
    num_of(v, key).clamp(0.0, u32::MAX as f64) as u32
}

fn flag(v: &Value, pointer: &str) -> bool {
    v.pointer(pointer).and_then(Value::as_bool).unwrap_or(false)
}

/// A reward from Helix.
pub(crate) fn reward_from_helix(v: &Value, manageable: bool) -> Reward {
    let limit = |obj: &str, enabled: &str, value: &str| {
        let o = v.get(obj).unwrap_or(&Value::Null);
        if o.get(enabled).and_then(Value::as_bool) == Some(true) {
            int_of(o, value)
        } else {
            0
        }
    };
    let image = v
        .pointer("/image/url_2x")
        .or_else(|| v.pointer("/default_image/url_2x"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Reward {
        id: str_of(v, "id"),
        title: str_of(v, "title"),
        cost: int_of(v, "cost"),
        prompt: str_of(v, "prompt"),
        input_required: v
            .get("is_user_input_required")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        color: str_of(v, "background_color"),
        enabled: v.get("is_enabled").and_then(Value::as_bool).unwrap_or(true),
        paused: flag(v, "/is_paused"),
        skip_queue: flag(v, "/should_redemptions_skip_request_queue"),
        max_per_stream: limit("max_per_stream_setting", "is_enabled", "max_per_stream"),
        max_per_user: limit(
            "max_per_user_per_stream_setting",
            "is_enabled",
            "max_per_user_per_stream",
        ),
        cooldown_s: limit(
            "global_cooldown_setting",
            "is_enabled",
            "global_cooldown_seconds",
        ),
        manageable,
        image_url: image,
    }
}

/// The body Helix wants to create or update a reward.
pub(crate) fn reward_body(r: &Reward, updating: bool) -> Value {
    let mut b = json!({
        "title": r.title.trim(),
        "cost": r.cost,
        "prompt": r.prompt.trim(),
        "is_enabled": r.enabled,
        "is_user_input_required": r.input_required,
        "is_max_per_stream_enabled": r.max_per_stream > 0,
        "max_per_stream": r.max_per_stream.max(1),
        "is_max_per_user_per_stream_enabled": r.max_per_user > 0,
        "max_per_user_per_stream": r.max_per_user.max(1),
        "is_global_cooldown_enabled": r.cooldown_s > 0,
        "global_cooldown_seconds": r.cooldown_s.max(1),
        "should_redemptions_skip_request_queue": r.skip_queue,
    });
    if !r.color.trim().is_empty() {
        b["background_color"] = json!(r.color.trim().to_uppercase());
    }
    if updating {
        b["is_paused"] = json!(r.paused);
    }
    b
}

pub(crate) fn status_of(s: &str) -> RedemptionStatus {
    match s.to_ascii_lowercase().as_str() {
        "fulfilled" => RedemptionStatus::Fulfilled,
        "canceled" | "cancelled" => RedemptionStatus::Canceled,
        _ => RedemptionStatus::Unfulfilled,
    }
}

/// A redemption from Helix or from an EventSub redemption event; both use the same fields.
pub(crate) fn redemption_from(v: &Value) -> Redemption {
    let reward = v.get("reward").unwrap_or(&Value::Null);
    Redemption {
        id: str_of(v, "id"),
        reward_id: str_of(reward, "id"),
        reward_title: str_of(reward, "title"),
        cost: int_of(reward, "cost"),
        user: user_of(v, "user").unwrap_or_default(),
        input: str_of(v, "user_input").trim().to_string(),
        status: status_of(&str_of(v, "status")),
        redeemed_at: parse_rfc3339(&str_of(v, "redeemed_at")).unwrap_or(0),
    }
}

fn data(v: &Value) -> &[Value] {
    v.get("data")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

impl TwitchService {
    async fn get_rewards(&self, id: &str, only_mine: bool) -> Result<Vec<Value>, HelixError> {
        let mut q = vec![("broadcaster_id", id.to_string())];
        if only_mine {
            q.push(("only_manageable_rewards", "true".into()));
        }
        let v = self
            .helix(AccountRole::Broadcaster, Method::GET, REWARDS, &q, None)
            .await?;
        Ok(data(&v).to_vec())
    }

    /// Every custom reward, newest Twitch order. `manageable` marks the ones Castwright made.
    pub async fn rewards(&self) -> AppResult<Vec<Reward>> {
        let id = self.require_broadcaster()?;
        let what = "read channel point rewards";
        let (all, mine) =
            futures_util::future::join(self.get_rewards(&id, false), self.get_rewards(&id, true))
                .await;
        let all = all.map_err(points_err(what))?;
        let mine: Vec<String> = mine
            .map_err(points_err(what))?
            .iter()
            .map(|r| str_of(r, "id"))
            .collect();
        Ok(all
            .iter()
            .map(|r| {
                let id = str_of(r, "id");
                reward_from_helix(r, mine.contains(&id))
            })
            .collect())
    }

    /// Creates the reward when it has no id yet, otherwise updates it.
    pub async fn save_reward(&self, reward: &Reward) -> AppResult<Reward> {
        reward.check().map_err(AppError::User)?;
        let broadcaster = self.require_broadcaster()?;
        let creating = reward.id.trim().is_empty();
        let mut q = vec![("broadcaster_id", broadcaster)];
        let method = if creating {
            Method::POST
        } else {
            q.push(("id", reward.id.trim().to_string()));
            Method::PATCH
        };
        let body = reward_body(reward, !creating);
        let v = self
            .helix(AccountRole::Broadcaster, method, REWARDS, &q, Some(&body))
            .await
            .map_err(|e| match (e.status(), e.message().to_lowercase()) {
                (Some(400), m) if m.contains("duplicate") => {
                    AppError::User("Another reward already has this title.".into())
                }
                _ => feature_error(e, Feature::ChannelPoints, "save the reward"),
            })?;
        Self::first(&v)
            .map(|r| reward_from_helix(r, true))
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the reward.".into()))
    }

    pub async fn delete_reward(&self, reward_id: &str) -> AppResult<()> {
        let broadcaster = self.require_broadcaster()?;
        self.helix(
            AccountRole::Broadcaster,
            Method::DELETE,
            REWARDS,
            &[
                ("broadcaster_id", broadcaster),
                ("id", reward_id.to_string()),
            ],
            None,
        )
        .await
        .map_err(points_err("delete the reward"))?;
        Ok(())
    }

    /// Redemptions still waiting, for every reward Castwright made. Oldest first.
    pub async fn redemptions(&self) -> AppResult<Vec<Redemption>> {
        let broadcaster = self.require_broadcaster()?;
        let what = "read channel point redemptions";
        let mine = self
            .get_rewards(&broadcaster, true)
            .await
            .map_err(points_err(what))?;
        let calls = mine.iter().map(|r| {
            let q = vec![
                ("broadcaster_id", broadcaster.clone()),
                ("reward_id", str_of(r, "id")),
                ("status", "UNFULFILLED".to_string()),
                ("sort", "OLDEST".to_string()),
                ("first", "50".to_string()),
            ];
            async move {
                self.helix(AccountRole::Broadcaster, Method::GET, REDEMPTIONS, &q, None)
                    .await
            }
        });
        let mut out = Vec::new();
        for res in futures_util::future::join_all(calls).await {
            out.extend(
                data(&res.map_err(points_err(what))?)
                    .iter()
                    .map(redemption_from),
            );
        }
        out.sort_by_key(|r| r.redeemed_at);
        Ok(out)
    }

    /// Marks redemptions complete, or refunds them. Returns how many changed.
    pub async fn finish_redemptions(
        &self,
        items: &[RedemptionRef],
        refund: bool,
    ) -> AppResult<u32> {
        let broadcaster = self.require_broadcaster()?;
        let mut by_reward: Vec<(String, Vec<String>)> = Vec::new();
        for it in items
            .iter()
            .filter(|i| !i.id.is_empty() && !i.reward_id.is_empty())
        {
            match by_reward.iter_mut().find(|(r, _)| *r == it.reward_id) {
                Some((_, ids)) => ids.push(it.id.clone()),
                None => by_reward.push((it.reward_id.clone(), vec![it.id.clone()])),
            }
        }
        let status = if refund { "CANCELED" } else { "FULFILLED" };
        let what = if refund {
            "refund redemptions"
        } else {
            "complete redemptions"
        };
        let mut changed = 0;
        for (reward_id, ids) in by_reward {
            for chunk in ids.chunks(BATCH) {
                let mut q = vec![
                    ("broadcaster_id", broadcaster.clone()),
                    ("reward_id", reward_id.clone()),
                ];
                q.extend(chunk.iter().map(|id| ("id", id.clone())));
                let v = self
                    .helix(
                        AccountRole::Broadcaster,
                        Method::PATCH,
                        REDEMPTIONS,
                        &q,
                        Some(&json!({ "status": status })),
                    )
                    .await
                    .map_err(|e| match e.status() {
                        Some(404) => AppError::Twitch(
                            "Those redemptions were already completed or refunded.".into(),
                        ),
                        _ => feature_error(e, Feature::ChannelPoints, what),
                    })?;
                for r in data(&v).iter().map(redemption_from) {
                    changed += 1;
                    self.hub.emit_ui(
                        ui::REDEMPTION,
                        &RedemptionUpdate {
                            id: r.id,
                            reward_id: reward_id.clone(),
                            status: r.status,
                        },
                    );
                }
            }
        }
        Ok(changed)
    }

    /// A reward Castwright made, found by id or else by title, so actions
    /// shared from another channel still find theirs.
    pub(crate) async fn find_my_reward(&self, id: &str, title: &str) -> AppResult<Value> {
        let broadcaster = self.require_broadcaster()?;
        let mine = self
            .get_rewards(&broadcaster, true)
            .await
            .map_err(points_err("read channel point rewards"))?;
        let (id, title) = (id.trim(), title.trim());
        mine.iter()
            .find(|r| !id.is_empty() && str_of(r, "id") == id)
            .or_else(|| {
                mine.iter()
                    .find(|r| !title.is_empty() && str_of(r, "title").eq_ignore_ascii_case(title))
            })
            .cloned()
            .ok_or_else(|| {
                AppError::User(if title.is_empty() {
                    "Couldn't find that reward. Pick it again; only rewards made in Castwright can be changed.".into()
                } else {
                    format!("Couldn't find the reward \"{title}\". Only rewards made in Castwright can be changed.")
                })
            })
    }

    pub(crate) async fn patch_reward(&self, reward_id: &str, body: Value) -> AppResult<()> {
        let broadcaster = self.require_broadcaster()?;
        self.helix(
            AccountRole::Broadcaster,
            Method::PATCH,
            REWARDS,
            &[
                ("broadcaster_id", broadcaster),
                ("id", reward_id.to_string()),
            ],
            Some(&body),
        )
        .await
        .map_err(points_err("change the reward"))?;
        Ok(())
    }

    pub(crate) async fn reward_state(
        &self,
        id: &str,
        title: &str,
        state: RewardState,
    ) -> AppResult<()> {
        let r = self.find_my_reward(id, title).await?;
        let body = match state {
            RewardState::Enable => json!({ "is_enabled": true }),
            RewardState::Disable => json!({ "is_enabled": false }),
            RewardState::Pause => json!({ "is_paused": true }),
            RewardState::Resume => json!({ "is_paused": false }),
        };
        self.patch_reward(&str_of(&r, "id"), body).await
    }

    pub(crate) async fn reward_cost(&self, id: &str, title: &str, cost: u32) -> AppResult<()> {
        if cost == 0 {
            return crate::error::user_err("The cost has to be at least 1 point.");
        }
        let r = self.find_my_reward(id, title).await?;
        self.patch_reward(&str_of(&r, "id"), json!({ "cost": cost }))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_round_trip() {
        let v = json!({
            "id": "r1", "title": "Hydrate", "cost": 500, "prompt": "Drink!",
            "is_user_input_required": true, "background_color": "#00E5CB",
            "is_enabled": true, "is_paused": false,
            "max_per_stream_setting": {"is_enabled": true, "max_per_stream": 3},
            "max_per_user_per_stream_setting": {"is_enabled": false, "max_per_user_per_stream": 0},
            "global_cooldown_setting": {"is_enabled": true, "global_cooldown_seconds": 60},
            "should_redemptions_skip_request_queue": false,
            "image": null,
            "default_image": {"url_2x": "https://x/2.png"}
        });
        let r = reward_from_helix(&v, true);
        assert_eq!(r.title, "Hydrate");
        assert_eq!(r.cost, 500);
        assert!(r.input_required);
        assert_eq!(r.max_per_stream, 3);
        assert_eq!(r.max_per_user, 0);
        assert_eq!(r.cooldown_s, 60);
        assert_eq!(r.image_url, "https://x/2.png");

        let b = reward_body(&r, true);
        assert_eq!(b["is_max_per_stream_enabled"], true);
        assert_eq!(b["max_per_stream"], 3);
        assert_eq!(b["is_max_per_user_per_stream_enabled"], false);
        assert_eq!(b["global_cooldown_seconds"], 60);
        assert_eq!(b["background_color"], "#00E5CB");
        assert_eq!(b["is_paused"], false);
        assert!(reward_body(&r, false).get("is_paused").is_none());
    }

    #[test]
    fn redemption_from_helix() {
        let v = json!({
            "id": "red-1", "user_id": "42", "user_login": "nova", "user_name": "Nova",
            "user_input": " hi ", "status": "UNFULFILLED",
            "redeemed_at": "2024-01-01T00:00:00Z",
            "reward": {"id": "r1", "title": "Hydrate", "cost": 500, "prompt": ""}
        });
        let r = redemption_from(&v);
        assert_eq!(r.reward_id, "r1");
        assert_eq!(r.user.display_name, "Nova");
        assert_eq!(r.input, "hi");
        assert_eq!(r.status, RedemptionStatus::Unfulfilled);
        assert_eq!(r.redeemed_at, 1_704_067_200_000);
        assert_eq!(status_of("CANCELED"), RedemptionStatus::Canceled);
    }

    #[test]
    fn affiliate_and_scope_errors() {
        let api = |status, message: &str| HelixError::Api {
            status,
            message: message.into(),
        };
        let msg = |e| feature_error(e, Feature::ChannelPoints, "read rewards").to_string();
        assert_eq!(
            msg(api(
                403,
                "The broadcaster must have partner or affiliate status."
            )),
            "Twitch: Channel points need Affiliate or Partner."
        );
        assert!(
            msg(api(
                403,
                "The client-id does not match the client-id that created the reward."
            ))
            .contains("made on Twitch")
        );
        assert!(
            msg(api(401, "Missing scope: channel:manage:redemptions"))
                .contains("Sign out and in again")
        );
        assert_eq!(
            feature_error(api(403, "Must be an Affiliate"), Feature::Polls, "x").to_string(),
            "Twitch: Polls need Affiliate or Partner."
        );
        assert!(msg(api(500, "")).contains("having trouble"));
    }
}
