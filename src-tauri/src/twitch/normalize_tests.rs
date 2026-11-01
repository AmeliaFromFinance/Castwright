use super::normalize::{Meta, Normalized, normalize, parse_rfc3339};
use crate::model::event::{Event, EventKind, MessagePart};
use serde_json::{Value, json};

pub(crate) fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/tests/fixtures/twitch/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn run(name: &str) -> Normalized {
    let v = fixture(name);
    let meta = &v["metadata"];
    normalize(
        meta["subscription_type"].as_str().unwrap(),
        Meta {
            message_id: meta["message_id"].as_str().unwrap(),
            ts: parse_rfc3339(meta["message_timestamp"].as_str().unwrap()).unwrap(),
            broadcaster_id: "1337",
        },
        &v["payload"]["event"],
    )
}

fn ev(name: &str) -> Event {
    match run(name) {
        Normalized::Event(e) => *e,
        other => panic!("{name}: expected an event, got {other:?}"),
    }
}

fn name(e: &Event) -> &str {
    &e.user.as_ref().expect("user").display_name
}

#[test]
fn rfc3339() {
    assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(
        parse_rfc3339("2020-10-11T10:11:12.123Z"),
        Some(1_602_411_072_123)
    );
    assert_eq!(
        parse_rfc3339("2023-07-19T10:11:12.634234626Z"),
        Some(1_689_761_472_634)
    );
    assert_eq!(
        parse_rfc3339("2020-10-11T12:11:12+02:00"),
        Some(1_602_411_072_000)
    );
    assert_eq!(parse_rfc3339("2000-02-29T00:00:00Z"), Some(951_782_400_000));
    for bad in [
        "",
        "yesterday",
        "2020-13-01T00:00:00Z",
        "2020-10-11T10:11:12",
        "2020-10-11",
    ] {
        assert_eq!(parse_rfc3339(bad), None, "{bad}");
    }
}

#[test]
fn follow() {
    let e = ev("follow");
    assert_eq!(e.kind, EventKind::Follow);
    assert_eq!(e.id, "msg-follow");
    assert_eq!(e.ts, 1_689_761_472_634);
    let u = e.user.unwrap();
    assert_eq!((u.id.as_str(), u.login.as_str()), ("1234", "cool_user"));
    assert_eq!(u.display_name, "Cool_User");
}

#[test]
fn cheer() {
    let e = ev("cheer");
    assert_eq!(e.kind, EventKind::Cheer);
    assert_eq!(e.amount, Some(1000.0));
    assert_eq!(e.message.as_deref(), Some("pogchamp"));
    assert!(!e.is_anonymous);
    assert_eq!(name(&e), "Cool_User");

    let a = ev("cheer_anonymous");
    assert!(a.is_anonymous);
    assert!(a.user.is_none());
    assert_eq!(a.message, None);
    assert_eq!(a.amount, Some(100.0));
}

#[test]
fn raid() {
    let e = ev("raid");
    assert_eq!(e.kind, EventKind::Raid);
    assert_eq!(name(&e), "Cool_User");
    assert_eq!(e.user.as_ref().unwrap().id, "1234");
    assert_eq!(e.amount, Some(9001.0));
}

#[test]
fn redemption() {
    let e = ev("redemption");
    assert_eq!(e.kind, EventKind::Redemption);
    assert_eq!(name(&e), "Cooler_User");
    assert_eq!(e.amount, Some(100.0));
    assert_eq!(e.message.as_deref(), Some("pogchamp"));
    assert_eq!(e.data["reward_title"], "title");
    assert_eq!(e.data["reward_id"], "92af127c-7326-4483-a52b-b0da0be61c01");
    assert_eq!(
        e.data["redemption_id"],
        "17fa2df1-ad76-4804-bfa5-a40ef63efe63"
    );
}

#[test]
fn power_up_only() {
    let e = ev("bits_use_power_up");
    assert_eq!(e.kind, EventKind::PowerUp);
    assert_eq!(e.amount, Some(50.0));
    assert_eq!(e.data["power_up_type"], "gigantify_an_emote");
    assert_eq!(e.data["emote_name"], "MegaCheer");
    assert_eq!(name(&e), "TwitchDev");
    assert_eq!(e.message.as_deref(), Some("hello MegaCheer"));
    assert_eq!(e.message_parts.len(), 2);
    assert_eq!(run("bits_use_cheer"), Normalized::Ignore);
}

