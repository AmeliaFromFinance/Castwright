//! Local web server for overlays. OBS loads `/overlay/<id>?token=...` in a
//! Browser Source; the page then connects to `/ws` for live data.

use crate::automation::Automation;
use crate::hub::{Hub, OverlayOut};
use crate::model::runtime::{OverlayClientMsg, OverlayMsg, ServerInfo};
use crate::store::project::ProjectStore;
use crate::util::secure_eq;
use axum::Router;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, RwLock};
use tokio::sync::{broadcast, oneshot};
use tower::ServiceExt;

#[derive(rust_embed::Embed)]
#[folder = "../dist"]
#[allow_missing = true]
struct WebAssets;

/// How many ports after the configured one to try if it's taken.
const PORT_ATTEMPTS: u16 = 10;
/// Largest message accepted from an overlay page.
const MAX_CLIENT_MSG: usize = 512 * 1024;

#[derive(Clone)]
struct Ctx {
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    automation: Arc<Automation>,
    token: Arc<RwLock<String>>,
}

pub struct OverlayServer {
    ctx: Ctx,
    info: RwLock<ServerInfo>,
    stop: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

#[derive(Deserialize)]
struct WsQuery {
    token: Option<String>,
    overlay: Option<String>,
}

impl OverlayServer {
    pub fn new(
        hub: Arc<Hub>,
        project: Arc<ProjectStore>,
        automation: Arc<Automation>,
        token: String,
    ) -> Arc<Self> {
        Arc::new(OverlayServer {
            ctx: Ctx {
                hub,
                project,
                automation,
                token: Arc::new(RwLock::new(token)),
            },
            info: RwLock::new(ServerInfo::default()),
            stop: std::sync::Mutex::new(None),
        })
    }

    pub fn info(&self) -> ServerInfo {
        self.info.read().unwrap().clone()
    }

    pub fn set_token(&self, token: String) {
        *self.ctx.token.write().unwrap() = token.clone();
        self.info.write().unwrap().token = token;
    }

    /// Start (or restart) listening. Tries the next few ports if the first is taken.
    pub async fn start(self: &Arc<Self>, port: u16, allow_lan: bool) -> ServerInfo {
        self.stop();
        let ip = if allow_lan {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        } else {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        };
        let mut last_err = String::new();
        let attempts = if port == 0 { 1 } else { PORT_ATTEMPTS };
        for p in port..port.saturating_add(attempts) {
            match tokio::net::TcpListener::bind(SocketAddr::new(ip, p)).await {
                Ok(listener) => {
                    let p = listener.local_addr().map(|a| a.port()).unwrap_or(p);
                    let (tx, rx) = oneshot::channel();
                    *self.stop.lock().unwrap() = Some(tx);
                    let app = router(self.ctx.clone());
                    tokio::spawn(async move {
                        let _ = axum::serve(listener, app)
                            .with_graceful_shutdown(async {
                                let _ = rx.await;
                            })
                            .await;
                    });
                    let info = ServerInfo {
                        running: true,
                        port: p,
                        base_url: format!("http://127.0.0.1:{p}"),
                        token: self.ctx.token.read().unwrap().clone(),
                        error: (port != 0 && p != port)
                            .then(|| format!("Port {port} was busy, using {p} instead.")),
                    };
                    *self.info.write().unwrap() = info.clone();
                    return info;
                }
                Err(e) => last_err = e.to_string(),
            }
        }
        let info = ServerInfo {
            running: false,
            port,
            base_url: String::new(),
            token: self.ctx.token.read().unwrap().clone(),
            error: Some(format!(
                "Couldn't open the overlay server on ports {port}-{}: {last_err}",
                port + PORT_ATTEMPTS - 1
            )),
        };
        *self.info.write().unwrap() = info.clone();
        info
    }

    pub fn stop(&self) {
        if let Some(tx) = self.stop.lock().unwrap().take() {
            let _ = tx.send(());
        }
        self.info.write().unwrap().running = false;
    }

    pub fn overlay_url(&self, overlay_id: &str) -> Option<String> {
        let info = self.info();
        info.running.then(|| {
            format!(
                "{}/overlay/{}?token={}",
                info.base_url, overlay_id, info.token
            )
        })
    }
}

fn router(ctx: Ctx) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/overlay/{id}", get(overlay_page))
        .route("/ws", get(ws_upgrade))
        .route("/assets/{name}", get(asset))
        .route("/api/overlay/{id}", get(overlay_json))
        .route("/api/actions/{id}/run", post(run_action))
        .route("/_app/{*path}", get(static_file))
        .with_state(ctx)
}

fn authorized(ctx: &Ctx, query: Option<&str>, headers: &HeaderMap) -> bool {
    let expected = ctx.token.read().unwrap().clone();
    let given = query
        .map(str::to_string)
        .or_else(|| {
            headers
                .get("x-castwright-token")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string)
        })
        .unwrap_or_default();
    !expected.is_empty() && secure_eq(&given, &expected)
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        "Missing or wrong token. Copy the overlay link again from Castwright.",
    )
        .into_response()
}

fn embedded(path: &str) -> Option<Response> {
    let file = WebAssets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut resp = Response::new(Body::from(file.data.into_owned()));
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).ok()?,
    );
    let cache = if path.starts_with("_app/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-store"
    };
    resp.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    Some(resp)
}

