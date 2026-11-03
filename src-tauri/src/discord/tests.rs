use super::payload::{self, Channel};
use super::*;
use crate::hub::RecordingUi;
use crate::model::session::{Ranked, SessionSummary, StreamSession};
use crate::sessions::{LiveSignal, TwitchLive};
use crate::store::db::Db;
use crate::vars::Vars;
use axum::body::Bytes;
use axum::extract::State as AxState;
use axum::http::{Method as HttpMethod, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use std::collections::VecDeque;
use std::sync::Mutex;

const MIN: i64 = 60_000;

#[derive(Debug, Clone)]
struct Req {
    method: String,
    path: String,
    query: String,
    body: Value,
}

#[derive(Default)]
struct Mock {
    requests: Vec<Req>,
    /// Status and body for the next requests; then 200 with a message id.
    replies: VecDeque<(u16, Value)>,
    next_id: u32,
}

type Shared = Arc<Mutex<Mock>>;

async fn handler(
    AxState(m): AxState<Shared>,
    method: HttpMethod,
    uri: Uri,
    body: Bytes,
) -> Response {
    let mut m = m.lock().unwrap();
    m.requests.push(Req {
        method: method.to_string(),
        path: uri.path().to_string(),
        query: uri.query().unwrap_or("").to_string(),
        body: serde_json::from_slice(&body).unwrap_or(Value::Null),
    });
    if let Some((status, body)) = m.replies.pop_front() {
        return (StatusCode::from_u16(status).unwrap(), axum::Json(body)).into_response();
    }
    m.next_id += 1;
    axum::Json(json!({ "id": format!("msg-{}", m.next_id) })).into_response()
}

struct Server {
    state: Shared,
    url: String,
}

impl Server {
    async fn start() -> Server {
        let state: Shared = Arc::default();
        let app = axum::Router::new()
            .fallback(handler)
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/api/webhooks/123/tok",
            listener.local_addr().unwrap()
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Server { state, url }
    }

    fn requests(&self) -> Vec<Req> {
        self.state.lock().unwrap().requests.clone()
    }

    fn reply(&self, status: u16, body: Value) {
        self.state.lock().unwrap().replies.push_back((status, body));
    }
}

struct Setup {
    discord: Arc<Discord>,
    hub: Arc<Hub>,
    ui: Arc<RecordingUi>,
    _dir: tempfile::TempDir,
}

fn hook(id: &str) -> DiscordWebhook {
    DiscordWebhook {
        id: id.into(),
        name: "#live".into(),
        on_live: true,
        on_end: true,
        edit_on_end: true,
        live_template: "{{channel}} is live: {{title}}".into(),
        end_template: "Done after {{duration}}, {{follows}} follows".into(),
        ..DiscordWebhook::default()
    }
}

fn with_db(db: Arc<Db>, url: &str, max_wait: Duration) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    settings
        .update(|s| s.discord.webhooks = vec![hook("w1")])
        .unwrap();
    let secrets = Arc::new(Secrets::in_memory());
    secrets.set(&secret_key("w1"), url).unwrap();
    let ui = Arc::new(RecordingUi::default());
    let hub = Hub::new(ui.clone(), Arc::new(Vars::new()), db);
    let discord = Discord::build(hub.clone(), settings, secrets, max_wait);
    Setup {
        discord,
        hub,
        ui,
        _dir: dir,
    }
}

fn setup(url: &str) -> Setup {
    with_db(Arc::new(Db::open_in_memory()), url, Duration::from_secs(2))
}

fn channel() -> Channel {
    Channel {
        login: "nova_kat".into(),
        display_name: "Nova_Kat".into(),
        profile_image_url: "https://example.com/p.png".into(),
        title: "Ranked grind".into(),
        category: "Celeste".into(),
    }
}

