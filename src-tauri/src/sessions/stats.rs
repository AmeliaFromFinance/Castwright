//! Numbers for one session, read from `events` and `session_activity`.

use super::activity;
use crate::error::AppResult;
use crate::model::event::{Event, EventKind};
use crate::model::session::{
    ChatMinute, CreditName, Credits, MarkerEntry, RaidEntry, Ranked, SessionSummary, StreamSession,
    TimelineMark,
};
use crate::store::db::Db;
use rusqlite::params;
use std::collections::HashMap;

/// Length of the top lists.
pub const TOP: usize = 5;

/// Event kinds the summary reads. Everything else (polls, chat, stream updates) is skipped.
const KINDS: [EventKind; 10] = [
    EventKind::Follow,
    EventKind::Sub,
    EventKind::Resub,
    EventKind::GiftSub,
    EventKind::CommunityGift,
    EventKind::Cheer,
    EventKind::Raid,
    EventKind::Charity,
    EventKind::Redemption,
    EventKind::HypeTrainBegin,
];

/// Totals per name, highest first, ties by name.
#[derive(Default)]
struct Tally(HashMap<String, f64>);

impl Tally {
    fn add(&mut self, name: &str, amount: f64) {
        *self.0.entry(name.to_string()).or_default() += amount;
    }

    fn top(self, n: usize) -> Vec<Ranked> {
        let mut v: Vec<Ranked> = self
            .0
            .into_iter()
            .map(|(name, amount)| Ranked { name, amount })
            .collect();
        v.sort_by(|a, b| {
            b.amount
                .total_cmp(&a.amount)
                .then_with(|| a.name.cmp(&b.name))
        });
        v.truncate(n);
        v
    }
}

fn who(e: &Event) -> String {
    match &e.user {
        Some(u) if !u.display_name.is_empty() => u.display_name.clone(),
        Some(u) if !u.login.is_empty() => u.login.clone(),
        _ => "Anonymous".into(),
    }
}

/// Most names under Top chatters.
pub const CREDIT_CHATTERS: usize = 25;

/// Event kinds the credits read.
const CREDIT_KINDS: [EventKind; 6] = [
    EventKind::Follow,
    EventKind::Sub,
    EventKind::Resub,
    EventKind::GiftSub,
    EventKind::Cheer,
    EventKind::Raid,
];

fn events_between(db: &Db, kinds: &[EventKind], start: i64, end: i64) -> AppResult<Vec<Event>> {
    db.with_conn(|c| {
        let placeholders = vec!["?"; kinds.len()].join(",");
        let mut stmt = c.prepare(&format!(
            "SELECT json FROM events WHERE kind IN ({placeholders}) AND ts BETWEEN ? AND ? AND test = 0 ORDER BY ts"
        ))?;
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = kinds
            .iter()
            .map(|k| Box::new(k.as_str()) as Box<dyn rusqlite::ToSql>)
            .collect();
        args.push(Box::new(start));
        args.push(Box::new(end));
        let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
            r.get::<_, String>(0)
        })?;
        Ok(rows
            .filter_map(|r| r.ok())
            .filter_map(|j| serde_json::from_str::<Event>(&j).ok())
            .collect())
    })
}

fn credit_name(e: &Event, amount: f64) -> CreditName {
    let (login, user_id) = match &e.user {
        Some(u) if !e.is_anonymous => (u.login.clone(), u.id.clone()),
        _ => (String::new(), String::new()),
    };
    CreditName {
        name: if e.is_anonymous {
            "Anonymous".into()
        } else {
            who(e)
        },
        login,
        user_id,
        amount,
    }
}

fn credit_key(c: &CreditName) -> String {
    if c.user_id.is_empty() {
        c.name.to_lowercase()
    } else {
        c.user_id.clone()
    }
}

/// Adds up amounts per person, keeping first-seen order; `ranked` sorts highest first.
#[derive(Default)]
struct CreditList(Vec<CreditName>);

