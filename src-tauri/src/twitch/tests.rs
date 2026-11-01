//! Service tests against local mock Twitch servers.

use super::auth::StoredToken;
use super::normalize_tests::fixture;
use super::*;
use crate::model::event::EventKind;
use crate::services::TwitchActions;
use axum::body::Bytes;
use axum::extract::State as AxState;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone)]
struct Rec {
    method: String,
    path: String,
    query: HashMap<String, String>,
    body: String,
    auth: String,
}

impl Rec {
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or(Value::Null)
    }
    fn form(&self) -> HashMap<String, String> {
        url::form_urlencoded::parse(self.body.as_bytes())
            .into_owned()
            .collect()
    }
}

#[derive(Default)]
struct Mock {
    requests: Vec<Rec>,
    device_replies: VecDeque<(u16, Value)>,
    refresh_reply: Option<(u16, Value)>,
    refresh_count: u32,
    /// Subscription types (or "type@version") answered with 403.
    forbid: HashSet<String>,
    /// Access tokens answered with 401.
    expired: HashSet<String>,
    streams: Value,
    shoutout_status: u16,
    rate_limit_next: bool,
}

type Shared = Arc<Mutex<Mock>>;

fn reply(status: u16, body: Value) -> Response {
    let code = StatusCode::from_u16(status).unwrap();
    if body.is_null() {
        code.into_response()
    } else {
        (code, axum::Json(body)).into_response()
    }
}

async fn handler(
    AxState(mock): AxState<Shared>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let rec = Rec {
        method: method.to_string(),
        path: uri.path().to_string(),
        query: url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
            .into_owned()
            .collect(),
        body: String::from_utf8_lossy(&body).into_owned(),
        auth: headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string(),
    };
    let mut m = mock.lock().unwrap();
    m.requests.push(rec.clone());
    let token = rec.auth.trim_start_matches("Bearer ").to_string();
    match (rec.method.as_str(), rec.path.as_str()) {
        ("POST", "/oauth2/device") => reply(
            200,
            json!({
                "device_code": "dev-code",
                "expires_in": 1800,
                "interval": 1,
                "user_code": "ABCDEFGH",
                "verification_uri": "https://www.twitch.tv/activate?public=true&device-code=ABCDEFGH"
            }),
        ),
        ("POST", "/oauth2/token") => {
            let form = rec.form();
            if form.get("grant_type").map(String::as_str) == Some("refresh_token") {
                m.refresh_count += 1;
                if let Some((s, b)) = m.refresh_reply.clone() {
                    return reply(s, b);
                }
                let n = m.refresh_count;
                return reply(
                    200,
                    json!({
                        "access_token": format!("new-access-{n}"),
                        "refresh_token": format!("new-refresh-{n}"),
                        "expires_in": 14400,
                        "scope": ["user:read:chat"],
                        "token_type": "bearer"
                    }),
                );
            }
            let (s, b) = if m.device_replies.len() > 1 {
                m.device_replies.pop_front().unwrap()
            } else {
                m.device_replies.front().cloned().unwrap_or((
                    400,
                    json!({"status": 400, "message": "authorization_pending"}),
                ))
            };
            reply(s, b)
        }
        ("GET", "/oauth2/validate") => {
            if m.expired.contains(rec.auth.trim_start_matches("OAuth ")) {
                return reply(
                    401,
                    json!({"status": 401, "message": "invalid access token"}),
                );
            }
            reply(
                200,
                json!({"client_id": "cid", "login": "cool_user", "scopes": ["bits:read", "user:read:chat"],
                       "user_id": "1337", "expires_in": 5000}),
            )
        }
        ("POST", "/oauth2/revoke") => reply(200, Value::Null),
        (_, p) if p.starts_with("/helix/") => {
            if m.expired.contains(&token) {
                return reply(
                    401,
                    json!({"error": "Unauthorized", "status": 401, "message": "Invalid OAuth token"}),
                );
            }
            if std::mem::take(&mut m.rate_limit_next) {
                let reset = (crate::util::now_ms() / 1000 + 1).to_string();
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    [
                        ("Ratelimit-Remaining", "0".to_string()),
                        ("Ratelimit-Reset", reset),
                    ],
                    axum::Json(json!({"status": 429, "message": "Too Many Requests"})),
                )
                    .into_response();
            }
            helix(&mut m, &rec, &token)
        }
        _ => reply(404, json!({"status": 404, "message": "not found"})),
    }
}

