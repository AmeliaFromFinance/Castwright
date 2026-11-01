//! Variables: named values overlays, alerts and actions can read and change.
//! Keys are flat dotted strings such as `last.sub.name` or `counter.deaths`.

use crate::model::event::{Event, EventKind};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

pub type Changes = Map<String, Value>;

#[derive(Default)]
pub struct Vars {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    values: HashMap<String, Value>,
    /// Keys saved to disk.
    persistent: HashSet<String>,
    dirty: bool,
}

/// Prefixes that describe live state and are never saved.
const LIVE_PREFIXES: [&str; 3] = ["stream.", "obs.", "twitch."];

fn is_live_key(key: &str) -> bool {
    LIVE_PREFIXES.iter().any(|p| key.starts_with(p))
}

pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && !key.starts_with('.')
        && !key.ends_with('.')
        && !key.contains("..")
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

impl Vars {
    pub fn new() -> Self {
        Vars::default()
    }

    /// Load saved values. Unknown or invalid keys are skipped.
    pub fn load(&self, saved: Map<String, Value>) {
        let mut g = self.inner.lock().unwrap();
        for (k, v) in saved {
            if valid_key(&k) && !is_live_key(&k) {
                g.persistent.insert(k.clone());
                g.values.insert(k, v);
            }
        }
        g.dirty = false;
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.inner.lock().unwrap().values.get(key).cloned()
    }

    pub fn snapshot(&self) -> Map<String, Value> {
        let g = self.inner.lock().unwrap();
        let mut keys: Vec<_> = g.values.keys().cloned().collect();
        keys.sort();
        keys.into_iter()
            .map(|k| {
                let v = g.values[&k].clone();
                (k, v)
            })
            .collect()
    }

    /// Values to write to disk, or None when nothing changed since the last call.
    pub fn take_dirty(&self) -> Option<Map<String, Value>> {
        let mut g = self.inner.lock().unwrap();
        if !g.dirty {
            return None;
        }
        g.dirty = false;
        let mut out = Map::new();
        let mut keys: Vec<_> = g.persistent.iter().cloned().collect();
        keys.sort();
        for k in keys {
            if let Some(v) = g.values.get(&k) {
                out.insert(k, v.clone());
            }
        }
        Some(out)
    }

    /// Set a value. Returns the change (empty when the value was already the same).
    pub fn set(&self, key: &str, value: Value, persist: bool) -> Changes {
        let mut g = self.inner.lock().unwrap();
        let mut changes = Map::new();
        Self::set_locked(&mut g, key, value, persist, &mut changes);
        changes
    }

    fn set_locked(g: &mut Inner, key: &str, value: Value, persist: bool, changes: &mut Changes) {
        if !valid_key(key) {
            return;
        }
        let persist = persist && !is_live_key(key);
        if persist {
            if g.persistent.insert(key.to_string()) {
                g.dirty = true;
            }
        } else if g.persistent.remove(key) {
            g.dirty = true;
        }
        if g.values.get(key) == Some(&value) {
            return;
        }
        if persist {
            g.dirty = true;
        }
        g.values.insert(key.to_string(), value.clone());
        changes.insert(key.to_string(), value);
    }

    pub fn delete(&self, key: &str) -> Changes {
        let mut g = self.inner.lock().unwrap();
        let mut changes = Map::new();
        if g.values.remove(key).is_some() {
            changes.insert(key.to_string(), Value::Null);
        }
        if g.persistent.remove(key) {
            g.dirty = true;
        }
        changes
    }

    /// Add `amount` to a number variable (missing or non-numeric counts as 0).
    pub fn add(&self, key: &str, amount: f64, persist: bool) -> (f64, Changes) {
        let mut g = self.inner.lock().unwrap();
        let current = g
            .values
            .get(key)
            .and_then(crate::model::condition::as_number)
            .unwrap_or(0.0);
        let next = current + amount;
        let mut changes = Map::new();
        Self::set_locked(&mut g, key, num(next), persist, &mut changes);
        (next, changes)
    }

