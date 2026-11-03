//! Polls and predictions.

use super::TwitchService;
use super::normalize::{self, Meta, num_of, parse_rfc3339, str_of};
use super::points::{Feature, feature_error};
use crate::error::{AppError, AppResult, user_err};
use crate::model::event::{Event, EventKind};
use crate::model::interact::{InteractState, PollDraft, PredictionAction, PredictionDraft};
use crate::model::runtime::AccountRole;
use reqwest::Method;
use serde_json::{Value, json};

fn meta(broadcaster_id: &str) -> Meta<'_> {
    Meta {
        message_id: "",
        ts: crate::util::now_ms(),
        broadcaster_id,
    }
}

fn ms(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_str).and_then(parse_rfc3339)
}

/// A Helix poll as the event its EventSub notification would make.
pub(crate) fn poll_event(v: &Value, broadcaster_id: &str) -> Option<Event> {
    if str_of(v, "id").is_empty() {
        return None;
    }
    let status = str_of(v, "status").to_lowercase();
    let mut ev = v.clone();
    ev["status"] = json!(status);
    ev["channel_points_voting"] = json!({
        "is_enabled": v.get("channel_points_voting_enabled").and_then(Value::as_bool).unwrap_or(false),
        "amount_per_vote": num_of(v, "channel_points_per_vote"),
    });
    let kind = if status == "active" {
        EventKind::PollProgress
    } else {
        EventKind::PollEnd
    };
    let mut e = normalize::poll(meta(broadcaster_id), &ev, kind)?;
    if let Some(start) = ms(v, "started_at") {
        e.data.insert(
            "ends_at".into(),
            json!(start + num_of(v, "duration") as i64 * 1000),
        );
    }
    Some(e)
}

/// A Helix prediction as the event its EventSub notification would make.
pub(crate) fn prediction_event(v: &Value, broadcaster_id: &str) -> Option<Event> {
    if str_of(v, "id").is_empty() {
        return None;
    }
    let status = str_of(v, "status").to_lowercase();
    let mut ev = v.clone();
    ev["status"] = json!(status);
    ev["started_at"] = v.get("created_at").cloned().unwrap_or_default();
    let kind = match status.as_str() {
        "active" => EventKind::PredictionProgress,
        "locked" => EventKind::PredictionLock,
        _ => EventKind::PredictionEnd,
    };
    let mut e = normalize::prediction(meta(broadcaster_id), &ev, kind)?;
    if let Some(start) = ms(v, "created_at") {
        e.data.insert(
            "locks_at".into(),
            json!(start + num_of(v, "prediction_window") as i64 * 1000),
        );
    }
    Some(e)
}

/// The outcome a "winner" text means: its id, its title, or its number from 1.
pub(crate) fn pick_outcome(outcomes: &[Value], winner: &str) -> Option<String> {
    let w = winner.trim();
    if w.is_empty() {
        return None;
    }
    let id = |o: &Value| str_of(o, "id");
    outcomes
        .iter()
        .find(|o| id(o) == w)
        .or_else(|| {
            outcomes
                .iter()
                .find(|o| str_of(o, "title").trim().eq_ignore_ascii_case(w))
        })
        .or_else(|| {
            let n: usize = w.parse().ok()?;
            outcomes.get(n.checked_sub(1)?)
        })
        .map(id)
}

fn list(v: &Value, key: &str) -> Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

