//! Turns EventSub notifications into app events. Every function here is pure.

use crate::model::event::{Event, EventKind, EventUser, MessagePart, UserRoles};
use serde_json::{Value, json};

/// What a notification means for the app.
#[derive(Debug, Clone, PartialEq)]
pub enum Normalized {
    Event(Box<Event>),
    DeleteChat(String),
    ClearUser(String),
    ClearChat,
    Ignore,
}

/// Fields every notification shares.
#[derive(Debug, Clone, Copy)]
pub struct Meta<'a> {
    pub message_id: &'a str,
    pub ts: i64,
    pub broadcaster_id: &'a str,
}

pub fn normalize(sub_type: &str, meta: Meta, ev: &Value) -> Normalized {
    let event = match sub_type {
        "channel.follow" => follow(meta, ev),
        "channel.chat.message" => chat_message(meta, ev),
        "channel.chat.notification" => chat_notification(meta, ev),
        "channel.chat.message_delete" => {
            return match str_of(ev, "message_id") {
                id if id.is_empty() => Normalized::Ignore,
                id => Normalized::DeleteChat(id),
            };
        }
        "channel.chat.clear_user_messages" => {
            return match str_of(ev, "target_user_id") {
                id if id.is_empty() => Normalized::Ignore,
                id => Normalized::ClearUser(id),
            };
        }
        "channel.chat.clear" => return Normalized::ClearChat,
        "channel.cheer" => cheer(meta, ev),
        "channel.raid" => raid(meta, ev),
        "channel.channel_points_custom_reward_redemption.add" => redemption(meta, ev),
        "channel.bits.use" => bits_use(meta, ev),
        "channel.hype_train.begin" => hype_train(meta, ev, EventKind::HypeTrainBegin),
        "channel.hype_train.progress" => hype_train(meta, ev, EventKind::HypeTrainProgress),
        "channel.hype_train.end" => hype_train(meta, ev, EventKind::HypeTrainEnd),
        "channel.poll.begin" => poll(meta, ev, EventKind::PollBegin),
        "channel.poll.progress" => poll(meta, ev, EventKind::PollProgress),
        "channel.poll.end" => poll(meta, ev, EventKind::PollEnd),
        "channel.prediction.begin" => prediction(meta, ev, EventKind::PredictionBegin),
        "channel.prediction.progress" => prediction(meta, ev, EventKind::PredictionProgress),
        "channel.prediction.lock" => prediction(meta, ev, EventKind::PredictionLock),
        "channel.prediction.end" => prediction(meta, ev, EventKind::PredictionEnd),
        "channel.shoutout.receive" => shoutout_received(meta, ev),
        "channel.ad_break.begin" => ad_break(meta, ev),
        "channel.charity_campaign.donate" => charity(meta, ev),
        "stream.online" => stream_online(meta, ev),
        "stream.offline" => Some(base(meta, EventKind::StreamOffline)),
        "channel.update" => channel_update(meta, ev),
        _ => None,
    };
    match event {
        Some(e) => Normalized::Event(Box::new(e)),
        None => Normalized::Ignore,
    }
}

pub fn follow(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::Follow);
    e.user = user(ev, "user");
    Some(e)
}

pub fn cheer(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::Cheer);
    e.is_anonymous = bool_of(ev, "is_anonymous");
    if !e.is_anonymous {
        e.user = user(ev, "user");
    }
    e.amount = Some(num_of(ev, "bits"));
    e.message = text(ev.get("message").and_then(Value::as_str).unwrap_or(""));
    Some(e)
}

pub fn raid(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::Raid);
    e.user = user(ev, "from_broadcaster_user");
    e.amount = Some(num_of(ev, "viewers"));
    Some(e)
}