fn helix(m: &mut Mock, rec: &Rec, token: &str) -> Response {
    let path = rec.path.trim_start_matches("/helix");
    match (rec.method.as_str(), path) {
        ("GET", "/users") => match rec.query.get("login").map(String::as_str) {
            Some("nobody") => reply(200, json!({"data": []})),
            Some(login) => reply(
                200,
                json!({"data": [{"id": "999", "login": login, "display_name": login.to_uppercase()}]}),
            ),
            None if token.starts_with("bot") => reply(
                200,
                json!({"data": [{"id": "2000", "login": "botty", "display_name": "Botty",
                                 "profile_image_url": ""}]}),
            ),
            None => reply(
                200,
                json!({"data": [{"id": "1337", "login": "cool_user", "display_name": "Cool_User",
                                 "profile_image_url": "https://example.com/p.png"}]}),
            ),
        },
        ("POST", "/eventsub/subscriptions") => {
            let b = rec.json();
            let kind = b["type"].as_str().unwrap_or("").to_string();
            let version = b["version"].as_str().unwrap_or("").to_string();
            if m.forbid.contains(&kind) || m.forbid.contains(&format!("{kind}@{version}")) {
                return reply(
                    403,
                    json!({"error": "Forbidden", "status": 403,
                           "message": "subscription missing proper authorization"}),
                );
            }
            reply(
                202,
                json!({"data": [{"id": "sub-1", "status": "enabled", "type": kind,
                                  "version": version, "condition": b["condition"],
                                  "transport": b["transport"], "cost": 0}],
                       "total": 1, "total_cost": 0, "max_total_cost": 10}),
            )
        }
        ("GET", "/streams") => reply(200, m.streams.clone()),
        ("GET", "/channels") => reply(
            200,
            json!({"data": [{"broadcaster_id": "1337", "game_id": "509658",
                             "game_name": "Just Chatting", "title": "Offline title",
                             "tags": ["English"]}]}),
        ),
        ("GET", "/search/categories") => reply(
            200,
            json!({"data": [
                {"id": "1", "name": "Just Chatting Extra", "box_art_url": "x"},
                {"id": "509658", "name": "Just Chatting", "box_art_url": "y"}
            ]}),
        ),
        ("POST", "/clips") => reply(
            202,
            json!({"data": [{"id": "clip1", "edit_url": "https://clips.twitch.tv/clip1/edit"}]}),
        ),
        ("POST", "/chat/messages") => reply(
            200,
            json!({"data": [{"message_id": "m1", "is_sent": true, "drop_reason": null}]}),
        ),
        ("POST", "/chat/shoutouts") if m.shoutout_status == 429 => (
            StatusCode::TOO_MANY_REQUESTS,
            [("Ratelimit-Remaining", "799")],
            axum::Json(json!({"status": 429, "message": "The broadcaster may not give the same broadcaster a Shoutout more than once per hour."})),
        )
            .into_response(),
        _ => reply(204, Value::Null),
    }
}

struct MockServer {
    state: Shared,
    base: String,
}

impl MockServer {
    async fn start() -> MockServer {
        let state: Shared = Arc::default();
        state.lock().unwrap().streams = json!({"data": []});
        let app = axum::Router::new()
            .fallback(handler)
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        MockServer { state, base }
    }

    fn requests(&self, method: &str, path: &str) -> Vec<Rec> {
        self.state
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|r| r.method == method && r.path == path)
            .cloned()
            .collect()
    }

    fn set(&self, f: impl FnOnce(&mut Mock)) {
        f(&mut self.state.lock().unwrap());
    }
}

