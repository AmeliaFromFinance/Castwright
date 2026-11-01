//! Event history and custom-widget storage in `events.sqlite`.

use crate::error::AppResult;
use crate::model::event::Event;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::Mutex;

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

/// Most history rows kept; the oldest are trimmed beyond this.
const MAX_EVENTS: i64 = 50_000;

impl Db {
    pub fn open(path: &Path) -> AppResult<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        Ok(Db {
            conn: Mutex::new(conn),
        })
    }

    pub fn open_in_memory() -> Db {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(SCHEMA).expect("schema");
        Db {
            conn: Mutex::new(conn),
        }
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
        self.conn.lock().unwrap().execute(
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