pub fn redemption(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::Redemption);
    e.user = user(ev, "user");
    let reward = ev.get("reward").unwrap_or(&Value::Null);
    e.amount = Some(num_of(reward, "cost"));
    e.message = text(&str_of(ev, "user_input"));
    e.data
        .insert("reward_title".into(), str_of(reward, "title").into());
    e.data
        .insert("reward_id".into(), str_of(reward, "id").into());
    e.data
        .insert("redemption_id".into(), str_of(ev, "id").into());
    e.data.insert("status".into(), str_of(ev, "status").into());
    Some(e)
}

/// Only Power-ups; cheers arrive through `channel.cheer`.
pub fn bits_use(meta: Meta, ev: &Value) -> Option<Event> {
    if str_of(ev, "type") != "power_up" {
        return None;
    }
    let mut e = base(meta, EventKind::PowerUp);
    e.user = user(ev, "user");
    e.amount = Some(num_of(ev, "bits"));
    let power_up = ev.get("power_up").unwrap_or(&Value::Null);
    e.data
        .insert("power_up_type".into(), str_of(power_up, "type").into());
    if let Some(name) = power_up.pointer("/emote/name").and_then(Value::as_str) {
        e.data.insert("emote_name".into(), name.into());
    }
    if let Some(msg) = ev.get("message").filter(|m| !m.is_null()) {
        e.message = text(&str_of(msg, "text"));
        e.message_parts = parts(msg.get("fragments"));
    }
    Some(e)
}

/// Works for both version 1 and version 2 payloads.
pub fn hype_train(meta: Meta, ev: &Value, kind: EventKind) -> Option<Event> {
    let mut e = base(meta, kind);
    e.data
        .insert("hype_train_id".into(), str_of(ev, "id").into());
    e.data
        .insert("level".into(), json!(num_of(ev, "level") as u64));
    e.data
        .insert("total".into(), json!(num_of(ev, "total") as u64));
    for key in ["goal", "progress"] {
        if let Some(v) = ev.get(key).and_then(Value::as_u64) {
            e.data.insert(key.into(), json!(v));
        }
    }
    let golden = ev.get("is_golden_kappa_train").and_then(Value::as_bool) == Some(true)
        || ev.get("type").and_then(Value::as_str) == Some("golden_kappa");
    e.data.insert("is_golden_kappa".into(), golden.into());
    let top: Vec<Value> = ev
        .get("top_contributions")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .map(|c| {
                    json!({
                        "name": str_of(c, "user_name"),
                        "login": str_of(c, "user_login"),
                        "type": str_of(c, "type"),
                        "total": num_of(c, "total") as u64,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    e.data.insert("top_contributions".into(), top.into());
    e.amount = Some(num_of(ev, "total"));
    Some(e)
}

pub fn poll(meta: Meta, ev: &Value, kind: EventKind) -> Option<Event> {
    let mut e = base(meta, kind);
    let choices: Vec<Value> = list(ev, "choices")
        .iter()
        .map(|c| {
            json!({
                "id": str_of(c, "id"),
                "title": str_of(c, "title"),
                "votes": num_of(c, "votes") as u64,
                "bits_votes": num_of(c, "bits_votes") as u64,
                "channel_points_votes": num_of(c, "channel_points_votes") as u64,
            })
        })
        .collect();
    let status = match str_of(ev, "status") {
        s if s.is_empty() => "active".to_string(),
        s => s,
    };
    e.data.insert("poll_id".into(), str_of(ev, "id").into());
    e.data.insert("title".into(), str_of(ev, "title").into());
    e.data.insert("choices".into(), choices.into());
    e.data.insert("status".into(), status.into());
    for key in ["started_at", "ends_at", "ended_at"] {
        if let Some(ms) = ev.get(key).and_then(Value::as_str).and_then(parse_rfc3339) {
            e.data.insert(key.into(), json!(ms));
        }
    }
    Some(e)
}

pub fn prediction(meta: Meta, ev: &Value, kind: EventKind) -> Option<Event> {
    let mut e = base(meta, kind);
    let outcomes: Vec<Value> = list(ev, "outcomes")
        .iter()
        .map(|o| {
            json!({
                "id": str_of(o, "id"),
                "title": str_of(o, "title"),
                "color": str_of(o, "color"),
                "users": num_of(o, "users") as u64,
                "channel_points": num_of(o, "channel_points") as u64,
            })
        })
        .collect();
    let status = match (kind, str_of(ev, "status")) {
        (_, s) if !s.is_empty() => s,
        (EventKind::PredictionLock, _) => "locked".into(),
        _ => "active".into(),
    };
    e.data
        .insert("prediction_id".into(), str_of(ev, "id").into());
    e.data.insert("title".into(), str_of(ev, "title").into());
    e.data.insert("outcomes".into(), outcomes.into());
    e.data.insert("status".into(), status.into());
    let winner = str_of(ev, "winning_outcome_id");
    if !winner.is_empty() {
        e.data.insert("winning_outcome_id".into(), winner.into());
    }
    for key in ["started_at", "locks_at", "locked_at", "ended_at"] {
        if let Some(ms) = ev.get(key).and_then(Value::as_str).and_then(parse_rfc3339) {
            e.data.insert(key.into(), json!(ms));
        }
    }
    Some(e)
}

pub fn shoutout_received(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::ShoutoutReceived);
    e.user = user(ev, "from_broadcaster_user");
    e.amount = Some(num_of(ev, "viewer_count"));
    Some(e)
}

pub fn ad_break(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::AdBreak);
    e.amount = Some(num_of(ev, "duration_seconds"));
    let automatic = match ev.get("is_automatic") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true",
        _ => false,
    };
    e.data.insert("is_automatic".into(), automatic.into());
    Some(e)
}

pub fn charity(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::Charity);
    e.user = user(ev, "user");
    let amount = ev.get("amount").unwrap_or(&Value::Null);
    let places = num_of(amount, "decimal_places").clamp(0.0, 8.0) as i32;
    e.amount = Some(num_of(amount, "value") / 10f64.powi(places));
    let currency = str_of(amount, "currency");
    if !currency.is_empty() {
        e.currency = Some(currency);
    }
    e.data
        .insert("charity_name".into(), str_of(ev, "charity_name").into());
    e.data
        .insert("campaign_id".into(), str_of(ev, "campaign_id").into());
    Some(e)
}

