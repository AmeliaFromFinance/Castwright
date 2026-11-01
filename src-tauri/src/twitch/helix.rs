//! Helix API calls with token refresh, rate limit handling and readable errors.

use super::{NO_CLIENT_ID, SIGNED_OUT, TwitchService};
use crate::error::AppError;
use crate::model::runtime::AccountRole;
use reqwest::Method;
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum HelixError {
    NotSignedIn,
    SignedOut,
    NoClientId,
    Network,
    Api { status: u16, message: String },
}

impl HelixError {
    pub fn status(&self) -> Option<u16> {
        match self {
            HelixError::Api { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            HelixError::Api { message, .. } => message,
            _ => "",
        }
    }

    /// A message a streamer can act on. `what` completes "permission to ...",
    /// e.g. "read follows".
    pub fn explain(&self, what: &str) -> String {
        match self {
            HelixError::NotSignedIn => "Sign in to Twitch first.".into(),
            HelixError::SignedOut => SIGNED_OUT.into(),
            HelixError::NoClientId => NO_CLIENT_ID.into(),
            HelixError::Network => "Couldn't reach Twitch. Check your internet connection.".into(),
            HelixError::Api { status, message } => match *status {
                401 => SIGNED_OUT.into(),
                403 if is_scope_problem(message) => {
                    format!("Castwright is missing permission to {what}. Sign out and in again.")
                }
                403 => format!("Twitch didn't allow Castwright to {what}. {message}")
                    .trim_end()
                    .into(),
                429 => "Twitch is getting too many requests. Try again in a moment.".into(),
                s if s >= 500 => {
                    "Twitch is having trouble right now. Try again in a moment.".into()
                }
                s => {
                    let detail = if message.is_empty() {
                        format!("error {s}")
                    } else {
                        message.clone()
                    };
                    format!("Couldn't {what}: {detail}")
                }
            },
        }
    }

    pub fn into_app(self, what: &str) -> AppError {
        AppError::Twitch(self.explain(what))
    }
}

fn is_scope_problem(message: &str) -> bool {
    let m = message.to_lowercase();
    m.is_empty()
        || m.contains("scope")
        || m.contains("missing")
        || m.contains("authorization")
        || m.contains("permission")
}

impl TwitchService {
    pub(crate) async fn helix(
        &self,
        role: AccountRole,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
    ) -> Result<Value, HelixError> {
        let client_id = self.client_id().ok_or(HelixError::NoClientId)?;
        let mut token = self.fresh_token(role).await?;
        let mut refreshed = false;
        let mut rate_waits = 0;
        loop {
            let mut req = self
                .http
                .request(
                    method.clone(),
                    format!("{}{path}", self.endpoints.helix_base),
                )
                .header("Client-Id", &client_id)
                .bearer_auth(&token.access_token);
            if !query.is_empty() {
                req = req.query(query);
            }
            if let Some(b) = body {
                req = req.json(b);
            }
            let res = req.send().await.map_err(|_| HelixError::Network)?;
            let status = res.status().as_u16();
            let header = |name: &str| {
                res.headers()
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from)
            };
            let remaining = header("Ratelimit-Remaining");
            let reset = header("Ratelimit-Reset");
            let text = res.text().await.unwrap_or_default();
            if (200..300).contains(&status) {
                return Ok(serde_json::from_str(&text).unwrap_or(Value::Null));
            }
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get("message").and_then(Value::as_str).map(String::from))
                .unwrap_or_default();
            if status == 401 && !refreshed {
                refreshed = true;
                token = self.refresh(role, &token.access_token).await?;
                continue;
            }
            // Only a drained bucket is worth waiting for; other 429s are cooldowns.
            if status == 429
                && rate_waits < 2
                && remaining.as_deref() == Some("0")
                && let Some(wait) = self.rate_wait(reset.as_deref())
            {
                rate_waits += 1;
                tokio::time::sleep(wait).await;
                continue;
            }
            return Err(HelixError::Api { status, message });
        }
    }

    fn rate_wait(&self, reset: Option<&str>) -> Option<Duration> {
        let reset_s: i64 = reset?.trim().parse().ok()?;
        let wait_ms = (reset_s * 1000 - crate::util::now_ms()).max(0) as u64 + 100;
        let wait = Duration::from_millis(wait_ms);
        (wait <= self.timing.max_rate_wait).then_some(wait)
    }

    /// `data[0]` of a Helix reply.
    pub(crate) fn first(v: &Value) -> Option<&Value> {
        v.get("data")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_messages() {
        let e = HelixError::Api {
            status: 403,
            message: "Missing scope: moderator:read:followers".into(),
        };
        assert_eq!(
            e.explain("read follows"),
            "Castwright is missing permission to read follows. Sign out and in again."
        );
        let e = HelixError::Api {
            status: 400,
            message: "The broadcaster is not live.".into(),
        };
        assert_eq!(
            e.explain("make a clip"),
            "Couldn't make a clip: The broadcaster is not live."
        );
        assert!(
            HelixError::Api {
                status: 503,
                message: String::new()
            }
            .explain("x")
            .contains("having trouble")
        );
    }
}
