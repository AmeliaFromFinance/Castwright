use super::*;
use crate::hub::Signal;
use axum::extract::State as AxState;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::json;
use std::collections::VecDeque;

/// Status, extra headers and body.
type Reply = (u16, Vec<(&'static str, String)>, Value);

#[derive(Default)]
struct Fake {
    /// Replies for currently-playing, in order. Empty = 204.
    replies: VecDeque<Reply>,
    /// Bearer tokens seen by the API.
    seen_tokens: Vec<String>,
    /// Token requests: grant type and refresh token or code.
    token_calls: Vec<(String, String)>,
    issued: u32,
}

type Shared = Arc<Mutex<Fake>>;

async fn token(AxState(f): AxState<Shared>, body: String) -> Response {
    let form: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(body.as_bytes())
            .into_owned()
            .collect();
    let grant = form.get("grant_type").cloned().unwrap_or_default();
    let given = form
        .get("refresh_token")
        .or_else(|| form.get("code"))
        .cloned()
        .unwrap_or_default();
    let mut g = f.lock().unwrap();
    g.token_calls.push((grant.clone(), given.clone()));
    if given == "bad" {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(
                json!({"error": "invalid_grant", "error_description": "Refresh token revoked"}),
            ),
        )
            .into_response();
    }
    if grant == "authorization_code" && form.get("code_verifier").is_none_or(|v| v.len() < 43) {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(json!({"error": "invalid_request"})),
        )
            .into_response();
    }
    g.issued += 1;
    let mut body = json!({"access_token": format!("acc-{}", g.issued), "token_type": "Bearer", "expires_in": 3600});
    if grant == "authorization_code" {
        body["refresh_token"] = "ref-1".into();
    }
    axum::Json(body).into_response()
}

async fn current(AxState(f): AxState<Shared>, headers: HeaderMap) -> Response {
    let mut g = f.lock().unwrap();
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .trim_start_matches("Bearer ")
        .to_string();
    g.seen_tokens.push(auth);
    let Some((status, extra, body)) = g.replies.pop_front() else {
        return StatusCode::NO_CONTENT.into_response();
    };
    let mut resp = if status == 204 {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::from_u16(status).unwrap(), axum::Json(body)).into_response()
    };
    for (k, v) in extra {
        resp.headers_mut().insert(k, v.parse().unwrap());
    }
    resp
}

async fn me() -> Response {
    axum::Json(json!({"display_name": "Nova", "id": "nova"})).into_response()
}

struct Rig {
    music: Arc<MusicService>,
    hub: Arc<Hub>,
    fake: Shared,
    _dir: tempfile::TempDir,
}

async fn rig() -> Rig {
    let fake: Shared = Arc::default();
    let app = axum::Router::new()
        .route("/api/token", axum::routing::post(token))
        .route(
            "/v1/me/player/currently-playing",
            axum::routing::get(current),
        )
        .route("/v1/me", axum::routing::get(me))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    crate::util::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    let hub = Hub::test();
    let music = MusicService::with_urls(
        hub.clone(),
        settings,
        Arc::new(Secrets::in_memory()),
        &base,
        &base,
    );
    music.set_hooks(Hooks {
        port: Box::new(|| Some(7470)),
        wanted: Box::new(|| true),
    });
    Rig {
        music,
        hub,
        fake,
        _dir: dir,
    }
}

fn track_json(id: &str, name: &str, playing: bool) -> Value {
    json!({
        "is_playing": playing,
        "progress_ms": 42_000,
        "currently_playing_type": "track",
        "item": {
            "type": "track",
            "id": id,
            "name": name,
            "duration_ms": 215_000,
            "artists": [{"name": "Kavinsky"}, {"name": "Lovefoxxx"}],
            "album": {
                "name": "OutRun",
                "images": [
                    {"url": "https://i.scdn.co/image/640", "width": 640, "height": 640},
                    {"url": "https://i.scdn.co/image/300", "width": 300, "height": 300},
                    {"url": "https://i.scdn.co/image/64", "width": 64, "height": 64}
                ]
            }
        }
    })
}

impl Rig {
    fn use_spotify(&self, token: StoredToken) {
        self.music
            .save_settings(MusicSettings {
                source: MusicSource::Spotify,
                spotify_client_id: "client-1".into(),
                ..MusicSettings::default()
            })
            .unwrap();
        self.music.save_token(&token);
    }

