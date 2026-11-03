//! Songs from a text file that a music player or tool keeps up to date
//! (Snip, Tuna, foobar2000, MusicBee and others can write one).

use crate::model::music::NowPlaying;
use std::path::Path;
use std::time::SystemTime;

/// Largest file read. Now-playing files are a line or two.
const MAX_BYTES: u64 = 64 * 1024;

const FIELDS: [&str; 3] = ["title", "artist", "album"];

/// Splits `text` using `format`, where `{title}`, `{artist}` and `{album}` stand for
/// the fields. Text that doesn't fit the format becomes the title.
pub fn parse(text: &str, format: &str) -> NowPlaying {
    let text = text.replace("\r\n", "\n");
    let text = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let mut np = NowPlaying::default();
    if text.is_empty() {
        return np;
    }
    let format = format.replace("\r\n", "\n").replace("\\n", "\n");
    match pattern(format.trim()).and_then(|re| {
        re.captures(text).map(|c| {
            let get = |n: &str| {
                c.name(n)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default()
            };
            (get("title"), get("artist"), get("album"))
        })
    }) {
        Some((title, artist, album)) if !title.is_empty() || !artist.is_empty() => {
            np.title = title;
            np.artist = artist;
            np.album = album;
        }
        _ => np.title = text.lines().next().unwrap_or_default().trim().to_string(),
    }
    np.playing = !np.title.is_empty();
    np.id = np.key();
    np
}

/// A regex for the format, or None when it has no fields.
fn pattern(format: &str) -> Option<regex::Regex> {
    let mut re = String::from("(?s)^");
    let mut rest = format;
    let mut used = Vec::new();
    while let Some(start) = rest.find('{') {
        let Some(len) = rest[start..].find('}') else {
            break;
        };
        let name = &rest[start + 1..start + len];
        re.push_str(&regex::escape(&rest[..start]));
        if FIELDS.contains(&name) && !used.contains(&name) {
            re.push_str(&format!("(?P<{name}>.*?)"));
            used.push(name);
        } else {
            re.push_str(&regex::escape(&rest[start..=start + len]));
        }
        rest = &rest[start + len + 1..];
    }
    re.push_str(&regex::escape(rest));
    re.push('$');
    if used.is_empty() {
        return None;
    }
    regex::Regex::new(&re).ok()
}

/// When the file last changed, to skip reading it when nothing did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
}

pub fn stamp(path: &Path) -> std::io::Result<Stamp> {
    let m = std::fs::metadata(path)?;
    Ok(Stamp {
        modified: m.modified().ok(),
        len: m.len(),
    })
}

/// The file's text. Tools write UTF-8 or UTF-16 (Windows); both are read.
pub fn read(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_BYTES)
        .read_to_end(&mut bytes)?;
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        return Ok(String::from_utf16_lossy(&units));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