type ServerWs = WebSocketStream<TcpStream>;

async fn ws_server() -> (String, mpsc::UnboundedReceiver<ServerWs>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("ws://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                let _ = tx.send(ws);
            }
        }
    });
    (base, rx)
}

fn fast() -> Timing {
    Timing {
        poll_unit: Duration::from_millis(5),
        keepalive_margin: Duration::from_millis(150),
        welcome_timeout: Duration::from_secs(2),
        backoff_min: Duration::from_millis(20),
        backoff_max: Duration::from_millis(200),
        stream_tick: Duration::from_secs(3600),
        validate_every: Duration::from_secs(3600),
        max_rate_wait: Duration::from_secs(3),
    }
}

struct Setup {
    svc: Arc<TwitchService>,
    hub: Arc<Hub>,
    secrets: Arc<Secrets>,
    _dir: tempfile::TempDir,
}

fn put_token(secrets: &Secrets, role: AccountRole, access: &str, refresh: &str, id: &str) {
    let t = StoredToken {
        access_token: access.into(),
        refresh_token: refresh.into(),
        expires_at: crate::util::now_ms() + 3_600_000,
        scopes: vec!["user:read:chat".into()],
        user_id: id.into(),
        login: "cool_user".into(),
        display_name: "Cool_User".into(),
        profile_image_url: String::new(),
    };
    secrets
        .set(secret_key(role), &serde_json::to_string(&t).unwrap())
        .unwrap();
}

fn stored(secrets: &Secrets, role: AccountRole) -> Option<StoredToken> {
    secrets
        .get(secret_key(role))
        .map(|s| serde_json::from_str(&s).unwrap())
}

fn setup(mock: &MockServer, ws_url: &str, prepare: impl FnOnce(&Secrets)) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    settings
        .update(|s| s.twitch.client_id = "cid".into())
        .unwrap();
    let secrets = Arc::new(Secrets::in_memory());
    prepare(&secrets);
    let hub = Hub::test();
    let endpoints = TwitchEndpoints {
        id_base: mock.base.clone(),
        helix_base: format!("{}/helix", mock.base),
        eventsub_url: ws_url.to_string(),
    };
    let svc = TwitchService::build(hub.clone(), secrets.clone(), settings, endpoints, fast());
    Setup {
        svc,
        hub,
        secrets,
        _dir: dir,
    }
}

fn broadcaster(s: &Secrets) {
    put_token(s, AccountRole::Broadcaster, "access-b", "refresh-b", "1337");
}

