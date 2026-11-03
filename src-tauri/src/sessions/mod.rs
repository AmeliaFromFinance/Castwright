//! Stream sessions: when the stream was live and what happened during it.
//!
//! Twitch decides when a stream starts and ends. Without a Twitch sign-in, OBS
//! streaming state is used instead. Chat, alerts, action runs, markers and raids
//! out aren't in the event history, so they're kept in `session_activity` while
//! a session is open.

mod stats;
#[cfg(test)]
mod tests;

use crate::error::AppResult;
use crate::model::event::{Event, EventKind};
use crate::model::runtime::{ConnState, ObsSnapshot, TwitchStatus};
use crate::model::session::{
    SessionChange, SessionListItem, SessionSource, SessionSummary, StreamSession,
};
use crate::store::db::Db;
use rusqlite::{OptionalExtension, Row, params};
use std::sync::{Arc, Mutex};

/// Twitch timestamps for the same stream can differ a little between calls.
const SAME_STREAM_MS: i64 = 2 * 60_000;
/// After a restart, an OBS-only session continues if it was seen this recently.
const RESUME_MS: i64 = 30 * 60_000;
/// A stream that comes back this soon after ending continues the last session.
pub(crate) const MERGE_MS: i64 = 5 * 60_000;
/// Shorter sessions (a quick test start and stop) are dropped.
const MIN_SESSION_MS: i64 = 60_000;
/// How often an open session is saved while live.
const SAVE_EVERY_MS: i64 = 30_000;
/// Most activity rows kept; the oldest are trimmed beyond this.
const MAX_ACTIVITY: i64 = 500_000;

/// What Twitch says about the stream.
#[derive(Debug, Clone, Default)]
pub struct TwitchLive {
    pub live: bool,
    /// ms since epoch, 0 when unknown.
    pub started_at: i64,
    pub title: String,
    pub category: String,
    pub viewers: u32,
}

/// Inputs for one check. `None` means that side can't tell right now.
#[derive(Debug, Clone, Default)]
pub struct LiveSignal {
    pub twitch: Option<TwitchLive>,
    pub obs: Option<bool>,
}

impl LiveSignal {
    /// Twitch counts once signed in and read; OBS only while connected.
    pub fn from_status(twitch: &TwitchStatus, twitch_known: bool, obs: &ObsSnapshot) -> Self {
        LiveSignal {
            twitch: (twitch.broadcaster.is_some() && twitch_known).then(|| TwitchLive {
                live: twitch.stream.live,
                started_at: twitch.stream.started_at,
                title: twitch.stream.title.clone(),
                category: twitch.stream.category.clone(),
                viewers: twitch.stream.viewers,
            }),
            obs: (obs.state == ConnState::Connected).then_some(obs.stream.active),
        }
    }
}

/// Activity kinds stored in `session_activity`.
pub mod activity {
    pub const CHAT: &str = "chat";
    pub const ALERT: &str = "alert";
    pub const ACTION: &str = "action";
    pub const MARKER: &str = "marker";
    pub const RAID_OUT: &str = "raid_out";
    /// `text` of a chat row from a moderator or a VIP.
    pub const ROLE_MOD: &str = "mod";
    pub const ROLE_VIP: &str = "vip";
}

#[derive(Debug, Clone)]
struct Open {
    session: StreamSession,
    twitch_started_at: i64,
    last_seen: i64,
    viewer_sum: i64,
    viewer_samples: i64,
    /// False for a session left open by the last run until a live check confirms it.
    confirmed: bool,
    saved_at: i64,
}

pub struct Sessions {
    db: Arc<Db>,
    open: Mutex<Option<Open>>,
    /// Chat from these user ids isn't counted (the bot account).
    ignored: Mutex<Vec<String>>,
}

const COLUMNS: &str = "id, started_at, ended_at, source, title, categories, peak_viewers, viewer_sum, viewer_samples, twitch_started_at, last_seen";

