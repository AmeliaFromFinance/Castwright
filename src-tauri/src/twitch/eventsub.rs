//! EventSub over WebSocket.

use super::TwitchService;
use super::helix::HelixError;
use super::normalize::{self, Meta, Normalized};
use crate::model::event::EventKind;
use crate::model::runtime::{AccountRole, ConnState, LogLevel};
use futures_util::StreamExt;
use reqwest::Method;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type PendingConnect =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<(Ws, Session), String>> + Send>>;

#[derive(Debug, Clone, Copy)]
enum Cond {
    Broadcaster,
    WithModerator,
    WithUser,
    ToBroadcaster,
}

struct SubSpec {
    kind: &'static str,
    /// Tried in order until one is accepted.
    versions: &'static [&'static str],
    cond: Cond,
    /// Completes "missing permission to ...".
    what: &'static str,
}

const fn sub(
    kind: &'static str,
    versions: &'static [&'static str],
    cond: Cond,
    what: &'static str,
) -> SubSpec {
    SubSpec {
        kind,
        versions,
        cond,
        what,
    }
}

const V1: &[&str] = &["1"];
const V2: &[&str] = &["2"];
const V2_OR_1: &[&str] = &["2", "1"];

const SUBSCRIPTIONS: &[SubSpec] = &[
    sub("channel.follow", V2, Cond::WithModerator, "read follows"),
    sub(
        "channel.chat.notification",
        V1,
        Cond::WithUser,
        "read subs and gifts in chat",
    ),
    sub("channel.chat.message", V1, Cond::WithUser, "read chat"),
    sub(
        "channel.chat.message_delete",
        V1,
        Cond::WithUser,
        "see deleted chat messages",
    ),
    sub(
        "channel.chat.clear_user_messages",
        V1,
        Cond::WithUser,
        "see timeouts and bans",
    ),
    sub("channel.chat.clear", V1, Cond::WithUser, "see chat clears"),
    sub("channel.cheer", V1, Cond::Broadcaster, "read cheers"),
    sub("channel.raid", V1, Cond::ToBroadcaster, "read raids"),
    sub(
        "channel.channel_points_custom_reward_redemption.add",
        V1,
        Cond::Broadcaster,
        "read channel point redemptions",
    ),
    sub("channel.bits.use", V1, Cond::Broadcaster, "read Power-ups"),
    sub(
        "channel.hype_train.begin",
        V2_OR_1,
        Cond::Broadcaster,
        "read hype trains",
    ),
    sub(
        "channel.hype_train.progress",
        V2_OR_1,
        Cond::Broadcaster,
        "read hype trains",
    ),
    sub(
        "channel.hype_train.end",
        V2_OR_1,
        Cond::Broadcaster,
        "read hype trains",
    ),
    sub("channel.poll.begin", V1, Cond::Broadcaster, "read polls"),
    sub("channel.poll.progress", V1, Cond::Broadcaster, "read polls"),
    sub("channel.poll.end", V1, Cond::Broadcaster, "read polls"),
    sub(
        "channel.prediction.begin",
        V1,
        Cond::Broadcaster,
        "read predictions",
    ),
    sub(
        "channel.prediction.progress",
        V1,
        Cond::Broadcaster,
        "read predictions",
    ),
    sub(
        "channel.prediction.lock",
        V1,
        Cond::Broadcaster,
        "read predictions",
    ),
    sub(
        "channel.prediction.end",
        V1,
        Cond::Broadcaster,
        "read predictions",
    ),
    sub(
        "channel.shoutout.receive",
        V1,
        Cond::WithModerator,
        "read shoutouts",
    ),
    sub(
        "channel.ad_break.begin",
        V1,
        Cond::Broadcaster,
        "read ad breaks",
    ),
    sub(
        "channel.charity_campaign.donate",
        V1,
        Cond::Broadcaster,
        "read charity donations",
    ),
    sub(
        "stream.online",
        V1,
        Cond::Broadcaster,
        "see when you go live",
    ),
    sub(
        "stream.offline",
        V1,
        Cond::Broadcaster,
        "see when you go offline",
    ),
    sub(
        "channel.update",
        V2,
        Cond::Broadcaster,
        "see title and category changes",
    ),
];

