//! Linux: the playing song from any MPRIS player (Spotify, VLC, browsers and most
//! others) over the session D-Bus.

use super::SystemTrack;
use crate::model::music::NowPlaying;
use std::collections::HashMap;
use zbus::zvariant::{OwnedValue, Value};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";

#[derive(Default)]
pub struct Reader {
    conn: Option<zbus::Connection>,
}

fn text(v: &Value) -> String {
    match v {
        Value::Str(s) => s.to_string(),
        Value::ObjectPath(p) => p.to_string(),
        Value::Array(a) => a
            .iter()
            .map(text)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Value(inner) => text(inner),
        _ => String::new(),
    }
}

fn number(v: &Value) -> i64 {
    match v {
        Value::I64(n) => *n,
        Value::U64(n) => *n as i64,
        Value::I32(n) => *n as i64,
        Value::U32(n) => *n as i64,
        Value::F64(n) => *n as i64,
        Value::Value(inner) => number(inner),
        _ => 0,
    }
}

/// A track from MPRIS metadata. Times in MPRIS are microseconds.
pub fn track_from(
    meta: &HashMap<String, OwnedValue>,
    status: &str,
    position_us: i64,
) -> Option<NowPlaying> {
    let get = |k: &str| meta.get(k).map(|v| text(v)).unwrap_or_default();
    let title = get("xesam:title");
    if title.is_empty() {
        return None;
    }
    let mut np = NowPlaying {
        id: get("mpris:trackid"),
        title,
        artist: get("xesam:artist"),
        album: get("xesam:album"),
        art_url: get("mpris:artUrl"),
        playing: status == "Playing",
        progress_ms: (position_us.max(0) / 1000) as u64,
        duration_ms: (meta
            .get("mpris:length")
            .map(|v| number(v))
            .unwrap_or(0)
            .max(0)
            / 1000) as u64,
    };
    // Some players use the same track id for every song.
    if np.id.is_empty()
        || np.id.ends_with("/NoTrack")
        || np.id == "/org/mpris/MediaPlayer2/TrackList/NoTrack"
    {
        np.id = String::new();
    }
    np.id = format!("{}\u{1f}{}", np.id, np.key());
    Some(np)
}

/// "spotify" from "org.mpris.MediaPlayer2.spotify.instance123".
fn player_name(bus: &str) -> String {
    let rest = bus.strip_prefix(PREFIX).unwrap_or(bus);
    let name = rest.split('.').next().unwrap_or(rest);
    let mut c = name.chars();
    c.next()
        .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
        .unwrap_or_default()
}

fn rank(status: &str) -> u8 {
    match status {
        "Playing" => 0,
        "Paused" => 1,
        _ => 2,
    }
}

impl Reader {
    async fn connection(&mut self) -> Result<zbus::Connection, String> {
        if let Some(c) = &self.conn {
            return Ok(c.clone());
        }
        let c = zbus::Connection::session()
            .await
            .map_err(|e| format!("Couldn't open the session D-Bus: {e}"))?;
        self.conn = Some(c.clone());
        Ok(c)
    }

    async fn player(
        conn: &zbus::Connection,
        bus: &str,
    ) -> zbus::Result<(String, HashMap<String, OwnedValue>, i64)> {
        let p: zbus::Proxy = zbus::proxy::Builder::new(conn)
            .destination(bus.to_string())?
            .path(PATH)?
            .interface("org.mpris.MediaPlayer2.Player")?
            .cache_properties(zbus::proxy::CacheProperties::No)
            .build()
            .await?;
        let status: String = p.get_property("PlaybackStatus").await?;
        let meta: HashMap<String, OwnedValue> =
            p.get_property("Metadata").await.unwrap_or_default();
        let pos: i64 = p.get_property("Position").await.unwrap_or(0);
        Ok((status, meta, pos))
    }

    /// The player that is playing, else one that is paused.
    pub async fn read(&mut self) -> Result<Option<SystemTrack>, String> {
        let conn = self.connection().await?;
        let names = match zbus::fdo::DBusProxy::new(&conn).await {
            Ok(d) => d.list_names().await,
            Err(e) => Err(e.into()),
        };
        let names = match names {
            Ok(n) => n,
            Err(e) => {
                self.conn = None;
                return Err(format!("Couldn't list media players: {e}"));
            }
        };
        let mut best: Option<(u8, SystemTrack)> = None;
        for name in names.iter().filter(|n| n.as_str().starts_with(PREFIX)) {
            let Ok((status, meta, pos)) = Self::player(&conn, name.as_str()).await else {
                continue;
            };
            let Some(track) = track_from(&meta, &status, pos) else {
                continue;
            };
            let r = rank(&status);
            if best.as_ref().is_none_or(|(b, _)| r < *b) {
                best = Some((
                    r,
                    SystemTrack {
                        player: player_name(name.as_str()),
                        art: None,
                        track,
                    },
                ));
            }
        }
        Ok(best.map(|(_, t)| t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(v: Value) -> OwnedValue {
        OwnedValue::try_from(v).unwrap()
    }

    #[test]
    fn reads_metadata() {
        let mut m = HashMap::new();
        m.insert("xesam:title".into(), owned(Value::from("Midnight City")));
        m.insert(
            "xesam:artist".into(),
            owned(Value::from(vec!["M83".to_string(), "Guest".to_string()])),
        );
        m.insert(
            "xesam:album".into(),
            owned(Value::from("Hurry Up, We're Dreaming")),
        );
        m.insert("mpris:length".into(), owned(Value::from(243_000_000i64)));
        m.insert(
            "mpris:artUrl".into(),
            owned(Value::from("file:///tmp/cover.jpg")),
        );
        let t = track_from(&m, "Playing", 61_500_000).unwrap();
        assert_eq!(t.title, "Midnight City");
        assert_eq!(t.artist, "M83, Guest");
        assert_eq!(t.duration_ms, 243_000);
        assert_eq!(t.progress_ms, 61_500);
        assert!(t.playing);
        assert_eq!(t.art_url, "file:///tmp/cover.jpg");
        assert!(track_from(&HashMap::new(), "Playing", 0).is_none());
    }

    #[test]
    fn names_players() {
        assert_eq!(player_name("org.mpris.MediaPlayer2.spotify"), "Spotify");
        assert_eq!(player_name("org.mpris.MediaPlayer2.vlc.instance42"), "Vlc");
    }
}
