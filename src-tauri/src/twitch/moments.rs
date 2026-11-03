//! Stream markers and clips.

use super::TwitchService;
use super::normalize::str_of;
use crate::error::{AppError, AppResult};
use crate::model::runtime::AccountRole;
use crate::model::session::ClipEntry;
use reqwest::Method;
use serde_json::{Value, json};

pub const MAX_MARKER: usize = 140;
pub const MARKERS_OFFLINE: &str = "Markers only work while you're live.";
pub const CLIPS_OFFLINE: &str = "Clips only work while you're live.";

#[derive(Debug, Clone, PartialEq)]
pub struct NewMarker {
    pub id: String,
    pub position_s: u32,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewClip {
    pub id: String,
    pub edit_url: String,
}

/// The public link of a clip. It works once Twitch has finished making it.
pub fn clip_url(id: &str) -> String {
    format!("https://clips.twitch.tv/{id}")
}

pub(crate) fn parse_marker(v: &Value, description: &str) -> Option<NewMarker> {
    let m = TwitchService::first(v)?;
    let id = str_of(m, "id");
    if id.is_empty() {
        return None;
    }
    let position_s = m
        .get("position_seconds")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32;
    let text = str_of(m, "description");
    Some(NewMarker {
        id,
        position_s,
        description: if text.is_empty() {
            description.to_string()
        } else {
            text
        },
    })
}

pub(crate) fn parse_new_clip(v: &Value) -> Option<NewClip> {
    let c = TwitchService::first(v)?;
    let id = str_of(c, "id");
    (!id.is_empty()).then(|| NewClip {
        id,
        edit_url: str_of(c, "edit_url"),
    })
}

/// A finished clip from Get Clips, or None while Twitch is still making it.
pub(crate) fn parse_clip(v: &Value) -> Option<(String, String)> {
    let c = TwitchService::first(v)?;
    let url = str_of(c, "url");
    (!url.is_empty()).then(|| (url, str_of(c, "title")))
}

impl TwitchService {
    /// Fails early when Twitch already says the stream is offline.
    fn require_live(&self, message: &str) -> AppResult<()> {
        if self.stream_known() && !self.status().stream.live {
            return Err(AppError::User(message.into()));
        }
        Ok(())
    }

    /// Add a marker and keep it with the stream session.
    pub async fn add_marker(&self, description: &str) -> AppResult<NewMarker> {
        let id = self.require_broadcaster()?;
        self.require_live(MARKERS_OFFLINE)?;
        let description: String = description.trim().chars().take(MAX_MARKER).collect();
        let body = json!({ "user_id": id, "description": description });
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/streams/markers",
                &[],
                Some(&body),
            )
            .await
            .map_err(|e| match e.status() {
                Some(404) => AppError::User(MARKERS_OFFLINE.into()),
                _ => e.into_app("add stream markers"),
            })?;
        let m = parse_marker(&v, &description).unwrap_or(NewMarker {
            id: String::new(),
            position_s: 0,
            description,
        });
        self.hub
            .sessions
            .on_marker(&m.id, m.position_s, &m.description);
        Ok(m)
    }

    /// Ask Twitch for a clip and keep it with the stream session.
    pub async fn start_clip(&self) -> AppResult<NewClip> {
        let id = self.require_broadcaster()?;
        self.require_live(CLIPS_OFFLINE)?;
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/clips",
                &[("broadcaster_id", id)],
                None,
            )
            .await
            .map_err(|e| match e.status() {
                Some(404) => AppError::User(CLIPS_OFFLINE.into()),
                _ => e.into_app("make clips"),
            })?;
        let clip = parse_new_clip(&v)
            .ok_or_else(|| AppError::Twitch("Twitch didn't return the new clip.".into()))?;
        self.hub.sessions.on_clip(&clip.id, &clip_url(&clip.id));
        Ok(clip)
    }

    /// Check Get Clips until the clip has a link, for up to `clip_wait`.
    /// None when Twitch is still busy after that.
    pub async fn wait_for_clip(&self, id: &str) -> Option<ClipEntry> {
        let started = tokio::time::Instant::now();
        loop {
            tokio::time::sleep(self.timing.clip_poll).await;
            let found = self
                .helix(
                    AccountRole::Broadcaster,
                    Method::GET,
                    "/clips",
                    &[("id", id.to_string())],
                    None,
                )
                .await
                .ok()
                .and_then(|v| parse_clip(&v));
            if let Some((url, title)) = found {
                if let Err(e) = self.hub.sessions.clip_ready(id, &url, &title) {
                    tracing::warn!("couldn't save clip {id}: {e}");
                }
                return Some(ClipEntry {
                    ts: crate::util::now_ms(),
                    id: id.to_string(),
                    title,
                    url,
                });
            }
            if started.elapsed() + self.timing.clip_poll > self.timing.clip_wait {
                return None;
            }
        }
    }
}