fn condition(cond: Cond, id: &str) -> Value {
    match cond {
        Cond::Broadcaster => json!({ "broadcaster_user_id": id }),
        Cond::WithModerator => json!({ "broadcaster_user_id": id, "moderator_user_id": id }),
        Cond::WithUser => json!({ "broadcaster_user_id": id, "user_id": id }),
        Cond::ToBroadcaster => json!({ "to_broadcaster_user_id": id }),
    }
}

#[derive(Debug, Clone)]
struct Session {
    id: String,
    keepalive: Duration,
}

enum Next {
    Continue,
    Reconnect(String),
}

async fn connect(url: String, welcome_timeout: Duration) -> Result<(Ws, Session), String> {
    let (mut ws, _) = tokio::time::timeout(welcome_timeout, tokio_tungstenite::connect_async(&url))
        .await
        .map_err(|_| "connection timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let welcome = tokio::time::timeout(welcome_timeout, async {
        while let Some(msg) = ws.next().await {
            match msg.map_err(|e| e.to_string())? {
                Message::Text(t) => return Ok(t.to_string()),
                Message::Close(_) => break,
                _ => {}
            }
        }
        Err("closed before welcome".to_string())
    })
    .await
    .map_err(|_| "no welcome message".to_string())??;
    let v: Value = serde_json::from_str(&welcome).map_err(|e| e.to_string())?;
    if v.pointer("/metadata/message_type").and_then(Value::as_str) != Some("session_welcome") {
        return Err("first message wasn't a welcome".into());
    }
    let id = v
        .pointer("/payload/session/id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Err("welcome without a session id".into());
    }
    let keepalive = v
        .pointer("/payload/session/keepalive_timeout_seconds")
        .and_then(Value::as_u64)
        .unwrap_or(10)
        .max(1);
    Ok((
        ws,
        Session {
            id,
            keepalive: Duration::from_secs(keepalive),
        },
    ))
}

impl TwitchService {
    pub(crate) async fn eventsub_loop(self: Arc<Self>) {
        let mut failures: u32 = 0;
        loop {
            self.update_status(|s| s.eventsub = ConnState::Connecting);
            let url = self.endpoints.eventsub_url.clone();
            match connect(url, self.timing.welcome_timeout).await {
                Ok((ws, session)) => {
                    failures = 0;
                    self.update_status(|s| {
                        s.eventsub = ConnState::Connected;
                        s.failed_subscriptions.clear();
                    });
                    self.hub
                        .log(LogLevel::Info, "twitch", "Connected to Twitch events");
                    let me = self.clone();
                    let session_id = session.id.clone();
                    let subscriber =
                        super::spawn(async move { me.subscribe_all(&session_id).await });
                    let reason = self.read_loop(ws, session).await;
                    subscriber.abort();
                    self.hub.log(
                        LogLevel::Warn,
                        "twitch",
                        format!("Lost connection to Twitch events ({reason}). Reconnecting."),
                    );
                }
                Err(e) => {
                    failures += 1;
                    if failures == 1 || failures.is_multiple_of(10) {
                        self.hub.log(
                            LogLevel::Warn,
                            "twitch",
                            format!("Couldn't connect to Twitch events ({e}). Retrying."),
                        );
                    }
                    self.update_status(|s| s.eventsub = ConnState::Error);
                }
            }
            let wait = self
                .timing
                .backoff_min
                .saturating_mul(1 << failures.min(6))
                .min(self.timing.backoff_max);
            tokio::time::sleep(wait).await;
        }
    }

