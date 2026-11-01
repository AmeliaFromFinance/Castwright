use super::*;
use crate::alerts::AlertEngine;
use crate::model::event::{Event, EventKind};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as WsMsg;

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