    /// Reset the `session.*` counters (done automatically when the stream goes live).
    pub fn reset_session(&self) -> Changes {
        let mut g = self.inner.lock().unwrap();
        let mut changes = Map::new();
        for key in SESSION_KEYS {
            Self::set_locked(&mut g, key, num(0.0), true, &mut changes);
        }
        changes
    }

    /// Update the built-in `last.*` and `session.*` values for an event.
    pub fn apply_event(&self, e: &Event) -> Changes {
        let mut g = self.inner.lock().unwrap();
        let mut ch = Map::new();
        let name = Value::String(
            e.user
                .as_ref()
                .map(|u| u.display_name.clone())
                .unwrap_or_else(|| {
                    if e.is_anonymous {
                        "Anonymous".into()
                    } else {
                        String::new()
                    }
                }),
        );
        let amount = e.amount.map(num).unwrap_or(Value::Null);
        let mut bump: Vec<(&str, f64)> = Vec::new();
        if e.kind == EventKind::StreamOnline {
            for key in SESSION_KEYS {
                Self::set_locked(&mut g, key, num(0.0), true, &mut ch);
            }
            return ch;
        }
        let mut set = |k: &str, v: Value| Self::set_locked(&mut g, k, v, true, &mut ch);
        match e.kind {
            EventKind::Follow => {
                set("last.follow.name", name.clone());
                bump.push(("session.follows", 1.0));
            }
            EventKind::Sub | EventKind::Resub => {
                set("last.sub.name", name.clone());
                set(
                    "last.sub.tier",
                    e.tier.map(|t| num(t as f64)).unwrap_or(Value::Null),
                );
                set(
                    "last.sub.months",
                    e.months.map(|m| num(m as f64)).unwrap_or(Value::Null),
                );
                bump.push(("session.subs", 1.0));
            }
            EventKind::GiftSub => {
                // Gifts that belong to a community gift keep its total in last.gift.amount.
                if !e.data.contains_key("community_gift_id") {
                    set("last.gift.name", name.clone());
                    set("last.gift.amount", num(1.0));
                }
                set(
                    "last.sub.name",
                    Value::String(
                        e.recipient
                            .as_ref()
                            .map(|u| u.display_name.clone())
                            .unwrap_or_default(),
                    ),
                );
                bump.push(("session.subs", 1.0));
                bump.push(("session.gifts", 1.0));
            }
            EventKind::CommunityGift => {
                set("last.gift.name", name.clone());
                set("last.gift.amount", amount.clone());
            }
            EventKind::Cheer => {
                set("last.cheer.name", name.clone());
                set("last.cheer.amount", amount.clone());
                bump.push(("session.bits", e.amount.unwrap_or(0.0)));
            }
            EventKind::Raid => {
                set("last.raid.name", name.clone());
                set("last.raid.viewers", amount.clone());
                bump.push(("session.raids", 1.0));
            }
            EventKind::Redemption => {
                set("last.redemption.name", name.clone());
                set(
                    "last.redemption.reward",
                    e.data.get("reward_title").cloned().unwrap_or(Value::Null),
                );
            }
            EventKind::Charity => {
                set("last.donation.name", name.clone());
                set("last.donation.amount", amount.clone());
                bump.push(("session.donations", e.amount.unwrap_or(0.0)));
            }
            _ => {}
        }
        if e.kind.is_alertable() {
            set("last.event.name", name);
            set("last.event.kind", Value::String(e.kind.as_str().into()));
        }
        for (key, by) in bump {
            let current = g
                .values
                .get(key)
                .and_then(crate::model::condition::as_number)
                .unwrap_or(0.0);
            Self::set_locked(&mut g, key, num(current + by), true, &mut ch);
        }
        ch
    }
}

pub const SESSION_KEYS: [&str; 6] = [
    "session.follows",
    "session.subs",
    "session.gifts",
    "session.bits",
    "session.raids",
    "session.donations",
];