fn session_from_row(r: &Row) -> rusqlite::Result<(StreamSession, i64, i64, i64, i64)> {
    let categories: String = r.get(5)?;
    let viewer_sum: i64 = r.get(7)?;
    let samples: i64 = r.get(8)?;
    Ok((
        StreamSession {
            id: r.get(0)?,
            started_at: r.get(1)?,
            ended_at: r.get(2)?,
            source: SessionSource::parse(&r.get::<_, String>(3)?),
            title: r.get(4)?,
            categories: serde_json::from_str(&categories).unwrap_or_default(),
            peak_viewers: r.get::<_, i64>(6)?.max(0) as u32,
            avg_viewers: average(viewer_sum, samples),
        },
        viewer_sum,
        samples,
        r.get(9)?,
        r.get(10)?,
    ))
}

fn average(sum: i64, samples: i64) -> u32 {
    if samples <= 0 {
        0
    } else {
        ((sum as f64 / samples as f64).round()).max(0.0) as u32
    }
}

impl Sessions {
    /// Picks up a session the last run left open (the app closed while live).
    pub fn load(db: Arc<Db>) -> Sessions {
        let open = db
            .with_conn(|c| {
                c.query_row(
                    &format!(
                        "SELECT {COLUMNS} FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
                    ),
                    [],
                    session_from_row,
                )
                .optional()
            })
            .unwrap_or_else(|e| {
                tracing::error!("couldn't read open stream session: {e}");
                None
            })
            .map(|(session, viewer_sum, viewer_samples, twitch_started_at, last_seen)| Open {
                session,
                twitch_started_at,
                last_seen,
                viewer_sum,
                viewer_samples,
                confirmed: false,
                saved_at: last_seen,
            });
        Sessions {
            db,
            open: Mutex::new(open),
            ignored: Mutex::new(Vec::new()),
        }
    }

    pub fn set_ignored_users(&self, ids: Vec<String>) {
        *self.ignored.lock().unwrap() = ids;
    }

    pub fn current(&self) -> Option<StreamSession> {
        self.open
            .lock()
            .unwrap()
            .as_ref()
            .map(|o| o.session.clone())
    }

    /// Check whether the stream started or ended. Call every few seconds.
    pub fn tick(&self, sig: &LiveSignal, now: i64) -> Vec<SessionChange> {
        let (live, source) = match (&sig.twitch, sig.obs) {
            (Some(t), _) => (t.live, SessionSource::Twitch),
            (None, Some(streaming)) => (streaming, SessionSource::Obs),
            (None, None) => return Vec::new(),
        };
        let mut out = Vec::new();
        let mut open = self.open.lock().unwrap();
        if live {
            if let Some(cur) = open.as_mut()
                && !cur.confirmed
            {
                if same_stream(cur, sig.twitch.as_ref(), now) {
                    cur.confirmed = true;
                } else if let Some(cur) = open.take() {
                    let end = cur.last_seen;
                    if let Some(s) = self.finish(cur, end) {
                        out.push(SessionChange::Ended { session: s });
                    }
                }
            }
            if open.is_none() {
                match self.begin(sig.twitch.as_ref(), source, now) {
                    Ok(o) => {
                        out.push(SessionChange::Started {
                            session: o.session.clone(),
                        });
                        *open = Some(o);
                    }
                    Err(e) => tracing::error!("couldn't start a stream session: {e}"),
                }
            }
            if let Some(cur) = open.as_mut() {
                self.heartbeat(cur, sig.twitch.as_ref(), now);
            }
        } else if let Some(cur) = open.take() {
            let end = if cur.confirmed { now } else { cur.last_seen };
            if let Some(s) = self.finish(cur, end) {
                out.push(SessionChange::Ended { session: s });
            }
        }
        out
    }

