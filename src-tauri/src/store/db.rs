//! Event history and custom-widget storage in `events.sqlite`.

use crate::error::AppResult;
use crate::model::event::Event;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::Mutex;

/// Most saved values one custom widget layer may keep.
pub const MAX_WIDGET_KEYS: i64 = 500;

pub struct Db {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    test INTEGER NOT NULL DEFAULT 0,
    user_name TEXT NOT NULL DEFAULT '',
    json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts DESC);
CREATE TABLE IF NOT EXISTS widget_state (
    layer_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (layer_id, key)
);
"#;

/// Changes after the first release, applied in order. `PRAGMA user_version`
/// holds how many have run. Never edit one that has shipped; add a new one.
const MIGRATIONS: &[&str] = &[
    // 1: stream sessions, plus what the summary needs that isn't in `events`.
    r#"
    CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        last_seen INTEGER NOT NULL,
        source TEXT NOT NULL,
        twitch_started_at INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL DEFAULT '',
        categories TEXT NOT NULL DEFAULT '[]',
        peak_viewers INTEGER NOT NULL DEFAULT 0,
        viewer_sum INTEGER NOT NULL DEFAULT 0,
        viewer_samples INTEGER NOT NULL DEFAULT 0,
        summary TEXT
    );
    CREATE INDEX sessions_started ON sessions(started_at DESC);
    CREATE INDEX sessions_open ON sessions(ended_at) WHERE ended_at IS NULL;
    CREATE TABLE session_activity (
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        user_key TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        amount REAL,
        text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX activity_kind_ts ON session_activity(kind, ts);
    CREATE TABLE chatters (
        user_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        first_seen INTEGER NOT NULL
    );
    CREATE INDEX chatters_first_seen ON chatters(first_seen);
    CREATE INDEX events_kind_ts ON events(kind, ts);
    "#,
    // 2: Discord posts made per stream, so each goes out once.
    r#"
    CREATE TABLE discord_posts (
        session_id INTEGER NOT NULL,
        webhook_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        message_id TEXT NOT NULL DEFAULT '',
        posted_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, webhook_id, kind)
    );
    CREATE TABLE discord_pending (
        session_id INTEGER PRIMARY KEY,
        due_at INTEGER NOT NULL
    );
    "#,
    // 3: giveaway history.
    r#"
    CREATE TABLE giveaways (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL DEFAULT 0,
        entrants INTEGER NOT NULL DEFAULT 0,
        entries INTEGER NOT NULL DEFAULT 0,
        winners TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX giveaways_opened ON giveaways(opened_at DESC);
    "#,
];

