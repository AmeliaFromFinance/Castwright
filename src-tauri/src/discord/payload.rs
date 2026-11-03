//! What gets sent to Discord. Pure functions, so every post can be checked in tests.

use crate::model::runtime::TwitchStatus;
use crate::model::session::SessionSummary;
use crate::model::settings::DiscordWebhook;
use crate::template::render;
use serde_json::{Map, Value, json};

const TWITCH_PURPLE: u32 = 0x9146FF;
const ENDED_GREY: u32 = 0x6B6B76;
const MAX_CONTENT: usize = 2000;
const MAX_TITLE: usize = 256;
const MAX_FIELD: usize = 1024;
const HOSTS: [&str; 4] = [
    "discord.com",
    "discordapp.com",
    "canary.discord.com",
    "ptb.discord.com",
];

/// The channel as Twitch last reported it.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Channel {
    pub login: String,
    pub display_name: String,
    pub profile_image_url: String,
    pub title: String,
    pub category: String,
}

impl Channel {
    /// None until a broadcaster is signed in.
    pub fn from_status(s: &TwitchStatus) -> Option<Channel> {
        let b = s.broadcaster.as_ref().filter(|b| !b.login.is_empty())?;
        Some(Channel {
            login: b.login.clone(),
            display_name: if b.display_name.is_empty() {
                b.login.clone()
            } else {
                b.display_name.clone()
            },
            profile_image_url: b.profile_image_url.clone(),
            title: s.stream.title.clone(),
            category: s.stream.category.clone(),
        })
    }

    pub fn url(&self) -> String {
        format!("https://www.twitch.tv/{}", self.login)
    }

    /// Twitch's live preview. The query makes Discord fetch a fresh copy each time.
    pub fn thumbnail(&self, now_ms: i64) -> String {
        format!(
            "https://static-cdn.jtvnw.net/previews-ttv/live_user_{}-1280x720.jpg?t={}",
            self.login.to_lowercase(),
            now_ms / 1000
        )
    }
}

fn cut(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let mut out: String = t.chars().take(max - 1).collect();
    out.push('…');
    out
}

fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// A webhook address from Discord, tidied to `https://discord.com/api/webhooks/<id>/<token>`.
pub fn clean_url(raw: &str) -> Result<String, String> {
    const HELP: &str = "That isn't a Discord webhook link. In Discord open Server Settings → Integrations → Webhooks and use Copy Webhook URL.";
    let u = url::Url::parse(raw.trim()).map_err(|_| HELP.to_string())?;
    if u.scheme() != "https" || !HOSTS.contains(&u.host_str().unwrap_or("")) {
        return Err(HELP.into());
    }
    let parts: Vec<&str> = u.path_segments().map(|p| p.collect()).unwrap_or_default();
    let rest = match parts.as_slice() {
        ["api", "webhooks", rest @ ..] => rest,
        ["api", v, "webhooks", rest @ ..] if v.starts_with('v') => rest,
        _ => return Err(HELP.into()),
    };
    let [id, token, ..] = rest else {
        return Err(HELP.into());
    };
    let token_ok = !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || !token_ok {
        return Err(HELP.into());
    }
    Ok(format!("https://discord.com/api/webhooks/{id}/{token}"))
}

/// A role mention, `@everyone`, `@here` or nothing. A bare role id becomes `<@&id>`.
pub fn clean_mention(raw: &str) -> Result<String, String> {
    let m = raw.trim();
    if m.is_empty() || m.eq_ignore_ascii_case("none") {
        return Ok(String::new());
    }
    if m == "@everyone" || m == "@here" {
        return Ok(m.into());
    }
    let id = m
        .strip_prefix("<@&")
        .and_then(|r| r.strip_suffix('>'))
        .or_else(|| m.strip_prefix('&'))
        .unwrap_or(m);
    if !id.is_empty() && id.len() <= 25 && id.chars().all(|c| c.is_ascii_digit()) {
        return Ok(format!("<@&{id}>"));
    }
    Err("Use a role mention like <@&123456789012345678>, @everyone, @here or leave it empty. In Discord, type \\@RoleName in a channel to get it.".into())
}