impl CreditList {
    fn add(&mut self, c: CreditName) {
        let key = credit_key(&c);
        match self.0.iter_mut().find(|x| credit_key(x) == key) {
            Some(x) => x.amount += c.amount,
            None => self.0.push(c),
        }
    }

    /// Keep one entry per person with the latest amount.
    fn set(&mut self, c: CreditName) {
        let key = credit_key(&c);
        match self.0.iter_mut().find(|x| credit_key(x) == key) {
            Some(x) => x.amount = x.amount.max(c.amount),
            None => self.0.push(c),
        }
    }

    fn ranked(mut self) -> Vec<CreditName> {
        self.0.sort_by(|a, b| {
            b.amount
                .total_cmp(&a.amount)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        self.0
    }
}

/// Names for the credits layer.
pub fn credits(db: &Db, session: &StreamSession) -> AppResult<Credits> {
    let start = session.started_at;
    let end = session
        .ended_at
        .unwrap_or_else(crate::util::now_ms)
        .max(start);
    let mut out = Credits {
        session_id: session.id,
        ..Default::default()
    };
    let (mut follows, mut subs, mut gifts, mut cheers, mut raids) = (
        CreditList::default(),
        CreditList::default(),
        CreditList::default(),
        CreditList::default(),
        CreditList::default(),
    );
    for e in events_between(db, &CREDIT_KINDS, start, end)? {
        let amount = e.amount.unwrap_or(0.0).max(0.0);
        match e.kind {
            EventKind::Follow => follows.set(credit_name(&e, 0.0)),
            // Gifted subs are thanked under the gifter.
            EventKind::Sub if !e.is_gift => subs.set(credit_name(&e, 0.0)),
            EventKind::Resub => subs.set(credit_name(&e, e.months.unwrap_or(0) as f64)),
            EventKind::GiftSub => gifts.add(credit_name(&e, 1.0)),
            EventKind::Cheer => cheers.add(credit_name(&e, amount)),
            EventKind::Raid => raids.add(credit_name(&e, amount)),
            _ => {}
        }
    }
    out.followers = follows.0;
    out.subscribers = subs.0;
    out.gifters = gifts.ranked();
    out.cheerers = cheers.ranked();
    out.raiders = raids.ranked();

    let rows = db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT user_key, MAX(name), COUNT(*) AS n, MAX(text = ?4), MAX(text = ?5)
             FROM session_activity WHERE kind = ?1 AND ts BETWEEN ?2 AND ?3
             GROUP BY user_key ORDER BY n DESC, MAX(name)",
        )?;
        stmt.query_map(
            params![
                activity::CHAT,
                start,
                end,
                activity::ROLE_MOD,
                activity::ROLE_VIP
            ],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, bool>(3)?,
                    r.get::<_, bool>(4)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
    })?;
    for (key, name, n, moderator, vip) in rows {
        let numeric = !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit());
        let login = if !numeric {
            key.clone()
        } else if name.is_ascii() {
            name.to_lowercase()
        } else {
            String::new()
        };
        let person = |amount: f64| CreditName {
            name: name.clone(),
            login: login.clone(),
            user_id: if numeric { key.clone() } else { String::new() },
            amount,
        };
        if moderator {
            out.moderators.push(person(0.0));
        } else if vip {
            out.vips.push(person(0.0));
        }
        if out.chatters.len() < CREDIT_CHATTERS {
            out.chatters.push(person(n as f64));
        }
    }
    let by_name =
        |a: &CreditName, b: &CreditName| a.name.to_lowercase().cmp(&b.name.to_lowercase());
    out.moderators.sort_by(by_name);
    out.vips.sort_by(by_name);
    Ok(out)
}