/// Most history rows kept; the oldest are trimmed beyond this.
const MAX_EVENTS: i64 = 50_000;

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)?;
    let done: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(done.max(0) as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&mut conn)?;
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_in_memory() -> Db {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        migrate(&mut conn).expect("schema");
        Db {
            conn: Mutex::new(conn),
        }
    }

    /// Run `f` with the connection locked.
    pub fn with_conn<R>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<R>) -> AppResult<R> {
        Ok(f(&self.conn.lock().unwrap())?)
    }

    /// Store an event. Returns false when an event with the same id was already
    /// stored (Twitch can deliver the same notification more than once).
    pub fn insert_event(&self, e: &Event) -> AppResult<bool> {
        let json = serde_json::to_string(e)?;
        let name = e
            .user
            .as_ref()
            .map(|u| u.display_name.as_str())
            .unwrap_or("");
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "INSERT OR IGNORE INTO events (id, kind, ts, test, user_name, json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![e.id, e.kind.as_str(), e.ts, e.test as i64, name, json],
        )?;
        if n > 0 && rand::random::<u8>() == 0 {
            conn.execute(
                "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY ts DESC LIMIT -1 OFFSET ?1)",
                params![MAX_EVENTS],
            )?;
        }
        Ok(n > 0)
    }

    /// Newest first. `kinds` empty = all kinds. `search` matches the user name.
    pub fn recent_events(
        &self,
        limit: u32,
        kinds: &[String],
        search: &str,
        include_tests: bool,
    ) -> AppResult<Vec<Event>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from("SELECT json FROM events WHERE 1=1");
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if !kinds.is_empty() {
            sql.push_str(" AND kind IN (");
            for (i, k) in kinds.iter().enumerate() {
                if i > 0 {
                    sql.push(',');
                }
                sql.push('?');
                args.push(Box::new(k.clone()));
            }
            sql.push(')');
        }
        if !search.trim().is_empty() {
            sql.push_str(" AND user_name LIKE ? ESCAPE '\\'");
            let escaped = search
                .trim()
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            args.push(Box::new(format!("%{escaped}%")));
        }
        if !include_tests {
            sql.push_str(" AND test = 0");
        }
        sql.push_str(" ORDER BY ts DESC LIMIT ?");
        args.push(Box::new(limit.min(5000) as i64));
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
            r.get::<_, String>(0)
        })?;
        let mut out = Vec::new();
        for row in rows {
            if let Ok(e) = serde_json::from_str::<Event>(&row?) {
                out.push(e);
            }
        }
        Ok(out)
    }

    pub fn get_event(&self, id: &str) -> AppResult<Option<Event>> {
        let conn = self.conn.lock().unwrap();
        let json: Option<String> = conn
            .query_row("SELECT json FROM events WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    }

    pub fn clear_events(&self) -> AppResult<()> {
        self.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM events", [])?;
        Ok(())
    }

    pub fn widget_state(&self) -> AppResult<Map<String, Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT layer_id, key, value FROM widget_state")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        let mut out: Map<String, Value> = Map::new();
        for row in rows {
            let (layer, key, value) = row?;
            let value = serde_json::from_str(&value).unwrap_or(Value::Null);
            out.entry(layer)
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .expect("object")
                .insert(key, value);
        }
        Ok(out)
    }

    pub fn set_widget_value(&self, layer_id: &str, key: &str, value: &Value) -> AppResult<()> {
        let json = serde_json::to_string(value)?;
        if json.len() > 256 * 1024 {
            return crate::error::user_err("Widget value is too large (256 KB max).");
        }
        let conn = self.conn.lock().unwrap();
        let (count, exists): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(key = ?2), 0) FROM widget_state WHERE layer_id = ?1",
            params![layer_id, key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if exists == 0 && count >= MAX_WIDGET_KEYS {
            return crate::error::user_err(format!(
                "A widget can save at most {MAX_WIDGET_KEYS} values."
            ));
        }
        conn.execute(
            "INSERT INTO widget_state (layer_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(layer_id, key) DO UPDATE SET value = excluded.value",
            params![layer_id, key, json],
        )?;
        Ok(())
    }

    pub fn delete_widget_value(&self, layer_id: &str, key: &str) -> AppResult<()> {
        self.conn.lock().unwrap().execute(
            "DELETE FROM widget_state WHERE layer_id = ?1 AND key = ?2",
            params![layer_id, key],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::event::EventKind;

    #[test]
    fn dedupes_by_id() {
        let db = Db::open_in_memory();
        let e = Event::new(EventKind::Follow).with_user("a", "A");
        assert!(db.insert_event(&e).unwrap());
        assert!(!db.insert_event(&e).unwrap());
        assert_eq!(db.recent_events(10, &[], "", true).unwrap().len(), 1);
    }

    #[test]
    fn filters() {
        let db = Db::open_in_memory();
        let mut a = Event::new(EventKind::Follow).with_user("a", "Alice_x");
        let mut z = Event::new(EventKind::Follow).with_user("z", "Alicezx");
        z.ts = 0;
        a.ts = 1;
        let mut b = Event::new(EventKind::Cheer).with_user("b", "Bob");
        b.ts = 2;
        let mut t = Event::new(EventKind::Cheer).with_user("c", "Carol");
        t.ts = 3;
        t.test = true;
        for e in [&a, &b, &t, &z] {
            db.insert_event(e).unwrap();
        }
        let all = db.recent_events(10, &[], "", true).unwrap();
        assert_eq!(
            all.iter().map(|e| e.ts).collect::<Vec<_>>(),
            vec![3, 2, 1, 0]
        );
        assert_eq!(
            db.recent_events(10, &["cheer".into()], "", false)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(db.recent_events(10, &[], "ali", true).unwrap().len(), 2);
        // `_` and `%` are literal characters, not wildcards
        assert_eq!(db.recent_events(10, &[], "e_x", true).unwrap().len(), 1);
        assert_eq!(db.recent_events(10, &[], "%", true).unwrap().len(), 0);
        assert!(db.get_event(&b.id).unwrap().is_some());
        db.clear_events().unwrap();
        assert!(db.recent_events(10, &[], "", true).unwrap().is_empty());
    }

    #[test]
    fn widget_keys_are_capped() {
        let db = Db::open_in_memory();
        for i in 0..MAX_WIDGET_KEYS {
            db.set_widget_value("l1", &format!("k{i}"), &Value::from(i))
                .unwrap();
        }
        assert!(
            db.set_widget_value("l1", "one-more", &Value::from(1))
                .is_err()
        );
        db.set_widget_value("l1", "k0", &Value::from(9)).unwrap();
        db.set_widget_value("l2", "x", &Value::from(1)).unwrap();
    }

    #[test]
    fn widget_state_round_trip() {
        let db = Db::open_in_memory();
        db.set_widget_value("l1", "count", &Value::from(3)).unwrap();
        db.set_widget_value("l1", "count", &Value::from(4)).unwrap();
        db.set_widget_value("l2", "x", &serde_json::json!({"a": 1}))
            .unwrap();
        let s = db.widget_state().unwrap();
        assert_eq!(s["l1"]["count"], 4);
        assert_eq!(s["l2"]["x"]["a"], 1);
        db.delete_widget_value("l1", "count").unwrap();
        let s = db.widget_state().unwrap();
        assert!(!s.contains_key("l1"));
        assert!(s.contains_key("l2"));
    }

    #[test]
    fn migrates_an_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("events.sqlite");
        {
            // A file from before migrations existed.
            let conn = Connection::open(&p).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            let e = Event::new(EventKind::Follow).with_user("a", "A");
            conn.execute(
                "INSERT INTO events (id, kind, ts, user_name, json) VALUES (?1, 'follow', 1, 'A', ?2)",
                params![e.id, serde_json::to_string(&e).unwrap()],
            )
            .unwrap();
        }
        let version = |db: &Db| {
            db.with_conn(|c| c.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)))
                .unwrap()
        };
        let db = Db::open(&p).unwrap();
        assert_eq!(version(&db), MIGRATIONS.len() as i64);
        assert_eq!(db.recent_events(10, &[], "", true).unwrap().len(), 1);
        let indexes: Vec<String> = db
            .with_conn(|c| {
                let mut s =
                    c.prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")?;
                s.query_map([], |r| r.get(0))?.collect()
            })
            .unwrap();
        for name in [
            "activity_kind_ts",
            "chatters_first_seen",
            "events_kind_ts",
            "sessions_started",
        ] {
            assert!(indexes.iter().any(|i| i == name), "missing {name}");
        }
        drop(db);
        // Opening again runs nothing twice.
        let db = Db::open(&p).unwrap();
        assert_eq!(version(&db), MIGRATIONS.len() as i64);
    }

    #[test]
    fn on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("events.sqlite");
        {
            let db = Db::open(&p).unwrap();
            db.insert_event(&Event::new(EventKind::Raid)).unwrap();
        }
        let db = Db::open(&p).unwrap();
        assert_eq!(db.recent_events(10, &[], "", true).unwrap().len(), 1);
    }
}