    /// Reads one session until it drops. Follows `session_reconnect` without resubscribing.
    async fn read_loop(&self, mut ws: Ws, mut session: Session) -> String {
        let mut pending: Option<PendingConnect> = None;
        loop {
            let limit = session.keepalive + self.timing.keepalive_margin;
            tokio::select! {
                res = async { pending.as_mut().expect("guarded").await }, if pending.is_some() => {
                    pending = None;
                    match res {
                        Ok((new_ws, new_session)) => {
                            let _ = ws.close(None).await;
                            ws = new_ws;
                            session = new_session;
                            self.hub.log(LogLevel::Info, "twitch", "Moved to a new Twitch events server");
                        }
                        Err(e) => return format!("reconnect failed: {e}"),
                    }
                }
                msg = tokio::time::timeout(limit, ws.next()) => {
                    let ended = match msg {
                        Err(_) => Some("no keepalive from Twitch".to_string()),
                        Ok(None) => Some("connection closed".to_string()),
                        Ok(Some(Err(e))) => Some(e.to_string()),
                        Ok(Some(Ok(Message::Close(frame)))) => Some(match frame {
                            Some(f) => format!("closed with code {}", u16::from(f.code)),
                            None => "connection closed".to_string(),
                        }),
                        Ok(Some(Ok(Message::Text(t)))) => {
                            if let Next::Reconnect(url) = self.handle_message(&t) {
                                pending = Some(Box::pin(connect(url, self.timing.welcome_timeout)));
                            }
                            None
                        }
                        Ok(Some(Ok(_))) => None,
                    };
                    if let Some(reason) = ended {
                        // The old connection may close before the new one says hello.
                        let Some(p) = pending.take() else { return reason };
                        match p.await {
                            Ok((new_ws, new_session)) => {
                                ws = new_ws;
                                session = new_session;
                            }
                            Err(e) => return format!("reconnect failed: {e}"),
                        }
                    }
                }
            }
        }
    }

    fn handle_message(&self, text: &str) -> Next {
        let Ok(v) = serde_json::from_str::<Value>(text) else {
            return Next::Continue;
        };
        let meta = v.get("metadata").cloned().unwrap_or_default();
        match meta.get("message_type").and_then(Value::as_str) {
            Some("notification") => self.handle_notification(&v),
            Some("session_reconnect") => {
                if let Some(url) = v
                    .pointer("/payload/session/reconnect_url")
                    .and_then(Value::as_str)
                {
                    return Next::Reconnect(url.to_string());
                }
            }
            Some("revocation") => {
                let kind = v
                    .pointer("/payload/subscription/type")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let why = v
                    .pointer("/payload/subscription/status")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                self.hub.log(
                    LogLevel::Warn,
                    "twitch",
                    format!("Twitch stopped sending {kind} events ({why})"),
                );
                self.update_status(|s| {
                    if !kind.is_empty() && !s.failed_subscriptions.contains(&kind) {
                        s.failed_subscriptions.push(kind.clone());
                    }
                });
            }
            _ => {}
        }
        Next::Continue
    }