fn summary() -> SessionSummary {
    SessionSummary {
        session: StreamSession {
            id: 4,
            started_at: 1_700_000_000_000,
            ended_at: Some(1_700_008_100_000),
            title: "Ranked grind".into(),
            categories: vec!["Celeste".into(), "Just Chatting".into()],
            peak_viewers: 1342,
            avg_viewers: 1187,
            ..StreamSession::default()
        },
        duration_ms: 8_100_000,
        follows: 38,
        new_subs: 10,
        resubs: 4,
        gifted_subs: 2,
        bits: 2400,
        top_chatters: vec![Ranked {
            name: "pixelbyte".into(),
            amount: 90.0,
        }],
        ..SessionSummary::default()
    }
}

fn logs(hub: &Hub) -> Vec<String> {
    hub.logs().into_iter().map(|l| l.message).collect()
}

#[test]
fn webhook_links_are_checked() {
    let ok = "https://discord.com/api/webhooks/1234567890/abc_DEF-123";
    assert_eq!(clean_url(ok).unwrap(), ok);
    assert_eq!(
        clean_url("  https://discordapp.com/api/v10/webhooks/42/tok?wait=true#x ").unwrap(),
        "https://discord.com/api/webhooks/42/tok"
    );
    for bad in [
        "",
        "http://discord.com/api/webhooks/1/tok",
        "https://evil.example/api/webhooks/1/tok",
        "https://discord.com/api/webhooks/abc/tok",
        "https://discord.com/api/webhooks/1",
        "https://discord.com/channels/1/2",
    ] {
        assert!(clean_url(bad).is_err(), "{bad}");
    }
}

#[test]
fn mentions_only_ping_what_was_picked() {
    assert_eq!(clean_mention(" ").unwrap(), "");
    assert_eq!(clean_mention("none").unwrap(), "");
    assert_eq!(clean_mention("@everyone").unwrap(), "@everyone");
    assert_eq!(clean_mention("<@&123456>").unwrap(), "<@&123456>");
    assert_eq!(clean_mention("123456").unwrap(), "<@&123456>");
    assert!(clean_mention("@mods").is_err());
    assert!(
        clean_mention("<@123>").is_err(),
        "user mentions aren't offered"
    );

    assert_eq!(payload::mention(""), (String::new(), json!({"parse": []})));
    assert_eq!(
        payload::mention("@here"),
        ("@here".into(), json!({"parse": ["everyone"]}))
    );
    assert_eq!(
        payload::mention("<@&42>"),
        ("<@&42>".into(), json!({"parse": [], "roles": ["42"]}))
    );

    // "@everyone" typed in the text doesn't ping when no mention is picked.
    let mut h = hook("w");
    h.live_template = "@everyone {{channel}} is live".into();
    let p = payload::live_payload(&h, &channel(), 1_700_000_000_000);
    assert_eq!(p["content"], "@everyone Nova_Kat is live");
    assert_eq!(p["allowed_mentions"], json!({"parse": []}));

    h.mention = "<@&42>".into();
    let p = payload::live_payload(&h, &channel(), 1_700_000_000_000);
    assert_eq!(p["content"], "<@&42> @everyone Nova_Kat is live");
    assert_eq!(p["allowed_mentions"], json!({"parse": [], "roles": ["42"]}));
}

#[test]
fn go_live_payload() {
    let p = payload::live_payload(&hook("w"), &channel(), 1_700_000_123_456);
    assert_eq!(p["content"], "Nova_Kat is live: Ranked grind");
    let e = &p["embeds"][0];
    assert_eq!(e["title"], "Ranked grind");
    assert_eq!(e["url"], "https://www.twitch.tv/nova_kat");
    assert_eq!(
        e["fields"][0],
        json!({"name": "Category", "value": "Celeste", "inline": true})
    );
    assert_eq!(
        e["image"]["url"],
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_nova_kat-1280x720.jpg?t=1700000123"
    );
    assert_eq!(e["author"]["icon_url"], "https://example.com/p.png");
    assert_eq!(e["author"]["name"], "Nova_Kat");
    assert_eq!(e["timestamp"], "2023-11-14T22:15:23Z");

    let ctx = payload::live_context(&channel(), 0);
    for key in ["channel", "login", "title", "category", "url", "thumbnail"] {
        assert!(ctx.get(key).is_some(), "{key}");
    }

    let mut blank = channel();
    blank.title.clear();
    blank.category.clear();
    blank.profile_image_url.clear();
    let mut h = hook("w");
    h.live_template = "x".repeat(2500);
    let p = payload::live_payload(&h, &blank, 0);
    assert_eq!(p["embeds"][0]["title"], "Nova_Kat is live");
    assert!(p["embeds"][0].get("fields").is_none());
    assert!(p["embeds"][0]["author"].get("icon_url").is_none());
    assert_eq!(p["content"].as_str().unwrap().chars().count(), 2000);
}