    fn reply(&self, status: u16, headers: Vec<(&'static str, String)>, body: Value) {
        self.fake
            .lock()
            .unwrap()
            .replies
            .push_back((status, headers, body));
    }
}

fn fresh_token() -> StoredToken {
    StoredToken {
        access_token: "live".into(),
        refresh_token: "ref-1".into(),
        expires_at: crate::util::now_ms() + 3_600_000,
        display_name: "Nova".into(),
    }
}

#[test]
fn pkce_values() {
    // RFC 7636, appendix B.
    assert_eq!(
        spotify::code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    let v = spotify::code_verifier();
    assert_eq!(v.len(), 64);
    assert!(
        v.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c))
    );
    assert_ne!(v, spotify::code_verifier());
    let url = url::Url::parse(&spotify::authorize_url(
        "https://accounts.spotify.com",
        "abc",
        "http://127.0.0.1:7470/spotify/callback",
        "chal",
        "st",
    ))
    .unwrap();
    let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(url.path(), "/authorize");
    assert_eq!(q["response_type"], "code");
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["code_challenge"], "chal");
    assert_eq!(
        q["scope"],
        "user-read-currently-playing user-read-playback-state"
    );
    assert_eq!(q["redirect_uri"], "http://127.0.0.1:7470/spotify/callback");
    assert_eq!(q["state"], "st");
}

#[test]
fn parses_spotify_replies() {
    let t = spotify::parse_current(&track_json("t1", "Nightcall", true)).unwrap();
    assert_eq!(t.title, "Nightcall");
    assert_eq!(t.artist, "Kavinsky, Lovefoxxx");
    assert_eq!(t.album, "OutRun");
    assert_eq!(t.art_url, "https://i.scdn.co/image/300");
    assert_eq!((t.progress_ms, t.duration_ms), (42_000, 215_000));
    assert!(t.playing);

    let episode = json!({
        "is_playing": false,
        "progress_ms": 1000,
        "item": {"type": "episode", "id": "e1", "name": "Ep 12", "duration_ms": 3_600_000,
                 "images": [{"url": "https://i.scdn.co/ep", "width": 640}],
                 "show": {"name": "The Show", "publisher": "Someone"}}
    });
    let e = spotify::parse_current(&episode).unwrap();
    assert_eq!((e.title.as_str(), e.artist.as_str()), ("Ep 12", "The Show"));
    assert_eq!(e.art_url, "https://i.scdn.co/ep");
    assert!(!e.playing);

    let ad = json!({"is_playing": true, "currently_playing_type": "ad", "item": null});
    assert!(spotify::parse_current(&ad).is_none());
    assert_eq!(spotify::retry_after(Some("7")), 7);
    assert_eq!(spotify::retry_after(Some("soon")), 5);
    assert_eq!(spotify::retry_after(None), 5);
}

#[tokio::test]
async fn polls_and_sets_live_variables() {
    let r = rig().await;
    r.use_spotify(fresh_token());
    r.reply(200, vec![], track_json("t1", "Nightcall", true));
    let wait = r.music.poll_once().await;
    assert_eq!(wait, SPOTIFY_ACTIVE);
    let v = |k: &str| r.hub.vars.get(k).unwrap_or(Value::Null);
    assert_eq!(v("music.title"), "Nightcall");
    assert_eq!(v("music.artist"), "Kavinsky, Lovefoxxx");
    assert_eq!(v("music.album"), "OutRun");
    assert_eq!(v("music.art_url"), "https://i.scdn.co/image/300");
    assert_eq!(v("music.playing"), true);
    assert_eq!(v("music.progress_ms"), 42_000);
    assert_eq!(v("music.duration_ms"), 215_000);
    assert!(
        r.hub.vars.saved().keys().all(|k| !k.starts_with("music.")),
        "never saved"
    );
    assert_eq!(r.fake.lock().unwrap().seen_tokens, ["live"]);

    // 204: nothing plays. The song stays, paused.
    r.reply(204, vec![], Value::Null);
    r.music.poll_once().await;
    assert_eq!(v("music.title"), "Nightcall");
    assert_eq!(v("music.playing"), false);
    assert_eq!(r.music.status().state, ConnState::Connected);
}