async fn wait_for(what: &str, f: impl Fn() -> bool) {
    for _ in 0..500 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

async fn next_ws(rx: &mut mpsc::UnboundedReceiver<ServerWs>) -> ServerWs {
    tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("client didn't connect")
        .unwrap()
}

async fn send(ws: &mut ServerWs, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

fn welcome(session: &str, keepalive: u64) -> Value {
    json!({
        "metadata": {"message_id": format!("welcome-{session}"), "message_type": "session_welcome",
                     "message_timestamp": "2023-07-19T14:56:51.634234626Z"},
        "payload": {"session": {"id": session, "status": "connected",
                                "connected_at": "2023-07-19T14:56:51.616329898Z",
                                "keepalive_timeout_seconds": keepalive,
                                "reconnect_url": null, "recovery_url": null}}
    })
}

async fn next_event(
    rx: &mut tokio::sync::broadcast::Receiver<crate::model::event::Event>,
) -> crate::model::event::Event {
    tokio::time::timeout(Duration::from_secs(3), rx.recv())
        .await
        .expect("no event published")
        .unwrap()
}

// ---- device flow ----

#[tokio::test]
async fn device_login_handles_pending_and_slow_down() {
    let mock = MockServer::start().await;
    let (ws_url, _ws) = ws_server().await;
    mock.set(|m| {
        m.device_replies = VecDeque::from(vec![
            (
                400,
                json!({"status": 400, "message": "authorization_pending"}),
            ),
            (400, json!({"status": 400, "message": "slow_down"})),
            (
                200,
                json!({"access_token": "fresh-access", "refresh_token": "fresh-refresh",
                       "expires_in": 14400, "scope": ["bits:read", "user:read:chat"],
                       "token_type": "bearer"}),
            ),
        ])
    });
    let s = setup(&mock, &ws_url, |_| {});
    let login = s.svc.start_login(AccountRole::Broadcaster).await.unwrap();
    assert_eq!(login.user_code, "ABCDEFGH");
    assert_eq!(login.expires_in_s, 1800);
    let device = mock.requests("POST", "/oauth2/device");
    let form = device[0].form();
    assert_eq!(form["client_id"], "cid");
    assert!(form["scopes"].contains("moderator:read:followers"));
    assert!(form["scopes"].contains("channel:bot"));

    let svc = s.svc.clone();
    wait_for("sign-in", || svc.status().broadcaster.is_some()).await;
    let account = s.svc.status().broadcaster.unwrap();
    assert_eq!(account.id, "1337");
    assert_eq!(account.display_name, "Cool_User");
    assert_eq!(account.scopes, vec!["bits:read", "user:read:chat"]);
    let saved = stored(&s.secrets, AccountRole::Broadcaster).unwrap();
    assert_eq!(saved.access_token, "fresh-access");
    assert_eq!(saved.refresh_token, "fresh-refresh");
    assert!(saved.expires_at > crate::util::now_ms());

    let polls = mock.requests("POST", "/oauth2/token");
    assert_eq!(polls.len(), 3);
    for p in &polls {
        let f = p.form();
        assert_eq!(
            f["grant_type"],
            "urn:ietf:params:oauth:grant-type:device_code"
        );
        assert_eq!(f["device_code"], "dev-code");
        assert_eq!(f["client_id"], "cid");
    }
    let users = mock.requests("GET", "/helix/users");
    assert_eq!(users[0].auth, "Bearer fresh-access");
    assert!(
        s.hub.logs().iter().all(|l| !l.message.contains("fresh-")),
        "tokens never logged"
    );
    s.svc.shutdown();
}

#[tokio::test]
async fn device_login_expired_code() {
    let mock = MockServer::start().await;
    mock.set(|m| {
        m.device_replies = VecDeque::from(vec![(
            400,
            json!({"status": 400, "message": "invalid device code"}),
        )])
    });
    let s = setup(&mock, "ws://127.0.0.1:1", |_| {});
    s.svc.start_login(AccountRole::Bot).await.unwrap();
    let svc = s.svc.clone();
    wait_for("error", || svc.status().error.is_some()).await;
    assert!(s.svc.status().error.unwrap().contains("expired"));
    assert!(s.svc.status().bot.is_none());
    assert!(stored(&s.secrets, AccountRole::Bot).is_none());
}

#[tokio::test]
async fn login_needs_client_id() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", |_| {});
    s.svc
        .settings
        .update(|v| v.twitch.client_id.clear())
        .unwrap();
    if option_env!("CASTWRIGHT_TWITCH_CLIENT_ID").is_none() {
        let err = s
            .svc
            .start_login(AccountRole::Broadcaster)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::User(_)));
        assert!(!s.svc.status().has_client_id);
    }
}

#[tokio::test]
async fn logout_revokes_and_forgets() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    assert!(s.svc.status().broadcaster.is_some());
    s.svc.logout(AccountRole::Broadcaster).await.unwrap();
    let revoke = mock.requests("POST", "/oauth2/revoke");
    assert_eq!(revoke[0].form()["token"], "access-b");
    assert!(s.svc.status().broadcaster.is_none());
    assert!(stored(&s.secrets, AccountRole::Broadcaster).is_none());
    assert_eq!(s.hub.vars.get("stream.live"), Some(json!(false)));
}

// ---- tokens and Helix ----