/// Text to put before the message, and `allowed_mentions` so only that mention pings.
pub fn mention(raw: &str) -> (String, Value) {
    match clean_mention(raw).unwrap_or_default().as_str() {
        "" => (String::new(), json!({ "parse": [] })),
        m @ ("@everyone" | "@here") => (m.to_string(), json!({ "parse": ["everyone"] })),
        m => {
            let id = m.trim_start_matches("<@&").trim_end_matches('>');
            (m.to_string(), json!({ "parse": [], "roles": [id] }))
        }
    }
}

fn content(prefix: &str, text: &str) -> String {
    let joined = [prefix.trim(), text.trim()]
        .iter()
        .filter(|s| !s.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join(" ");
    cut(&joined, MAX_CONTENT)
}

fn author(ch: &Channel) -> Value {
    let mut a = json!({ "name": cut(&ch.display_name, MAX_TITLE), "url": ch.url() });
    if !ch.profile_image_url.is_empty() {
        a["icon_url"] = json!(ch.profile_image_url);
    }
    a
}

fn field(name: &str, value: impl Into<String>) -> Value {
    json!({ "name": name, "value": cut(&value.into(), MAX_FIELD), "inline": true })
}

/// Placeholders for the go-live template.
pub fn live_context(ch: &Channel, now_ms: i64) -> Value {
    json!({
        "channel": ch.display_name,
        "login": ch.login,
        "title": ch.title,
        "category": ch.category,
        "url": ch.url(),
        "thumbnail": ch.thumbnail(now_ms),
    })
}

/// `8_100_000` -> `2h 15m`.
pub fn duration_text(ms: i64) -> String {
    let mins = ((ms.max(0) as f64) / 60_000.0).round() as i64;
    let (h, m) = (mins / 60, mins % 60);
    if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

fn date_text(ms: i64) -> String {
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let iso = crate::commands::format_rfc3339(ms);
    let n = |r: std::ops::Range<usize>| iso.get(r).and_then(|s| s.parse::<usize>().ok());
    match (n(0..4), n(5..7), n(8..10)) {
        (Some(y), Some(m), Some(d)) if (1..=12).contains(&m) => {
            format!("{d} {} {y}", MONTHS[m - 1])
        }
        _ => String::new(),
    }
}

fn money(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{n}")
    } else {
        format!("{n:.2}")
    }
}

/// Placeholders for the end template: the same as "Copy for socials", plus the link.
pub fn end_context(s: &SessionSummary, ch: &Channel) -> Value {
    let sess = &s.session;
    let names = |list: &[crate::model::session::Ranked]| {
        list.first().map(|r| r.name.clone()).unwrap_or_default()
    };
    let mut m = Map::new();
    let mut put = |k: &str, v: Value| {
        m.insert(k.into(), v);
    };
    put("channel", json!(ch.display_name));
    put("login", json!(ch.login));
    put("url", json!(ch.url()));
    put("title", json!(sess.title));
    put(
        "category",
        json!(sess.categories.last().cloned().unwrap_or_default()),
    );
    put("categories", json!(sess.categories.join(", ")));
    put("date", json!(date_text(sess.started_at)));
    put("duration", json!(duration_text(s.duration_ms)));
    put(
        "duration_minutes",
        json!((s.duration_ms as f64 / 60_000.0).round() as i64),
    );
    put("peak_viewers", json!(sess.peak_viewers));
    put("avg_viewers", json!(sess.avg_viewers));
    put("follows", json!(s.follows));
    put("subs", json!(s.new_subs + s.resubs + s.gifted_subs));
    put("new_subs", json!(s.new_subs));
    put("resubs", json!(s.resubs));
    put("gifted_subs", json!(s.gifted_subs));
    put("top_gifter", json!(names(&s.top_gifters)));
    put("bits", json!(s.bits));
    put("top_cheerer", json!(names(&s.top_cheerers)));
    put("raids", json!(s.raids_in.len()));
    let raiders: Vec<&str> = s.raids_in.iter().map(|r| r.name.as_str()).collect();
    put("raiders", json!(raiders.join(", ")));
    put(
        "raided",
        json!(
            s.raids_out
                .last()
                .map(|r| r.name.clone())
                .unwrap_or_default()
        ),
    );
    put("donations", json!(s.donation_count));
    let totals: Vec<String> = s
        .donation_totals
        .iter()
        .map(|d| format!("{} {}", money(d.amount), d.name).trim().to_string())
        .collect();
    put("donation_total", json!(totals.join(", ")));
    put("chat_messages", json!(s.chat_messages));
    put("chatters", json!(s.chatters));
    put("first_chatters", json!(s.first_chatters.len()));
    put("top_chatter", json!(names(&s.top_chatters)));
    put("alerts", json!(s.alerts));
    put("actions", json!(s.actions));
    put("markers", json!(s.markers.len()));
    put("clips", json!(s.clips.len()));
    Value::Object(m)
}

/// The go-live post: the template text, then an embed with the title, category,
/// link and Twitch preview.
pub fn live_payload(hook: &DiscordWebhook, ch: &Channel, now_ms: i64) -> Value {
    let (prefix, allowed) = mention(&hook.mention);
    let text = render(&hook.live_template, &live_context(ch, now_ms));
    let title = if ch.title.trim().is_empty() {
        format!("{} is live", ch.display_name)
    } else {
        ch.title.clone()
    };
    let mut embed = json!({
        "title": cut(&title, MAX_TITLE),
        "url": ch.url(),
        "color": TWITCH_PURPLE,
        "author": author(ch),
        "image": { "url": ch.thumbnail(now_ms) },
        "timestamp": crate::commands::format_rfc3339(now_ms),
    });
    if !ch.category.trim().is_empty() {
        embed["fields"] = json!([field("Category", &ch.category)]);
    }
    json!({ "content": content(&prefix, &text), "allowed_mentions": allowed, "embeds": [embed] })
}

fn summary_fields(s: &SessionSummary) -> Vec<Value> {
    let subs = s.new_subs + s.resubs + s.gifted_subs;
    let mut fields = vec![
        field("Length", duration_text(s.duration_ms)),
        field("Peak viewers", thousands(s.session.peak_viewers as u64)),
        field("Average viewers", thousands(s.session.avg_viewers as u64)),
        field("Follows", thousands(s.follows as u64)),
        field("Subs", thousands(subs as u64)),
        field("Bits", thousands(s.bits)),
    ];
    if !s.clips.is_empty() {
        fields.push(field("Clips", thousands(s.clips.len() as u64)));
    }
    fields
}

fn ended_at(s: &SessionSummary) -> i64 {
    s.session
        .ended_at
        .unwrap_or(s.session.started_at + s.duration_ms)
}

/// The summary post when the stream ends.
pub fn end_payload(hook: &DiscordWebhook, s: &SessionSummary, ch: &Channel) -> Value {
    let (prefix, allowed) = mention(&hook.mention);
    let text = render(&hook.end_template, &end_context(s, ch));
    let title = if s.session.title.trim().is_empty() {
        "Stream ended".to_string()
    } else {
        s.session.title.clone()
    };
    let mut embed = json!({
        "title": cut(&title, MAX_TITLE),
        "url": ch.url(),
        "color": ENDED_GREY,
        "author": author(ch),
        "fields": summary_fields(s),
        "footer": { "text": "Stream summary" },
        "timestamp": crate::commands::format_rfc3339(ended_at(s)),
    });
    if !s.session.categories.is_empty() {
        embed["description"] = json!(cut(&s.session.categories.join(", "), 4096));
    }
    json!({ "content": content(&prefix, &text), "allowed_mentions": allowed, "embeds": [embed] })
}

/// Turns the go-live post into an "ended" one. The text stays; edits never ping.
pub fn ended_edit(s: &SessionSummary, ch: &Channel) -> Value {
    let title = if s.session.title.trim().is_empty() {
        format!("{} was live", ch.display_name)
    } else {
        s.session.title.clone()
    };
    let mut embed = json!({
        "title": cut(&title, MAX_TITLE),
        "url": ch.url(),
        "color": ENDED_GREY,
        "author": author(ch),
        "description": format!("Ended after {}. Thanks for watching!", duration_text(s.duration_ms)),
        "timestamp": crate::commands::format_rfc3339(ended_at(s)),
    });
    if let Some(c) = s.session.categories.last() {
        embed["fields"] = json!([field("Category", c)]);
    }
    if !ch.profile_image_url.is_empty() {
        embed["thumbnail"] = json!({ "url": ch.profile_image_url });
    }
    json!({ "embeds": [embed], "allowed_mentions": { "parse": [] } })
}

/// Plain text from an action. Nothing in it pings.
pub fn text_payload(text: &str) -> Value {
    json!({ "content": cut(text, MAX_CONTENT), "allowed_mentions": { "parse": [] } })
}