#[test]
fn end_payload_reuses_the_summary() {
    let s = summary();
    let p = payload::end_payload(&hook("w"), &s, &channel());
    assert_eq!(p["content"], "Done after 2h 15m, 38 follows");
    let e = &p["embeds"][0];
    let fields: Vec<(String, String)> = e["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| {
            (
                f["name"].as_str().unwrap().into(),
                f["value"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert_eq!(
        fields,
        [
            ("Length", "2h 15m"),
            ("Peak viewers", "1,342"),
            ("Average viewers", "1,187"),
            ("Follows", "38"),
            ("Subs", "16"),
            ("Bits", "2,400")
        ]
        .map(|(a, b)| (a.to_string(), b.to_string()))
    );
    assert_eq!(e["description"], "Celeste, Just Chatting");

    let ctx = payload::end_context(&s, &channel());
    assert_eq!(ctx["subs"], 16);
    assert_eq!(ctx["category"], "Just Chatting");
    assert_eq!(ctx["top_chatter"], "pixelbyte");
    assert_eq!(ctx["date"], "14 November 2023");
    assert_eq!(ctx["duration_minutes"], 135);

    let edit = payload::ended_edit(&s, &channel());
    assert!(edit.get("content").is_none(), "the text stays as it was");
    assert_eq!(edit["allowed_mentions"], json!({"parse": []}));
    assert_eq!(
        edit["embeds"][0]["description"],
        "Ended after 2h 15m. Thanks for watching!"
    );
    assert!(
        edit["embeds"][0].get("image").is_none(),
        "no stale live preview"
    );

    assert_eq!(
        payload::text_payload("hi @everyone"),
        json!({"content": "hi @everyone", "allowed_mentions": {"parse": []}})
    );
}

#[tokio::test]
async fn retries_after_a_rate_limit() {
    let srv = Server::start().await;
    let s = setup(&srv.url);
    srv.reply(
        429,
        json!({"message": "You are being rate limited.", "retry_after": 0.05, "global": false}),
    );
    let v = s
        .discord
        .send(&srv.url, None, &json!({"content": "hi"}))
        .await
        .unwrap();
    assert_eq!(v["id"], "msg-1");
    let reqs = srv.requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[1].query, "wait=true");
    assert_eq!(reqs[1].method, "POST");

    // Too long to wait: give up after one try.
    srv.reply(429, json!({"retry_after": 120.0}));
    let err = s
        .discord
        .send(&srv.url, None, &json!({}))
        .await
        .unwrap_err();
    assert_eq!(err, SendError::RateLimited);
    assert_eq!(srv.requests().len(), 3);

    // Never more than three tries.
    for _ in 0..3 {
        srv.reply(429, json!({"retry_after": 0.01}));
    }
    let err = s
        .discord
        .send(&srv.url, None, &json!({}))
        .await
        .unwrap_err();
    assert_eq!(err, SendError::RateLimited);
    assert_eq!(srv.requests().len(), 6);
}

#[tokio::test]
async fn deleted_webhooks_and_network_errors_are_logged() {
    let srv = Server::start().await;
    let s = setup(&srv.url);
    srv.reply(404, json!({"message": "Unknown Webhook", "code": 10015}));
    let err = s
        .discord
        .send_test("w1", &channel())
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("no longer exists"), "{err}");
    let entry = s.hub.logs().pop().unwrap();
    assert_eq!(entry.level, LogLevel::Error);
    assert_eq!(entry.source, "discord");
    assert!(
        s.ui.0
            .lock()
            .unwrap()
            .iter()
            .any(|(n, _)| n == crate::hub::ui::LOG),
        "the window hears about it"
    );

    srv.reply(
        400,
        json!({"message": "Cannot send an empty message", "code": 50006}),
    );
    let err = s
        .discord
        .post_text("w1", "x")
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Cannot send an empty message"), "{err}");

    let closed = setup("http://127.0.0.1:9/api/webhooks/1/t");
    let err = closed
        .discord
        .post_text("w1", "x")
        .await
        .unwrap_err()
        .to_string();
    assert!(err.contains("Couldn't reach Discord"), "{err}");
    assert!(
        logs(&closed.hub)
            .iter()
            .any(|l| l.contains("Couldn't reach Discord"))
    );

    // A test post never pings.
    let mut h = hook("w1");
    h.mention = "@everyone".into();
    s.discord.save_webhook(h, None).unwrap();
    s.discord.send_test("w1", &channel()).await.unwrap();
    let last = srv.requests().pop().unwrap();
    assert_eq!(last.body["allowed_mentions"], json!({"parse": []}));
    assert!(
        last.body["content"]
            .as_str()
            .unwrap()
            .starts_with("Test post from Castwright.")
    );
}

fn live(started_at: i64) -> LiveSignal {
    LiveSignal {
        twitch: Some(TwitchLive {
            live: true,
            started_at,
            title: "Ranked grind".into(),
            category: "Celeste".into(),
            viewers: 50,
        }),
        obs: None,
    }
}

fn offline() -> LiveSignal {
    LiveSignal {
        twitch: Some(TwitchLive::default()),
        obs: None,
    }
}

fn started(c: &[crate::model::session::SessionChange]) -> Option<StreamSession> {
    c.iter().find_map(|c| match c {
        crate::model::session::SessionChange::Started { session } => Some(session.clone()),
        _ => None,
    })
}

fn ended(c: &[crate::model::session::SessionChange]) -> Option<StreamSession> {
    c.iter().find_map(|c| match c {
        crate::model::session::SessionChange::Ended { session } => Some(session.clone()),
        _ => None,
    })
}

#[tokio::test]
async fn posts_once_per_stream_across_restarts_and_reconnects() {
    let srv = Server::start().await;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("events.sqlite");
    let ch = channel();
    let t0 = 1_700_000_000_000;
    let posts = |method: &str| srv.requests().iter().filter(|r| r.method == method).count();

    let s = with_db(
        Arc::new(Db::open(&file).unwrap()),
        &srv.url,
        Duration::from_secs(2),
    );
    let session = started(&s.hub.sessions.tick(&live(t0), t0 + 5_000)).unwrap();
    s.discord.on_started(&session, Some(&ch)).await;
    s.discord.on_started(&session, Some(&ch)).await;
    assert_eq!(posts("POST"), 1, "once, even when told twice");
    s.hub.sessions.tick(&live(t0), t0 + MIN);
    s.hub.sessions.flush();
    drop(s);

    // The app restarts mid-stream: the session continues and nothing is posted.
    let s = with_db(
        Arc::new(Db::open(&file).unwrap()),
        &srv.url,
        Duration::from_secs(2),
    );
    let c = s.hub.sessions.tick(&live(t0), t0 + 10 * MIN);
    assert!(started(&c).is_none());
    s.discord.on_started(&session, Some(&ch)).await;
    assert_eq!(posts("POST"), 1);

    // A quick reconnect continues the same session; the end post waits it out.
    let end = ended(&s.hub.sessions.tick(&offline(), t0 + 60 * MIN)).unwrap();
    s.discord.on_ended(&end, t0 + 60 * MIN);
    s.discord.run_due(Some(&ch), t0 + 61 * MIN).await;
    assert_eq!(posts("POST"), 1, "not due yet");
    let back = started(&s.hub.sessions.tick(&live(t0 + 62 * MIN), t0 + 62 * MIN)).unwrap();
    assert_eq!(back.id, session.id);
    s.discord.on_started(&back, Some(&ch)).await;
    s.discord
        .run_due(Some(&ch), t0 + 62 * MIN + END_DELAY_MS)
        .await;
    assert_eq!(posts("POST"), 1, "still the same stream");

    // The real end: one summary and the go-live post edited to "ended".
    let end = ended(&s.hub.sessions.tick(&offline(), t0 + 120 * MIN)).unwrap();
    s.discord.on_ended(&end, t0 + 120 * MIN);
    s.discord
        .run_due(Some(&ch), t0 + 120 * MIN + END_DELAY_MS)
        .await;
    s.discord
        .run_due(Some(&ch), t0 + 121 * MIN + END_DELAY_MS)
        .await;
    assert_eq!(posts("POST"), 2);
    let patch: Vec<Req> = srv
        .requests()
        .into_iter()
        .filter(|r| r.method == "PATCH")
        .collect();
    assert_eq!(patch.len(), 1);
    assert_eq!(patch[0].path, "/api/webhooks/123/tok/messages/msg-1");
    let summary_post = srv
        .requests()
        .into_iter()
        .rfind(|r| r.method == "POST")
        .unwrap();
    assert_eq!(
        summary_post.body["embeds"][0]["fields"][0]["value"],
        "2h 0m"
    );
}

#[tokio::test]
async fn a_failed_post_can_go_out_next_time() {
    let srv = Server::start().await;
    let s = setup(&srv.url);
    let session = started(&s.hub.sessions.tick(&live(1), 1_000)).unwrap();
    srv.reply(500, json!({"message": "oops"}));
    s.discord.on_started(&session, Some(&channel())).await;
    s.discord.on_started(&session, Some(&channel())).await;
    assert_eq!(srv.requests().len(), 2);
    s.discord.on_started(&session, Some(&channel())).await;
    assert_eq!(
        srv.requests().len(),
        2,
        "posted on the second try, then never again"
    );

    // Not signed in to Twitch: skipped with a note.
    let other = setup(&srv.url);
    let session = started(&other.hub.sessions.tick(&live(1), 1_000)).unwrap();
    other.discord.on_started(&session, None).await;
    assert_eq!(srv.requests().len(), 2);
    assert!(
        logs(&other.hub)
            .iter()
            .any(|l| l.contains("sign in to Twitch"))
    );
}

#[test]
fn saving_keeps_the_link_out_of_settings() {
    let s = setup("https://discord.com/api/webhooks/1/old");
    let h = DiscordWebhook {
        id: String::new(),
        name: "  #announcements  ".into(),
        mention: "987".into(),
        ..DiscordWebhook::default()
    };
    let saved = s
        .discord
        .save_webhook(
            h,
            Some("https://discord.com/api/webhooks/55/SECRET-token".into()),
        )
        .unwrap();
    assert!(saved.has_url);
    assert_eq!(saved.name, "#announcements");
    assert_eq!(saved.mention, "<@&987>");
    assert!(!saved.id.is_empty());
    let raw = serde_json::to_string(&s.discord.settings.get()).unwrap();
    assert!(!raw.contains("SECRET-token"));
    assert_eq!(
        s.discord.url(&saved.id).as_deref(),
        Some("https://discord.com/api/webhooks/55/SECRET-token")
    );

    assert!(
        s.discord
            .save_webhook(saved.clone(), Some("nope".into()))
            .is_err()
    );
    let mut bad = saved.clone();
    bad.mention = "@mods".into();
    assert!(s.discord.save_webhook(bad, None).is_err());

    let kept = s.discord.save_webhook(saved.clone(), None).unwrap();
    assert!(kept.has_url, "None keeps the link");
    let cleared = s
        .discord
        .save_webhook(saved.clone(), Some(String::new()))
        .unwrap();
    assert!(!cleared.has_url);
    s.discord.delete_webhook(&saved.id).unwrap();
    assert!(
        s.discord
            .settings
            .get()
            .discord
            .webhooks
            .iter()
            .all(|w| w.id != saved.id)
    );
}