pub fn stream_online(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::StreamOnline);
    if let Some(ms) = parse_rfc3339(&str_of(ev, "started_at")) {
        e.data.insert("started_at".into(), json!(ms));
    }
    e.data.insert("type".into(), str_of(ev, "type").into());
    Some(e)
}

pub fn channel_update(meta: Meta, ev: &Value) -> Option<Event> {
    let mut e = base(meta, EventKind::ChannelUpdate);
    e.data.insert("title".into(), str_of(ev, "title").into());
    e.data
        .insert("category_name".into(), str_of(ev, "category_name").into());
    e.data
        .insert("category_id".into(), str_of(ev, "category_id").into());
    e.data
        .insert("language".into(), str_of(ev, "language").into());
    Some(e)
}

pub fn chat_message(meta: Meta, ev: &Value) -> Option<Event> {
    if from_other_channel(meta, ev) {
        return None;
    }
    let message_id = str_of(ev, "message_id");
    if message_id.is_empty() {
        return None;
    }
    let mut e = base(meta, EventKind::Chat);
    // Chat events use the chat message id so deletes and replies can find them.
    e.id = message_id;
    e.user = user(ev, "chatter_user");
    let msg = ev.get("message").unwrap_or(&Value::Null);
    e.message = Some(str_of(msg, "text"));
    e.message_parts = parts(msg.get("fragments"));
    e.roles = roles(ev, meta.broadcaster_id);
    e.data.insert("color".into(), str_of(ev, "color").into());
    e.data.insert("badges".into(), badge_ids(ev).into());
    e.data
        .insert("message_type".into(), str_of(ev, "message_type").into());
    if let Some(parent) = ev
        .pointer("/reply/parent_message_id")
        .and_then(Value::as_str)
    {
        e.data
            .insert("reply_parent_message_id".into(), parent.into());
    }
    let bits = ev
        .pointer("/cheer/bits")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if bits > 0 {
        e.data.insert("cheer_bits".into(), json!(bits));
    }
    let reward = str_of(ev, "channel_points_custom_reward_id");
    if !reward.is_empty() {
        e.data.insert("reward_id".into(), reward.into());
    }
    Some(e)
}

