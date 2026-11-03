//! Mod tools against the mock Twitch server.

use super::*;
use crate::hub::RecordingUi;
use crate::model::automation::Toggle;
use crate::model::moderation::ChatMode;
use crate::model::runtime::OverlayMsg;
use crate::store::db::Db;
use crate::vars::Vars;

/// Replies for the moderation endpoints, or None to fall through.
pub(super) fn reply_for(rec: &Rec, path: &str) -> Option<Response> {
    let r = match (rec.method.as_str(), path) {
        ("GET", "/users") if rec.query.contains_key("id") => reply(
            200,
            json!({"data": [{"id": rec.query["id"], "login": "nova_kat", "display_name": "Nova_Kat",
                             "profile_image_url": "https://example.com/n.png",
                             "created_at": "2020-03-01T10:00:00Z"}]}),
        ),
        ("GET", "/channels/followers") => reply(
            200,
            json!({"data": [{"user_id": "999", "followed_at": "2024-01-02T03:04:05Z"}], "total": 1}),
        ),
        ("GET", "/subscriptions") => reply(
            200,
            json!({"data": [{"user_id": "999", "tier": "2000", "is_gift": true}]}),
        ),
        ("GET", "/moderation/banned") => reply(
            200,
            json!({"data": [{"user_id": "999", "expires_at": "2030-01-01T00:00:00Z"}]}),
        ),
        ("GET", "/chat/settings") => reply(
            200,
            json!({"data": [{"broadcaster_id": "1337", "slow_mode": true, "slow_mode_wait_time": 10,
                             "follower_mode": false, "follower_mode_duration": null,
                             "subscriber_mode": false, "emote_mode": true, "unique_chat_mode": false}]}),
        ),
        ("PATCH", "/chat/settings") => reply(200, json!({"data": [rec.json()]})),
        ("GET", "/moderation/shield_mode") => reply(200, json!({"data": [{"is_active": true}]})),
        ("PUT", "/moderation/shield_mode") => reply(200, json!({"data": [rec.json()]})),
        ("POST", "/moderation/bans") => reply(200, json!({"data": [{"user_id": "999"}]})),
        ("DELETE", "/moderation/bans") | ("DELETE", "/moderation/chat") => reply(204, Value::Null),
        _ => return None,
    };
    Some(r)
}

#[tokio::test]
async fn mod_calls_send_the_right_requests() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);

    s.svc.delete_chat_message("msg-1").await.unwrap();
    let d = mock
        .requests("DELETE", "/helix/moderation/chat")
        .pop()
        .unwrap();
    assert_eq!(d.query["message_id"], "msg-1");
    assert_eq!(d.query["broadcaster_id"], "1337");
    assert_eq!(d.query["moderator_id"], "1337");
    assert!(s.svc.delete_chat_message("  ").await.is_err());

    s.svc.ban("999", Some(600), " spam ").await.unwrap();
    let b = mock
        .requests("POST", "/helix/moderation/bans")
        .pop()
        .unwrap();
    assert_eq!(
        b.json(),
        json!({"data": {"user_id": "999", "reason": "spam", "duration": 600}})
    );
    s.svc.ban("999", Some(9_999_999), "").await.unwrap();
    let b = mock
        .requests("POST", "/helix/moderation/bans")
        .pop()
        .unwrap();
    assert_eq!(b.json()["data"]["duration"], 1_209_600);
    s.svc.ban("999", None, "").await.unwrap();
    let b = mock
        .requests("POST", "/helix/moderation/bans")
        .pop()
        .unwrap();
    assert!(
        b.json()["data"].get("duration").is_none(),
        "a ban has no duration"
    );

    s.svc.unban("999").await.unwrap();
    let u = mock
        .requests("DELETE", "/helix/moderation/bans")
        .pop()
        .unwrap();
    assert_eq!(u.query["user_id"], "999");

    let modes = s.svc.chat_modes().await.unwrap();
    assert!(modes.shield && modes.slow && modes.emotes && !modes.followers);
    assert_eq!(modes.slow_wait_s, 10);

    s.svc.set_mode(ChatMode::Followers, true, 30).await.unwrap();
    let p = mock
        .requests("PATCH", "/helix/chat/settings")
        .pop()
        .unwrap();
    assert_eq!(
        p.json(),
        json!({"follower_mode": true, "follower_mode_duration": 30})
    );
    s.svc.set_mode(ChatMode::Shield, false, 0).await.unwrap();
    let sh = mock
        .requests("PUT", "/helix/moderation/shield_mode")
        .pop()
        .unwrap();
    assert_eq!(sh.json(), json!({"is_active": false}));

    // Toggle reads the current state first: emote-only is on, so it goes off.
    s.svc
        .set_chat_mode(ChatMode::Emotes, Toggle::Toggle, 0)
        .await
        .unwrap();
    let p = mock
        .requests("PATCH", "/helix/chat/settings")
        .pop()
        .unwrap();
    assert_eq!(p.json(), json!({"emote_mode": false}));

    s.svc.delete_message("msg-2").await.unwrap();
    assert_eq!(
        mock.requests("DELETE", "/helix/moderation/chat")
            .pop()
            .unwrap()
            .query["message_id"],
        "msg-2"
    );
}

#[tokio::test]
async fn viewer_card_collects_what_twitch_shares() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    let card = s.svc.viewer("999").await.unwrap();
    assert_eq!(card.id, "999");
    assert_eq!(card.display_name, "Nova_Kat");
    assert_eq!(card.created_at, parse("2020-03-01T10:00:00Z"));
    assert_eq!(card.followed_at, parse("2024-01-02T03:04:05Z"));
    assert_eq!(card.sub_tier.as_deref(), Some("2000"));
    assert!(card.sub_gifted);
    assert!(card.banned);
    assert_eq!(card.banned_until, parse("2030-01-01T00:00:00Z"));
    assert_eq!(
        mock.requests("GET", "/helix/channels/followers")[0].query["user_id"],
        "999"
    );
}

fn parse(s: &str) -> Option<i64> {
    crate::twitch::normalize::parse_rfc3339(s)
}

#[tokio::test]
async fn not_signed_in() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", |_| {});
    let err = s.svc.ban("999", None, "").await.unwrap_err();
    assert!(err.to_string().contains("Sign in"), "{err}");
    assert!(mock.requests("POST", "/helix/moderation/bans").is_empty());
}

#[tokio::test]
async fn delete_events_reach_the_window_and_overlays() {
    let rec = Arc::new(RecordingUi::default());
    let hub = Hub::new(
        rec.clone(),
        Arc::new(Vars::new()),
        Arc::new(Db::open_in_memory()),
    );
    let mut ov = hub.subscribe_overlays();
    hub.delete_chat("m1");
    hub.clear_chat_user("u1");
    hub.clear_chat();
    let sent: Vec<Value> = rec
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|(n, _)| n == crate::hub::ui::CHAT_DELETE)
        .map(|(_, v)| v.clone())
        .collect();
    assert_eq!(
        sent,
        vec![
            json!({"message_id": "m1"}),
            json!({"user_id": "u1"}),
            json!({"all": true})
        ]
    );
    assert!(matches!(
        ov.recv().await.unwrap().msg,
        OverlayMsg::ChatDelete { message_id } if message_id == "m1"
    ));
    assert!(matches!(
        ov.recv().await.unwrap().msg,
        OverlayMsg::ChatClearUser { user_id } if user_id == "u1"
    ));
    assert!(matches!(
        ov.recv().await.unwrap().msg,
        OverlayMsg::ChatClear
    ));
}
