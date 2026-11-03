//! Past giveaways in `events.sqlite`.

use crate::error::AppResult;
use crate::model::play::{Giveaway, GiveawayRecord};
use crate::store::db::Db;
use rusqlite::params;

pub fn record(g: &Giveaway, ended_at: i64) -> GiveawayRecord {
    GiveawayRecord {
        id: g.id.clone(),
        title: g.settings.title.clone(),
        opened_at: g.opened_at,
        ended_at,
        entrants: g.entrants.len() as u32,
        entries: g.total_entries(),
        winners: g
            .winners
            .iter()
            .filter(|w| w.standing())
            .map(|w| w.viewer.name.clone())
            .collect(),
    }
}

pub fn save(db: &Db, r: &GiveawayRecord) -> AppResult<()> {
    let winners = serde_json::to_string(&r.winners)?;
    db.with_conn(|c| {
        c.execute(
            "INSERT OR REPLACE INTO giveaways (id, title, opened_at, ended_at, entrants, entries, winners)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                r.id,
                r.title,
                r.opened_at,
                r.ended_at,
                r.entrants,
                r.entries as i64,
                winners
            ],
        )
    })?;
    Ok(())
}

/// Newest first.
pub fn list(db: &Db, limit: u32) -> AppResult<Vec<GiveawayRecord>> {
    db.with_conn(|c| {
        let mut st = c.prepare(
            "SELECT id, title, opened_at, ended_at, entrants, entries, winners
             FROM giveaways ORDER BY opened_at DESC LIMIT ?1",
        )?;
        let rows = st.query_map([limit], |r| {
            let winners: String = r.get(6)?;
            Ok(GiveawayRecord {
                id: r.get(0)?,
                title: r.get(1)?,
                opened_at: r.get(2)?,
                ended_at: r.get(3)?,
                entrants: r.get(4)?,
                entries: r.get::<_, i64>(5)?.max(0) as u64,
                winners: serde_json::from_str(&winners).unwrap_or_default(),
            })
        })?;
        rows.collect()
    })
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    db.with_conn(|c| c.execute("DELETE FROM giveaways WHERE id = ?1", [id]))?;
    Ok(())
}