    /// Start a new session, or continue the last one if it ended moments ago.
    fn begin(
        &self,
        twitch: Option<&TwitchLive>,
        source: SessionSource,
        now: i64,
    ) -> AppResult<Open> {
        let started_at = twitch
            .map(|t| t.started_at)
            .filter(|&s| s > 0 && s <= now)
            .unwrap_or(now);
        let last = self.db.with_conn(|c| {
            c.query_row(
                &format!(
                    "SELECT {COLUMNS} FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1"
                ),
                [],
                session_from_row,
            )
            .optional()
        })?;
        if let Some((mut session, viewer_sum, viewer_samples, twitch_started_at, _)) = last
            && let Some(ended) = session.ended_at
            && started_at - ended <= MERGE_MS
            && started_at >= session.started_at
        {
            self.db.with_conn(|c| {
                c.execute(
                    "UPDATE sessions SET ended_at = NULL, summary = NULL WHERE id = ?1",
                    params![session.id],
                )
            })?;
            session.ended_at = None;
            return Ok(Open {
                session,
                twitch_started_at,
                last_seen: now,
                viewer_sum,
                viewer_samples,
                confirmed: true,
                saved_at: now,
            });
        }
        let title = twitch.map(|t| t.title.clone()).unwrap_or_default();
        let categories: Vec<String> = twitch
            .map(|t| t.category.clone())
            .filter(|c| !c.is_empty())
            .into_iter()
            .collect();
        let twitch_started_at = twitch.map(|t| t.started_at).unwrap_or(0);
        let id = self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO sessions (started_at, last_seen, source, twitch_started_at, title, categories)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    started_at,
                    now,
                    source.as_str(),
                    twitch_started_at,
                    title,
                    serde_json::to_string(&categories).unwrap_or_else(|_| "[]".into())
                ],
            )?;
            Ok(c.last_insert_rowid())
        })?;
        Ok(Open {
            session: StreamSession {
                id,
                started_at,
                ended_at: None,
                source,
                title,
                categories,
                peak_viewers: 0,
                avg_viewers: 0,
            },
            twitch_started_at,
            last_seen: now,
            viewer_sum: 0,
            viewer_samples: 0,
            confirmed: true,
            saved_at: now,
        })
    }

    fn heartbeat(&self, cur: &mut Open, twitch: Option<&TwitchLive>, now: i64) {
        cur.last_seen = now;
        if let Some(t) = twitch.filter(|t| t.live) {
            let s = &mut cur.session;
            if !t.title.is_empty() {
                s.title = t.title.clone();
            }
            if !t.category.is_empty() && !s.categories.contains(&t.category) {
                s.categories.push(t.category.clone());
            }
            if t.viewers > 0 {
                s.peak_viewers = s.peak_viewers.max(t.viewers);
                cur.viewer_sum += t.viewers as i64;
                cur.viewer_samples += 1;
                s.avg_viewers = average(cur.viewer_sum, cur.viewer_samples);
            }
            if cur.twitch_started_at == 0 && t.started_at > 0 {
                cur.twitch_started_at = t.started_at;
            }
        }
        if now - cur.saved_at >= SAVE_EVERY_MS {
            self.save(cur, None);
        }
    }

    fn save(&self, cur: &mut Open, ended_at: Option<i64>) {
        cur.saved_at = cur.last_seen;
        let s = &cur.session;
        let r = self.db.with_conn(|c| {
            c.execute(
                "UPDATE sessions SET ended_at = ?2, last_seen = ?3, title = ?4, categories = ?5,
                 peak_viewers = ?6, viewer_sum = ?7, viewer_samples = ?8, twitch_started_at = ?9
                 WHERE id = ?1",
                params![
                    s.id,
                    ended_at,
                    cur.last_seen,
                    s.title,
                    serde_json::to_string(&s.categories).unwrap_or_else(|_| "[]".into()),
                    s.peak_viewers,
                    cur.viewer_sum,
                    cur.viewer_samples,
                    cur.twitch_started_at
                ],
            )
        });
        if let Err(e) = r {
            tracing::error!("couldn't save stream session: {e}");
        }
    }

    /// Close a session and store its summary. None when it was too short to keep.
    fn finish(&self, mut cur: Open, end: i64) -> Option<StreamSession> {
        let end = end.max(cur.session.started_at);
        if end - cur.session.started_at < MIN_SESSION_MS {
            if let Err(e) = self.delete_rows(cur.session.id) {
                tracing::error!("couldn't drop a short stream session: {e}");
            }
            return None;
        }
        cur.last_seen = cur.last_seen.max(end);
        cur.session.ended_at = Some(end);
        self.save(&mut cur, Some(end));
        match stats::summarize(&self.db, &cur.session) {
            Ok(summary) => {
                let json = serde_json::to_string(&summary).unwrap_or_default();
                let _ = self.db.with_conn(|c| {
                    c.execute(
                        "UPDATE sessions SET summary = ?2 WHERE id = ?1",
                        params![cur.session.id, json],
                    )
                });
            }
            Err(e) => tracing::error!("couldn't sum up the stream: {e}"),
        }
        Some(cur.session)
    }

    /// Save the open session now (the app is closing).
    pub fn flush(&self) {
        if let Some(cur) = self.open.lock().unwrap().as_mut() {
            self.save(cur, None);
        }
    }

    // ---------- activity ----------

    fn record(&self, kind: &str, user_key: &str, name: &str, amount: Option<f64>, text: &str) {
        self.record_at(crate::util::now_ms(), kind, user_key, name, amount, text);
    }

    fn record_at(
        &self,
        ts: i64,
        kind: &str,
        user_key: &str,
        name: &str,
        amount: Option<f64>,
        text: &str,
    ) {
        if self.open.lock().unwrap().is_none() {
            return;
        }
        let r = self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO session_activity (ts, kind, user_key, name, amount, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![ts, kind, user_key, name, amount, text],
            )?;
            if rand::random::<u8>() == 0 {
                c.execute(
                    "DELETE FROM session_activity WHERE rowid IN
                     (SELECT rowid FROM session_activity ORDER BY ts DESC LIMIT -1 OFFSET ?1)",
                    params![MAX_ACTIVITY],
                )?;
            }
            Ok(())
        });
        if let Err(e) = r {
            tracing::warn!("couldn't save session activity: {e}");
        }
    }

    /// Count a chat message. Messages from the broadcaster, the bot and the app are skipped.
    /// True when Castwright never saw this person chat before.
    pub fn on_chat(&self, e: &Event) -> bool {
        if e.kind != EventKind::Chat || e.test || e.roles.broadcaster {
            return false;
        }
        if e.data.get("sent_by_castwright").and_then(|v| v.as_bool()) == Some(true) {
            return false;
        }
        let Some(user) = e.user.as_ref() else {
            return false;
        };
        let key = if user.id.is_empty() {
            user.login.as_str()
        } else {
            user.id.as_str()
        };
        if key.is_empty() || self.ignored.lock().unwrap().iter().any(|i| i == key) {
            return false;
        }
        let name = if user.display_name.is_empty() {
            &user.login
        } else {
            &user.display_name
        };
        let r = self.db.with_conn(|c| {
            c.execute(
                "INSERT OR IGNORE INTO chatters (user_key, name, first_seen) VALUES (?1, ?2, ?3)",
                params![key, name, e.ts],
            )
        });
        let first = match r {
            Ok(n) => n > 0,
            Err(err) => {
                tracing::warn!("couldn't save chatter: {err}");
                false
            }
        };
        let role = if e.roles.moderator {
            activity::ROLE_MOD
        } else if e.roles.vip {
            activity::ROLE_VIP
        } else {
            ""
        };
        self.record_at(e.ts, activity::CHAT, key, name, None, role);
        first
    }

    pub fn on_alert(&self, title: &str) {
        self.record(activity::ALERT, "", "", None, title);
    }

    pub fn on_action(&self, name: &str) {
        self.record(activity::ACTION, "", "", None, name);
    }

    pub fn on_marker(&self, description: &str) {
        self.record(activity::MARKER, "", "", None, description);
    }

    pub fn on_raid_out(&self, to_login: &str, to_name: &str, viewers: u32) {
        self.record(
            activity::RAID_OUT,
            to_login,
            to_name,
            Some(viewers as f64),
            "",
        );
    }

    // ---------- reading ----------

    pub fn list(&self, limit: u32) -> AppResult<Vec<SessionListItem>> {
        let rows = self.db.with_conn(|c| {
            let mut stmt = c.prepare(&format!(
                "SELECT {COLUMNS}, summary FROM sessions ORDER BY started_at DESC LIMIT ?1"
            ))?;
            stmt.query_map(params![limit.clamp(1, 1000)], |r| {
                Ok((session_from_row(r)?.0, r.get::<_, Option<String>>(11)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
        })?;
        let open = self.current();
        let mut out = Vec::with_capacity(rows.len());
        for (mut session, cached) in rows {
            if let Some(o) = open.as_ref().filter(|o| o.id == session.id) {
                session = o.clone();
            }
            let summary = match cached.and_then(|j| serde_json::from_str::<SessionSummary>(&j).ok())
            {
                Some(s) if session.ended_at.is_some() => s,
                _ => stats::summarize(&self.db, &session)?,
            };
            out.push(SessionListItem {
                follows: summary.follows,
                subs: summary.new_subs + summary.resubs + summary.gifted_subs,
                bits: summary.bits,
                chat_messages: summary.chat_messages,
                session,
            });
        }
        Ok(out)
    }

    pub fn summary(&self, id: i64) -> AppResult<Option<SessionSummary>> {
        if let Some(open) = self.current().filter(|s| s.id == id) {
            return stats::summarize(&self.db, &open).map(Some);
        }
        let row = self.db.with_conn(|c| {
            c.query_row(
                &format!("SELECT {COLUMNS}, summary FROM sessions WHERE id = ?1"),
                params![id],
                |r| Ok((session_from_row(r)?.0, r.get::<_, Option<String>>(11)?)),
            )
            .optional()
        })?;
        let Some((session, cached)) = row else {
            return Ok(None);
        };
        if let Some(mut s) = cached.and_then(|j| serde_json::from_str::<SessionSummary>(&j).ok()) {
            s.session = session;
            return Ok(Some(s));
        }
        stats::summarize(&self.db, &session).map(Some)
    }

    /// Names for the credits: the live session, else the last one.
    pub fn credits(&self) -> AppResult<crate::model::session::Credits> {
        let session = match self.current() {
            Some(s) => Some(s),
            None => self
                .db
                .with_conn(|c| {
                    c.query_row(
                        &format!("SELECT {COLUMNS} FROM sessions ORDER BY started_at DESC LIMIT 1"),
                        [],
                        session_from_row,
                    )
                    .optional()
                })?
                .map(|r| r.0),
        };
        match session {
            Some(s) => stats::credits(&self.db, &s),
            None => Ok(Default::default()),
        }
    }

    /// Remove a session and the chat, alert and action counts stored for it.
    pub fn delete(&self, id: i64) -> AppResult<bool> {
        if self.current().is_some_and(|s| s.id == id) {
            return crate::error::user_err("This stream is still live. Delete it after it ends.");
        }
        self.delete_rows(id)
    }

    fn delete_rows(&self, id: i64) -> AppResult<bool> {
        self.db.with_conn(|c| {
            let range: Option<(i64, Option<i64>, i64)> = c
                .query_row(
                    "SELECT started_at, ended_at, last_seen FROM sessions WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let Some((start, end, last_seen)) = range else {
                return Ok(false);
            };
            c.execute(
                "DELETE FROM session_activity WHERE ts BETWEEN ?1 AND ?2",
                params![start, end.unwrap_or(last_seen.max(crate::util::now_ms()))],
            )?;
            c.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
            Ok(true)
        })
    }
}

fn same_stream(cur: &Open, twitch: Option<&TwitchLive>, now: i64) -> bool {
    match twitch {
        Some(t) if cur.twitch_started_at > 0 && t.started_at > 0 => {
            (t.started_at - cur.twitch_started_at).abs() <= SAME_STREAM_MS
        }
        _ => now - cur.last_seen <= RESUME_MS,
    }
}
