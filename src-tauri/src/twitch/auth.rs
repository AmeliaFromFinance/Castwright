//! Sign-in with the OAuth device code flow (public client, no secret), plus token
//! refresh, validation and revocation.

use crate::model::runtime::{AccountRole, TwitchAccount};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BROADCASTER_SCOPES: &[&str] = &[
    "channel:read:subscriptions",
    "bits:read",
    "moderator:read:followers",
    "moderator:manage:chat_settings",
    "moderator:manage:shield_mode",
    "channel:read:redemptions",
    "channel:manage:redemptions",
    "channel:read:hype_train",
    "channel:read:polls",
    "channel:manage:polls",
    "channel:read:predictions",
    "channel:manage:predictions",
    "user:read:chat",
    "user:write:chat",
    "channel:bot",
    "moderator:read:shoutouts",
    "moderator:manage:shoutouts",
    "moderator:manage:announcements",
    "channel:read:ads",
    "channel:edit:commercial",
    "channel:read:charity",
    "channel:manage:broadcast",
    "clips:edit",
    "moderator:manage:banned_users",
    "moderator:manage:chat_messages",
    "moderator:read:chatters",
];

/// Only channel points, polls and predictions need these. A sign-in without
/// them still works for everything else.
pub const INTERACT_SCOPES: &[&str] = &[
    "channel:read:redemptions",
    "channel:manage:redemptions",
    "channel:read:polls",
    "channel:manage:polls",
    "channel:read:predictions",
    "channel:manage:predictions",
];

pub const BOT_SCOPES: &[&str] = &["user:read:chat", "user:write:chat", "user:bot"];

pub fn scopes(role: AccountRole) -> &'static [&'static str] {
    match role {
        AccountRole::Broadcaster => BROADCASTER_SCOPES,
        AccountRole::Bot => BOT_SCOPES,
    }
}

/// What is kept in the keychain for each signed-in account.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: String,
    /// ms since epoch.
    pub expires_at: i64,
    pub scopes: Vec<String>,
    pub user_id: String,
    pub login: String,
    pub display_name: String,
    pub profile_image_url: String,
}

impl StoredToken {
    pub fn account(&self) -> TwitchAccount {
        TwitchAccount {
            id: self.user_id.clone(),
            login: self.login.clone(),
            display_name: self.display_name.clone(),
            profile_image_url: self.profile_image_url.clone(),
            scopes: self.scopes.clone(),
        }
    }

    pub fn apply(&mut self, t: TokenResponse) {
        self.access_token = t.access_token;
        if let Some(r) = t.refresh_token.filter(|r| !r.is_empty()) {
            self.refresh_token = r;
        }
        self.expires_at = t
            .expires_in
            .map(|s| crate::util::now_ms() + s * 1000)
            .unwrap_or(0);
        if let Some(s) = t.scope {
            self.scopes = s;
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub scope: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default = "default_interval")]
    pub interval: u64,
    #[serde(default)]
    pub expires_in: u64,
}

fn default_interval() -> u64 {
    5
}

#[derive(Debug)]
pub enum Poll {
    Pending,
    SlowDown,
    Done(TokenResponse),
    /// Message for the user. The login can't continue.
    Failed(String),
}

#[derive(Debug)]
pub enum RefreshError {
    /// The refresh token was rejected; the user must sign in again.
    Invalid,
    Network(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct Validation {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub login: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub expires_in: i64,
}

#[derive(Debug)]
pub enum ValidateError {
    Invalid,
    Network(String),
}

fn twitch_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(Value::as_str).map(String::from))
        .unwrap_or_default()
}

pub async fn request_device_code(
    http: &reqwest::Client,
    id_base: &str,
    client_id: &str,
    role: AccountRole,
) -> Result<DeviceCode, String> {
    let res = http
        .post(format!("{id_base}/oauth2/device"))
        .form(&[
            ("client_id", client_id),
            ("scopes", &scopes(role).join(" ")),
        ])
        .send()
        .await
        .map_err(|_| "Couldn't reach Twitch. Check your internet connection.".to_string())?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = twitch_message(&body);
        return Err(if msg.to_lowercase().contains("client") {
            "Twitch didn't accept the Client ID. Check it in Settings, and make sure the \
             Twitch application is set to the \"Public\" client type."
                .into()
        } else {
            format!("Twitch couldn't start sign-in ({}). {msg}", status.as_u16())
                .trim_end()
                .to_string()
        });
    }
    serde_json::from_str(&body).map_err(|_| "Twitch sent an unexpected sign-in reply.".into())
}

pub async fn poll_device_token(
    http: &reqwest::Client,
    id_base: &str,
    client_id: &str,
    role: AccountRole,
    device_code: &str,
) -> Poll {
    let res = http
        .post(format!("{id_base}/oauth2/token"))
        .form(&[
            ("client_id", client_id),
            ("scopes", &scopes(role).join(" ")),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await;
    // Network hiccups while waiting are not fatal; try again next round.
    let Ok(res) = res else { return Poll::Pending };
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if status.is_success() {
        return match serde_json::from_str(&body) {
            Ok(t) => Poll::Done(t),
            Err(_) => Poll::Failed("Twitch sent an unexpected sign-in reply.".into()),
        };
    }
    if status.is_server_error() || status.as_u16() == 429 {
        return Poll::Pending;
    }
    let msg = twitch_message(&body).to_lowercase();
    match msg.as_str() {
        "authorization_pending" => Poll::Pending,
        "slow_down" => Poll::SlowDown,
        m if m.contains("invalid device code") || m.contains("expired") => {
            Poll::Failed("The sign-in code expired. Start again to get a new code.".into())
        }
        m if m.contains("denied") => Poll::Failed("Sign-in was declined on Twitch.".into()),
        _ => Poll::Failed(format!("Twitch sign-in failed: {msg}")),
    }
}

pub async fn refresh(
    http: &reqwest::Client,
    id_base: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse, RefreshError> {
    if refresh_token.is_empty() {
        return Err(RefreshError::Invalid);
    }
    let res = http
        .post(format!("{id_base}/oauth2/token"))
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| RefreshError::Network(e.to_string()))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if status.is_success() {
        return serde_json::from_str(&body).map_err(|e| RefreshError::Network(e.to_string()));
    }
    if status.as_u16() == 400 || status.as_u16() == 401 {
        return Err(RefreshError::Invalid);
    }
    Err(RefreshError::Network(format!("status {}", status.as_u16())))
}

pub async fn validate(
    http: &reqwest::Client,
    id_base: &str,
    access_token: &str,
) -> Result<Validation, ValidateError> {
    let res = http
        .get(format!("{id_base}/oauth2/validate"))
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .await
        .map_err(|e| ValidateError::Network(e.to_string()))?;
    match res.status().as_u16() {
        200 => res
            .json()
            .await
            .map_err(|e| ValidateError::Network(e.to_string())),
        401 => Err(ValidateError::Invalid),
        s => Err(ValidateError::Network(format!("status {s}"))),
    }
}

pub async fn revoke(http: &reqwest::Client, id_base: &str, client_id: &str, token: &str) {
    let _ = http
        .post(format!("{id_base}/oauth2/revoke"))
        .form(&[("client_id", client_id), ("token", token)])
        .send()
        .await;
}
