//! Spotify Web API: sign-in with Authorization Code and PKCE (no client secret),
//! token refresh and the currently playing track.

use crate::model::music::NowPlaying;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;

pub const ACCOUNTS: &str = "https://accounts.spotify.com";
pub const API: &str = "https://api.spotify.com";
pub const SCOPES: &str = "user-read-currently-playing user-read-playback-state";

/// What is kept in the keychain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StoredToken {
    pub access_token: String,
    pub refresh_token: String,
    /// ms since epoch.
    pub expires_at: i64,
    pub display_name: String,
}

impl StoredToken {
    pub fn apply(&mut self, t: TokenResponse, now_ms: i64) {
        self.access_token = t.access_token;
        // Spotify may hand out a new refresh token; keep the old one otherwise.
        if let Some(r) = t.refresh_token.filter(|r| !r.is_empty()) {
            self.refresh_token = r;
        }
        self.expires_at = now_ms + t.expires_in.unwrap_or(3600) * 1000;
    }

    /// True when the access token runs out within a minute.
    pub fn stale(&self, now_ms: i64) -> bool {
        self.access_token.is_empty() || self.expires_at - 60_000 <= now_ms
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
}

/// A random code verifier: 64 characters from the unreserved set (RFC 7636).
pub fn code_verifier() -> String {
    use rand::Rng;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::rng();
    (0..64)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

/// S256 code challenge for a verifier.
pub fn code_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(
    accounts: &str,
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> String {
    let mut u = url::Url::parse(&format!("{accounts}/authorize")).expect("valid base");
    u.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("scope", SCOPES)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", challenge)
        .append_pair("state", state);
    u.into()
}

#[derive(Debug, PartialEq)]
pub enum TokenError {
    /// The code or refresh token was refused; sign in again.
    Invalid(String),
    Network(String),
}

fn error_text(body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let desc = v
        .get("error_description")
        .and_then(Value::as_str)
        .or_else(|| v.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| v.get("error").and_then(Value::as_str))
        .unwrap_or_default();
    desc.to_string()
}

async fn token_request(
    http: &reqwest::Client,
    accounts: &str,
    form: &[(&str, &str)],
) -> Result<TokenResponse, TokenError> {
    let res = http
        .post(format!("{accounts}/api/token"))
        .form(form)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| TokenError::Network("Couldn't reach Spotify.".into()))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if status.is_success() {
        return serde_json::from_str(&body)
            .map_err(|_| TokenError::Network("Spotify sent an unexpected reply.".into()));
    }
    let msg = error_text(&body);
    if status.as_u16() == 400 || status.as_u16() == 401 {
        Err(TokenError::Invalid(msg))
    } else {
        Err(TokenError::Network(format!(
            "Spotify answered {} {msg}",
            status.as_u16()
        )))
    }
}

pub async fn exchange_code(
    http: &reqwest::Client,
    accounts: &str,
    client_id: &str,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<TokenResponse, TokenError> {
    token_request(
        http,
        accounts,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ],
    )
    .await
}

pub async fn refresh(
    http: &reqwest::Client,
    accounts: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse, TokenError> {
    token_request(
        http,
        accounts,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ],
    )
    .await
}

#[derive(Debug, PartialEq)]
pub enum ApiError {
    /// The access token expired or was revoked.
    Unauthorized,
    /// Too many requests. Seconds to wait.
    RateLimited(u64),
    Other(String),
}

/// Seconds from a Retry-After header. Spotify sends whole seconds.
pub fn retry_after(value: Option<&str>) -> u64 {
    value
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(5)
        .clamp(1, 3600)
}

async fn get(http: &reqwest::Client, url: &str, token: &str) -> Result<(u16, String), ApiError> {
    let res = http
        .get(url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| ApiError::Other("Couldn't reach Spotify.".into()))?;
    let status = res.status().as_u16();
    if status == 429 {
        let wait = retry_after(
            res.headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok()),
        );
        return Err(ApiError::RateLimited(wait));
    }
    if status == 401 {
        return Err(ApiError::Unauthorized);
    }
    let body = res.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        let msg = error_text(&body);
        return Err(ApiError::Other(if status == 403 {
            "Spotify refused access. Check that your account is added under User Management in the Spotify app.".into()
        } else {
            format!("Spotify answered {status}. {msg}")
                .trim()
                .to_string()
        }));
    }
    Ok((status, body))
}

/// The track playing now. None when nothing plays (204) or Spotify plays an ad.
pub async fn currently_playing(
    http: &reqwest::Client,
    api: &str,
    token: &str,
) -> Result<Option<NowPlaying>, ApiError> {
    let (status, body) = get(
        http,
        &format!("{api}/v1/me/player/currently-playing?additional_types=track,episode"),
        token,
    )
    .await?;
    if status == 204 || body.trim().is_empty() {
        return Ok(None);
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|_| ApiError::Other("Spotify sent an unexpected reply.".into()))?;
    Ok(parse_current(&v))
}

/// The account name, shown in Settings.
pub async fn display_name(http: &reqwest::Client, api: &str, token: &str) -> String {
    match get(http, &format!("{api}/v1/me"), token).await {
        Ok((_, body)) => serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("display_name")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .or_else(|| v.get("id").and_then(Value::as_str))
                    .map(String::from)
            })
            .unwrap_or_default(),
        Err(_) => String::new(),
    }
}

fn s(v: &Value, ptr: &str) -> String {
    v.pointer(ptr)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The image closest to 300 px wide; overlays rarely need more.
fn pick_image(images: Option<&Value>) -> String {
    let list = images
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    list.iter()
        .filter_map(|i| {
            let url = i.get("url")?.as_str()?;
            let w = i.get("width").and_then(Value::as_i64).unwrap_or(300);
            Some(((w - 300).abs(), url.to_string()))
        })
        .min_by_key(|(d, _)| *d)
        .map(|(_, u)| u)
        .unwrap_or_default()
}

/// Turns a currently-playing reply into a track. Ads and empty replies give None.
pub fn parse_current(v: &Value) -> Option<NowPlaying> {
    let item = v.get("item").filter(|i| i.is_object())?;
    let episode = item.get("type").and_then(Value::as_str) == Some("episode");
    let (artist, album, art) = if episode {
        (
            s(item, "/show/name"),
            s(item, "/show/publisher"),
            pick_image(item.get("images").or_else(|| item.pointer("/show/images"))),
        )
    } else {
        let artists: Vec<String> = item
            .get("artists")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.get("name").and_then(Value::as_str).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        (
            artists.join(", "),
            s(item, "/album/name"),
            pick_image(item.pointer("/album/images")),
        )
    };
    Some(NowPlaying {
        id: s(item, "/id"),
        title: s(item, "/name"),
        artist,
        album,
        art_url: art,
        playing: v
            .get("is_playing")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        progress_ms: v.get("progress_ms").and_then(Value::as_u64).unwrap_or(0),
        duration_ms: item.get("duration_ms").and_then(Value::as_u64).unwrap_or(0),
    })
}