#[test]
fn hype_train() {
    let b = ev("hype_train_begin");
    assert_eq!(b.kind, EventKind::HypeTrainBegin);
    assert_eq!(b.data["level"], 2);
    assert_eq!(b.data["total"], 137);
    assert_eq!(b.data["goal"], 500);
    assert_eq!(b.data["progress"], 137);
    assert_eq!(b.data["is_golden_kappa"], false);
    assert_eq!(b.data["top_contributions"][1]["name"], "Kappa");

    let p = ev("hype_train_progress_v2");
    assert_eq!(p.kind, EventKind::HypeTrainProgress);
    assert_eq!(p.data["goal"], 1000);
    assert_eq!(p.data["progress"], 200);
    assert_eq!(p.data["is_golden_kappa"], true);

    let end = ev("hype_train_end");
    assert_eq!(end.kind, EventKind::HypeTrainEnd);
    assert_eq!(end.data["level"], 2);
    assert!(!end.data.contains_key("goal"));
}

#[test]
fn polls() {
    let b = ev("poll_begin");
    assert_eq!(b.kind, EventKind::PollBegin);
    assert_eq!(b.data["title"], "Aren’t shoes just really hard socks?");
    assert_eq!(b.data["status"], "active");
    assert_eq!(b.data["choices"].as_array().unwrap().len(), 3);
    assert_eq!(b.data["choices"][0]["votes"], 0);
    assert!(b.data["ends_at"].is_i64());

    let p = ev("poll_progress");
    assert_eq!(p.kind, EventKind::PollProgress);
    assert_eq!(p.data["choices"][1]["votes"], 14);
    assert_eq!(p.data["choices"][1]["bits_votes"], 10);

    let e = ev("poll_end");
    assert_eq!(e.kind, EventKind::PollEnd);
    assert_eq!(e.data["status"], "completed");
    assert_eq!(e.data["choices"][1]["title"], "Yellow");
}

#[test]
fn predictions() {
    let b = ev("prediction_begin");
    assert_eq!(b.kind, EventKind::PredictionBegin);
    assert_eq!(b.data["status"], "active");
    assert_eq!(b.data["outcomes"][1]["color"], "pink");

    let l = ev("prediction_lock");
    assert_eq!(l.kind, EventKind::PredictionLock);
    assert_eq!(l.data["status"], "locked");
    assert_eq!(l.data["outcomes"][0]["channel_points"], 15000);
    assert_eq!(l.data["outcomes"][0]["users"], 10);

    let e = ev("prediction_end");
    assert_eq!(e.kind, EventKind::PredictionEnd);
    assert_eq!(e.data["status"], "resolved");
    assert_eq!(e.data["winning_outcome_id"], "12345");
}

#[test]
fn shoutout_received() {
    let e = ev("shoutout_receive");
    assert_eq!(e.kind, EventKind::ShoutoutReceived);
    assert_eq!(name(&e), "SimplySimple");
    assert_eq!(e.amount, Some(860.0));
}

#[test]
fn ad_break() {
    // Twitch's documented example sends these as strings.
    let e = ev("ad_break_begin");
    assert_eq!(e.kind, EventKind::AdBreak);
    assert_eq!(e.amount, Some(60.0));
    assert_eq!(e.data["is_automatic"], false);
}

#[test]
fn charity() {
    let e = ev("charity_donate");
    assert_eq!(e.kind, EventKind::Charity);
    assert_eq!(e.amount, Some(100.0));
    assert_eq!(e.currency.as_deref(), Some("USD"));
    assert_eq!(name(&e), "GenerousUser1");
    assert_eq!(e.data["charity_name"], "Example name");
}

#[test]
fn stream_and_channel() {
    let on = ev("stream_online");
    assert_eq!(on.kind, EventKind::StreamOnline);
    assert_eq!(on.data["started_at"], 1_602_411_072_123i64);
    assert_eq!(ev("stream_offline").kind, EventKind::StreamOffline);
    let up = ev("channel_update");
    assert_eq!(up.kind, EventKind::ChannelUpdate);
    assert_eq!(up.data["title"], "Best Stream Ever");
    assert_eq!(up.data["category_name"], "Grand Theft Auto");
}

