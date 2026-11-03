//! What redemption, poll and prediction triggers give an action to work with.

use crate::model::event::{Event, EventKind};
use serde_json::{Map, Value, json};

fn text(e: &Event, key: &str) -> String {
    match e.data.get(key) {
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn items<'a>(e: &'a Event, key: &str) -> &'a [Value] {
    e.data
        .get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn n(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn title(v: &Value) -> String {
    v.get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Whether a redemption trigger set to this reward fires for `e`.
pub fn reward_matches(e: &Event, reward_id: &str, reward_title: &str) -> bool {
    let (id, title) = (reward_id.trim(), reward_title.trim());
    if id.is_empty() && title.is_empty() {
        return true;
    }
    (!id.is_empty() && text(e, "reward_id") == id)
        || (!title.is_empty() && text(e, "reward_title").trim().eq_ignore_ascii_case(title))
}

/// Short names for the values of redemption, poll and prediction events.
pub fn args(e: &Event) -> Map<String, Value> {
    let mut m = Map::new();
    match e.kind {
        EventKind::Redemption => {
            let user = e.user.as_ref();
            m.insert(
                "user".into(),
                json!(user.map(|u| u.display_name.as_str()).unwrap_or("")),
            );
            m.insert("reward".into(), json!(text(e, "reward_title")));
            m.insert("reward_id".into(), json!(text(e, "reward_id")));
            m.insert("redemption_id".into(), json!(text(e, "redemption_id")));
            m.insert("cost".into(), json!(e.amount.unwrap_or(0.0)));
            m.insert("input".into(), json!(e.message.as_deref().unwrap_or("")));
        }
        EventKind::PollBegin | EventKind::PollProgress | EventKind::PollEnd => {
            let choices = items(e, "choices");
            let votes = |c: &Value| n(c, "votes");
            let total: u64 = choices.iter().map(votes).sum();
            let top = choices.iter().max_by_key(|c| votes(c));
            let tied =
                top.is_some_and(|t| choices.iter().filter(|c| votes(c) == votes(t)).count() > 1);
            m.insert("poll.title".into(), json!(text(e, "title")));
            m.insert("poll.status".into(), json!(text(e, "status")));
            m.insert(
                "poll.choices".into(),
                json!(choices.iter().map(title).collect::<Vec<_>>().join(", ")),
            );
            m.insert("poll.total_votes".into(), json!(total));
            let winner = match top {
                Some(t) if total > 0 && !tied => title(t),
                _ => String::new(),
            };
            m.insert("poll.winner".into(), json!(winner));
            m.insert(
                "poll.winner_votes".into(),
                json!(top.map(votes).unwrap_or(0)),
            );
        }
        EventKind::PredictionBegin
        | EventKind::PredictionProgress
        | EventKind::PredictionLock
        | EventKind::PredictionEnd => {
            let outcomes = items(e, "outcomes");
            let win = text(e, "winning_outcome_id");
            let winner = outcomes
                .iter()
                .find(|o| !win.is_empty() && o.get("id").and_then(Value::as_str) == Some(&win));
            m.insert("prediction.title".into(), json!(text(e, "title")));
            m.insert("prediction.status".into(), json!(text(e, "status")));
            m.insert(
                "prediction.outcomes".into(),
                json!(outcomes.iter().map(title).collect::<Vec<_>>().join(", ")),
            );
            m.insert(
                "prediction.total_points".into(),
                json!(outcomes.iter().map(|o| n(o, "channel_points")).sum::<u64>()),
            );
            m.insert(
                "prediction.total_users".into(),
                json!(outcomes.iter().map(|o| n(o, "users")).sum::<u64>()),
            );
            m.insert(
                "prediction.winner".into(),
                json!(winner.map(title).unwrap_or_default()),
            );
        }
        _ => {}
    }
    m
}

/// Poll end events also come when a finished poll is hidden; that isn't a new end.
pub fn is_real_end(e: &Event) -> bool {
    text(e, "status") != "archived"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn poll(choices: Value, status: &str) -> Event {
        let mut e = Event::new(EventKind::PollEnd);
        e.data.insert("title".into(), json!("Next map?"));
        e.data.insert("status".into(), json!(status));
        e.data.insert("choices".into(), choices);
        e
    }

    #[test]
    fn redemption_values() {
        let mut e = Event::new(EventKind::Redemption).with_user("nova", "Nova");
        e.amount = Some(500.0);
        e.message = Some("hi".into());
        e.data.insert("reward_id".into(), json!("r1"));
        e.data.insert("reward_title".into(), json!("Hydrate"));
        e.data.insert("redemption_id".into(), json!("x1"));
        let a = args(&e);
        assert_eq!(a["user"], "Nova");
        assert_eq!(a["reward"], "Hydrate");
        assert_eq!(a["cost"], 500.0);
        assert_eq!(a["input"], "hi");
        assert_eq!(a["redemption_id"], "x1");

        assert!(reward_matches(&e, "", ""));
        assert!(reward_matches(&e, "r1", ""));
        assert!(reward_matches(&e, "other-id", "hydrate"));
        assert!(!reward_matches(&e, "r2", "Stretch"));
    }

    #[test]
    fn poll_winner_and_ties() {
        let e = poll(
            json!([{"title": "Dust", "votes": 5}, {"title": "Mirage", "votes": 2}]),
            "completed",
        );
        let a = args(&e);
        assert_eq!(a["poll.winner"], "Dust");
        assert_eq!(a["poll.winner_votes"], 5);
        assert_eq!(a["poll.total_votes"], 7);
        assert_eq!(a["poll.choices"], "Dust, Mirage");
        let tie = poll(
            json!([{"title": "A", "votes": 2}, {"title": "B", "votes": 2}]),
            "completed",
        );
        assert_eq!(args(&tie)["poll.winner"], "");
        assert!(!is_real_end(&poll(json!([]), "archived")));
    }

    #[test]
    fn prediction_winner() {
        let mut e = Event::new(EventKind::PredictionEnd);
        e.data.insert("title".into(), json!("Win?"));
        e.data.insert("status".into(), json!("resolved"));
        e.data.insert("winning_outcome_id".into(), json!("n"));
        e.data.insert(
            "outcomes".into(),
            json!([{"id": "y", "title": "Yes", "users": 3, "channel_points": 300},
                   {"id": "n", "title": "No", "users": 1, "channel_points": 50}]),
        );
        let a = args(&e);
        assert_eq!(a["prediction.winner"], "No");
        assert_eq!(a["prediction.total_points"], 350);
        assert_eq!(a["prediction.total_users"], 4);
    }
}