#[tokio::test]
async fn backs_off_when_rate_limited() {
    let r = rig().await;
    r.use_spotify(fresh_token());
    r.reply(
        429,
        vec![("retry-after", "7".into())],
        json!({"error": {"status": 429}}),
    );
    assert_eq!(r.music.poll_once().await, Duration::from_secs(7));
    r.reply(429, vec![("retry-after", "1".into())], json!({}));
    assert_eq!(
        r.music.poll_once().await,
        Duration::from_secs(5),
        "never faster than 5 s"
    );
}

#[tokio::test]
async fn refreshes_tokens() {
    let r = rig().await;
    // Runs out within the minute, so it's refreshed before the request.
    r.use_spotify(StoredToken {
        expires_at: crate::util::now_ms() + 30_000,
        ..fresh_token()
    });
    r.reply(200, vec![], track_json("t1", "Nightcall", true));
    r.music.poll_once().await;
    {
        let f = r.fake.lock().unwrap();
        assert_eq!(
            f.token_calls,
            [("refresh_token".to_string(), "ref-1".to_string())]
        );
        assert_eq!(f.seen_tokens, ["acc-1"]);
    }
    let saved = r.music.token().unwrap();
    assert_eq!(saved.access_token, "acc-1");
    assert_eq!(saved.refresh_token, "ref-1", "kept when Spotify sends none");
    assert!(!saved.stale(crate::util::now_ms()));

    // A 401 forces a refresh and a retry.
    r.reply(401, vec![], json!({"error": {"status": 401}}));
    r.reply(200, vec![], track_json("t2", "Odd Look", true));
    assert!(r.music.poll_once().await < Duration::from_secs(1));
    r.music.poll_once().await;
    assert_eq!(r.hub.vars.get("music.title"), Some("Odd Look".into()));
    assert_eq!(
        r.fake.lock().unwrap().seen_tokens,
        ["acc-1", "acc-1", "acc-2"]
    );

    // A revoked refresh token signs out.
    r.music.save_token(&StoredToken {
        refresh_token: "bad".into(),
        expires_at: 0,
        ..fresh_token()
    });
    assert_eq!(r.music.poll_once().await, PARKED);
    assert!(r.music.token().is_none());
    let st = r.music.status();
    assert_eq!(st.spotify_user, None);
    assert!(st.error.unwrap().contains("Sign in again"));
}

#[tokio::test]
async fn signs_in_with_pkce() {
    let r = rig().await;
    r.music
        .save_settings(MusicSettings {
            source: MusicSource::Spotify,
            spotify_client_id: "client-1".into(),
            ..MusicSettings::default()
        })
        .unwrap();
    let url = url::Url::parse(&r.music.start_login().unwrap()).unwrap();
    let state = url
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .to_string();
    assert!(r.music.status().login_pending);
    assert_eq!(
        r.music.status().redirect_uri,
        "http://127.0.0.1:7470/spotify/callback"
    );

    assert!(
        r.music
            .finish_login("wrong", Ok("code-1".into()))
            .await
            .is_err()
    );
    let msg = r
        .music
        .finish_login(&state, Ok("code-1".into()))
        .await
        .unwrap();
    assert_eq!(msg, "Spotify is connected as Nova.");
    let t = r.music.token().unwrap();
    assert_eq!(
        (t.access_token.as_str(), t.refresh_token.as_str()),
        ("acc-1", "ref-1")
    );
    let st = r.music.status();
    assert!(!st.login_pending);
    assert_eq!(st.spotify_user.as_deref(), Some("Nova"));
    assert!(
        r.music
            .finish_login(&state, Ok("code-1".into()))
            .await
            .is_err(),
        "a link works once"
    );

    let url = url::Url::parse(&r.music.start_login().unwrap()).unwrap();
    let state = url
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .to_string();
    let err = r
        .music
        .finish_login(&state, Err("access_denied".into()))
        .await
        .unwrap_err();
    assert!(err.contains("cancelled"));
    r.music.logout();
    assert!(r.music.token().is_none());
}