#[tokio::test]
async fn refreshes_once_on_401_and_retries() {
    let mock = MockServer::start().await;
    mock.set(|m| {
        m.expired.insert("access-b".into());
    });
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    let (a, b, c) = tokio::join!(
        s.svc.create_clip(),
        s.svc.search_categories("just"),
        s.svc.search_categories("chat"),
    );
    assert_eq!(a.unwrap(), "https://clips.twitch.tv/clip1/edit");
    assert_eq!(b.unwrap().len(), 2);
    assert!(c.is_ok());
    assert_eq!(
        mock.state.lock().unwrap().refresh_count,
        1,
        "single-use refresh token"
    );
    let refresh = mock.requests("POST", "/oauth2/token").pop().unwrap().form();
    assert_eq!(refresh["grant_type"], "refresh_token");
    assert_eq!(refresh["refresh_token"], "refresh-b");
    assert_eq!(refresh["client_id"], "cid");
    let saved = stored(&s.secrets, AccountRole::Broadcaster).unwrap();
    assert_eq!(saved.access_token, "new-access-1");
    assert_eq!(saved.refresh_token, "new-refresh-1");
    assert_eq!(saved.user_id, "1337", "account details kept");
    let clips = mock.requests("POST", "/helix/clips");
    assert_eq!(clips.last().unwrap().auth, "Bearer new-access-1");
    assert_eq!(clips[0].query["broadcaster_id"], "1337");
}

#[tokio::test]
async fn rejected_refresh_signs_out() {
    let mock = MockServer::start().await;
    mock.set(|m| {
        m.expired.insert("access-b".into());
        m.refresh_reply = Some((
            400,
            json!({"status": 400, "message": "Invalid refresh token"}),
        ));
    });
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    let err = s.svc.create_marker("x").await.unwrap_err();
    assert!(err.to_string().contains("signed you out"), "{err}");
    assert!(s.svc.status().broadcaster.is_none());
    assert!(s.svc.status().error.is_some());
    assert!(stored(&s.secrets, AccountRole::Broadcaster).is_none());
}

#[tokio::test]
async fn validation_refreshes_invalid_token() {
    let mock = MockServer::start().await;
    mock.set(|m| {
        m.expired.insert("access-b".into());
    });
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    s.svc.validate_role(AccountRole::Broadcaster).await;
    assert_eq!(
        stored(&s.secrets, AccountRole::Broadcaster)
            .unwrap()
            .access_token,
        "new-access-1"
    );
    assert_eq!(
        mock.requests("GET", "/oauth2/validate")[0].auth,
        "OAuth access-b"
    );
}

#[tokio::test]
async fn waits_out_rate_limit() {
    let mock = MockServer::start().await;
    mock.set(|m| m.rate_limit_next = true);
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    let found = s.svc.search_categories("just").await.unwrap();
    assert_eq!(found[1].name, "Just Chatting");
    assert_eq!(mock.requests("GET", "/helix/search/categories").len(), 2);
}