async fn overlay_page(
    State(ctx): State<Ctx>,
    Path(id): Path<String>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&ctx, q.token.as_deref(), &headers) {
        return forbidden();
    }
    if !ctx.project.read(|p| p.overlays.iter().any(|o| o.id == id)) {
        return (
            StatusCode::NOT_FOUND,
            "This overlay was deleted in Castwright.",
        )
            .into_response();
    }
    if cfg!(debug_assertions) && WebAssets::get("overlay.html").is_none() {
        // Development: the page comes from the Vite dev server.
        let to = format!(
            "http://localhost:1420/overlay.html?overlay={id}&token={}&server={}",
            q.token.unwrap_or_default(),
            headers
                .get(header::HOST)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("127.0.0.1")
        );
        return (StatusCode::TEMPORARY_REDIRECT, [(header::LOCATION, to)]).into_response();
    }
    embedded("overlay.html").unwrap_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Overlay page is missing from this build.",
        )
            .into_response()
    })
}

async fn static_file(Path(path): Path<String>) -> Response {
    if path.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    embedded(&format!("_app/{path}")).unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

async fn asset(
    State(ctx): State<Ctx>,
    Path(name): Path<String>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
    req: Request,
) -> Response {
    if !authorized(&ctx, q.token.as_deref(), &headers) {
        return forbidden();
    }
    let Some(path) = ctx.project.asset_path(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    // ServeFile handles Range requests, which video playback needs.
    match tower_http::services::ServeFile::new(path)
        .oneshot(req)
        .await
    {
        Ok(resp) => resp.map(Body::new).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn overlay_json(
    State(ctx): State<Ctx>,
    Path(id): Path<String>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&ctx, q.token.as_deref(), &headers) {
        return forbidden();
    }
    match ctx
        .project
        .read(|p| p.overlays.iter().find(|o| o.id == id).cloned())
    {
        Some(o) => axum::Json(o).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn run_action(
    State(ctx): State<Ctx>,
    Path(id): Path<String>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&ctx, q.token.as_deref(), &headers) {
        return forbidden();
    }
    match ctx.automation.run_manual(&id) {
        Ok(()) => (StatusCode::ACCEPTED, "ok").into_response(),
        Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
    }
}

async fn ws_upgrade(
    State(ctx): State<Ctx>,
    Query(q): Query<WsQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !authorized(&ctx, q.token.as_deref(), &headers) {
        return forbidden();
    }
    let Some(overlay_id) = q.overlay.filter(|o| !o.is_empty()) else {
        return (StatusCode::BAD_REQUEST, "overlay id missing").into_response();
    };
    ws.max_message_size(MAX_CLIENT_MSG)
        .on_upgrade(move |socket| overlay_socket(ctx, overlay_id, socket))
}

fn hello(ctx: &Ctx, overlay_id: &str) -> Option<OverlayMsg> {
    let overlay = ctx
        .project
        .read(|p| p.overlays.iter().find(|o| o.id == overlay_id).cloned())?;
    let widget_state = ctx.hub.db.widget_state().unwrap_or_default();
    Some(OverlayMsg::Hello {
        overlay,
        vars: ctx.hub.vars.snapshot(),
        recent: ctx.hub.recent_events(),
        chat: ctx.hub.recent_chat(),
        widget_state,
    })
}

async fn overlay_socket(ctx: Ctx, overlay_id: String, socket: WebSocket) {
    // Subscribe before building the hello so nothing sent in between is lost.
    let mut rx = ctx.hub.subscribe_overlays();
    let (mut tx, mut incoming) = socket.split();
    let Some(first) = hello(&ctx, &overlay_id) else {
        let _ = tx.send(Message::Close(None)).await;
        return;
    };
    if send(&mut tx, &first).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Ok(OverlayOut { target, msg }) => {
                    if target.as_deref().is_some_and(|t| t != overlay_id) {
                        continue;
                    }
                    if send(&mut tx, &msg).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    // Fell behind; resync with a fresh hello.
                    let Some(h) = hello(&ctx, &overlay_id) else { break };
                    if send(&mut tx, &h).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            msg = incoming.next() => match msg {
                Some(Ok(Message::Text(text))) => handle_client(&ctx, &overlay_id, text.as_str()),
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }
}

async fn send(
    tx: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    msg: &OverlayMsg,
) -> Result<(), ()> {
    let text = serde_json::to_string(msg).map_err(|_| ())?;
    tx.send(Message::Text(text.into())).await.map_err(|_| ())
}

fn handle_client(ctx: &Ctx, overlay_id: &str, text: &str) {
    let Ok(msg) = serde_json::from_str::<OverlayClientMsg>(text) else {
        return;
    };
    let layer_ok = |layer_id: &str| {
        ctx.project.read(|p| {
            p.overlays
                .iter()
                .find(|o| o.id == overlay_id)
                .is_some_and(|o| o.layers.iter().any(|l| l.id == layer_id))
        })
    };
    match msg {
        OverlayClientMsg::StoreSet {
            layer_id,
            key,
            value,
        } => {
            if layer_ok(&layer_id)
                && !key.is_empty()
                && key.len() <= 128
                && let Err(e) = ctx.hub.db.set_widget_value(&layer_id, &key, &value)
            {
                ctx.hub.log(
                    crate::model::runtime::LogLevel::Warn,
                    "overlay",
                    e.to_string(),
                );
            }
        }
        OverlayClientMsg::StoreDelete { layer_id, key } => {
            if layer_ok(&layer_id) {
                let _ = ctx.hub.db.delete_widget_value(&layer_id, &key);
            }
        }
        OverlayClientMsg::Ping => {}
    }
}

#[cfg(test)]
mod tests;
