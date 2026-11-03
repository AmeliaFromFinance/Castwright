//! Discord webhooks: a post when the stream goes live, a summary when it ends,
//! and plain messages from actions.
//!
//! Webhook URLs are secrets. They stay in the keychain and never go into
//! settings, backups, exports or portable copies.

mod payload;
#[cfg(test)]
mod tests;

pub use payload::{Channel, clean_mention, clean_url};

use crate::error::{AppError, AppResult, user_err};
use crate::hub::Hub;
use crate::model::runtime::LogLevel;
use crate::model::session::{SessionSummary, StreamSession};
use crate::model::settings::{DiscordSettings, DiscordWebhook};
use crate::services::DiscordActions;
use crate::store::secrets::Secrets;
use crate::store::settings::SettingsStore;
use async_trait::async_trait;
use reqwest::Method;
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

pub const MAX_WEBHOOKS: usize = 10;
const MAX_TEMPLATE: usize = 2000;
const MAX_NAME: usize = 80;
/// The end post waits this long, so a quick reconnect continues the stream instead.
pub const END_DELAY_MS: i64 = crate::sessions::MERGE_MS;
/// End posts this late are dropped (the app was closed for a long time).
const END_STALE_MS: i64 = 6 * 3_600_000;
const MAX_TRIES: u32 = 3;

const LIVE: &str = "live";
const END: &str = "end";
const EDITED: &str = "edited";

pub fn secret_key(webhook_id: &str) -> String {
    format!("discord.webhook.{webhook_id}")
}

#[derive(Debug, Clone, PartialEq)]
pub enum SendError {
    /// 404 or 401: the webhook was deleted or its link is wrong.
    Gone,
    RateLimited,
    Network,
    Api {
        status: u16,
        message: String,
    },
}

impl SendError {
    pub fn explain(&self, name: &str) -> String {
        match self {
            SendError::Gone => format!(
                "The Discord webhook \"{name}\" no longer exists. It was deleted in Discord, or the link is wrong. Paste a new link in Settings → Discord."
            ),
            SendError::RateLimited => {
                format!("Discord asked to slow down, so the post to \"{name}\" was skipped.")
            }
            SendError::Network => format!(
                "Couldn't reach Discord to post to \"{name}\". Check your internet connection."
            ),
            SendError::Api { status, message } if message.is_empty() => {
                format!("Discord refused the post to \"{name}\" (error {status}).")
            }
            SendError::Api { status, message } => {
                format!("Discord refused the post to \"{name}\" (error {status}): {message}")
            }
        }
    }
}

pub struct Discord {
    hub: Arc<Hub>,
    settings: Arc<SettingsStore>,
    secrets: Arc<Secrets>,
    http: reqwest::Client,
    /// Longest wait for a rate limit before giving up.
    max_wait: Duration,
}

impl Discord {
    pub fn new(hub: Arc<Hub>, settings: Arc<SettingsStore>, secrets: Arc<Secrets>) -> Arc<Self> {
        Self::build(hub, settings, secrets, Duration::from_secs(30))
    }