#[tokio::test]
async fn actions_send_the_right_requests() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", |sec| {
        broadcaster(sec);
        put_token(sec, AccountRole::Bot, "bot-access", "bot-refresh", "2000");
    });

    s.svc
        .send_chat(&format!("  {}  ", "x".repeat(600)), true, Some("parent-1"))
        .await
        .unwrap();
    let r = mock.requests("POST", "/helix/chat/messages").pop().unwrap();
    assert_eq!(r.auth, "Bearer bot-access");
    let b = r.json();
    assert_eq!(b["sender_id"], "2000");
    assert_eq!(b["broadcaster_id"], "1337");
    assert_eq!(b["reply_parent_message_id"], "parent-1");
    assert_eq!(b["message"].as_str().unwrap().len(), 500);

    assert!(
        s.svc.was_sent_by_app("m1"),
        "posted message ids are remembered"
    );
    assert!(!s.svc.was_sent_by_app("someone-else"));

    s.svc.send_chat("hi", false, None).await.unwrap();
    let b = mock.requests("POST", "/helix/chat/messages").pop().unwrap();
    assert_eq!(b.auth, "Bearer access-b");
    assert_eq!(b.json()["sender_id"], "1337");
    assert!(b.json().get("reply_parent_message_id").is_none());

    s.svc.announce("hello", "pink").await.unwrap();
    let a = mock
        .requests("POST", "/helix/chat/announcements")
        .pop()
        .unwrap();
    assert_eq!(a.json()["color"], "primary");
    assert_eq!(a.query["moderator_id"], "1337");

    s.svc.run_ad(100).await.unwrap();
    let ad = mock
        .requests("POST", "/helix/channels/commercial")
        .pop()
        .unwrap();
    assert_eq!(ad.json()["length"], 90);

    s.svc.timeout_user("@Some_User", 0, "spam").await.unwrap();
    let ban = mock
        .requests("POST", "/helix/moderation/bans")
        .pop()
        .unwrap();
    assert_eq!(ban.json()["data"]["user_id"], "999");
    assert_eq!(ban.json()["data"]["duration"], 1);
    assert_eq!(
        mock.requests("GET", "/helix/users").pop().unwrap().query["login"],
        "some_user"
    );

    s.svc
        .set_stream_info("New title", "just chatting")
        .await
        .unwrap();
    let patch = mock.requests("PATCH", "/helix/channels").pop().unwrap();
    assert_eq!(
        patch.json(),
        json!({"title": "New title", "game_id": "509658"})
    );
    assert_eq!(patch.query["broadcaster_id"], "1337");

    s.svc.set_stream_info("", "").await.unwrap();
    assert_eq!(
        mock.requests("PATCH", "/helix/channels").len(),
        1,
        "nothing to change"
    );

    s.svc
        .update_stream_info("T", "", vec!["Cozy".into()])
        .await
        .unwrap();
    let patch = mock.requests("PATCH", "/helix/channels").pop().unwrap();
    assert_eq!(patch.json(), json!({"title": "T", "tags": ["Cozy"]}));

    let err = s.svc.shoutout("nobody").await.unwrap_err();
    assert!(err.to_string().contains("Couldn't find"));
    mock.set(|m| m.shoutout_status = 429);
    let err = s.svc.shoutout("friend").await.unwrap_err();
    assert!(err.to_string().contains("cooldown"), "{err}");
    assert_eq!(
        mock.requests("POST", "/helix/chat/shoutouts").len(),
        1,
        "cooldowns aren't retried"
    );
}

#[tokio::test]
async fn stream_info_polling_and_hints() {
    let mock = MockServer::start().await;
    let s = setup(&mock, "ws://127.0.0.1:1", broadcaster);
    s.svc.poll_stream().await;
    assert!(!s.svc.status().stream.live);
    assert_eq!(s.svc.status().stream.title, "Offline title");
    assert_eq!(s.hub.vars.get("stream.uptime_text"), Some(json!("")));

    let started = "2020-10-11T10:11:12Z";
    mock.set(|m| {
        m.streams = json!({"data": [{"id": "1", "user_id": "1337", "game_id": "33214",
            "game_name": "Fortnite", "type": "live", "title": "Live now", "tags": ["English"],
            "viewer_count": 78365, "started_at": started}]})
    });
    s.svc.poll_stream().await;
    let st = s.svc.status().stream;
    assert!(st.live);
    assert_eq!(st.viewers, 78365);
    assert_eq!(st.category, "Fortnite");
    assert_eq!(st.started_at, 1_602_411_072_000);
    assert_eq!(s.hub.vars.get("stream.live"), Some(json!(true)));
    assert_eq!(s.hub.vars.get("stream.viewers"), Some(json!(78365)));
    assert!(
        s.hub
            .vars
            .get("stream.uptime_text")
            .unwrap()
            .as_str()
            .unwrap()
            .ends_with('m')
    );

    // A stream.offline event wins over a lagging Helix reply.
    let mut off = crate::model::event::Event::new(EventKind::StreamOffline);
    off.id = "off".into();
    s.svc.on_stream_event(&off);
    s.svc.poll_stream().await;
    assert!(!s.svc.status().stream.live);
    assert_eq!(s.hub.vars.get("stream.uptime_text"), Some(json!("")));
}

