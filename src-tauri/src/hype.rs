//! The running hype train, kept in the live `hype.*` variables, and level-up detection.

use crate::model::event::{Event, EventKind};
use serde_json::{Value, json};

/// What a hype train event changed.
#[derive(Debug, Clone, PartialEq)]
pub enum HypeChange {
    Began,
    /// A higher level than the last event of the same train.
    LevelUp {
        from: u64,
        to: u64,
    },
    Progress,
    Ended,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HypeUpdate {
    pub change: HypeChange,
    pub vars: Vec<(&'static str, Value)>,
}

#[derive(Debug, Default)]
pub struct HypeTracker {
    /// Id and level of the train running now.
    current: Option<(String, u64)>,
}

fn u64_of(e: &Event, key: &str) -> Option<u64> {
    e.data.get(key).and_then(Value::as_u64)
}

fn i64_of(e: &Event, key: &str) -> i64 {
    e.data.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Name and total of the top contributor of one type (`bits` or `subscription`).
fn top_of(e: &Event, kind: &str) -> (String, u64) {
    e.data
        .get("top_contributions")
        .and_then(Value::as_array)
        .and_then(|list| list.iter().find(|c| c["type"] == kind))
        .map(|c| {
            (
                c["name"].as_str().unwrap_or_default().to_string(),
                c["total"].as_u64().unwrap_or(0),
            )
        })
        .unwrap_or_default()
}

impl HypeTracker {
    pub fn new() -> Self {
        HypeTracker::default()
    }

    /// Variables to set and what changed, for hype train events. None for other events.
    pub fn apply(&mut self, e: &Event, now_ms: i64) -> Option<HypeUpdate> {
        if !matches!(
            e.kind,
            EventKind::HypeTrainBegin | EventKind::HypeTrainProgress | EventKind::HypeTrainEnd
        ) {
            return None;
        }
        let id = e
            .data
            .get("hype_train_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let level = u64_of(e, "level").unwrap_or(1).max(1);
        let total = u64_of(e, "total").unwrap_or(0);
        let mut vars = Vec::new();
        let change = match e.kind {
            EventKind::HypeTrainEnd => {
                self.current = None;
                vars.push(("hype.active", json!(false)));
                vars.push(("hype.last_level", json!(level)));
                vars.push(("hype.ended_at", json!(now_ms)));
                vars.push(("hype.ends_at", json!(0)));
                HypeChange::Ended
            }
            kind => {
                let change = match (&self.current, kind) {
                    (_, EventKind::HypeTrainBegin) => HypeChange::Began,
                    (Some((cur, from)), _) if (*cur == id || id.is_empty()) && level > *from => {
                        HypeChange::LevelUp {
                            from: *from,
                            to: level,
                        }
                    }
                    _ => HypeChange::Progress,
                };
                self.current = Some((id.clone(), level));
                let goal = u64_of(e, "goal").unwrap_or(0);
                let progress = u64_of(e, "progress").unwrap_or(0);
                let percent = (progress.min(goal) * 100).checked_div(goal).unwrap_or(0);
                vars.push(("hype.active", json!(true)));
                vars.push(("hype.goal", json!(goal)));
                vars.push(("hype.progress", json!(progress)));
                vars.push(("hype.percent", json!(percent)));
                vars.push(("hype.started_at", json!(i64_of(e, "started_at"))));
                vars.push(("hype.ends_at", json!(i64_of(e, "expires_at"))));
                if let Some(record) = u64_of(e, "record_level") {
                    vars.push(("hype.record_level", json!(record)));
                }
                change
            }
        };
        let (bits_name, bits) = top_of(e, "bits");
        let (sub_name, subs) = top_of(e, "subscription");
        let shared_with: Vec<&str> = e
            .data
            .get("shared_with")
            .and_then(Value::as_array)
            .map(|l| l.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        vars.extend([
            ("hype.id", json!(id)),
            ("hype.level", json!(level)),
            ("hype.total", json!(total)),
            (
                "hype.type",
                e.data
                    .get("train_type")
                    .cloned()
                    .unwrap_or("regular".into()),
            ),
            (
                "hype.shared",
                json!(e.data.get("is_shared").and_then(Value::as_bool) == Some(true)),
            ),
            ("hype.shared_with", json!(shared_with.join(", "))),
            (
                "hype.top",
                e.data
                    .get("top_contributions")
                    .cloned()
                    .unwrap_or(json!([])),
            ),
            ("hype.top_bits_name", json!(bits_name)),
            ("hype.top_bits", json!(bits)),
            ("hype.top_sub_name", json!(sub_name)),
            ("hype.top_subs", json!(subs)),
        ]);
        Some(HypeUpdate { change, vars })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn train(kind: EventKind, id: &str, level: u64, progress: u64, goal: u64) -> Event {
        let mut e = Event::new(kind);
        e.data.insert("hype_train_id".into(), id.into());
        e.data.insert("level".into(), json!(level));
        e.data.insert("progress".into(), json!(progress));
        e.data.insert("goal".into(), json!(goal));
        e.data
            .insert("total".into(), json!(progress + level * 1000));
        e.data.insert("expires_at".into(), json!(5_000));
        e.data.insert(
            "top_contributions".into(),
            json!([
                { "name": "PogChamp", "login": "pogchamp", "type": "bits", "total": 800 },
                { "name": "Kappa", "login": "kappa", "type": "subscription", "total": 500 }
            ]),
        );
        e
    }

    fn vars(u: &HypeUpdate) -> HashMap<&'static str, Value> {
        u.vars.iter().cloned().collect()
    }

    #[test]
    fn other_events_are_ignored() {
        let mut t = HypeTracker::new();
        assert!(t.apply(&Event::new(EventKind::Follow), 0).is_none());
    }

    #[test]
    fn begin_progress_level_up_end() {
        let mut t = HypeTracker::new();
        let b = t
            .apply(&train(EventKind::HypeTrainBegin, "a", 1, 150, 600), 1)
            .unwrap();
        assert_eq!(b.change, HypeChange::Began);
        let v = vars(&b);
        assert_eq!(v["hype.active"], true);
        assert_eq!(v["hype.level"], 1);
        assert_eq!(v["hype.progress"], 150);
        assert_eq!(v["hype.goal"], 600);
        assert_eq!(v["hype.percent"], 25);
        assert_eq!(v["hype.ends_at"], 5_000);
        assert_eq!(v["hype.type"], "regular");
        assert_eq!(v["hype.top_bits_name"], "PogChamp");
        assert_eq!(v["hype.top_bits"], 800);
        assert_eq!(v["hype.top_sub_name"], "Kappa");

        let same = t
            .apply(&train(EventKind::HypeTrainProgress, "a", 1, 400, 600), 2)
            .unwrap();
        assert_eq!(same.change, HypeChange::Progress);

        let up = t
            .apply(&train(EventKind::HypeTrainProgress, "a", 3, 10, 900), 3)
            .unwrap();
        assert_eq!(up.change, HypeChange::LevelUp { from: 1, to: 3 });
        assert_eq!(vars(&up)["hype.percent"], 1);

        // A late event with a lower level is no level up.
        let late = t
            .apply(&train(EventKind::HypeTrainProgress, "a", 2, 500, 700), 4)
            .unwrap();
        assert_eq!(late.change, HypeChange::Progress);

        let end = t
            .apply(&train(EventKind::HypeTrainEnd, "a", 3, 0, 0), 99)
            .unwrap();
        assert_eq!(end.change, HypeChange::Ended);
        let v = vars(&end);
        assert_eq!(v["hype.active"], false);
        assert_eq!(v["hype.last_level"], 3);
        assert_eq!(v["hype.ended_at"], 99);
        assert_eq!(v["hype.ends_at"], 0);
        assert!(!v.contains_key("hype.goal"), "the end event has no goal");
    }

    #[test]
    fn a_new_train_or_a_missed_begin_is_no_level_up() {
        let mut t = HypeTracker::new();
        let first = t
            .apply(&train(EventKind::HypeTrainProgress, "a", 2, 1, 2), 0)
            .unwrap();
        assert_eq!(first.change, HypeChange::Progress, "started mid-train");
        assert_eq!(vars(&first)["hype.active"], true);
        let other = t
            .apply(&train(EventKind::HypeTrainProgress, "b", 4, 1, 2), 0)
            .unwrap();
        assert_eq!(other.change, HypeChange::Progress, "a different train");
        let begin = t
            .apply(&train(EventKind::HypeTrainBegin, "c", 2, 1, 2), 0)
            .unwrap();
        assert_eq!(begin.change, HypeChange::Began);
    }

    #[test]
    fn v2_types_and_shared_trains() {
        let mut t = HypeTracker::new();
        let mut e = train(EventKind::HypeTrainBegin, "a", 1, 0, 100);
        e.data.insert("train_type".into(), "treasure".into());
        e.data.insert("is_shared".into(), true.into());
        e.data
            .insert("shared_with".into(), json!(["Cool_User", "Pal_User"]));
        e.data.insert("record_level".into(), json!(6));
        let v = vars(&t.apply(&e, 0).unwrap());
        assert_eq!(v["hype.type"], "treasure");
        assert_eq!(v["hype.shared"], true);
        assert_eq!(v["hype.shared_with"], "Cool_User, Pal_User");
        assert_eq!(v["hype.record_level"], 6);
        assert_eq!(v["hype.percent"], 0);
    }
}
