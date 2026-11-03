//! Removes secrets from anything that goes into a bug report: by setting name
//! (`token`, `password`, `webhook`...), by known value (the link secret, saved
//! sign-ins) and by what a value looks like (sign-in tokens, webhook links, emails).

use regex::{Captures, Regex};
use serde_json::Value;
use std::path::Path;
use std::sync::LazyLock;

pub const REMOVED: &str = "[removed]";

/// Words that mark a setting's value as private when they appear in its name.
const SECRET_WORDS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "pwd",
    "apikey",
    "auth",
    "authorization",
    "webhook",
    "cookie",
    "credential",
    "credentials",
    "email",
    "bearer",
    "oauth",
    "signature",
    "private",
];

fn rx(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid pattern")
}

static WEBHOOK_URL: LazyLock<Regex> = LazyLock::new(|| {
    rx(r#"(?i)\b(?:https?|wss?)://(?:hooks\.|[^\s"'<>]*?(?:webhook|/hooks?/))[^\s"'<>]*"#)
});
static URL_USERINFO: LazyLock<Regex> =
    LazyLock::new(|| rx(r#"(?i)\b((?:https?|wss?|ftp)://)[^\s/@"'<>]+@"#));
static QUERY_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    rx(
        r#"(?i)([?&#;](?:[a-z_]*token|key|[a-z_]+_key|apikey|secret|client_secret|password|pass|pwd|code|sig|signature|auth)=)[^&\s"'#<>]+"#,
    )
});
static AUTH_SCHEME: LazyLock<Regex> =
    LazyLock::new(|| rx(r"(?i)\b(bearer|oauth)(\s+)[A-Za-z0-9._~+/=-]{8,}"));
static IRC_OAUTH: LazyLock<Regex> = LazyLock::new(|| rx(r"(?i)\boauth:[a-z0-9]{8,}"));
static NAMED_SECRET: LazyLock<Regex> = LazyLock::new(|| {
    rx(
        r#"(?i)\b((?:access|refresh|client|id|api|bot|stream)?[_-]?(?:token|secret|password|passwd|pwd|api[_-]?key|stream[_-]?key|authorization))("?\s*[:=]\s*"?)([^\s"',;&}]+)"#,
    )
});
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| rx(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"));
static JWT: LazyLock<Regex> =
    LazyLock::new(|| rx(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*"));
/// Long runs of letters and digits, like Twitch tokens (30) or the link secret (32).
static OPAQUE: LazyLock<Regex> = LazyLock::new(|| rx(r"(^|[^A-Za-z0-9])([A-Za-z0-9]{24,})"));

pub fn is_secret_name(name: &str) -> bool {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for ch in name.chars() {
        if !ch.is_ascii_alphanumeric() {
            words.push(std::mem::take(&mut cur));
            prev_lower = false;
            continue;
        }
        if ch.is_ascii_uppercase() && prev_lower {
            words.push(std::mem::take(&mut cur));
        }
        prev_lower = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        cur.push(ch.to_ascii_lowercase());
    }
    words.push(cur);
    words.retain(|w| !w.is_empty());
    let joined = words.concat();
    words.iter().any(|w| SECRET_WORDS.contains(&w.as_str()))
        // `api_key`, `stream_key`, `asset_key`, but not a plain `key` (a variable name).
        || (words.len() > 1 && words.last().is_some_and(|w| w == "key"))
        || ["apikey", "accesstoken", "refreshtoken", "clientsecret", "streamkey"]
            .iter()
            .any(|w| joined.contains(w))
}

pub struct Redactor {
    known: Vec<String>,
    home: Vec<String>,
}

impl Redactor {
    /// `known`: exact values to remove wherever they appear. Very short ones are ignored.
    pub fn new(known: impl IntoIterator<Item = String>) -> Self {
        let mut known: Vec<String> = known
            .into_iter()
            .map(|k| k.trim().to_string())
            .filter(|k| k.chars().count() >= 6)
            .collect();
        known.sort();
        known.dedup();
        known.sort_by_key(|k| std::cmp::Reverse(k.len()));
        Redactor {
            known,
            home: Vec::new(),
        }
    }

    /// Show the home folder as `~`, so user names in paths stay private.
    pub fn with_home(mut self, home: Option<&Path>) -> Self {
        if let Some(h) = home.map(|h| {
            h.to_string_lossy()
                .trim_end_matches(['/', '\\'])
                .to_string()
        }) && h.len() > 1
        {
            let alt = h.replace('\\', "/");
            if alt != h {
                self.home.push(alt);
            }
            self.home.push(h.replace('\\', "\\\\"));
            self.home.push(h);
        }
        self
    }

    pub fn text(&self, s: &str) -> String {
        let mut out = s.to_string();
        for k in &self.known {
            if out.contains(k.as_str()) {
                out = out.replace(k.as_str(), REMOVED);
            }
        }
        for h in &self.home {
            if out.contains(h.as_str()) {
                out = out.replace(h.as_str(), "~");
            }
        }
        let out = WEBHOOK_URL.replace_all(&out, "[removed link]");
        let out = URL_USERINFO.replace_all(&out, "${1}[removed]@");
        let out = QUERY_SECRET.replace_all(&out, "${1}[removed]");
        let out = IRC_OAUTH.replace_all(&out, "oauth:[removed]");
        let out = AUTH_SCHEME.replace_all(&out, "${1}${2}[removed]");
        let out = NAMED_SECRET.replace_all(&out, |c: &Captures| {
            if &c[3] == REMOVED || c[3].starts_with("[removed") {
                c[0].to_string()
            } else {
                format!("{}{}{REMOVED}", &c[1], &c[2])
            }
        });
        let out = JWT.replace_all(&out, REMOVED);
        let out = EMAIL.replace_all(&out, "[removed email]");
        OPAQUE
            .replace_all(&out, |c: &Captures| {
                let m = &c[2];
                if m.bytes().any(|b| b.is_ascii_digit())
                    && m.bytes().any(|b| b.is_ascii_alphabetic())
                {
                    format!("{}{REMOVED}", &c[1])
                } else {
                    c[0].to_string()
                }
            })
            .into_owned()
    }

    pub fn json(&self, v: &Value) -> Value {
        self.json_inner(v, false)
    }

    fn json_inner(&self, v: &Value, secret: bool) -> Value {
        match v {
            Value::String(s) if secret && !s.is_empty() => Value::String(REMOVED.into()),
            Value::String(s) => Value::String(self.text(s)),
            Value::Array(items) => {
                Value::Array(items.iter().map(|i| self.json_inner(i, secret)).collect())
            }
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(k, v)| {
                        (
                            self.text(k),
                            self.json_inner(v, secret || is_secret_name(k)),
                        )
                    })
                    .collect(),
            ),
            other => other.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plain() -> Redactor {
        Redactor::new(Vec::new())
    }

    #[test]
    fn secret_names() {
        for name in [
            "token",
            "access_token",
            "refreshToken",
            "client_secret",
            "clientSecret",
            "password",
            "has_password",
            "api_key",
            "apiKey",
            "x-api-key",
            "asset_key",
            "stream_key",
            "discord_webhook",
            "webhookUrl",
            "Authorization",
            "email",
            "userEmail",
            "cookie",
            "my.password",
        ] {
            assert!(is_secret_name(name), "{name}");
        }
        for name in [
            "key",
            "keys",
            "name",
            "client_id",
            "port",
            "monkey",
            "author",
            "secretary",
        ] {
            assert!(!is_secret_name(name), "{name}");
        }
    }

    #[test]
    fn values_that_look_secret() {
        let r = plain();
        let cases = [
            (
                "posting to https://discord.com/api/webhooks/1234567890/AbCdEf-ghIJ_kl done",
                "https://discord.com/api",
            ),
            (
                "hook https://discordapp.com/api/v10/webhooks/1/x",
                "discordapp.com",
            ),
            (
                "https://hooks.slack.com/services/T000/B000/XXXX",
                "slack.com",
            ),
            ("https://example.com/my-webhook/abc?x=1", "example.com"),
            (
                "ws://127.0.0.1:7470/ws?token=0123456789abcdef&overlay=a",
                "0123456789abcdef",
            ),
            ("http://127.0.0.1:7470/overlay/a?token=s3cr3t", "s3cr3t"),
            (
                "https://id.twitch.tv/#access_token=abcdef123&scope=x",
                "abcdef123",
            ),
            ("GET /x?client_secret=hunter22&y=1", "hunter22"),
            ("?api_key=k123", "k123"),
            (
                "Authorization: Bearer abcdefghijkl12345",
                "abcdefghijkl12345",
            ),
            ("Authorization: OAuth zyxwvut9876543", "zyxwvut9876543"),
            ("PASS oauth:abcdefghij1234567890", "abcdefghij1234567890"),
            ("password=hunter2!", "hunter2!"),
            ("obs password: correcthorse", "correcthorse"),
            (r#"{"access_token":"tok_value_1"}"#, "tok_value_1"),
            ("refresh_token = rt-998877", "rt-998877"),
            ("stream_key=live_123_abc", "live_123_abc"),
            (
                "contact me at jane.doe+stream@example.co.uk please",
                "jane.doe",
            ),
            ("user@localhost.dev", "user@"),
            (
                "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
                "eyJhbGciOiJIUzI1NiJ9",
            ),
            (
                "twitch token 0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o",
                "0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o",
            ),
            (
                "link secret 0123456789abcdef0123456789abcdef",
                "0123456789abcdef0123456789abcdef",
            ),
            (
                "id tok_0123456789abcdef0123456789ab",
                "0123456789abcdef0123456789ab",
            ),
            ("https://user:pa55word@example.com/x", "pa55word"),
        ];
        for (input, secret) in cases {
            let out = r.text(input);
            assert!(!out.contains(secret), "{input:?} became {out:?}");
            assert!(out.contains("[removed"), "{input:?} became {out:?}");
        }
    }

    #[test]
    fn ordinary_text_is_left_alone() {
        let r = plain();
        for s in [
            "Connected to OBS 32.1.0",
            "Missing or wrong token. Copy the overlay link again.",
            "Listening for 27 of 28 Twitch event types",
            "Lost connection to Twitch events (no keepalive from Twitch). Reconnecting.",
            "Can't listen for channel.follow: Castwright is missing permission to read follows.",
            "Event 5f3c1a2b-7d4e-4f60-9a1b-2c3d4e5f6a7b",
            "http://127.0.0.1:7470/overlay/abc123",
            "a sentence about the secret sauce",
            "your token expiring soon, basic information",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "2026-11-03T10:00:00.123456Z  INFO castwright_lib::core: started",
        ] {
            assert_eq!(r.text(s), s);
        }
    }

    #[test]
    fn known_values_anywhere() {
        let r = Redactor::new(vec![
            "short".into(),
            "my-obs-pass".into(),
            "Abc 123 with spaces".into(),
        ]);
        assert_eq!(r.text("p=my-obs-pass!"), "p=[removed]!");
        assert_eq!(r.text("x Abc 123 with spaces y"), "x [removed] y");
        assert_eq!(r.text("short stays"), "short stays");
    }

    #[test]
    fn home_folder_becomes_tilde() {
        let r = plain().with_home(Some(Path::new("/home/jane")));
        assert_eq!(
            r.text("/home/jane/.config/castwright"),
            "~/.config/castwright"
        );
        let r = plain().with_home(Some(Path::new(r"C:\Users\Jane")));
        assert_eq!(r.text(r"C:\Users\Jane\AppData\x"), r"~\AppData\x");
        assert_eq!(r.text("C:/Users/Jane/AppData"), "~/AppData");
        assert_eq!(r.text(r#"{"p":"C:\\Users\\Jane\\x"}"#), r#"{"p":"~\\x"}"#);
    }

    #[test]
    fn json_by_key_and_by_value() {
        let r = Redactor::new(vec!["known-secret-value".into()]);
        let v = json!({
            "server": { "port": 7470, "token": "abc", "allow_lan": false },
            "obs": { "has_password": true, "password": "" },
            "twitch": { "client_id": "public-id", "clientSecret": "s" },
            "headers": { "Authorization": "Bearer x", "Accept": "json" },
            "auth": { "nested": { "deep": "value" }, "n": 3 },
            "steps": [
                { "type": "http", "url": "https://discord.com/api/webhooks/1/2" },
                { "type": "set", "key": "counter.deaths", "value": "known-secret-value" },
                { "note": "mail me@example.com" }
            ],
            "my.password": "x"
        });
        let out = r.json(&v);
        assert_eq!(out["server"]["token"], REMOVED);
        assert_eq!(out["server"]["port"], 7470);
        assert_eq!(out["obs"]["has_password"], true);
        assert_eq!(out["obs"]["password"], "", "empty stays empty");
        assert_eq!(out["twitch"]["client_id"], "public-id");
        assert_eq!(out["twitch"]["clientSecret"], REMOVED);
        assert_eq!(out["headers"]["Authorization"], REMOVED);
        assert_eq!(out["headers"]["Accept"], "json");
        assert_eq!(out["auth"]["nested"]["deep"], REMOVED);
        assert_eq!(out["auth"]["n"], 3);
        assert_eq!(out["steps"][0]["url"], "[removed link]");
        assert_eq!(out["steps"][1]["key"], "counter.deaths");
        assert_eq!(out["steps"][1]["value"], REMOVED);
        assert_eq!(out["steps"][2]["note"], "mail [removed email]");
        assert_eq!(out["my.password"], REMOVED);
    }
}