#[test]
fn chat_message() {
    let e = ev("chat_message");
    assert_eq!(e.kind, EventKind::Chat);
    assert_eq!(e.id, "cc106a89-1814-919d-454c-f4f2f970aae7");
    assert_eq!(name(&e), "VIPTwitch");
    assert_eq!(
        e.message.as_deref(),
        Some("Hi chat cheer100 @Cool_User Kappa")
    );
    assert_eq!(
        e.message_parts,
        vec![
            MessagePart::Text {
                text: "Hi chat ".into()
            },
            MessagePart::Cheermote {
                text: "cheer100".into(),
                prefix: "cheer".into(),
                bits: 100
            },
            MessagePart::Text { text: " ".into() },
            MessagePart::Mention {
                text: "@Cool_User".into(),
                login: "cool_user".into()
            },
            MessagePart::Text { text: " ".into() },
            MessagePart::Emote {
                text: "Kappa".into(),
                id: "25".into()
            },
        ]
    );
    assert!(e.roles.moderator && e.roles.subscriber);
    assert!(!e.roles.vip && !e.roles.broadcaster);
    assert_eq!(e.data["color"], "#00FF7F");
    assert_eq!(
        e.data["badges"],
        json!(["moderator", "subscriber", "sub-gifter"])
    );
    assert_eq!(e.data["reply_parent_message_id"], "aaaa-bbbb");
    assert_eq!(e.data["cheer_bits"], 100);
}

#[test]
fn shared_chat_from_other_channel_is_skipped() {
    assert_eq!(run("chat_message_shared"), Normalized::Ignore);
    assert_eq!(run("notice_shared_chat_sub"), Normalized::Ignore);
}

#[test]
fn broadcaster_role_from_id() {
    let mut v = fixture("chat_message");
    let event = &mut v["payload"]["event"];
    event["chatter_user_id"] = json!("1337");
    event["badges"] = json!([]);
    let n = normalize(
        "channel.chat.message",
        Meta {
            message_id: "x",
            ts: 0,
            broadcaster_id: "1337",
        },
        event,
    );
    let Normalized::Event(e) = n else { panic!() };
    assert!(e.roles.broadcaster);
}

#[test]
fn sub() {
    let e = ev("notice_sub");
    assert_eq!(e.kind, EventKind::Sub);
    assert_eq!(e.tier, Some(1));
    assert_eq!(e.months, Some(1));
    assert_eq!(e.data["is_prime"], false);
    assert_eq!(e.message, None);
    assert_eq!(name(&e), "viewer23");
    assert!(e.roles.subscriber);

    let p = ev("notice_sub_prime");
    assert_eq!(p.tier, Some(1));
    assert_eq!(p.data["is_prime"], true);
}

#[test]
fn resub() {
    let e = ev("notice_resub");
    assert_eq!(e.kind, EventKind::Resub);
    assert_eq!(e.months, Some(10));
    assert_eq!(e.tier, Some(2));
    assert_eq!(e.message.as_deref(), Some("Love the stream! Kappa"));
    assert_eq!(e.message_parts.len(), 2);
    assert!(!e.is_gift);
}

#[test]
fn gift_subs() {
    let e = ev("notice_sub_gift");
    assert_eq!(e.kind, EventKind::GiftSub);
    assert!(e.is_gift);
    assert_eq!(e.tier, Some(3));
    assert_eq!(name(&e), "viewer23");
    let r = e.recipient.unwrap();
    assert_eq!(
        (r.id.as_str(), r.display_name.as_str()),
        ("135711", "Lucky_One")
    );
    assert_eq!(e.data["community_gift_id"], "14822548394719045291");

    let a = ev("notice_sub_gift_anonymous");
    assert!(a.is_anonymous);
    assert!(a.user.is_none());
    assert!(!a.data.contains_key("community_gift_id"));

    let c = ev("notice_community_sub_gift");
    assert_eq!(c.kind, EventKind::CommunityGift);
    assert_eq!(c.amount, Some(5.0));
    assert_eq!(c.tier, Some(1));
    assert_eq!(c.data["community_gift_id"], "14822548394719045291");
}

#[test]
fn upgrades_are_subs() {
    let g = ev("notice_gift_paid_upgrade");
    assert_eq!(g.kind, EventKind::Sub);
    assert_eq!(g.data["upgrade"], "gift_paid_upgrade");
    let p = ev("notice_prime_paid_upgrade");
    assert_eq!(p.kind, EventKind::Sub);
    assert_eq!(p.tier, Some(1));
}

#[test]
fn raid_notice_is_ignored() {
    assert_eq!(run("notice_raid"), Normalized::Ignore);
}

#[test]
fn chat_moderation() {
    assert_eq!(
        run("message_delete"),
        Normalized::DeleteChat("ab24e0b0-2260-4bac-94e4-05eedd4ecd0e".into())
    );
    assert_eq!(
        run("clear_user_messages"),
        Normalized::ClearUser("7734".into())
    );
    assert_eq!(run("chat_clear"), Normalized::ClearChat);
}

#[test]
fn unknown_types_are_ignored() {
    assert_eq!(
        normalize(
            "channel.something_new",
            Meta {
                message_id: "x",
                ts: 0,
                broadcaster_id: "1"
            },
            &json!({})
        ),
        Normalized::Ignore
    );
}