    pub(crate) fn build(
        hub: Arc<Hub>,
        settings: Arc<SettingsStore>,
        secrets: Arc<Secrets>,
        max_wait: Duration,
    ) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("Castwright/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Arc::new(Discord {
            hub,
            settings,
            secrets,
            http,
            max_wait,
        })
    }

    fn url(&self, id: &str) -> Option<String> {
        self.secrets.get(&secret_key(id)).filter(|u| !u.is_empty())
    }

    /// Sets `has_url` from the keychain.
    pub fn fill_has_url(&self, d: &mut DiscordSettings) {
        for w in &mut d.webhooks {
            w.has_url = self.url(&w.id).is_some();
        }
    }

    fn webhooks(&self) -> Vec<DiscordWebhook> {
        let mut d = self.settings.get().discord;
        self.fill_has_url(&mut d);
        d.webhooks
    }

    fn webhook(&self, id: &str) -> AppResult<(DiscordWebhook, String)> {
        let hook = self
            .webhooks()
            .into_iter()
            .find(|w| w.id == id)
            .ok_or_else(|| AppError::User("That Discord webhook was removed.".into()))?;
        let url = self.url(id).ok_or_else(|| {
            AppError::User(format!(
                "\"{}\" has no webhook link yet. Paste one in Settings → Discord.",
                hook.name
            ))
        })?;
        Ok((hook, url))
    }

    /// Adds or updates a webhook. `url`: None keeps the saved link, empty removes it.
    pub fn save_webhook(
        &self,
        mut hook: DiscordWebhook,
        url: Option<String>,
    ) -> AppResult<DiscordWebhook> {
        hook.name = hook.name.trim().chars().take(MAX_NAME).collect();
        if hook.name.is_empty() {
            hook.name = "Discord".into();
        }
        if hook.id.trim().is_empty() {
            hook.id = crate::util::new_id();
        }
        for t in [&hook.live_template, &hook.end_template] {
            if t.chars().count() > MAX_TEMPLATE {
                return user_err(format!(
                    "Keep each message under {MAX_TEMPLATE} characters."
                ));
            }
        }
        hook.mention = clean_mention(&hook.mention).map_err(AppError::User)?;
        let exists = self
            .settings
            .get()
            .discord
            .webhooks
            .iter()
            .any(|w| w.id == hook.id);
        if !exists && self.settings.get().discord.webhooks.len() >= MAX_WEBHOOKS {
            return user_err(format!("You can add up to {MAX_WEBHOOKS} webhooks."));
        }
        match url.as_deref().map(str::trim) {
            Some("") => self.secrets.delete(&secret_key(&hook.id))?,
            Some(u) => {
                let clean = clean_url(u).map_err(AppError::User)?;
                self.secrets.set(&secret_key(&hook.id), &clean)?;
            }
            None => {}
        }
        hook.has_url = self.url(&hook.id).is_some();
        let saved = hook.clone();
        self.settings.update(|s| {
            let list = &mut s.discord.webhooks;
            match list.iter_mut().find(|w| w.id == saved.id) {
                Some(w) => *w = saved,
                None => list.push(saved),
            }
        })?;
        Ok(hook)
    }

    pub fn delete_webhook(&self, id: &str) -> AppResult<()> {
        self.secrets.delete(&secret_key(id))?;
        self.settings
            .update(|s| s.discord.webhooks.retain(|w| w.id != id))?;
        Ok(())
    }

    /// POST (`message_id` None, waits for the new message) or PATCH an earlier one.
    /// Retries rate limits Discord asks to wait for, up to `max_wait`.
    pub(crate) async fn send(
        &self,
        url: &str,
        message_id: Option<&str>,
        body: &Value,
    ) -> Result<Value, SendError> {
        let (method, target) = match message_id {
            Some(id) => (Method::PATCH, format!("{url}/messages/{id}")),
            None => (Method::POST, format!("{url}?wait=true")),
        };
        let mut tries = 0;
        loop {
            tries += 1;
            let res = self
                .http
                .request(method.clone(), &target)
                .json(body)
                .send()
                .await
                .map_err(|_| SendError::Network)?;
            let status = res.status().as_u16();
            let header_wait = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<f64>().ok());
            let text = res.text().await.unwrap_or_default();
            let json: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            match status {
                200..=299 => return Ok(json),
                429 => {
                    let secs = json
                        .get("retry_after")
                        .and_then(Value::as_f64)
                        .or(header_wait)
                        .unwrap_or(1.0)
                        .clamp(0.0, 3600.0);
                    let wait = Duration::from_secs_f64(secs) + Duration::from_millis(50);
                    if tries >= MAX_TRIES || wait > self.max_wait {
                        return Err(SendError::RateLimited);
                    }
                    tokio::time::sleep(wait).await;
                }
                401 | 404 => return Err(SendError::Gone),
                _ => {
                    let message = json
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    return Err(SendError::Api { status, message });
                }
            }
        }
    }

    /// Sends and writes the outcome to the log. Returns the message id on success.
    async fn deliver(
        &self,
        hook: &DiscordWebhook,
        url: &str,
        message_id: Option<&str>,
        body: &Value,
        what: &str,
    ) -> Result<String, SendError> {
        match self.send(url, message_id, body).await {
            Ok(v) => {
                self.hub.log(
                    LogLevel::Info,
                    "discord",
                    format!("{what} \"{}\"", hook.name),
                );
                Ok(v.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string())
            }
            Err(e) => {
                let level = if e == SendError::Gone {
                    LogLevel::Error
                } else {
                    LogLevel::Warn
                };
                self.hub.log(level, "discord", e.explain(&hook.name));
                Err(e)
            }
        }
    }

    /// A go-live post to check the webhook works. Nobody is pinged.
    pub async fn send_test(&self, id: &str, ch: &Channel) -> AppResult<()> {
        let (hook, url) = self.webhook(id)?;
        let mut body = payload::live_payload(&hook, ch, crate::util::now_ms());
        let text = crate::template::render(
            &hook.live_template,
            &payload::live_context(ch, crate::util::now_ms()),
        );
        body["content"] = Value::String(
            format!("Test post from Castwright. {}", text.trim())
                .trim()
                .to_string(),
        );
        body["allowed_mentions"] = serde_json::json!({ "parse": [] });
        self.deliver(&hook, &url, None, &body, "Sent a test post to")
            .await
            .map(|_| ())
            .map_err(|e| AppError::User(e.explain(&hook.name)))
    }

    // ---------- once per stream ----------

    /// Marks a post as taken for this stream. False when it was already made.
    fn claim(&self, session_id: i64, webhook_id: &str, kind: &str) -> bool {
        self.hub
            .db
            .with_conn(|c| {
                c.execute(
                    "INSERT OR IGNORE INTO discord_posts (session_id, webhook_id, kind, posted_at) VALUES (?1, ?2, ?3, ?4)",
                    params![session_id, webhook_id, kind, crate::util::now_ms()],
                )
            })
            .map(|n| n == 1)
            .unwrap_or(false)
    }

    fn release(&self, session_id: i64, webhook_id: &str, kind: &str) {
        let _ = self.hub.db.with_conn(|c| {
            c.execute(
                "DELETE FROM discord_posts WHERE session_id = ?1 AND webhook_id = ?2 AND kind = ?3",
                params![session_id, webhook_id, kind],
            )
        });
    }

    fn set_message_id(&self, session_id: i64, webhook_id: &str, kind: &str, message_id: &str) {
        let _ = self.hub.db.with_conn(|c| {
            c.execute(
                "UPDATE discord_posts SET message_id = ?4 WHERE session_id = ?1 AND webhook_id = ?2 AND kind = ?3",
                params![session_id, webhook_id, kind, message_id],
            )
        });
    }

    fn message_id(&self, session_id: i64, webhook_id: &str, kind: &str) -> Option<String> {
        self.hub
            .db
            .with_conn(|c| {
                c.query_row(
                    "SELECT message_id FROM discord_posts WHERE session_id = ?1 AND webhook_id = ?2 AND kind = ?3",
                    params![session_id, webhook_id, kind],
                    |r| r.get::<_, String>(0),
                )
                .optional()
            })
            .ok()
            .flatten()
            .filter(|m| !m.is_empty())
    }

    /// The stream started (or a session continued after a quick reconnect, which
    /// was already posted). Each webhook posts at most once per session.
    pub async fn on_started(&self, session: &StreamSession, ch: Option<&Channel>) {
        let hooks: Vec<_> = self
            .webhooks()
            .into_iter()
            .filter(|w| w.on_live && w.has_url)
            .collect();
        if hooks.is_empty() {
            return;
        }
        let Some(ch) = ch else {
            self.hub.log(
                LogLevel::Warn,
                "discord",
                "Skipped the go-live post: sign in to Twitch so it can link to your channel.",
            );
            return;
        };
        // A later end post for this session would be stale now.
        let _ = self.hub.db.with_conn(|c| {
            c.execute(
                "DELETE FROM discord_pending WHERE session_id = ?1",
                params![session.id],
            )
        });
        for hook in hooks {
            if !self.claim(session.id, &hook.id, LIVE) {
                continue;
            }
            let Some(url) = self.url(&hook.id) else {
                continue;
            };
            let body = payload::live_payload(&hook, ch, crate::util::now_ms());
            match self
                .deliver(&hook, &url, None, &body, "Posted the go-live message to")
                .await
            {
                Ok(id) => self.set_message_id(session.id, &hook.id, LIVE, &id),
                Err(_) => self.release(session.id, &hook.id, LIVE),
            }
        }
    }

    /// The stream ended. The end post waits a few minutes in case it comes back.
    pub fn on_ended(&self, session: &StreamSession, now: i64) {
        let r = self.hub.db.with_conn(|c| {
            c.execute(
                "INSERT OR REPLACE INTO discord_pending (session_id, due_at) VALUES (?1, ?2)",
                params![session.id, now + END_DELAY_MS],
            )
        });
        if let Err(e) = r {
            tracing::warn!("couldn't queue the Discord end post: {e}");
        }
    }

    fn due(&self, now: i64) -> Vec<(i64, i64)> {
        self.hub
            .db
            .with_conn(|c| {
                let mut st =
                    c.prepare("SELECT session_id, due_at FROM discord_pending WHERE due_at <= ?1")?;
                st.query_map(params![now], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default()
    }

    /// Sends end posts that are due. Call every few seconds.
    pub async fn run_due(&self, ch: Option<&Channel>, now: i64) {
        for (session_id, due_at) in self.due(now) {
            let _ = self.hub.db.with_conn(|c| {
                c.execute(
                    "DELETE FROM discord_pending WHERE session_id = ?1",
                    params![session_id],
                )
            });
            let Ok(Some(summary)) = self.hub.sessions.summary(session_id) else {
                continue;
            };
            // It came back on: the stream goes on, so nothing ended.
            if summary.session.ended_at.is_none() || now - due_at > END_STALE_MS {
                continue;
            }
            let Some(ch) = ch else { continue };
            self.post_end(&summary, ch).await;
        }
    }

    async fn post_end(&self, summary: &SessionSummary, ch: &Channel) {
        let id = summary.session.id;
        for hook in self.webhooks().into_iter().filter(|w| w.has_url) {
            let Some(url) = self.url(&hook.id) else {
                continue;
            };
            if hook.on_end && self.claim(id, &hook.id, END) {
                let body = payload::end_payload(&hook, summary, ch);
                match self
                    .deliver(&hook, &url, None, &body, "Posted the stream summary to")
                    .await
                {
                    Ok(m) => self.set_message_id(id, &hook.id, END, &m),
                    Err(_) => self.release(id, &hook.id, END),
                }
            }
            if hook.edit_on_end
                && let Some(live_msg) = self.message_id(id, &hook.id, LIVE)
                && self.claim(id, &hook.id, EDITED)
            {
                let body = payload::ended_edit(summary, ch);
                if self
                    .deliver(
                        &hook,
                        &url,
                        Some(&live_msg),
                        &body,
                        "Marked the go-live post as ended in",
                    )
                    .await
                    .is_err()
                {
                    self.release(id, &hook.id, EDITED);
                }
            }
        }
    }
}

#[async_trait]
impl DiscordActions for Discord {
    async fn post_text(&self, webhook_id: &str, text: &str) -> AppResult<()> {
        let (hook, url) = self.webhook(webhook_id)?;
        self.deliver(&hook, &url, None, &payload::text_payload(text), "Posted to")
            .await
            .map(|_| ())
            .map_err(|e| AppError::User(e.explain(&hook.name)))
    }
}
