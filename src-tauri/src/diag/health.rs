//! The Health panel: how overlays, OBS, Twitch and the app are doing right now.

use crate::core::Core;
use crate::model::runtime::{ConnState, LogEntry, LogLevel};
use crate::server::PageConnection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use ts_rs::TS;

pub const PROBLEMS_KEEP: usize = 50;
const DROPPED_WARN: f64 = 1.0;
const DROPPED_BAD: f64 = 5.0;
const LAG_WARN: f64 = 1.0;
const LAG_BAD: f64 = 5.0;
const CPU_WARN: f64 = 90.0;
/// Errors this recent turn the status bar icon yellow.
const RECENT_ERRORS_MS: i64 = 5 * 60 * 1000;
const SIZE_STALE: Duration = Duration::from_secs(60);
const CHAT_SUBSCRIPTION: &str = "channel.chat.message";

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS, Default,
)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HealthLevel {
    #[default]
    Ok,
    Warn,
    Bad,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HealthIssue {
    pub level: HealthLevel,
    /// `overlays`, `obs`, `twitch` or `app`.
    pub area: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct OverlayHealth {
    pub id: String,
    pub name: String,
    pub pages: Vec<PageConnection>,
    #[ts(type = "number | null")]
    pub last_connect: Option<i64>,
    #[ts(type = "number | null")]
    pub last_disconnect: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct ObsHealth {
    pub state: ConnState,
    pub error: Option<String>,
    pub version: String,
    pub websocket_version: String,
    pub scene: String,
    pub streaming: bool,
    pub recording: bool,
    #[ts(type = "number")]
    pub stream_ms: u64,
    #[ts(type = "number")]
    pub record_ms: u64,
    pub dropped_percent: f64,
    /// Frames OBS couldn't render in time.
    pub render_lag_percent: f64,
    /// Frames the encoder skipped.
    pub encoder_lag_percent: f64,
    pub cpu_percent: f64,
    pub fps: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FailedSubscription {
    pub kind: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct TwitchHealth {
    pub has_client_id: bool,
    pub signed_in: bool,
    pub login: String,
    pub bot_login: Option<String>,
    #[ts(type = "number | null")]
    pub token_expires_at: Option<i64>,
    #[ts(type = "number | null")]
    pub bot_token_expires_at: Option<i64>,
    pub missing_scopes: Vec<String>,
    pub eventsub: ConnState,
    pub subscriptions_total: u32,
    pub subscriptions_active: u32,
    /// Subscribing finished for the current connection.
    pub subscriptions_ready: bool,
    pub failed: Vec<FailedSubscription>,
    #[ts(type = "number | null")]
    pub last_event_at: Option<i64>,
    pub chat: ConnState,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct AppHealth {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub portable: bool,
    pub data_dir: String,
    #[ts(type = "number | null")]
    pub data_bytes: Option<u64>,
    #[ts(type = "number | null")]
    pub memory_bytes: Option<u64>,
    #[ts(type = "number")]
    pub started_at: i64,
    #[ts(type = "number")]
    pub uptime_ms: i64,
    pub server_running: bool,
    pub server_error: Option<String>,
    pub secrets_in_file: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct HealthSnapshot {
    #[ts(type = "number")]
    pub ts: i64,
    /// The worst of `issues`.
    pub level: HealthLevel,
    pub issues: Vec<HealthIssue>,
    pub overlays: Vec<OverlayHealth>,
    pub obs: ObsHealth,
    pub twitch: TwitchHealth,
    pub app: AppHealth,
    /// Recent warnings and errors, newest first.
    pub problems: Vec<LogEntry>,
}

fn issue(level: HealthLevel, area: &str, text: impl Into<String>) -> HealthIssue {
    HealthIssue {
        level,
        area: area.into(),
        text: text.into(),
    }
}

fn by_threshold(value: f64, warn: f64, bad: f64) -> Option<HealthLevel> {
    if value >= bad {
        Some(HealthLevel::Bad)
    } else if value >= warn {
        Some(HealthLevel::Warn)
    } else {
        None
    }
}

/// What's wrong right now, worst first.
pub fn issues(s: &HealthSnapshot) -> Vec<HealthIssue> {
    use HealthLevel::*;
    let mut out = Vec::new();

    if !s.app.server_running {
        out.push(issue(
            Bad,
            "overlays",
            "The overlay server isn't running, so overlays can't load.",
        ));
    } else if let Some(e) = &s.app.server_error {
        out.push(issue(Warn, "overlays", e.clone()));
    }

    let obs = &s.obs;
    if obs.state == ConnState::Error {
        out.push(issue(
            Warn,
            "obs",
            obs.error
                .clone()
                .unwrap_or_else(|| "Can't reach OBS.".into()),
        ));
    }
    if obs.state == ConnState::Connected {
        if obs.streaming
            && let Some(l) = by_threshold(obs.dropped_percent, DROPPED_WARN, DROPPED_BAD)
        {
            out.push(issue(
                l,
                "obs",
                format!(
                    "{:.1}% of frames dropped. Your connection can't keep up with the bitrate.",
                    obs.dropped_percent
                ),
            ));
        }
        if let Some(l) = by_threshold(obs.render_lag_percent, LAG_WARN, LAG_BAD) {
            out.push(issue(
                l,
                "obs",
                format!(
                    "{:.1}% of frames rendered late. The GPU is too busy.",
                    obs.render_lag_percent
                ),
            ));
        }
        if (obs.streaming || obs.recording)
            && let Some(l) = by_threshold(obs.encoder_lag_percent, LAG_WARN, LAG_BAD)
        {
            out.push(issue(
                l,
                "obs",
                format!(
                    "{:.1}% of frames skipped by the encoder. Try a faster encoder preset.",
                    obs.encoder_lag_percent
                ),
            ));
        }
        if obs.cpu_percent >= CPU_WARN {
            out.push(issue(
                Warn,
                "obs",
                format!("OBS is using {:.0}% CPU.", obs.cpu_percent),
            ));
        }
    }

    let tw = &s.twitch;
    if tw.signed_in {
        match tw.eventsub {
            ConnState::Error => out.push(issue(
                Bad,
                "twitch",
                "Not receiving Twitch events. Retrying.",
            )),
            ConnState::Disconnected => {
                out.push(issue(Warn, "twitch", "Not connected to Twitch events."))
            }
            _ => {}
        }
        if !tw.failed.is_empty() {
            let n = tw.failed.len();
            out.push(issue(
                Warn,
                "twitch",
                if n == 1 {
                    format!("Twitch isn't sending {} events.", tw.failed[0].kind)
                } else {
                    format!("{n} kinds of Twitch events aren't coming in.")
                },
            ));
        }
        if !tw.missing_scopes.is_empty() {
            out.push(issue(
                Warn,
                "twitch",
                "Some permissions are missing. Sign out and in again in Settings.",
            ));
        }
    }
    if let Some(e) = &tw.error {
        out.push(issue(Warn, "twitch", e.clone()));
    }

    let errors = s
        .problems
        .iter()
        .filter(|p| p.level == LogLevel::Error && s.ts - p.ts <= RECENT_ERRORS_MS)
        .count();
    if errors > 0 {
        out.push(issue(
            Warn,
            "app",
            if errors == 1 {
                "1 error in the last 5 minutes.".to_string()
            } else {
                format!("{errors} errors in the last 5 minutes.")
            },
        ));
    }

    out.sort_by_key(|i| std::cmp::Reverse(i.level));
    out
}

pub fn worst(issues: &[HealthIssue]) -> HealthLevel {
    issues.iter().map(|i| i.level).max().unwrap_or_default()
}

/// Warnings and errors, newest first.
pub fn problems(log: &[LogEntry]) -> Vec<LogEntry> {
    log.iter()
        .rev()
        .filter(|e| e.level != LogLevel::Info)
        .take(PROBLEMS_KEEP)
        .cloned()
        .collect()
}

struct SizeCache {
    dir: PathBuf,
    at: Instant,
    bytes: Option<u64>,
    refreshing: bool,
}

static DATA_SIZE: Mutex<Option<SizeCache>> = Mutex::new(None);

/// Last known size of `dir`, measured again in the background when it's old.
fn data_size(dir: &std::path::Path) -> Option<u64> {
    let mut cache = DATA_SIZE.lock().unwrap();
    let (bytes, refresh) = match cache.as_ref().filter(|c| c.dir == dir) {
        Some(c) => (c.bytes, !c.refreshing && c.at.elapsed() > SIZE_STALE),
        None => (None, true),
    };
    if refresh {
        *cache = Some(SizeCache {
            dir: dir.to_path_buf(),
            at: Instant::now(),
            bytes,
            refreshing: true,
        });
        let dir = dir.to_path_buf();
        crate::util::spawn(async move {
            let d = dir.clone();
            let size = tokio::task::spawn_blocking(move || super::sys::dir_size(&d))
                .await
                .ok();
            *DATA_SIZE.lock().unwrap() = Some(SizeCache {
                dir,
                at: Instant::now(),
                bytes: size,
                refreshing: false,
            });
        });
    }
    bytes
}

pub fn snapshot(core: &Core, portable: bool) -> HealthSnapshot {
    let now = crate::util::now_ms();
    let overlays = core.project.read(|p| {
        p.overlays
            .iter()
            .map(|o| (o.id.clone(), o.name.clone()))
            .collect::<Vec<_>>()
    });
    let overlays = overlays
        .into_iter()
        .map(|(id, name)| {
            let c = core.server.connections(&id);
            OverlayHealth {
                id,
                name,
                pages: c.pages,
                last_connect: c.last_connect,
                last_disconnect: c.last_disconnect,
            }
        })
        .collect();

    let o = core.obs.snapshot();
    let obs = ObsHealth {
        state: o.state,
        error: o.error,
        version: o.obs_version,
        websocket_version: o.websocket_version,
        scene: o.program_scene,
        streaming: o.stream.active,
        recording: o.record.active,
        stream_ms: o.stream.duration_ms,
        record_ms: o.record.duration_ms,
        dropped_percent: o.stats.stream_dropped_percent,
        render_lag_percent: o.stats.render_skipped_percent,
        encoder_lag_percent: o.stats.output_skipped_percent,
        cpu_percent: o.stats.cpu_percent,
        fps: o.stats.active_fps,
    };

    let st = core.twitch.status();
    let es = core.twitch.eventsub_health();
    let signed_in = st.broadcaster.is_some();
    let scopes = st
        .broadcaster
        .as_ref()
        .map(|b| b.scopes.clone())
        .unwrap_or_default();
    let missing_scopes = if signed_in {
        crate::twitch::auth::BROADCASTER_SCOPES
            .iter()
            .filter(|s| !scopes.iter().any(|have| have == *s))
            .map(|s| s.to_string())
            .collect()
    } else {
        Vec::new()
    };
    let failed: Vec<FailedSubscription> = es
        .failed
        .iter()
        .map(|(kind, reason)| FailedSubscription {
            kind: kind.clone(),
            reason: reason.clone(),
        })
        .collect();
    let connected = st.eventsub == ConnState::Connected;
    let chat = if !signed_in {
        ConnState::Disconnected
    } else if failed.iter().any(|f| f.kind == CHAT_SUBSCRIPTION) {
        ConnState::Error
    } else if connected && !es.subscribed {
        ConnState::Connecting
    } else {
        st.eventsub
    };
    let expires = |t: Option<i64>| t.filter(|ms| *ms > 0);
    let twitch = TwitchHealth {
        has_client_id: st.has_client_id,
        signed_in,
        login: st
            .broadcaster
            .as_ref()
            .map(|b| b.login.clone())
            .unwrap_or_default(),
        bot_login: st.bot.as_ref().map(|b| b.login.clone()),
        token_expires_at: expires(es.broadcaster_expires_at),
        bot_token_expires_at: expires(es.bot_expires_at),
        missing_scopes,
        eventsub: st.eventsub,
        subscriptions_total: es.total as u32,
        subscriptions_active: if connected && es.subscribed {
            es.total.saturating_sub(failed.len()) as u32
        } else {
            0
        },
        subscriptions_ready: connected && es.subscribed,
        failed,
        last_event_at: es.last_event_at,
        chat,
        error: st.error,
    };

    let server = core.server.info();
    let app = AppHealth {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        portable,
        data_dir: core.paths.data_dir.to_string_lossy().into_owned(),
        data_bytes: data_size(&core.paths.data_dir),
        memory_bytes: super::sys::memory_bytes(),
        started_at: core.started_at,
        uptime_ms: now - core.started_at,
        server_running: server.running,
        server_error: server.error,
        secrets_in_file: core.secrets.using_file(),
    };

    let mut s = HealthSnapshot {
        ts: now,
        level: HealthLevel::Ok,
        issues: Vec::new(),
        overlays,
        obs,
        twitch,
        app,
        problems: problems(&core.hub.logs()),
    };
    s.issues = issues(&s);
    s.level = worst(&s.issues);
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use HealthLevel::*;

    fn healthy() -> HealthSnapshot {
        let mut s = HealthSnapshot {
            ts: 10_000_000,
            ..Default::default()
        };
        s.app.server_running = true;
        s.obs.state = ConnState::Connected;
        s.obs.streaming = true;
        s.twitch.signed_in = true;
        s.twitch.eventsub = ConnState::Connected;
        s
    }

    fn levels(s: &HealthSnapshot) -> Vec<(HealthLevel, String)> {
        issues(s).into_iter().map(|i| (i.level, i.area)).collect()
    }

    fn log(level: LogLevel, ts: i64) -> LogEntry {
        LogEntry {
            ts,
            level,
            source: "obs".into(),
            message: "x".into(),
        }
    }

    #[test]
    fn all_good_is_ok() {
        let s = healthy();
        assert!(issues(&s).is_empty());
        assert_eq!(worst(&issues(&s)), Ok);
        assert_eq!(worst(&[]), Ok);
    }

    #[test]
    fn worst_level_wins() {
        let mut s = healthy();
        s.obs.dropped_percent = 2.0;
        assert_eq!(worst(&issues(&s)), Warn);
        s.app.server_running = false;
        let found = issues(&s);
        assert_eq!(worst(&found), Bad);
        assert_eq!(found[0].level, Bad, "worst first");
        assert_eq!(found[0].area, "overlays");
    }

    #[test]
    fn obs_thresholds() {
        let mut s = healthy();
        s.obs.dropped_percent = 0.9;
        s.obs.render_lag_percent = 0.5;
        assert!(issues(&s).is_empty());
        s.obs.dropped_percent = 5.0;
        assert_eq!(levels(&s), [(Bad, "obs".into())]);
        s.obs.streaming = false;
        assert!(
            issues(&s).is_empty(),
            "dropped frames only count while live"
        );
        s.obs.render_lag_percent = 1.5;
        s.obs.encoder_lag_percent = 9.0;
        assert_eq!(
            levels(&s),
            [(Warn, "obs".into())],
            "encoder lag needs an output"
        );
        s.obs.recording = true;
        assert_eq!(levels(&s), [(Bad, "obs".into()), (Warn, "obs".into())]);
        s.obs.state = ConnState::Disconnected;
        assert!(issues(&s).is_empty(), "stale numbers don't count");
        s.obs.state = ConnState::Error;
        assert_eq!(levels(&s), [(Warn, "obs".into())]);
    }

    #[test]
    fn twitch_problems() {
        let mut s = healthy();
        s.twitch.eventsub = ConnState::Error;
        assert_eq!(worst(&issues(&s)), Bad);
        s.twitch.eventsub = ConnState::Connecting;
        assert!(issues(&s).is_empty());
        s.twitch.failed.push(FailedSubscription {
            kind: "channel.follow".into(),
            reason: "missing permission".into(),
        });
        s.twitch.missing_scopes.push("bits:read".into());
        assert_eq!(
            levels(&s),
            [(Warn, "twitch".into()), (Warn, "twitch".into())]
        );
        s.twitch.signed_in = false;
        assert!(
            issues(&s).is_empty(),
            "nothing to worry about when signed out"
        );
    }

    #[test]
    fn only_recent_errors_count() {
        let mut s = healthy();
        s.problems = vec![
            log(LogLevel::Warn, s.ts - 1000),
            log(LogLevel::Error, s.ts - RECENT_ERRORS_MS - 1),
        ];
        assert!(issues(&s).is_empty());
        s.problems.push(log(LogLevel::Error, s.ts - 1000));
        s.problems.push(log(LogLevel::Error, s.ts));
        let found = issues(&s);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].level, Warn);
        assert!(found[0].text.starts_with("2 errors"), "{}", found[0].text);
    }

    #[test]
    fn problems_are_newest_first_and_capped() {
        let mut entries: Vec<LogEntry> = (0..120)
            .map(|i| {
                log(
                    if i % 2 == 0 {
                        LogLevel::Info
                    } else {
                        LogLevel::Warn
                    },
                    i,
                )
            })
            .collect();
        entries.push(log(LogLevel::Error, 500));
        let p = problems(&entries);
        assert_eq!(p.len(), PROBLEMS_KEEP);
        assert_eq!(p[0].ts, 500);
        assert_eq!(p[1].ts, 119);
        assert!(p.iter().all(|e| e.level != LogLevel::Info));
    }
}