    pub(crate) fn handle_notification(&self, v: &Value) {
        let meta = v.get("metadata").cloned().unwrap_or_default();
        let message_id = normalize::str_of(&meta, "message_id");
        if !self.first_sighting(&message_id) {
            return;
        }
        let sub_type = normalize::str_of(&meta, "subscription_type");
        let ts = meta
            .get("message_timestamp")
            .and_then(Value::as_str)
            .and_then(normalize::parse_rfc3339)
            .unwrap_or_else(crate::util::now_ms);
        let broadcaster_id = self.broadcaster_id().unwrap_or_default();
        let event = v.pointer("/payload/event").cloned().unwrap_or_default();
        let m = Meta {
            message_id: &message_id,
            ts,
            broadcaster_id: &broadcaster_id,
        };
        match normalize::normalize(&sub_type, m, &event) {
            Normalized::Event(e) => {
                if matches!(
                    e.kind,
                    EventKind::StreamOnline | EventKind::StreamOffline | EventKind::ChannelUpdate
                ) {
                    self.on_stream_event(&e);
                }
                if e.kind == EventKind::Chat && !self.first_sighting(&format!("chat:{}", e.id)) {
                    return;
                }
                let mut e = *e;
                if e.kind == EventKind::Chat {
                    self.attach_badges(&mut e.data, &event);
                }
                if e.kind == EventKind::Chat
                    && (self.was_sent_by_app(&e.id)
                        || e.user.as_ref().is_some_and(|u| {
                            self.is_echo_of_sending(&u.id, e.message.as_deref().unwrap_or(""))
                        }))
                {
                    e.data
                        .insert("sent_by_castwright".into(), Value::Bool(true));
                }
                self.hub.publish(e);
            }
            Normalized::DeleteChat(id) => self.hub.delete_chat(&id),
            Normalized::ClearUser(id) => self.hub.clear_chat_user(&id),
            Normalized::ClearChat => self.hub.clear_chat(),
            Normalized::Ignore => {}
        }
    }

    async fn subscribe_all(&self, session_id: &str) {
        let Some(id) = self.broadcaster_id() else {
            return;
        };
        let results = futures_util::future::join_all(
            SUBSCRIPTIONS
                .iter()
                .map(|spec| self.subscribe_one(spec, &id, session_id)),
        )
        .await;
        let mut failed = Vec::new();
        for (spec, res) in SUBSCRIPTIONS.iter().zip(results) {
            if let Err(e) = res {
                self.hub.log(
                    LogLevel::Warn,
                    "twitch",
                    format!("Can't listen for {}: {}", spec.kind, e.explain(spec.what)),
                );
                failed.push(spec.kind.to_string());
            }
        }
        let ok = SUBSCRIPTIONS.len() - failed.len();
        self.hub.log(
            LogLevel::Info,
            "twitch",
            format!(
                "Listening for {ok} of {} Twitch event types",
                SUBSCRIPTIONS.len()
            ),
        );
        self.update_status(|s| {
            for kind in failed {
                if !s.failed_subscriptions.contains(&kind) {
                    s.failed_subscriptions.push(kind);
                }
            }
        });
    }

    async fn subscribe_one(
        &self,
        spec: &SubSpec,
        broadcaster_id: &str,
        session_id: &str,
    ) -> Result<(), HelixError> {
        let mut last = HelixError::Network;
        for version in spec.versions {
            let body = json!({
                "type": spec.kind,
                "version": version,
                "condition": condition(spec.cond, broadcaster_id),
                "transport": { "method": "websocket", "session_id": session_id },
            });
            match self
                .helix(
                    AccountRole::Broadcaster,
                    Method::POST,
                    "/eventsub/subscriptions",
                    &[],
                    Some(&body),
                )
                .await
            {
                Ok(_) => return Ok(()),
                // Already subscribed on this session.
                Err(e) if e.status() == Some(409) => return Ok(()),
                Err(e @ (HelixError::SignedOut | HelixError::NotSignedIn)) => return Err(e),
                Err(e) => last = e,
            }
        }
        Err(last)
    }
}

#[cfg(test)]
pub(crate) fn subscription_types() -> Vec<&'static str> {
    SUBSCRIPTIONS.iter().map(|s| s.kind).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_list_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for s in SUBSCRIPTIONS {
            assert!(seen.insert(s.kind), "{}", s.kind);
            assert!(!s.versions.is_empty());
        }
        assert_eq!(SUBSCRIPTIONS.len(), 26);
    }

    #[test]
    fn conditions() {
        assert_eq!(
            condition(Cond::ToBroadcaster, "1"),
            json!({"to_broadcaster_user_id": "1"})
        );
        assert_eq!(
            condition(Cond::WithUser, "1"),
            json!({"broadcaster_user_id": "1", "user_id": "1"})
        );
    }
}