// ---- EventSub ----

#[tokio::test]
async fn eventsub_subscribes_publishes_and_follows_reconnect() {
    let mock = MockServer::start().await;
    mock.set(|m| {
        m.forbid.insert("channel.cheer".into());
        m.forbid.insert("channel.hype_train.begin@2".into());
    });
    let (ws_url, mut conns) = ws_server().await;
    let s = setup(&mock, &format!("{ws_url}/ws"), broadcaster);
    let mut events = s.hub.subscribe_events();
    s.svc.start();

    let mut ws1 = next_ws(&mut conns).await;
    send(&mut ws1, welcome("session-1", 10)).await;
    let svc = s.svc.clone();
    wait_for("failed subscription", || {
        svc.status().failed_subscriptions == vec!["channel.cheer".to_string()]
    })
    .await;
    assert_eq!(s.svc.status().eventsub, ConnState::Connected);
    let subs = mock.requests("POST", "/helix/eventsub/subscriptions");
    let all = eventsub::subscription_types();
    assert_eq!(
        subs.len(),
        all.len() + 1,
        "hype train begin fell back to v1"
    );
    for r in &subs {
        let b = r.json();
        assert_eq!(b["transport"]["method"], "websocket");
        assert_eq!(b["transport"]["session_id"], "session-1");
        assert_eq!(r.auth, "Bearer access-b");
    }
    let find = |kind: &str| -> Vec<Value> {
        subs.iter()
            .map(Rec::json)
            .filter(|b| b["type"] == kind)
            .collect()
    };
    assert_eq!(find("channel.follow")[0]["version"], "2");
    assert_eq!(
        find("channel.follow")[0]["condition"]["moderator_user_id"],
        "1337"
    );
    assert_eq!(
        find("channel.raid")[0]["condition"]["to_broadcaster_user_id"],
        "1337"
    );
    assert_eq!(
        find("channel.chat.message")[0]["condition"]["user_id"],
        "1337"
    );
    let hype: Vec<_> = find("channel.hype_train.begin")
        .iter()
        .map(|b| b["version"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(hype, vec!["2", "1"]);
    assert_eq!(find("channel.hype_train.end")[0]["version"], "2");

    // Notification -> event, duplicates dropped.
    send(&mut ws1, fixture("follow")).await;
    let e = next_event(&mut events).await;
    assert_eq!(e.kind, EventKind::Follow);
    assert_eq!(e.id, "msg-follow");
    send(&mut ws1, fixture("follow")).await;
    send(&mut ws1, fixture("chat_message")).await;
    let e = next_event(&mut events).await;
    assert_eq!(e.kind, EventKind::Chat, "duplicate follow was dropped");
    assert_eq!(s.hub.recent_chat().len(), 1);
    send(&mut ws1, fixture("message_delete")).await;
    let mut del = fixture("message_delete");
    del["metadata"]["message_id"] = json!("msg-delete-2");
    del["payload"]["event"]["message_id"] = json!("cc106a89-1814-919d-454c-f4f2f970aae7");
    send(&mut ws1, del).await;
    let hub = s.hub.clone();
    wait_for("chat delete", || hub.recent_chat().is_empty()).await;

    // Reconnect: move to a new URL, keep subscriptions.
    send(
        &mut ws1,
        json!({
            "metadata": {"message_id": "rc-1", "message_type": "session_reconnect",
                         "message_timestamp": "2023-07-19T14:56:51.634234626Z"},
            "payload": {"session": {"id": "session-1", "status": "reconnecting",
                "keepalive_timeout_seconds": null,
                "reconnect_url": format!("{ws_url}/ws?reconnect=1"),
                "connected_at": "2023-07-19T14:56:51.616329898Z"}}
        }),
    )
    .await;
    let mut ws2 = next_ws(&mut conns).await;
    // Old connection still delivers until the new welcome arrives.
    send(&mut ws1, fixture("raid")).await;
    assert_eq!(next_event(&mut events).await.kind, EventKind::Raid);
    send(&mut ws2, welcome("session-2", 10)).await;
    // Client closes the old connection once the new one is welcomed.
    let closed = tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(m) = ws1.next().await {
            if matches!(m, Ok(Message::Close(_)) | Err(_)) {
                break;
            }
        }
    })
    .await;
    assert!(closed.is_ok(), "old connection closed");
    send(&mut ws2, fixture("stream_online")).await;
    assert_eq!(next_event(&mut events).await.kind, EventKind::StreamOnline);
    assert!(s.svc.status().stream.live);
    assert_eq!(
        mock.requests("POST", "/helix/eventsub/subscriptions").len(),
        subs.len(),
        "no new subscriptions after a reconnect"
    );
    assert_eq!(s.svc.status().eventsub, ConnState::Connected);
    assert!(
        s.hub
            .logs()
            .iter()
            .all(|l| !l.message.contains("access-b") && !l.message.contains("refresh-b"))
    );
    s.svc.shutdown();
    assert_eq!(s.svc.status().eventsub, ConnState::Disconnected);
}

