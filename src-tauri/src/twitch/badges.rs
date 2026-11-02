//! Twitch chat badge images from Helix, kept per signed-in channel.

use super::TwitchService;
use super::normalize::str_of;
use crate::model::runtime::{AccountRole, LogLevel};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BadgeImage {
    pub title: String,
    pub url_1x: String,
    pub url_2x: String,
    pub url_4x: String,
}

/// Keyed by (set id, version id).
pub type BadgeMap = HashMap<(String, String), BadgeImage>;

#[derive(Debug, Default)]
pub struct BadgeCache {
    pub global: BadgeMap,
    /// Channel badges (sub, bits) replace global ones with the same key.
    pub channel: BadgeMap,
}

impl BadgeCache {
    pub fn get(&self, set_id: &str, id: &str) -> Option<&BadgeImage> {
        let key = (set_id.to_string(), id.to_string());
        self.channel.get(&key).or_else(|| self.global.get(&key))
    }

    pub fn is_empty(&self) -> bool {
        self.global.is_empty() && self.channel.is_empty()
    }
}

/// Reads a `GET /chat/badges` or `/chat/badges/global` reply.
pub fn parse(v: &Value) -> BadgeMap {
    let mut out = BadgeMap::new();
    let sets = v.get("data").and_then(Value::as_array);
    for set in sets.into_iter().flatten() {
        let set_id = str_of(set, "set_id");
        let versions = set.get("versions").and_then(Value::as_array);
        for ver in versions.into_iter().flatten() {
            let id = str_of(ver, "id");
            let url_1x = str_of(ver, "image_url_1x");
            if set_id.is_empty() || id.is_empty() || url_1x.is_empty() {
                continue;
            }
            let pick = |k: &str| match str_of(ver, k) {
                s if s.is_empty() => url_1x.clone(),
                s => s,
            };
            let image = BadgeImage {
                title: str_of(ver, "title"),
                url_2x: pick("image_url_2x"),
                url_4x: pick("image_url_4x"),
                url_1x: url_1x.clone(),
            };
            out.insert((set_id.clone(), id), image);
        }
    }
    out
}

/// Images for the badges on an EventSub chat message, in order. Unknown badges are left out.
pub fn resolve(badges: Option<&Value>, cache: &BadgeCache) -> Vec<Value> {
    badges
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let (set_id, id) = (str_of(b, "set_id"), str_of(b, "id"));
            let img = cache.get(&set_id, &id)?;
            Some(json!({
                "set_id": set_id,
                "id": id,
                "title": img.title,
                "url_1x": img.url_1x,
                "url_2x": img.url_2x,
                "url_4x": img.url_4x,
            }))
        })
        .collect()
}

/// Wait before trying again after a failed fetch.
const RETRY: Duration = Duration::from_secs(5 * 60);

impl TwitchService {
    pub(crate) async fn badge_loop(self: Arc<Self>) {
        let mut failing = false;
        loop {
            let wait = match self.fetch_badges().await {
                Ok(()) => {
                    failing = false;
                    self.timing.badge_refresh
                }
                Err(msg) => {
                    if !std::mem::replace(&mut failing, true) {
                        self.hub.log(
                            LogLevel::Warn,
                            "twitch",
                            format!("Couldn't load chat badges: {msg}"),
                        );
                    }
                    RETRY.min(self.timing.badge_refresh)
                }
            };
            tokio::time::sleep(wait).await;
        }
    }

    pub(crate) async fn fetch_badges(&self) -> Result<(), String> {
        let id = self.broadcaster_id().ok_or("not signed in")?;
        let global = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/chat/badges/global",
                &[],
                None,
            )
            .await
            .map_err(|e| e.explain("read chat badges"))?;
        let channel = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/chat/badges",
                &[("broadcaster_id", id)],
                None,
            )
            .await
            .map_err(|e| e.explain("read chat badges"))?;
        let mut cache = self.badges.lock().unwrap();
        cache.global = parse(&global);
        cache.channel = parse(&channel);
        Ok(())
    }

    /// Adds `badge_images` to a chat event from its raw EventSub payload.
    pub(crate) fn attach_badges(&self, data: &mut serde_json::Map<String, Value>, raw: &Value) {
        let cache = self.badges.lock().unwrap();
        if cache.is_empty() {
            return;
        }
        data.insert(
            "badge_images".into(),
            resolve(raw.get("badges"), &cache).into(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::twitch::normalize_tests::fixture;

    #[test]
    fn parses_helix_badges() {
        let map = parse(&fixture("badges_global"));
        let vip = &map[&("vip".to_string(), "1".to_string())];
        assert_eq!(vip.title, "VIP");
        assert!(vip.url_1x.ends_with("/1"));
        assert!(vip.url_4x.ends_with("/3"));
        assert!(map.contains_key(&("subscriber".to_string(), "0".to_string())));
        assert!(parse(&json!({"data": [{"set_id": "x", "versions": [{"id": "1"}]}]})).is_empty());
        assert!(parse(&Value::Null).is_empty());
    }

    #[test]
    fn channel_badges_win_and_unknown_are_skipped() {
        let cache = BadgeCache {
            global: parse(&fixture("badges_global")),
            channel: parse(&fixture("badges_channel")),
        };
        let raw = json!([
            { "set_id": "moderator", "id": "1", "info": "" },
            { "set_id": "subscriber", "id": "12", "info": "16" },
            { "set_id": "mystery", "id": "1", "info": "" }
        ]);
        let out = resolve(Some(&raw), &cache);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["set_id"], "moderator");
        assert_eq!(out[1]["set_id"], "subscriber");
        assert_eq!(out[1]["title"], "1-Year Subscriber");
        assert!(
            out[1]["url_2x"]
                .as_str()
                .unwrap()
                .contains("channel-sub-12")
        );
        assert!(resolve(None, &cache).is_empty());
    }
}
