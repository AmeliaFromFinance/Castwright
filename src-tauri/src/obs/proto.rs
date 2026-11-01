//! A small obs-websocket 5 client. It reads only the fields Castwright uses, so it
//! works with every 5.x release (OBS 28 and newer).

use base64::Engine;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type Pending = Mutex<HashMap<u64, oneshot::Sender<Result<Value, ReqError>>>>;

const RPC_VERSION: u64 = 1;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const CLOSE_AUTH_FAILED: u16 = 4009;
const CLOSE_UNSUPPORTED_RPC: u16 = 4010;

/// Event groups to subscribe to (obs-websocket `EventSubscription`).
pub mod sub {
    pub const GENERAL: u32 = 1 << 0;
    pub const CONFIG: u32 = 1 << 1;
    pub const SCENES: u32 = 1 << 2;
    pub const INPUTS: u32 = 1 << 3;
    pub const TRANSITIONS: u32 = 1 << 4;
    pub const OUTPUTS: u32 = 1 << 6;
    pub const SCENE_ITEMS: u32 = 1 << 7;
    pub const UI: u32 = 1 << 10;
    pub const INPUT_VOLUME_METERS: u32 = 1 << 16;
}

/// obs-websocket request status codes this app reacts to.
pub mod code {
    pub const NOT_READY: u16 = 207;
    pub const OUTPUT_RUNNING: u16 = 500;
    pub const OUTPUT_NOT_RUNNING: u16 = 501;
    pub const OUTPUT_PAUSED: u16 = 502;
    pub const OUTPUT_NOT_PAUSED: u16 = 503;
    pub const OUTPUT_DISABLED: u16 = 504;
    pub const STUDIO_MODE_ACTIVE: u16 = 505;
    pub const STUDIO_MODE_NOT_ACTIVE: u16 = 506;
    pub const RESOURCE_NOT_FOUND: u16 = 600;
    pub const INVALID_INPUT_KIND: u16 = 605;
}

#[derive(Debug, Clone, PartialEq)]
pub enum ReqError {
    Api { code: u16, comment: Option<String> },
    Disconnected,
    Timeout,
}

