//! Live stream info: polled from Helix and kept in status and `stream.*` variables.

use super::TwitchService;
use super::normalize::{num_of, parse_rfc3339, str_of};
use crate::model::event::{Event, EventKind};
use crate::model::runtime::{AccountRole, LogLevel, StreamInfo};
use reqwest::Method;
use serde_json::{Value, json};
use std::sync::Arc;

/// How long a stream.online/offline event outranks what Helix says.
const HINT_MS: i64 = 3 * 60 * 1000;

pub fn uptime_text(started_at: i64, now: i64) -> String {
    if started_at <= 0 {
        return String::new();
    }
    let mins = (now - started_at).max(0) / 60_000;
    let (h, m) = (mins / 60, mins % 60);
    if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

fn tags(v: &Value) -> Vec<String> {
    v.get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

impl TwitchService {
    pub(crate) async fn stream_loop(self: Arc<Self>) {
        let mut tick: u32 = 0;
        loop {
            if tick.is_multiple_of(2) {
                self.poll_stream().await;
            } else {
                let info = self.status().stream;
                self.publish_stream_vars(&info);
            }
            tokio::select! {
                _ = tokio::time::sleep(self.timing.stream_tick) => tick = tick.wrapping_add(1),
                _ = self.stream_poke.notified() => tick = 0,
            }
        }
    }

    pub(crate) async fn poll_stream(&self) {
        let Some(id) = self.broadcaster_id() else {
            return;
        };
        match self.fetch_stream(&id).await {
            Ok(mut info) => {
                let was_failing = {
                    let mut st = self.state.lock().unwrap();
                    if let Some((live, at)) = st.stream_hint
                        && crate::util::now_ms() - at < HINT_MS
                        && info.live != live
                    {
                        info.live = live;
                        if live {
                            info.started_at = st.status.stream.started_at;
                        } else {
                            info.viewers = 0;
                            info.started_at = 0;
                        }
                    }
                    std::mem::replace(&mut st.stream_failing, false)
                };
                if was_failing {
                    self.hub
                        .log(LogLevel::Info, "twitch", "Stream info is updating again");
                }
                self.set_stream(info);
            }
            Err(msg) => {
                let first =
                    !std::mem::replace(&mut self.state.lock().unwrap().stream_failing, true);
                if first {
                    self.hub.log(
                        LogLevel::Warn,
                        "twitch",
                        format!("Couldn't update stream info: {msg}"),
                    );
                }
            }
        }
    }

    async fn fetch_stream(&self, id: &str) -> Result<StreamInfo, String> {
        let streams = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/streams",
                &[("user_id", id.to_string())],
                None,
            )
            .await
            .map_err(|e| e.explain("read stream info"))?;
        if let Some(s) = Self::first(&streams).filter(|s| str_of(s, "type") == "live") {
            return Ok(StreamInfo {
                live: true,
                viewers: num_of(s, "viewer_count") as u32,
                title: str_of(s, "title"),
                category: str_of(s, "game_name"),
                category_id: str_of(s, "game_id"),
                tags: tags(s),
                started_at: parse_rfc3339(&str_of(s, "started_at")).unwrap_or(0),
            });
        }
        let channels = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/channels",
                &[("broadcaster_id", id.to_string())],
                None,
            )
            .await
            .map_err(|e| e.explain("read channel info"))?;
        let c = Self::first(&channels).cloned().unwrap_or_default();
        Ok(StreamInfo {
            live: false,
            viewers: 0,
            title: str_of(&c, "title"),
            category: str_of(&c, "game_name"),
            category_id: str_of(&c, "game_id"),
            tags: tags(&c),
            started_at: 0,
        })
    }

    /// Applies stream.online/offline and channel.update right away; Helix catches up later.
    pub(crate) fn on_stream_event(&self, e: &Event) {
        let mut info = self.status().stream;
        let now = crate::util::now_ms();
        match e.kind {
            EventKind::StreamOnline => {
                info.live = true;
                info.started_at = e
                    .data
                    .get("started_at")
                    .and_then(Value::as_i64)
                    .unwrap_or(now);
                self.state.lock().unwrap().stream_hint = Some((true, now));
                self.stream_poke.notify_one();
            }
            EventKind::StreamOffline => {
                info.live = false;
                info.viewers = 0;
                info.started_at = 0;
                self.state.lock().unwrap().stream_hint = Some((false, now));
                self.stream_poke.notify_one();
            }
            EventKind::ChannelUpdate => {
                let get = |k: &str| {
                    e.data
                        .get(k)
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                };
                info.title = get("title");
                info.category = get("category_name");
                info.category_id = get("category_id");
            }
            _ => return,
        }
        self.set_stream(info);
    }

    fn set_stream(&self, info: StreamInfo) {
        self.state.lock().unwrap().stream_known = true;
        let copy = info.clone();
        self.update_status(|s| s.stream = copy);
        self.publish_stream_vars(&info);
    }

    pub(crate) fn publish_stream_vars(&self, info: &StreamInfo) {
        let uptime = if info.live {
            uptime_text(info.started_at, crate::util::now_ms())
        } else {
            String::new()
        };
        let values = [
            ("stream.live", json!(info.live)),
            ("stream.viewers", json!(info.viewers)),
            ("stream.title", json!(info.title)),
            ("stream.category", json!(info.category)),
            ("stream.started_at", json!(info.started_at)),
            ("stream.uptime_text", json!(uptime)),
        ];
        for (k, v) in values {
            self.hub.set_var(k, v, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uptime() {
        assert_eq!(uptime_text(0, 1_000_000), "");
        assert_eq!(uptime_text(1, 1), "0m");
        assert_eq!(uptime_text(1000, 1000 + 23 * 60_000 + 59_000), "23m");
        assert_eq!(uptime_text(1000, 1000 + 83 * 60_000), "1h 23m");
        assert_eq!(uptime_text(1000, 1000 + 26 * 3_600_000), "26h 0m");
    }
}