/// Subs, resubs and gifts.
pub fn chat_notification(meta: Meta, ev: &Value) -> Option<Event> {
    if from_other_channel(meta, ev) {
        return None;
    }
    let notice = str_of(ev, "notice_type");
    let anonymous = bool_of(ev, "chatter_is_anonymous");
    let chatter = if anonymous {
        None
    } else {
        user(ev, "chatter_user")
    };
    let detail = ev.get(notice.as_str()).unwrap_or(&Value::Null);
    let mut e = match notice.as_str() {
        "sub" => {
            let mut e = base(meta, EventKind::Sub);
            e.months = Some(1);
            set_tier(&mut e, detail);
            insert_num(&mut e, "duration_months", detail);
            e
        }
        "resub" => {
            let mut e = base(meta, EventKind::Resub);
            e.months = Some(num_of(detail, "cumulative_months") as u32);
            e.is_gift = bool_of(detail, "is_gift");
            set_tier(&mut e, detail);
            insert_num(&mut e, "duration_months", detail);
            insert_num(&mut e, "streak_months", detail);
            e
        }
        "sub_gift" => {
            let mut e = base(meta, EventKind::GiftSub);
            e.is_gift = true;
            e.recipient = user(detail, "recipient_user");
            set_tier(&mut e, detail);
            insert_num(&mut e, "duration_months", detail);
            insert_num(&mut e, "cumulative_total", detail);
            let gift_id = str_of(detail, "community_gift_id");
            if !gift_id.is_empty() {
                e.data.insert("community_gift_id".into(), gift_id.into());
            }
            e
        }
        "community_sub_gift" => {
            let mut e = base(meta, EventKind::CommunityGift);
            e.is_gift = true;
            e.amount = Some(num_of(detail, "total"));
            set_tier(&mut e, detail);
            insert_num(&mut e, "cumulative_total", detail);
            e.data
                .insert("community_gift_id".into(), str_of(detail, "id").into());
            e
        }
        "gift_paid_upgrade" | "prime_paid_upgrade" => {
            let mut e = base(meta, EventKind::Sub);
            if notice == "prime_paid_upgrade" {
                set_tier(&mut e, detail);
            }
            e.data.insert("upgrade".into(), notice.clone().into());
            e
        }
        _ => return None,
    };
    e.is_anonymous = anonymous;
    e.user = chatter;
    e.roles = roles(ev, meta.broadcaster_id);
    if let Some(msg) = ev.get("message").filter(|m| !m.is_null()) {
        e.message = text(&str_of(msg, "text"));
        if e.message.is_some() {
            e.message_parts = parts(msg.get("fragments"));
        }
    }
    let system = str_of(ev, "system_message");
    if !system.is_empty() {
        e.data.insert("system_message".into(), system.into());
    }
    Some(e)
}

fn base(meta: Meta, kind: EventKind) -> Event {
    let mut e = Event::new(kind);
    if !meta.message_id.is_empty() {
        e.id = meta.message_id.to_string();
    }
    e.ts = meta.ts;
    e
}

fn from_other_channel(meta: Meta, ev: &Value) -> bool {
    let source = str_of(ev, "source_broadcaster_user_id");
    !source.is_empty() && source != meta.broadcaster_id
}