impl ReqError {
    pub fn code(&self) -> Option<u16> {
        match self {
            ReqError::Api { code, .. } => Some(*code),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectFailure {
    Refused,
    Unreachable,
    TimedOut,
    BadPassword,
    NotObs,
    Unsupported,
    BadAddress,
    Other,
}

#[derive(Debug)]
pub struct ConnectError {
    pub failure: ConnectFailure,
    pub detail: String,
}

impl ConnectError {
    fn new(failure: ConnectFailure, detail: impl Into<String>) -> Self {
        ConnectError {
            failure,
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObsEvent {
    pub kind: String,
    pub data: Value,
}

/// Incoming events. `next` returns None once the connection is gone.
pub struct Events {
    rx: mpsc::Receiver<ObsEvent>,
    lagged: Arc<AtomicBool>,
}

impl Events {
    pub async fn next(&mut self) -> Option<ObsEvent> {
        self.rx.recv().await
    }

    /// True (once) if events were dropped because they came in faster than read.
    pub fn take_lagged(&self) -> bool {
        self.lagged.swap(false, Ordering::SeqCst)
    }
}

pub struct ObsClient {
    write: tokio::sync::Mutex<SplitSink<Socket, Message>>,
    pending: Arc<Pending>,
    reidentify: Arc<Mutex<VecDeque<oneshot::Sender<()>>>>,
    next_id: AtomicU64,
    closed: Arc<AtomicBool>,
    reader: JoinHandle<()>,
    timeout: Duration,
}

impl Drop for ObsClient {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// obs-websocket 5 authentication string.
pub fn auth_response(password: &str, salt: &str, challenge: &str) -> String {
    let b64 = base64::engine::general_purpose::STANDARD;
    let secret = b64.encode(Sha256::digest(format!("{password}{salt}").as_bytes()));
    b64.encode(Sha256::digest(format!("{secret}{challenge}").as_bytes()))
}

pub fn ws_url(host: &str, port: u16) -> String {
    let host = host.trim();
    if host.contains(':') && !host.starts_with('[') {
        format!("ws://[{host}]:{port}")
    } else {
        format!("ws://{host}:{port}")
    }
}

fn classify_ws(e: &tungstenite::Error) -> ConnectFailure {
    use std::io::ErrorKind;
    match e {
        tungstenite::Error::Io(io) => match io.kind() {
            ErrorKind::ConnectionRefused => ConnectFailure::Refused,
            ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted
            | ErrorKind::UnexpectedEof => ConnectFailure::NotObs,
            _ => ConnectFailure::Unreachable,
        },
        tungstenite::Error::Url(_) => ConnectFailure::BadAddress,
        tungstenite::Error::Http(_)
        | tungstenite::Error::HttpFormat(_)
        | tungstenite::Error::Protocol(_)
        | tungstenite::Error::Utf8
        | tungstenite::Error::ConnectionClosed
        | tungstenite::Error::AlreadyClosed => ConnectFailure::NotObs,
        _ => ConnectFailure::Other,
    }
}

enum Incoming {
    Json(Value),
    Closed(Option<(u16, String)>),
}

async fn read_next(read: &mut SplitStream<Socket>) -> Result<Incoming, ConnectError> {
    loop {
        let msg = tokio::time::timeout(HANDSHAKE_TIMEOUT, read.next())
            .await
            .map_err(|_| {
                ConnectError::new(ConnectFailure::NotObs, "no greeting from the server")
            })?;
        match msg {
            None => return Ok(Incoming::Closed(None)),
            Some(Err(e)) => return Err(ConnectError::new(classify_ws(&e), e.to_string())),
            Some(Ok(Message::Text(t))) => {
                let v = serde_json::from_str(t.as_str())
                    .map_err(|e| ConnectError::new(ConnectFailure::NotObs, e.to_string()))?;
                return Ok(Incoming::Json(v));
            }
            Some(Ok(Message::Close(f))) => {
                return Ok(Incoming::Closed(
                    f.map(|f| (u16::from(f.code), f.reason.as_str().to_string())),
                ));
            }
            Some(Ok(Message::Binary(_))) => {
                return Err(ConnectError::new(ConnectFailure::NotObs, "binary message"));
            }
            Some(Ok(_)) => {}
        }
    }
}

/// Connects and identifies. `timeout` covers reaching the server; each request
/// afterwards gets `request_timeout`.
pub async fn connect(
    host: &str,
    port: u16,
    password: Option<&str>,
    subscriptions: u32,
    event_buffer: usize,
    timeout: Duration,
    request_timeout: Duration,
) -> Result<(ObsClient, Events), ConnectError> {
    let url = ws_url(host, port);
    let (socket, _) =
        match tokio::time::timeout(timeout, tokio_tungstenite::connect_async(url)).await {
            Err(_) => return Err(ConnectError::new(ConnectFailure::TimedOut, "timed out")),
            Ok(Err(e)) => return Err(ConnectError::new(classify_ws(&e), e.to_string())),
            Ok(Ok(s)) => s,
        };
    let (mut write, mut read) = socket.split();

    let hello = match read_next(&mut read).await? {
        Incoming::Json(v) if v["op"] == 0 => v,
        _ => return Err(ConnectError::new(ConnectFailure::NotObs, "no hello")),
    };
    let auth = &hello["d"]["authentication"];
    let mut identify = json!({ "rpcVersion": RPC_VERSION, "eventSubscriptions": subscriptions });
    if let (Some(challenge), Some(salt), Some(pw)) =
        (auth["challenge"].as_str(), auth["salt"].as_str(), password)
    {
        identify["authentication"] = Value::String(auth_response(pw, salt, challenge));
    }
    write
        .send(Message::text(json!({ "op": 1, "d": identify }).to_string()))
        .await
        .map_err(|e| ConnectError::new(classify_ws(&e), e.to_string()))?;

    match read_next(&mut read).await? {
        Incoming::Json(v) if v["op"] == 2 => {}
        Incoming::Closed(Some((CLOSE_AUTH_FAILED, _))) => {
            return Err(ConnectError::new(
                ConnectFailure::BadPassword,
                "authentication failed",
            ));
        }
        Incoming::Closed(Some((CLOSE_UNSUPPORTED_RPC, r))) => {
            return Err(ConnectError::new(ConnectFailure::Unsupported, r));
        }
        Incoming::Closed(Some((code, r))) => {
            return Err(ConnectError::new(
                ConnectFailure::Other,
                format!("closed ({code}) {r}"),
            ));
        }
        Incoming::Closed(None) => {
            return Err(ConnectError::new(
                ConnectFailure::Other,
                "closed during login",
            ));
        }
        Incoming::Json(_) => {
            return Err(ConnectError::new(
                ConnectFailure::NotObs,
                "unexpected reply",
            ));
        }
    }

    let pending: Arc<Pending> = Arc::default();
    let reidentify: Arc<Mutex<VecDeque<oneshot::Sender<()>>>> = Arc::default();
    let closed = Arc::new(AtomicBool::new(false));
    let lagged = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel(event_buffer.max(1));
    let reader = tokio::spawn(read_loop(
        read,
        tx,
        pending.clone(),
        reidentify.clone(),
        closed.clone(),
        lagged.clone(),
    ));
    Ok((
        ObsClient {
            write: tokio::sync::Mutex::new(write),
            pending,
            reidentify,
            next_id: AtomicU64::new(1),
            closed,
            reader,
            timeout: request_timeout,
        },
        Events { rx, lagged },
    ))
}

async fn read_loop(
    mut read: SplitStream<Socket>,
    events: mpsc::Sender<ObsEvent>,
    pending: Arc<Pending>,
    reidentify: Arc<Mutex<VecDeque<oneshot::Sender<()>>>>,
    closed: Arc<AtomicBool>,
    lagged: Arc<AtomicBool>,
) {
    while let Some(msg) = read.next().await {
        let text = match msg {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => continue,
        };
        let Ok(v) = serde_json::from_str::<Value>(text.as_str()) else {
            continue;
        };
        let d = &v["d"];
        match v["op"].as_u64() {
            Some(5) => {
                let ev = ObsEvent {
                    kind: d["eventType"].as_str().unwrap_or_default().to_string(),
                    data: d.get("eventData").cloned().unwrap_or(Value::Null),
                };
                if let Err(mpsc::error::TrySendError::Full(_)) = events.try_send(ev) {
                    lagged.store(true, Ordering::SeqCst);
                }
            }
            Some(7) => {
                let Some(id) = d["requestId"].as_str().and_then(|s| s.parse::<u64>().ok()) else {
                    continue;
                };
                let Some(tx) = lock(&pending).remove(&id) else {
                    continue;
                };
                let _ = tx.send(response(d));
            }
            Some(2) => {
                if let Some(tx) = lock(&reidentify).pop_front() {
                    let _ = tx.send(());
                }
            }
            _ => {}
        }
    }
    closed.store(true, Ordering::SeqCst);
    lock(&pending).clear();
    lock(&reidentify).clear();
}

fn response(d: &Value) -> Result<Value, ReqError> {
    let status = &d["requestStatus"];
    if status["result"].as_bool() == Some(true) {
        Ok(match d.get("responseData") {
            Some(v) if !v.is_null() => v.clone(),
            _ => json!({}),
        })
    } else {
        Err(ReqError::Api {
            code: status["code"]
                .as_u64()
                .unwrap_or(0)
                .min(u64::from(u16::MAX)) as u16,
            comment: status["comment"].as_str().map(String::from),
        })
    }
}

impl ObsClient {
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Sends a request and waits for its response data (`{}` when there is none).
    pub async fn request(&self, kind: &str, data: Value) -> Result<Value, ReqError> {
        if self.is_closed() {
            return Err(ReqError::Disconnected);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        lock(&self.pending).insert(id, tx);
        // The reader marks itself closed before dropping waiters, so this catches a
        // request added just after that.
        if self.is_closed() {
            lock(&self.pending).remove(&id);
            return Err(ReqError::Disconnected);
        }
        let mut d = json!({ "requestType": kind, "requestId": id.to_string() });
        if !data.is_null() {
            d["requestData"] = data;
        }
        let msg = Message::text(json!({ "op": 6, "d": d }).to_string());
        let sent = tokio::time::timeout(self.timeout, async {
            self.write.lock().await.send(msg).await
        })
        .await;
        if !matches!(sent, Ok(Ok(()))) {
            lock(&self.pending).remove(&id);
            return Err(if sent.is_err() {
                ReqError::Timeout
            } else {
                ReqError::Disconnected
            });
        }
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(ReqError::Disconnected),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(ReqError::Timeout)
            }
        }
    }

    /// Changes which events OBS sends.
    pub async fn reidentify(&self, subscriptions: u32) -> Result<(), ReqError> {
        if self.is_closed() {
            return Err(ReqError::Disconnected);
        }
        let (tx, rx) = oneshot::channel();
        lock(&self.reidentify).push_back(tx);
        let msg = json!({ "op": 3, "d": { "eventSubscriptions": subscriptions } });
        if self
            .write
            .lock()
            .await
            .send(Message::text(msg.to_string()))
            .await
            .is_err()
        {
            return Err(ReqError::Disconnected);
        }
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => Err(ReqError::Disconnected),
            Err(_) => Err(ReqError::Timeout),
        }
    }

    /// Says goodbye to OBS. The connection is closed for good when the client is dropped.
    pub async fn close(&self) {
        let _ = tokio::time::timeout(Duration::from_secs(1), async {
            let mut w = self.write.lock().await;
            let _ = w.send(Message::Close(None)).await;
            let _ = w.close().await;
        })
        .await;
        self.reader.abort();
        self.closed.store(true, Ordering::SeqCst);
        lock(&self.pending).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_matches_protocol_example() {
        assert_eq!(
            auth_response(
                "supersecretpassword",
                "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
                "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="
            ),
            "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4="
        );
    }

    #[test]
    fn urls() {
        assert_eq!(ws_url("127.0.0.1", 4455), "ws://127.0.0.1:4455");
        assert_eq!(ws_url("::1", 4455), "ws://[::1]:4455");
        assert_eq!(ws_url("[::1]", 4455), "ws://[::1]:4455");
    }

    #[test]
    fn responses() {
        let ok = json!({"requestStatus": {"result": true, "code": 100}, "responseData": {"a": 1}});
        assert_eq!(response(&ok), Ok(json!({"a": 1})));
        let empty = json!({"requestStatus": {"result": true, "code": 100}});
        assert_eq!(response(&empty), Ok(json!({})));
        let bad = json!({"requestStatus": {"result": false, "code": 600, "comment": "No input"}});
        assert_eq!(
            response(&bad),
            Err(ReqError::Api {
                code: 600,
                comment: Some("No input".into())
            })
        );
    }

    async fn fake_server(
        script: impl FnOnce(WebSocketStream<TcpStream>) -> futures_util::future::BoxFuture<'static, ()>
        + Send
        + 'static,
    ) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
            script(ws).await;
        });
        port
    }

    async fn recv_json(ws: &mut WebSocketStream<TcpStream>) -> Value {
        loop {
            if let Message::Text(t) = ws.next().await.unwrap().unwrap() {
                return serde_json::from_str(t.as_str()).unwrap();
            }
        }
    }

    async fn send_json(ws: &mut WebSocketStream<TcpStream>, v: Value) {
        ws.send(Message::text(v.to_string())).await.unwrap();
    }

    fn hello(auth: bool) -> Value {
        let mut d = json!({"obsWebSocketVersion": "5.3.3", "rpcVersion": 1});
        if auth {
            d["authentication"] = json!({"challenge": "c", "salt": "s"});
        }
        json!({"op": 0, "d": d})
    }

    const SECS: Duration = Duration::from_secs(2);

    #[tokio::test]
    async fn requests_events_and_close() {
        let port = fake_server(|mut ws| {
            Box::pin(async move {
                send_json(&mut ws, hello(true)).await;
                let id = recv_json(&mut ws).await;
                assert_eq!(id["op"], 1);
                assert_eq!(id["d"]["authentication"], auth_response("pw", "s", "c"));
                assert_eq!(id["d"]["eventSubscriptions"], 4);
                send_json(&mut ws, json!({"op": 2, "d": {"negotiatedRpcVersion": 1}})).await;

                let req = recv_json(&mut ws).await;
                assert_eq!(req["d"]["requestType"], "GetSceneList");
                send_json(
                    &mut ws,
                    json!({"op": 5, "d": {"eventType": "StudioModeStateChanged", "eventIntent": 1024,
                        "eventData": {"studioModeEnabled": true}}}),
                )
                .await;
                send_json(
                    &mut ws,
                    json!({"op": 7, "d": {"requestType": "GetSceneList", "requestId": req["d"]["requestId"],
                        "requestStatus": {"result": true, "code": 100}, "responseData": {"scenes": []}}}),
                )
                .await;
                let req = recv_json(&mut ws).await;
                send_json(
                    &mut ws,
                    json!({"op": 7, "d": {"requestType": "X", "requestId": req["d"]["requestId"],
                        "requestStatus": {"result": false, "code": 204, "comment": "Unknown"}}}),
                )
                .await;
                // Re-identify, then hang up.
                let re = recv_json(&mut ws).await;
                assert_eq!(re["op"], 3);
                send_json(&mut ws, json!({"op": 2, "d": {"negotiatedRpcVersion": 1}})).await;
                let _ = recv_json(&mut ws).await;
                let _ = ws.close(None).await;
            })
        })
        .await;

        let (c, mut ev) = connect("127.0.0.1", port, Some("pw"), sub::SCENES, 8, SECS, SECS)
            .await
            .unwrap();
        let r = c.request("GetSceneList", Value::Null).await.unwrap();
        assert_eq!(r, json!({"scenes": []}));
        let e = ev.next().await.unwrap();
        assert_eq!(e.kind, "StudioModeStateChanged");
        assert_eq!(e.data["studioModeEnabled"], true);
        let err = c.request("X", json!({})).await.unwrap_err();
        assert_eq!(err.code(), Some(204));
        c.reidentify(sub::SCENES | sub::INPUT_VOLUME_METERS)
            .await
            .unwrap();
        // Server hangs up while this request waits.
        assert_eq!(
            c.request("Y", Value::Null).await,
            Err(ReqError::Disconnected)
        );
        assert!(ev.next().await.is_none(), "events end with the connection");
        assert!(c.is_closed());
        assert_eq!(
            c.request("Z", Value::Null).await,
            Err(ReqError::Disconnected)
        );
    }

    #[tokio::test]
    async fn bad_password_is_reported() {
        let port = fake_server(|mut ws| {
            Box::pin(async move {
                send_json(&mut ws, hello(true)).await;
                let _ = recv_json(&mut ws).await;
                let _ = ws
                    .close(Some(tungstenite::protocol::CloseFrame {
                        code: CLOSE_AUTH_FAILED.into(),
                        reason: "Authentication failed.".into(),
                    }))
                    .await;
            })
        })
        .await;
        let e = connect("127.0.0.1", port, Some("x"), 0, 8, SECS, SECS)
            .await
            .err()
            .unwrap();
        assert_eq!(e.failure, ConnectFailure::BadPassword);
    }

    #[tokio::test]
    async fn request_times_out() {
        let port = fake_server(|mut ws| {
            Box::pin(async move {
                send_json(&mut ws, hello(false)).await;
                let _ = recv_json(&mut ws).await;
                send_json(&mut ws, json!({"op": 2, "d": {"negotiatedRpcVersion": 1}})).await;
                // Never answers.
                tokio::time::sleep(Duration::from_secs(5)).await;
            })
        })
        .await;
        let (c, _ev) = connect(
            "127.0.0.1",
            port,
            None,
            0,
            8,
            SECS,
            Duration::from_millis(200),
        )
        .await
        .unwrap();
        assert_eq!(
            c.request("GetStats", Value::Null).await,
            Err(ReqError::Timeout)
        );
        assert!(lock(&c.pending).is_empty());
    }

    #[tokio::test]
    async fn not_obs_and_refused() {
        let port = fake_server(|mut ws| {
            Box::pin(async move {
                send_json(&mut ws, json!({"hello": "world"})).await;
                tokio::time::sleep(Duration::from_secs(1)).await;
            })
        })
        .await;
        let e = connect("127.0.0.1", port, None, 0, 8, SECS, SECS)
            .await
            .err()
            .unwrap();
        assert_eq!(e.failure, ConnectFailure::NotObs);

        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let free = l.local_addr().unwrap().port();
        drop(l);
        let e = connect("127.0.0.1", free, None, 0, 8, SECS, SECS)
            .await
            .err()
            .unwrap();
        assert_eq!(e.failure, ConnectFailure::Refused);
    }

    #[tokio::test]
    async fn slow_reader_marks_lag() {
        let port = fake_server(|mut ws| {
            Box::pin(async move {
                send_json(&mut ws, hello(false)).await;
                let _ = recv_json(&mut ws).await;
                send_json(&mut ws, json!({"op": 2, "d": {"negotiatedRpcVersion": 1}})).await;
                for i in 0..10 {
                    send_json(
                        &mut ws,
                        json!({"op": 5, "d": {"eventType": "E", "eventData": {"i": i}}}),
                    )
                    .await;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            })
        })
        .await;
        let (_c, mut ev) = connect("127.0.0.1", port, None, 0, 4, SECS, SECS)
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(ev.take_lagged());
        assert!(!ev.take_lagged(), "reported once");
        assert_eq!(ev.next().await.unwrap().data["i"], 0);
    }
}