impl TwitchService {
    async fn latest(&self, path: &str, feature: Feature) -> AppResult<Option<Value>> {
        let id = self.require_broadcaster()?;
        let what = if feature == Feature::Polls {
            "read polls"
        } else {
            "read predictions"
        };
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                path,
                &[("broadcaster_id", id), ("first", "1".into())],
                None,
            )
            .await
            .map_err(|e| feature_error(e, feature, what))?;
        Ok(Self::first(&v).cloned())
    }

    /// The latest poll and prediction, running or not.
    pub async fn interact_state(&self) -> AppResult<InteractState> {
        let id = self.require_broadcaster()?;
        let (poll, prediction) = futures_util::future::join(
            self.latest("/polls", Feature::Polls),
            self.latest("/predictions", Feature::Predictions),
        )
        .await;
        Ok(InteractState {
            poll: poll?.and_then(|p| poll_event(&p, &id)),
            prediction: prediction?.and_then(|p| prediction_event(&p, &id)),
        })
    }

    pub async fn create_poll(&self, draft: &PollDraft) -> AppResult<Event> {
        draft.check().map_err(AppError::User)?;
        let id = self.require_broadcaster()?;
        let mut body = json!({
            "broadcaster_id": id,
            "title": draft.title.trim(),
            "choices": draft.choices.iter().map(|c| json!({ "title": c.trim() })).collect::<Vec<_>>(),
            "duration": draft.duration_s,
        });
        if draft.points_per_vote > 0 {
            body["channel_points_voting_enabled"] = json!(true);
            body["channel_points_per_vote"] = json!(draft.points_per_vote);
        }
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/polls",
                &[],
                Some(&body),
            )
            .await
            .map_err(|e| match (e.status(), e.message().to_lowercase()) {
                (Some(400), m) if m.contains("active") => {
                    AppError::User("A poll is already running. End it first.".into())
                }
                _ => feature_error(e, Feature::Polls, "start polls"),
            })?;
        Self::first(&v)
            .and_then(|p| poll_event(p, &id))
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the new poll.".into()))
    }

    /// Ends the running poll and shows the result.
    pub async fn stop_poll(&self) -> AppResult<Event> {
        let id = self.require_broadcaster()?;
        let Some(p) = self
            .latest("/polls", Feature::Polls)
            .await?
            .filter(|p| str_of(p, "status").eq_ignore_ascii_case("active"))
        else {
            return user_err("No poll is running.");
        };
        let body = json!({ "broadcaster_id": id, "id": str_of(&p, "id"), "status": "TERMINATED" });
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::PATCH,
                "/polls",
                &[],
                Some(&body),
            )
            .await
            .map_err(|e| feature_error(e, Feature::Polls, "end polls"))?;
        Self::first(&v)
            .and_then(|p| poll_event(p, &id))
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the poll.".into()))
    }

    pub async fn create_prediction(&self, draft: &PredictionDraft) -> AppResult<Event> {
        draft.check().map_err(AppError::User)?;
        let id = self.require_broadcaster()?;
        let body = json!({
            "broadcaster_id": id,
            "title": draft.title.trim(),
            "outcomes": draft.outcomes.iter().map(|c| json!({ "title": c.trim() })).collect::<Vec<_>>(),
            "prediction_window": draft.window_s,
        });
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/predictions",
                &[],
                Some(&body),
            )
            .await
            .map_err(|e| match (e.status(), e.message().to_lowercase()) {
                (Some(400), m) if m.contains("active") => AppError::User(
                    "A prediction is already running. Resolve or cancel it first.".into(),
                ),
                _ => feature_error(e, Feature::Predictions, "start predictions"),
            })?;
        Self::first(&v)
            .and_then(|p| prediction_event(p, &id))
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the new prediction.".into()))
    }

    /// Locks, resolves or cancels the latest prediction. `winner` is an outcome id,
    /// title or number and only matters when resolving.
    pub async fn finish_prediction(
        &self,
        action: PredictionAction,
        winner: &str,
    ) -> AppResult<Event> {
        let id = self.require_broadcaster()?;
        let Some(p) = self.latest("/predictions", Feature::Predictions).await? else {
            return user_err("No prediction is running.");
        };
        let status = str_of(&p, "status").to_lowercase();
        let open = status == "active" || status == "locked";
        let mut body = json!({ "broadcaster_id": id, "id": str_of(&p, "id") });
        match action {
            PredictionAction::Lock if status == "active" => body["status"] = json!("LOCKED"),
            PredictionAction::Lock if status == "locked" => {
                return user_err("The prediction is already locked.");
            }
            PredictionAction::Cancel if open => body["status"] = json!("CANCELED"),
            PredictionAction::Resolve if open => {
                let outcomes = list(&p, "outcomes");
                let Some(win) = pick_outcome(&outcomes, winner) else {
                    let names: Vec<String> = outcomes.iter().map(|o| str_of(o, "title")).collect();
                    return user_err(format!("Pick the winning outcome: {}.", names.join(", ")));
                };
                body["status"] = json!("RESOLVED");
                body["winning_outcome_id"] = json!(win);
            }
            _ => return user_err("No prediction is running."),
        }
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::PATCH,
                "/predictions",
                &[],
                Some(&body),
            )
            .await
            .map_err(|e| feature_error(e, Feature::Predictions, "end predictions"))?;
        Self::first(&v)
            .and_then(|p| prediction_event(p, &id))
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the prediction.".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helix_poll_reads_like_its_event() {
        let v = json!({
            "id": "p1", "title": "Next map?", "status": "ACTIVE", "duration": 120,
            "started_at": "2024-01-01T00:00:00Z", "ended_at": null,
            "channel_points_voting_enabled": true, "channel_points_per_vote": 50,
            "choices": [
                {"id": "a", "title": "Dust", "votes": 3, "channel_points_votes": 1, "bits_votes": 0},
                {"id": "b", "title": "Mirage", "votes": 1, "channel_points_votes": 0, "bits_votes": 0}
            ]
        });
        let e = poll_event(&v, "1337").unwrap();
        assert_eq!(e.kind, EventKind::PollProgress);
        assert_eq!(e.data["status"], "active");
        assert_eq!(e.data["ends_at"], 1_704_067_320_000i64);
        assert_eq!(e.data["points_per_vote"], 50);
        assert_eq!(e.data["choices"][0]["votes"], 3);

        let mut done = v.clone();
        done["status"] = json!("TERMINATED");
        assert_eq!(poll_event(&done, "1").unwrap().kind, EventKind::PollEnd);
        assert!(poll_event(&json!({}), "1").is_none());
    }

    #[test]
    fn helix_prediction_reads_like_its_event() {
        let v = json!({
            "id": "pr1", "title": "Win?", "status": "LOCKED", "prediction_window": 60,
            "created_at": "2024-01-01T00:00:00Z", "winning_outcome_id": null,
            "outcomes": [
                {"id": "y", "title": "Yes", "users": 2, "channel_points": 900, "color": "BLUE"},
                {"id": "n", "title": "No", "users": 1, "channel_points": 100, "color": "PINK"}
            ]
        });
        let e = prediction_event(&v, "1").unwrap();
        assert_eq!(e.kind, EventKind::PredictionLock);
        assert_eq!(e.data["status"], "locked");
        assert_eq!(e.data["locks_at"], 1_704_067_260_000i64);
        assert_eq!(e.data["outcomes"][0]["channel_points"], 900);
    }

    #[test]
    fn outcome_by_id_title_or_number() {
        let o = vec![
            json!({"id": "y", "title": "Yes"}),
            json!({"id": "n", "title": "No"}),
        ];
        assert_eq!(pick_outcome(&o, "n").as_deref(), Some("n"));
        assert_eq!(pick_outcome(&o, " yes ").as_deref(), Some("y"));
        assert_eq!(pick_outcome(&o, "2").as_deref(), Some("n"));
        assert_eq!(pick_outcome(&o, "3"), None);
        assert_eq!(pick_outcome(&o, "0"), None);
        assert_eq!(pick_outcome(&o, ""), None);
    }
}