/// Reads `{prefix}_id`, `{prefix}_login` and `{prefix}_name`.
fn user(v: &Value, prefix: &str) -> Option<EventUser> {
    let id = str_of(v, &format!("{prefix}_id"));
    let login = str_of(v, &format!("{prefix}_login"));
    let name = str_of(v, &format!("{prefix}_name"));
    if id.is_empty() && login.is_empty() && name.is_empty() {
        return None;
    }
    Some(EventUser {
        id,
        display_name: if name.is_empty() { login.clone() } else { name },
        login,
    })
}

fn set_tier(e: &mut Event, detail: &Value) {
    if bool_of(detail, "is_prime") {
        e.tier = Some(1);
        e.data.insert("is_prime".into(), true.into());
        return;
    }
    e.tier = match str_of(detail, "sub_tier").as_str() {
        "1000" => Some(1),
        "2000" => Some(2),
        "3000" => Some(3),
        _ => None,
    };
    e.data.insert("is_prime".into(), false.into());
}

fn insert_num(e: &mut Event, key: &str, v: &Value) {
    if let Some(n) = v.get(key).and_then(Value::as_u64) {
        e.data.insert(key.into(), json!(n));
    }
}

fn roles(ev: &Value, broadcaster_id: &str) -> UserRoles {
    let ids: Vec<String> = badge_ids(ev);
    let has = |id: &str| ids.iter().any(|b| b == id);
    UserRoles {
        broadcaster: has("broadcaster")
            || (!broadcaster_id.is_empty() && str_of(ev, "chatter_user_id") == broadcaster_id),
        moderator: has("moderator"),
        vip: has("vip"),
        subscriber: has("subscriber") || has("founder"),
    }
}

fn badge_ids(ev: &Value) -> Vec<String> {
    list(ev, "badges")
        .iter()
        .map(|b| str_of(b, "set_id"))
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn parts(fragments: Option<&Value>) -> Vec<MessagePart> {
    let Some(list) = fragments.and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|f| {
            let text = str_of(f, "text");
            match str_of(f, "type").as_str() {
                "emote" => Some(MessagePart::Emote {
                    id: f
                        .pointer("/emote/id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                    text,
                }),
                "cheermote" => {
                    let c = f.get("cheermote").unwrap_or(&Value::Null);
                    Some(MessagePart::Cheermote {
                        prefix: str_of(c, "prefix"),
                        bits: num_of(c, "bits") as u32,
                        text,
                    })
                }
                "mention" => Some(MessagePart::Mention {
                    login: f
                        .pointer("/mention/user_login")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                    text,
                }),
                _ if text.is_empty() => None,
                _ => Some(MessagePart::Text { text }),
            }
        })
        .collect()
}

fn text(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_string())
}

fn list<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

pub(crate) fn str_of(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

pub(crate) fn num_of(v: &Value, key: &str) -> f64 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn bool_of(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Milliseconds since the epoch for an RFC 3339 time such as
/// `2023-07-19T14:56:51.634234626Z` or `2021-03-10T15:04:21+01:00`.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't' | b' ') {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (year, month, day) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (hour, min, sec) = (n(11..13)?, n(14..16)?, n(17..19)?);
    if b[13] != b':' || b[16] != b':' || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut i = 19;
    let mut millis = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i];
        if frac.is_empty() {
            return None;
        }
        let ms: String = frac.chars().chain("000".chars()).take(3).collect();
        millis = ms.parse().ok()?;
    }
    let offset_min = match s.get(i..)? {
        "Z" | "z" => 0,
        tz if tz.len() == 6 && (tz.starts_with('+') || tz.starts_with('-')) => {
            let h: i64 = tz.get(1..3)?.parse().ok()?;
            let m: i64 = tz.get(4..6)?.parse().ok()?;
            let sign = if tz.starts_with('-') { -1 } else { 1 };
            sign * (h * 60 + m)
        }
        _ => return None,
    };
    // Days from civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hour * 3600 + min * 60 + sec - offset_min * 60;
    Some(secs * 1000 + millis)
}
