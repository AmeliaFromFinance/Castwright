use rand::Rng;
use std::path::Path;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Short random id for layers, actions, variations and so on.
pub fn new_id() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..12)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect()
}

/// 32 hex characters (128 bits) for URL tokens.
pub fn random_token() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Write a file so that a crash mid-write never leaves a half-written file behind:
/// write to a temporary file next to it, flush to disk, then rename over the original.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic_inner(path, bytes, false)
}

/// Like `write_atomic`, but only the current user can ever read the file (Unix).
pub fn write_atomic_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_atomic_inner(path, bytes, true)
}

fn write_atomic_inner(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let tmp = dir.join(format!(".{file_name}.{}.tmp", new_id()));
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Reject names that could escape a folder (`..`, absolute paths, separators).
pub fn safe_file_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains(['/', '\\', ':', '\0'])
        || trimmed.starts_with('.')
    {
        return None;
    }
    Some(trimmed.to_string())
}

/// Constant-time comparison for secrets.
pub fn secure_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Read JSON into `T`, keeping every setting that still parses when some don't
/// (for example a value written by a newer version). Checks two levels deep.
pub fn lenient_json<T>(raw: &serde_json::Value) -> T
where
    T: serde::Serialize + serde::de::DeserializeOwned + Default,
{
    use serde_json::Value;
    let parses = |v: &Value| serde_json::from_value::<T>(v.clone()).is_ok();
    let mut out = serde_json::to_value(T::default()).unwrap_or(Value::Null);
    if let (Value::Object(raw), true) = (raw, out.is_object()) {
        for (k, rv) in raw {
            let Some(current) = out.get(k).cloned() else {
                continue;
            };
            if let (Value::Object(rsub), Value::Object(_)) = (rv, &current) {
                for (sk, sv) in rsub {
                    let mut candidate = out.clone();
                    candidate[k][sk] = sv.clone();
                    if parses(&candidate) {
                        out = candidate;
                    }
                }
            } else {
                let mut candidate = out.clone();
                candidate[k] = rv.clone();
                if parses(&candidate) {
                    out = candidate;
                }
            }
        }
    }
    serde_json::from_value(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_distinct() {
        let a: std::collections::HashSet<_> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(a.len(), 1000);
        assert_eq!(random_token().len(), 32);
    }

    #[test]
    fn atomic_write_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn file_names() {
        assert_eq!(safe_file_name("logo.png").as_deref(), Some("logo.png"));
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:x", ".hidden"] {
            assert!(safe_file_name(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn secure_compare() {
        assert!(secure_eq("abc", "abc"));
        assert!(!secure_eq("abc", "abd"));
        assert!(!secure_eq("abc", "ab"));
    }
}
