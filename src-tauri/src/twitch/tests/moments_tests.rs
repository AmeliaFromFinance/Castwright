//! Stream markers and clips against the mock Twitch server.

use super::*;
use crate::sessions::LiveSignal;
use crate::twitch::moments::{CLIPS_OFFLINE, MARKERS_OFFLINE, parse_clip, parse_marker};

pub(super) fn reply_for(m: &mut Mock, rec: &Rec, path: &str) -> Option<Response> {
    let r = match (rec.method.as_str(), path) {
        ("POST", "/streams/markers" | "/clips") if m.offline => reply(
            404,
            json!({"error": "Not Found", "status": 404, "message": "user is not live"}),
        ),
        ("POST", "/streams/markers") => reply(
            200,
            json!({"data": [{"id": "mk1", "created_at": "2030-01-01T00:00:00Z",
                             "description": rec.json()["description"], "position_seconds": 5025}]}),
        ),
        ("GET", "/clips") if m.clip_busy > 0 => {
            m.clip_busy -= 1;
            reply(200, json!({"data": [], "pagination": {}}))
        }
        ("GET", "/clips") => reply(
            200,
            json!({"data": [{"id": rec.query["id"], "url": "https://clips.twitch.tv/ShinyClip",
                             "title": "Clutch round", "view_count": 0}]}),
        ),
        _ => return None,
    };
    Some(r)
}

fn go_live(s: &Setup) {
    let sig = LiveSignal {
        twitch: None,
        obs: Some(true),
    };
    s.hub
        .sessions
        .tick(&sig, crate::util::now_ms() - 10 * 60_000);
}

fn summary(s: &Setup) -> crate::model::session::SessionSummary {
    let id = s.hub.sessions.current().unwrap().id;
    s.hub.sessions.summary(id).unwrap().unwrap()
}

#[tokio::test]
async fn adds_a_marker_and_keeps_it() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    go_live(&s);
    let m = s.svc.add_marker("  Marker 1 · 1:23:45 ").await.unwrap();
    assert_eq!(m.id, "mk1");
    assert_eq!(m.position_s, 5025);
    assert_eq!(m.description, "Marker 1 · 1:23:45");

    let post = mock
        .requests("POST", "/helix/streams/markers")
        .pop()
        .unwrap();
    assert_eq!(post.auth, "Bearer access-b");
    assert_eq!(
        post.json(),
        json!({"user_id": "1337", "description": "Marker 1 · 1:23:45"})
    );

    let long = "x".repeat(200);
    s.svc.add_marker(&long).await.unwrap();
    let post = mock
        .requests("POST", "/helix/streams/markers")
        .pop()
        .unwrap();
    assert_eq!(
        post.json()["description"].as_str().unwrap().chars().count(),
        140
    );

    let sum = summary(&s);
    assert_eq!(sum.markers.len(), 2);
    assert_eq!(sum.markers[0].id, "mk1");
    assert_eq!(sum.markers[0].position_s, 5025);
    assert_eq!(s.hub.sessions.marker_count(), 2);
}

#[tokio::test]
async fn makes_a_clip_and_waits_for_its_link() {
    let mock = MockServer::start().await;
    mock.set(|m| m.clip_busy = 2);
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    go_live(&s);
    let clip = s.svc.start_clip().await.unwrap();
    assert_eq!(clip.id, "clip1");
    assert_eq!(clip.edit_url, "https://clips.twitch.tv/clip1/edit");
    assert_eq!(summary(&s).clips[0].url, "https://clips.twitch.tv/clip1");

    let done = s.svc.wait_for_clip(&clip.id).await.expect("clip ready");
    assert_eq!(done.url, "https://clips.twitch.tv/ShinyClip");
    assert_eq!(done.title, "Clutch round");
    let gets = mock.requests("GET", "/helix/clips");
    assert_eq!(gets.len(), 3, "two empty replies, then the clip");
    assert_eq!(gets[0].query["id"], "clip1");

    let saved = &summary(&s).clips[0];
    assert_eq!(saved.url, "https://clips.twitch.tv/ShinyClip");
    assert_eq!(saved.title, "Clutch round");
}

#[tokio::test]
async fn gives_up_on_a_slow_clip() {
    let mock = MockServer::start().await;
    mock.set(|m| m.clip_busy = 1000);
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    go_live(&s);
    let clip = s.svc.start_clip().await.unwrap();
    assert!(s.svc.wait_for_clip(&clip.id).await.is_none());
    let polls = mock.requests("GET", "/helix/clips").len();
    assert!((5..=20).contains(&polls), "{polls} polls");
    assert_eq!(
        summary(&s).clips[0].url,
        "https://clips.twitch.tv/clip1",
        "the plain link is kept"
    );
}

#[tokio::test]
async fn offline_markers_and_clips_fail_nicely() {
    let mock = MockServer::start().await;
    mock.set(|m| m.offline = true);
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    let err = s.svc.add_marker("x").await.unwrap_err().to_string();
    assert_eq!(err, MARKERS_OFFLINE);
    let err = s.svc.start_clip().await.unwrap_err().to_string();
    assert_eq!(err, CLIPS_OFFLINE);

    // Once Twitch says the stream is offline, nothing is sent.
    let before = mock.requests("POST", "/helix/streams/markers").len();
    s.svc.state.lock().unwrap().stream_known = true;
    let err = s.svc.add_marker("x").await.unwrap_err().to_string();
    assert_eq!(err, MARKERS_OFFLINE);
    assert_eq!(
        mock.requests("POST", "/helix/streams/markers").len(),
        before
    );
}

#[test]
fn parses_helix_replies() {
    let v = json!({"data": [{"id": "9", "description": "", "position_seconds": 61}]});
    let m = parse_marker(&v, "fallback").unwrap();
    assert_eq!((m.id.as_str(), m.position_s), ("9", 61));
    assert_eq!(m.description, "fallback");
    assert!(parse_marker(&json!({"data": []}), "x").is_none());

    assert!(parse_clip(&json!({"data": []})).is_none());
    assert!(parse_clip(&json!({"data": [{"id": "a", "url": ""}]})).is_none());
    assert_eq!(
        parse_clip(
            &json!({"data": [{"id": "a", "url": "https://clips.twitch.tv/A", "title": "T"}]})
        ),
        Some(("https://clips.twitch.tv/A".into(), "T".into()))
    );
}