#[tokio::test]
async fn song_changes_signal_automation() {
    let r = rig().await;
    let mut signals = r.hub.subscribe_signals();
    let song = |id: &str, title: &str| NowPlaying {
        id: id.into(),
        title: title.into(),
        artist: "Artist".into(),
        playing: true,
        ..NowPlaying::default()
    };
    // The song playing at start isn't a change.
    r.music.apply(Some(song("a", "First")), String::new(), None);
    r.music.apply(
        Some(NowPlaying {
            progress_ms: 9000,
            ..song("a", "First")
        }),
        String::new(),
        None,
    );
    r.music.apply(None, String::new(), None);
    assert!(signals.try_recv().is_err());
    r.music
        .apply(Some(song("b", "Second")), String::new(), None);
    match signals.try_recv().unwrap() {
        Signal::SongChanged(t) => assert_eq!(t.title, "Second"),
        other => panic!("{other:?}"),
    }
    assert!(signals.try_recv().is_err());
}

#[tokio::test]
async fn covers_from_the_media_session_are_served() {
    let r = rig().await;
    let t = NowPlaying {
        title: "Song".into(),
        ..NowPlaying::default()
    };
    r.music.apply(
        Some(t),
        "Spotify".into(),
        Some(ArtSource::Bytes {
            mime: "image/png".into(),
            bytes: vec![1, 2, 3],
        }),
    );
    let url = r.hub.vars.get("music.art_url").unwrap();
    assert_eq!(url, "/music/art/1");
    assert_eq!(r.music.art(1).unwrap().bytes.as_ref(), &vec![1, 2, 3]);
    assert!(r.music.art(2).is_none());
    assert_eq!(r.music.status().player, "Spotify");
}

#[test]
fn text_file_formats() {
    let t = textfile::parse("Daft Punk - One More Time\n", "{artist} - {title}");
    assert_eq!(
        (t.artist.as_str(), t.title.as_str()),
        ("Daft Punk", "One More Time")
    );
    assert!(t.playing);
    let t = textfile::parse("A - B - C", "{artist} - {title}");
    assert_eq!((t.artist.as_str(), t.title.as_str()), ("A", "B - C"));
    let t = textfile::parse(
        "Title: Song\r\nArtist: Band\r\nAlbum: LP",
        "Title: {title}\\nArtist: {artist}\\nAlbum: {album}",
    );
    assert_eq!(
        (t.title.as_str(), t.artist.as_str(), t.album.as_str()),
        ("Song", "Band", "LP")
    );
    let t = textfile::parse("Just a title", "{artist} - {title}");
    assert_eq!((t.title.as_str(), t.artist.as_str()), ("Just a title", ""));
    let t = textfile::parse("  \n", "{artist} - {title}");
    assert!(!t.playing && t.title.is_empty());
    let t = textfile::parse("x {odd} y", "{title} {odd} y");
    assert_eq!(t.title, "x");
}

#[tokio::test]
async fn text_file_source_follows_changes() {
    let r = rig().await;
    let file = r._dir.path().join("np.txt");
    std::fs::write(&file, "Boards of Canada - Roygbiv").unwrap();
    r.music
        .save_settings(MusicSettings {
            source: MusicSource::TextFile,
            text_file: file.to_string_lossy().into_owned(),
            ..MusicSettings::default()
        })
        .unwrap();
    assert_eq!(r.music.poll_once().await, FILE_CHECK);
    assert_eq!(r.hub.vars.get("music.title"), Some("Roygbiv".into()));
    assert_eq!(
        r.hub.vars.get("music.artist"),
        Some("Boards of Canada".into())
    );
    assert_eq!(r.music.status().player, "np.txt");

    std::fs::write(&file, "Boards of Canada - Dayvan Cowboy (longer)").unwrap();
    r.music.poll_once().await;
    assert_eq!(
        r.hub.vars.get("music.title"),
        Some("Dayvan Cowboy (longer)".into())
    );

    // UTF-16, as some Windows tools write it.
    let mut bytes = vec![0xff, 0xfe];
    for u in "Air - La femme d'argent".encode_utf16() {
        bytes.extend(u.to_le_bytes());
    }
    std::fs::write(&file, bytes).unwrap();
    r.music.poll_once().await;
    assert_eq!(
        r.hub.vars.get("music.title"),
        Some("La femme d'argent".into())
    );

    std::fs::remove_file(&file).unwrap();
    r.music.poll_once().await;
    assert!(r.music.status().error.unwrap().contains("Can't find"));

    // Turning music off empties the variables.
    r.music.save_settings(MusicSettings::default()).unwrap();
    assert_eq!(r.hub.vars.get("music.title"), Some("".into()));
    assert_eq!(r.hub.vars.get("music.playing"), Some(false.into()));
}
