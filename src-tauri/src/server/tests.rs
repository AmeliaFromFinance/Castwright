use super::*;
use crate::alerts::AlertEngine;
use crate::model::event::{Event, EventKind};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as WsMsg;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

struct Rig {
    server: Arc<OverlayServer>,
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    base: String,
    overlay_id: String,
    _dir: tempfile::TempDir,
}

async fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = ProjectStore::open(dir.path()).unwrap();
    let project = Arc::new(store);
    let hub = Hub::test();
    let alerts = AlertEngine::new(hub.clone(), project.clone());
    let automation = Automation::new(hub.clone(), project.clone(), alerts);
    let server = OverlayServer::new(hub.clone(), project.clone(), automation, TOKEN.into());
    let info = server.start(0, false).await;
    assert!(info.running, "{:?}", info.error);
    let overlay_id = project.read(|p| p.overlays[0].id.clone());
    Rig {
        base: info.base_url,
        server,
        hub,
        project,
        overlay_id,
        _dir: dir,
    }
}

async fn status(url: &str) -> u16 {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(url)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn token_is_required() {
    let r = rig().await;
    assert_eq!(status(&format!("{}/health", r.base)).await, 200);
    let page = format!("{}/overlay/{}", r.base, r.overlay_id);
    assert_eq!(status(&page).await, 403);
    assert_eq!(status(&format!("{page}?token=wrong")).await, 403);
    let ok = status(&format!("{page}?token={TOKEN}")).await;
    assert!(ok == 200 || ok == 307, "got {ok}");
    assert_eq!(
        status(&format!("{}/overlay/nope?token={TOKEN}", r.base)).await,
        404
    );
    let json = format!("{}/api/overlay/{}?token={TOKEN}", r.base, r.overlay_id);
    assert_eq!(status(&json).await, 200);
}

#[tokio::test]
async fn assets_are_served_safely() {
    let r = rig().await;
    let src = r._dir.path().join("logo.png");
    std::fs::write(&src, vec![7u8; 2048]).unwrap();
    r.project.import_asset(&src).unwrap();
    let url = format!("{}/assets/logo.png?token={TOKEN}", r.base);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Range", "bytes=0-99")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 206, "range requests work");
    assert_eq!(resp.bytes().await.unwrap().len(), 100);
    assert_eq!(status(&format!("{}/assets/logo.png", r.base)).await, 403);
    assert_eq!(
        status(&format!(
            "{}/assets/..%2Fproject.json?token={TOKEN}",
            r.base
        ))
        .await,
        404
    );
    assert_eq!(
        status(&format!("{}/assets/missing.png?token={TOKEN}", r.base)).await,
        404
    );
    assert_eq!(
        status(&format!("{}/_app/..%2F..%2FCargo.toml", r.base)).await,
        404
    );
}

#[allow(clippy::result_large_err)]
async fn connect(
    r: &Rig,
    overlay: &str,
    token: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::Error,
> {
    let url = format!(
        "{}/ws?token={token}&overlay={overlay}",
        r.base.replace("http", "ws")
    );
    tokio_tungstenite::connect_async(url).await.map(|(s, _)| s)
}

async fn next_msg(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> OverlayMsg {
    loop {
        let m = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
            .await
            .expect("timed out")
            .unwrap()
            .unwrap();
        if let WsMsg::Text(t) = m {
            return serde_json::from_str(t.as_str()).unwrap();
        }
    }
}

#[tokio::test]
async fn websocket_flow() {
    let r = rig().await;
    assert!(connect(&r, &r.overlay_id, "bad").await.is_err());
    let mut ws = connect(&r, &r.overlay_id, TOKEN).await.unwrap();
    match next_msg(&mut ws).await {
        OverlayMsg::Hello { overlay, .. } => assert_eq!(overlay.id, r.overlay_id),
        other => panic!("expected hello, got {other:?}"),
    }
    // A message for another overlay is not delivered; one for everyone is.
    r.hub.to_overlays(Some("other"), OverlayMsg::Reload);
    r.hub
        .publish(Event::new(EventKind::Follow).with_user("a", "A"));
    loop {
        match next_msg(&mut ws).await {
            OverlayMsg::Reload => panic!("got a message meant for another overlay"),
            OverlayMsg::Event { event } => {
                assert_eq!(event.kind, EventKind::Follow);
                break;
            }
            _ => {}
        }
    }
    // Widget storage
    let layer_id = r.project.read(|p| p.overlays[0].layers[0].id.clone());
    let set = serde_json::json!({ "type": "store_set", "layer_id": layer_id, "key": "count", "value": 5 });
    ws.send(WsMsg::Text(set.to_string().into())).await.unwrap();
    let bogus = serde_json::json!({ "type": "store_set", "layer_id": "not-a-layer", "key": "x", "value": 1 });
    ws.send(WsMsg::Text(bogus.to_string().into()))
        .await
        .unwrap();
    ws.send(WsMsg::Text("not json".into())).await.unwrap();
    for _ in 0..100 {
        if r.hub.db.widget_state().unwrap().get(&layer_id).is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let state = r.hub.db.widget_state().unwrap();
    assert_eq!(state[&layer_id]["count"], 5);
    assert!(!state.contains_key("not-a-layer"));
}

#[tokio::test]
async fn unknown_overlay_closes_socket() {
    let r = rig().await;
    let mut ws = connect(&r, "nope", TOKEN).await.unwrap();
    let m = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
        .await
        .unwrap();
    assert!(matches!(m, Some(Ok(WsMsg::Close(_))) | None | Some(Err(_))));
}

#[tokio::test]
async fn run_action_endpoint() {
    let r = rig().await;
    let id = r.project.read(|p| p.actions[0].id.clone());
    let client = reqwest::Client::new();
    let url = format!("{}/api/actions/{id}/run", r.base);
    assert_eq!(
        client.post(&url).send().await.unwrap().status().as_u16(),
        403
    );
    let ok = client
        .post(&url)
        .header("x-castwright-token", TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status().as_u16(), 202);
    let missing = client
        .post(format!("{}/api/actions/missing/run?token={TOKEN}", r.base))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status().as_u16(), 404);
}

#[tokio::test]
async fn busy_port_falls_back() {
    let blocker = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let busy = blocker.local_addr().unwrap().port();
    let r = rig().await;
    let info = r.server.start(busy, false).await;
    assert!(info.running);
    assert_ne!(info.port, busy);
    assert!(info.error.unwrap().contains("busy"));
    assert!(
        r.server
            .overlay_url("x")
            .unwrap()
            .contains(&format!(":{}/overlay/x?token=", info.port))
    );
}

#[tokio::test]
async fn token_can_change() {
    let r = rig().await;
    let new_token = "fedcba9876543210fedcba9876543210";
    r.server.set_token(new_token.into());
    let page = format!("{}/api/overlay/{}", r.base, r.overlay_id);
    assert_eq!(status(&format!("{page}?token={TOKEN}")).await, 403);
    assert_eq!(status(&format!("{page}?token={new_token}")).await, 200);
}

#[tokio::test]
async fn asset_key_opens_assets_only() {
    let r = rig().await;
    let src = r._dir.path().join("logo.png");
    std::fs::write(&src, b"PNG").unwrap();
    r.project.import_asset(&src).unwrap();
    let key = asset_key(TOKEN);
    assert_eq!(r.server.info().asset_key, key);
    assert_ne!(key, TOKEN);
    assert_eq!(
        status(&format!("{}/assets/logo.png?key={key}", r.base)).await,
        200
    );
    assert_eq!(
        status(&format!("{}/assets/logo.png?key=wrong", r.base)).await,
        403
    );
    let json = format!("{}/api/overlay/{}?token={key}", r.base, r.overlay_id);
    assert_eq!(status(&json).await, 403, "the key isn't the token");
    r.server
        .set_token("fedcba9876543210fedcba9876543210".into());
    assert_eq!(
        status(&format!("{}/assets/logo.png?key={key}", r.base)).await,
        403
    );
}

#[tokio::test]
async fn other_pages_cant_use_live_data_or_actions() {
    let r = rig().await;
    let id = r.project.read(|p| p.actions[0].id.clone());
    let client = reqwest::Client::new();
    let url = format!("{}/api/actions/{id}/run?token={TOKEN}", r.base);
    // A sandboxed widget frame has the origin "null".
    let from_widget = client
        .post(&url)
        .header("Origin", "null")
        .send()
        .await
        .unwrap();
    assert_eq!(from_widget.status().as_u16(), 403);
    let from_site = client
        .post(&url)
        .header("Origin", "https://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(from_site.status().as_u16(), 403);
    let own = r.base.clone();
    let same = client
        .post(&url)
        .header("Origin", own)
        .send()
        .await
        .unwrap();
    assert_eq!(same.status().as_u16(), 202);

    let mut req = format!(
        "{}/ws?token={TOKEN}&overlay={}",
        r.base.replace("http", "ws"),
        r.overlay_id
    )
    .into_client_request()
    .unwrap();
    req.headers_mut().insert("Origin", "null".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(req).await.is_err());
}

#[tokio::test]
async fn new_secret_disconnects_open_pages() {
    let r = rig().await;
    let mut ws = connect(&r, &r.overlay_id, TOKEN).await.unwrap();
    assert!(matches!(next_msg(&mut ws).await, OverlayMsg::Hello { .. }));
    r.server
        .set_token("fedcba9876543210fedcba9876543210".into());
    let closed = tokio::time::timeout(std::time::Duration::from_secs(6), async {
        loop {
            match ws.next().await {
                None | Some(Err(_)) | Some(Ok(WsMsg::Close(_))) => return true,
                Some(Ok(_)) => {}
            }
        }
    })
    .await;
    assert_eq!(closed, Ok(true));
}

#[tokio::test]
async fn overlay_page_carries_asset_key_not_in_links() {
    if WebAssets::get("overlay.html").is_none() {
        return; // no frontend build in this checkout
    }
    let r = rig().await;
    let html = reqwest::get(format!("{}/overlay/{}?token={TOKEN}", r.base, r.overlay_id))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(html.contains(&format!(
        "name=\"cw-asset-key\" content=\"{}\"",
        asset_key(TOKEN)
    )));
}

#[tokio::test]
async fn alert_controls_endpoint() {
    let r = rig().await;
    let client = reqwest::Client::new();
    let post = |cmd: &str| {
        client
            .post(format!("{}/api/alerts/{cmd}", r.base))
            .header("x-castwright-token", TOKEN)
            .send()
    };
    assert_eq!(
        status(&format!("{}/api/alerts", r.base)).await,
        403,
        "needs the secret"
    );
    let resp = post("pause").await.unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["paused"], true);
    let body: serde_json::Value = post("toggle-mute").await.unwrap().json().await.unwrap();
    assert_eq!(
        (body["paused"].clone(), body["muted"].clone()),
        (true.into(), true.into())
    );
    post("resume").await.unwrap();
    post("unmute").await.unwrap();
    let body: serde_json::Value = client
        .get(format!("{}/api/alerts?token={TOKEN}", r.base))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        body,
        serde_json::json!({ "paused": false, "muted": false, "playing": false, "waiting": 0 })
    );
    assert_eq!(post("skip").await.unwrap().status().as_u16(), 200);
    assert_eq!(
        post("replay").await.unwrap().status().as_u16(),
        409,
        "nothing has played yet"
    );
    assert_eq!(post("dance").await.unwrap().status().as_u16(), 404);
}

#[tokio::test]
async fn sound_endpoints() {
    use crate::model::soundboard::{SoundButton, Soundboard};
    let r = rig().await;
    let client = reqwest::Client::new();
    let post = |path: &str| {
        client
            .post(format!("{}/api/sounds/{path}", r.base))
            .header("x-castwright-token", TOKEN)
            .send()
    };
    assert_eq!(
        post("horn/play").await.unwrap().status().as_u16(),
        503,
        "no soundboard yet"
    );
    let sb = crate::soundboard::SoundboardService::new(r.hub.clone(), r.project.clone());
    sb.save(Soundboard {
        buttons: vec![SoundButton {
            id: "horn".into(),
            src: "assets/horn.wav".into(),
            cooldown_s: 60,
            ..SoundButton::default()
        }],
        ..Soundboard::default()
    });
    r.server.set_soundboard(sb.clone());
    let mut overlays = r.hub.subscribe_overlays();

    let no_token = client
        .post(format!("{}/api/sounds/horn/play", r.base))
        .send()
        .await
        .unwrap();
    assert_eq!(no_token.status().as_u16(), 403);

    let resp = post("horn/play").await.unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["result"], "played");
    loop {
        if let OverlayMsg::SoundPlay { sound_id, src, .. } = overlays.recv().await.unwrap().msg {
            assert_eq!(
                (sound_id.as_str(), src.as_str()),
                ("horn", "assets/horn.wav")
            );
            break;
        }
    }

    let again = post("horn/play").await.unwrap();
    assert_eq!(again.status().as_u16(), 409);
    let body: serde_json::Value = again.json().await.unwrap();
    assert_eq!(body["result"], "cooldown");
    assert!(body["seconds_left"].as_u64().unwrap() > 50);

    let stop = post("horn/stop").await.unwrap();
    assert_eq!(stop.status().as_u16(), 200);
    assert_eq!(
        stop.json::<serde_json::Value>().await.unwrap()["result"],
        "stopped"
    );
    loop {
        if let OverlayMsg::SoundStop { sound_id } = overlays.recv().await.unwrap().msg {
            assert_eq!(sound_id.as_deref(), Some("horn"));
            break;
        }
    }
    assert_eq!(post("all/stop").await.unwrap().status().as_u16(), 200);
    assert_eq!(post("gone/play").await.unwrap().status().as_u16(), 404);
    assert_eq!(post("gone/stop").await.unwrap().status().as_u16(), 404);
    assert_eq!(post("horn/dance").await.unwrap().status().as_u16(), 404);
}

#[tokio::test]
async fn open_overlay_pages_are_counted() {
    let r = rig().await;
    assert_eq!(r.server.overlay_clients(&r.overlay_id), 0);
    let mut ws = connect(&r, &r.overlay_id, TOKEN).await.unwrap();
    next_msg(&mut ws).await;
    assert_eq!(r.server.overlay_clients(&r.overlay_id), 1);
    ws.close(None).await.unwrap();
    for _ in 0..100 {
        if r.server.overlay_clients(&r.overlay_id) == 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(r.server.overlay_clients(&r.overlay_id), 0);
}

#[tokio::test]
async fn overlays_hear_the_program_scene() {
    let r = rig().await;
    r.hub
        .set_var("obs.scene", serde_json::Value::from("Gameplay"), false);
    let mut ws = connect(&r, &r.overlay_id, TOKEN).await.unwrap();
    match next_msg(&mut ws).await {
        OverlayMsg::Hello { vars, .. } => assert_eq!(vars["obs.scene"], "Gameplay"),
        other => panic!("expected hello, got {other:?}"),
    }
    r.hub
        .set_var("obs.scene", serde_json::Value::from("BRB"), false);
    loop {
        if let OverlayMsg::Vars { changes } = next_msg(&mut ws).await {
            assert_eq!(changes["obs.scene"], "BRB");
            break;
        }
    }
}

async fn connect_as(
    r: &Rig,
    agent: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let url = format!(
        "{}/ws?token={TOKEN}&overlay={}",
        r.base.replace("http", "ws"),
        r.overlay_id
    );
    let mut req = url.into_client_request().unwrap();
    req.headers_mut()
        .insert("user-agent", agent.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    next_msg(&mut ws).await;
    ws
}

const OBS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 OBS/32.0.1";

#[tokio::test]
async fn connections_are_tracked_per_page() {
    let r = rig().await;
    let before = r.server.connections(&r.overlay_id);
    assert!(before.pages.is_empty());
    assert_eq!(before.last_connect, None);
    assert_eq!(before.last_disconnect, None);

    let mut obs = connect_as(&r, OBS_UA).await;
    let _chrome = connect_as(
        &r,
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )
    .await;
    let c = r.server.connections(&r.overlay_id);
    let agents: Vec<_> = c.pages.iter().map(|p| p.agent.as_str()).collect();
    assert_eq!(agents, ["OBS 32", "Chrome"]);
    assert!(c.last_connect.is_some());
    assert_eq!(c.last_disconnect, None);
    assert_eq!(r.server.overlay_clients(&r.overlay_id), 2);

    obs.close(None).await.unwrap();
    for _ in 0..100 {
        if r.server.overlay_clients(&r.overlay_id) == 1 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let c = r.server.connections(&r.overlay_id);
    assert_eq!(c.pages.len(), 1);
    assert_eq!(c.pages[0].agent, "Chrome");
    assert!(c.last_disconnect.is_some());
    assert!(
        r.server.connections("other").pages.is_empty(),
        "other overlays are separate"
    );
}

#[test]
fn user_agents_are_shortened() {
    let cases = [
        (OBS_UA, "OBS 32"),
        ("Mozilla/5.0 Chrome/120.0 Safari/537.36 Edg/120.0", "Edge"),
        ("Mozilla/5.0 Chrome/120.0 Safari/537.36 OPR/105.0", "Opera"),
        (
            "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0",
            "Firefox",
        ),
        (
            "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
            "Safari",
        ),
        ("Mozilla/5.0 Chrome/120.0 Streamlabs Desktop", "Streamlabs"),
        ("", "Unknown"),
        ("curl/8.5.0", "curl"),
        ("OBS/", "OBS"),
    ];
    for (ua, want) in cases {
        assert_eq!(short_agent(ua), want, "{ua}");
    }
}

#[tokio::test]
async fn music_covers_and_spotify_callback() {
    use crate::model::music::NowPlaying;
    use crate::music::{ArtSource, MusicService};
    let r = rig().await;
    let settings = Arc::new(crate::store::settings::SettingsStore::open(
        r._dir.path().join("settings.json"),
    ));
    let music = MusicService::new(
        r.hub.clone(),
        settings,
        Arc::new(crate::store::secrets::Secrets::in_memory()),
    );
    let art = format!("{}/music/art/1", r.base);
    let key = asset_key(TOKEN);
    assert_eq!(
        status(&format!("{art}?key={key}")).await,
        404,
        "no music service yet"
    );
    r.server.set_music(music.clone());
    music.apply(
        Some(NowPlaying {
            title: "Song".into(),
            ..NowPlaying::default()
        }),
        String::new(),
        Some(ArtSource::Bytes {
            mime: "image/png".into(),
            bytes: vec![9; 10],
        }),
    );
    assert_eq!(status(&art).await, 403);
    let resp = reqwest::get(format!("{art}?key={key}")).await.unwrap();
    assert_eq!(resp.status().as_u16(), 200);
    assert_eq!(resp.headers()["content-type"], "image/png");
    assert!(
        resp.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("sandbox")
    );
    assert_eq!(resp.bytes().await.unwrap().len(), 10);
    assert_eq!(
        status(&format!("{}/music/art/2?key={key}", r.base)).await,
        404
    );

    // A callback that doesn't match a sign-in started in the app does nothing.
    let cb = reqwest::get(format!(
        "{}/spotify/callback?code=x&state=<b>made-up</b>",
        r.base
    ))
    .await
    .unwrap();
    assert_eq!(cb.status().as_u16(), 400);
    let page = cb.text().await.unwrap();
    assert!(page.contains("Start again from Castwright"));
    assert!(!page.contains("<b>made-up"));
}