#[tokio::test]
async fn eventsub_reconnects_after_keepalive_timeout() {
    let mock = MockServer::start().await;
    let (ws_url, mut conns) = ws_server().await;
    let s = setup(&mock, &ws_url, broadcaster);
    s.svc.start();

    let mut ws1 = next_ws(&mut conns).await;
    send(&mut ws1, welcome("session-1", 1)).await;
    let n = eventsub::subscription_types().len();
    wait_for("first subscriptions", || {
        mock.requests("POST", "/helix/eventsub/subscriptions").len() == n
    })
    .await;
    // Say nothing; the client should give up on this connection and open a new one.
    let mut ws2 = next_ws(&mut conns).await;
    send(&mut ws2, welcome("session-2", 10)).await;
    wait_for("resubscribed", || {
        mock.requests("POST", "/helix/eventsub/subscriptions").len() == 2 * n
    })
    .await;
    let last = mock
        .requests("POST", "/helix/eventsub/subscriptions")
        .pop()
        .unwrap();
    assert_eq!(last.json()["transport"]["session_id"], "session-2");
    let svc = s.svc.clone();
    wait_for("connected", || {
        svc.status().eventsub == ConnState::Connected
    })
    .await;
    assert!(
        s.hub
            .logs()
            .iter()
            .any(|l| l.message.contains("no keepalive"))
    );
    s.svc.shutdown();
}

#[tokio::test]
async fn revocation_is_reported() {
    let mock = MockServer::start().await;
    let (ws_url, mut conns) = ws_server().await;
    let s = setup(&mock, &ws_url, broadcaster);
    s.svc.start();
    let mut ws = next_ws(&mut conns).await;
    send(&mut ws, welcome("session-1", 10)).await;
    send(
        &mut ws,
        json!({
            "metadata": {"message_id": "rev-1", "message_type": "revocation",
                         "message_timestamp": "2023-07-19T14:56:51.634234626Z",
                         "subscription_type": "channel.follow", "subscription_version": "2"},
            "payload": {"subscription": {"id": "f1c2a387", "status": "authorization_revoked",
                "type": "channel.follow", "version": "2", "cost": 0,
                "condition": {"broadcaster_user_id": "1337"},
                "transport": {"method": "websocket", "session_id": "session-1"},
                "created_at": "2023-07-19T14:56:51.634234626Z"}}
        }),
    )
    .await;
    let svc = s.svc.clone();
    wait_for("revocation", || {
        svc.status()
            .failed_subscriptions
            .contains(&"channel.follow".to_string())
    })
    .await;
    s.svc.shutdown();
}