/// Whole numbers are stored as integers so templates show `3`, not `3.0`.
pub fn num(n: f64) -> Value {
    if n.is_finite() && n == n.trunc() && n.abs() < 9e15 {
        Value::from(n as i64)
    } else {
        serde_json::Number::from_f64(n)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::event::EventUser;

    fn ev(kind: EventKind) -> Event {
        let mut e = Event::new(kind);
        e.user = Some(EventUser {
            id: "1".into(),
            login: "nova".into(),
            display_name: "Nova".into(),
        });
        e
    }

    #[test]
    fn set_reports_only_real_changes() {
        let v = Vars::new();
        assert_eq!(v.set("a", Value::from(1), false).len(), 1);
        assert!(v.set("a", Value::from(1), false).is_empty());
        assert!(v.set("bad key", Value::from(1), false).is_empty());
        assert!(v.get("bad key").is_none());
    }

    #[test]
    fn add_treats_missing_as_zero() {
        let v = Vars::new();
        assert_eq!(v.add("counter.deaths", 1.0, true).0, 1.0);
        assert_eq!(v.add("counter.deaths", 2.0, true).0, 3.0);
        v.set("text", Value::from("abc"), false);
        assert_eq!(v.add("text", 1.0, false).0, 1.0);
        assert_eq!(v.get("counter.deaths"), Some(Value::from(3)));
    }

    #[test]
    fn persistence_only_saves_flagged_keys() {
        let v = Vars::new();
        v.set("keep", Value::from(1), true);
        v.set("temp", Value::from(1), false);
        v.set("stream.title", Value::from("x"), true);
        let saved = v.take_dirty().unwrap();
        assert!(saved.contains_key("keep"));
        assert!(!saved.contains_key("temp"));
        assert!(!saved.contains_key("stream.title"));
        assert!(v.take_dirty().is_none());
        v.set("temp", Value::from(2), false);
        assert!(v.take_dirty().is_none());
        v.delete("keep");
        assert!(v.take_dirty().unwrap().is_empty());
    }

    #[test]
    fn events_update_built_ins() {
        let v = Vars::new();
        let mut sub = ev(EventKind::Sub);
        sub.tier = Some(3);
        v.apply_event(&sub);
        let mut cheer = ev(EventKind::Cheer);
        cheer.amount = Some(100.0);
        v.apply_event(&cheer);
        v.apply_event(&cheer);
        assert_eq!(v.get("last.sub.name"), Some(Value::from("Nova")));
        assert_eq!(v.get("last.sub.tier"), Some(Value::from(3)));
        assert_eq!(v.get("session.subs"), Some(Value::from(1)));
        assert_eq!(v.get("session.bits"), Some(Value::from(200)));
        assert_eq!(v.get("last.event.kind"), Some(Value::from("cheer")));
        v.reset_session();
        assert_eq!(v.get("session.bits"), Some(Value::from(0)));
    }

    #[test]
    fn community_gift_does_not_double_count() {
        let v = Vars::new();
        let mut community = ev(EventKind::CommunityGift);
        community.amount = Some(5.0);
        v.apply_event(&community);
        for _ in 0..5 {
            v.apply_event(&ev(EventKind::GiftSub));
        }
        assert_eq!(v.get("session.subs"), Some(Value::from(5)));
        assert_eq!(v.get("session.gifts"), Some(Value::from(5)));
    }

    #[test]
    fn going_live_resets_session() {
        let v = Vars::new();
        v.apply_event(&ev(EventKind::Follow));
        assert_eq!(v.get("session.follows"), Some(Value::from(1)));
        v.apply_event(&Event::new(EventKind::StreamOnline));
        assert_eq!(v.get("session.follows"), Some(Value::from(0)));
        assert_eq!(
            v.get("last.follow.name"),
            Some(Value::from("Nova")),
            "last.* is kept"
        );
    }

    #[test]
    fn load_skips_bad_keys() {
        let v = Vars::new();
        let mut m = Map::new();
        m.insert("ok".into(), Value::from(1));
        m.insert("bad key".into(), Value::from(1));
        m.insert("obs.scene".into(), Value::from("x"));
        v.load(m);
        assert!(v.get("ok").is_some());
        assert!(v.get("bad key").is_none());
        assert!(v.get("obs.scene").is_none());
    }

    #[test]
    fn number_storage() {
        assert_eq!(num(3.0), Value::from(3));
        assert_eq!(num(2.5), serde_json::json!(2.5));
        assert_eq!(num(f64::NAN), Value::Null);
    }
}