pub fn summarize(db: &Db, session: &StreamSession) -> AppResult<SessionSummary> {
    let start = session.started_at;
    let end = session
        .ended_at
        .unwrap_or_else(crate::util::now_ms)
        .max(start);
    let mut s = SessionSummary {
        session: session.clone(),
        duration_ms: end - start,
        ..Default::default()
    };

    let events = events_between(db, &KINDS, start, end)?;

    let (mut gifters, mut cheerers, mut donors) =
        (Tally::default(), Tally::default(), Tally::default());
    let mut currencies = Tally::default();
    for e in &events {
        let amount = e.amount.unwrap_or(0.0);
        match e.kind {
            EventKind::Follow => s.follows += 1,
            EventKind::Sub => s.new_subs += 1,
            EventKind::Resub => s.resubs += 1,
            EventKind::GiftSub => {
                s.gifted_subs += 1;
                gifters.add(&who(e), 1.0);
            }
            EventKind::Cheer => {
                s.bits += amount.max(0.0) as u64;
                cheerers.add(&who(e), amount);
            }
            EventKind::Raid => s.raids_in.push(RaidEntry {
                ts: e.ts,
                name: who(e),
                viewers: amount.max(0.0) as u32,
            }),
            EventKind::Charity => {
                s.donation_count += 1;
                donors.add(&who(e), amount);
                currencies.add(e.currency.as_deref().unwrap_or(""), amount);
            }
            _ => {}
        }
        // Gifts inside a community gift show as the one community gift on the timeline.
        if e.kind != EventKind::GiftSub || !e.data.contains_key("community_gift_id") {
            s.timeline.push(TimelineMark {
                ts: e.ts,
                kind: e.kind.as_str().into(),
            });
        }
    }
    s.top_gifters = gifters.top(TOP);
    s.top_cheerers = cheerers.top(TOP);
    s.top_donors = donors.top(TOP);
    s.donation_totals = currencies.top(usize::MAX);

    db.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT MAX(name), COUNT(*) AS n FROM session_activity
             WHERE kind = ?1 AND ts BETWEEN ?2 AND ?3 GROUP BY user_key ORDER BY n DESC, MAX(name)",
        )?;
        let rows = stmt.query_map(params![activity::CHAT, start, end], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (name, n) = row?;
            s.chatters += 1;
            s.chat_messages += n as u32;
            if s.top_chatters.len() < TOP {
                s.top_chatters.push(Ranked {
                    name,
                    amount: n as f64,
                });
            }
        }

        let mut stmt = c.prepare(
            "SELECT ts / 60000 * 60000 AS m, COUNT(*) FROM session_activity
             WHERE kind = ?1 AND ts BETWEEN ?2 AND ?3 GROUP BY m ORDER BY m",
        )?;
        s.chat_minutes = stmt
            .query_map(params![activity::CHAT, start, end], |r| {
                Ok(ChatMinute {
                    minute: r.get(0)?,
                    count: r.get::<_, i64>(1)? as u32,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;

        let count = |kind: &str| -> rusqlite::Result<u32> {
            c.query_row(
                "SELECT COUNT(*) FROM session_activity WHERE kind = ?1 AND ts BETWEEN ?2 AND ?3",
                params![kind, start, end],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n as u32)
        };
        s.alerts = count(activity::ALERT)?;
        s.actions = count(activity::ACTION)?;

        let mut stmt = c.prepare(
            "SELECT ts, kind, name, amount, text FROM session_activity
             WHERE kind IN (?1, ?2) AND ts BETWEEN ?3 AND ?4 ORDER BY ts",
        )?;
        let rows = stmt.query_map(
            params![activity::MARKER, activity::RAID_OUT, start, end],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<f64>>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )?;
        for row in rows {
            let (ts, kind, name, amount, text) = row?;
            if kind == activity::MARKER {
                s.markers.push(MarkerEntry {
                    ts,
                    description: text,
                });
            } else {
                s.raids_out.push(RaidEntry {
                    ts,
                    name,
                    viewers: amount.unwrap_or(0.0).max(0.0) as u32,
                });
            }
        }

        let mut stmt = c.prepare(
            "SELECT name FROM chatters WHERE first_seen BETWEEN ?1 AND ?2 ORDER BY first_seen",
        )?;
        s.first_chatters = stmt
            .query_map(params![start, end], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(())
    })?;
    Ok(s)
}
