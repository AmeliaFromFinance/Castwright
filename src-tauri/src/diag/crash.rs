//! A crash file written when Castwright panics. A panic followed by a normal exit
//! (a background task failed) is kept for bug reports without bothering anyone;
//! one that ends the app is offered as a bug report on the next start.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use ts_rs::TS;

/// Written by the panic hook. Its presence at start means the last run didn't exit normally.
pub const CRASH_FILE: &str = "crash.json";
/// The most recent crash, already seen.
pub const LAST_CRASH_FILE: &str = "last-crash.json";
const LOG_LINES: usize = 200;
const BACKTRACE_MAX: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CrashInfo {
    #[ts(type = "number")]
    pub ts: i64,
    pub version: String,
    pub os: String,
    pub thread: String,
    pub message: String,
    pub location: String,
    pub backtrace: String,
    /// The last log lines before the crash.
    pub log: Vec<String>,
}

impl CrashInfo {
    pub fn new(message: String, location: String) -> Self {
        CrashInfo {
            ts: crate::util::now_ms(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            thread: std::thread::current()
                .name()
                .unwrap_or("unnamed")
                .to_string(),
            message,
            location,
            backtrace: String::new(),
            log: Vec::new(),
        }
    }

    fn from_panic(info: &std::panic::PanicHookInfo) -> Self {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        let mut c = CrashInfo::new(message, location);
        let mut bt = std::backtrace::Backtrace::force_capture().to_string();
        if bt.len() > BACKTRACE_MAX {
            let mut cut = BACKTRACE_MAX;
            while !bt.is_char_boundary(cut) {
                cut -= 1;
            }
            bt.truncate(cut);
        }
        c.backtrace = bt;
        c.log = super::logbuf::sink().try_tail(LOG_LINES);
        c
    }
}

pub fn write(dir: &Path, crash: &CrashInfo) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(crash).map_err(std::io::Error::other)?;
    crate::util::write_atomic(&dir.join(CRASH_FILE), &json)
}

/// Write a crash file into `dir` on every panic, then run the usual hook.
pub fn install(dir: PathBuf) {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    if DIR.set(dir).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(dir) = DIR.get() {
            let _ = write(dir, &CrashInfo::from_panic(info));
        }
        previous(info);
    }));
}

fn read(path: &Path) -> Option<CrashInfo> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Call once at start. Returns the crash that ended the last run, if one did.
pub fn take_unexpected(dir: &Path) -> Option<CrashInfo> {
    let path = dir.join(CRASH_FILE);
    if !path.exists() {
        return None;
    }
    let crash = read(&path);
    if crash.is_some() {
        let _ = std::fs::rename(&path, dir.join(LAST_CRASH_FILE));
    } else {
        let _ = std::fs::remove_file(&path);
    }
    crash
}

/// Call on a normal exit: a panic this run didn't end the app.
pub fn mark_clean_exit(dir: &Path) {
    let path = dir.join(CRASH_FILE);
    if path.exists() {
        let _ = std::fs::rename(&path, dir.join(LAST_CRASH_FILE));
    }
}

/// The most recent crash, whether or not it ended the app.
pub fn last(dir: &Path) -> Option<CrashInfo> {
    read(&dir.join(CRASH_FILE)).or_else(|| read(&dir.join(LAST_CRASH_FILE)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CrashInfo {
        let mut c = CrashInfo::new("index out of bounds".into(), "src/x.rs:1:2".into());
        c.log = vec!["INFO started".into()];
        c
    }

    #[test]
    fn crash_file_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(take_unexpected(dir.path()), None);
        assert_eq!(last(dir.path()), None);

        let c = sample();
        write(dir.path(), &c).unwrap();
        assert_eq!(last(dir.path()).as_ref(), Some(&c));
        assert_eq!(take_unexpected(dir.path()).as_ref(), Some(&c));
        assert_eq!(take_unexpected(dir.path()), None, "offered only once");
        assert_eq!(last(dir.path()).as_ref(), Some(&c), "still in reports");
    }

    #[test]
    fn a_normal_exit_after_a_panic_is_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let c = sample();
        write(dir.path(), &c).unwrap();
        mark_clean_exit(dir.path());
        assert_eq!(take_unexpected(dir.path()), None);
        assert_eq!(last(dir.path()), Some(c));
        mark_clean_exit(dir.path());
    }

    #[test]
    fn a_broken_crash_file_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(CRASH_FILE), b"{ half").unwrap();
        assert_eq!(take_unexpected(dir.path()), None);
        assert!(!dir.path().join(CRASH_FILE).exists());
    }

    #[test]
    fn panics_are_described() {
        let hook = std::panic::take_hook();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
        let s = seen.clone();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().name() == Some("crash-test") {
                *s.lock().unwrap() = Some(CrashInfo::from_panic(info));
            }
        }));
        let _ = std::thread::Builder::new()
            .name("crash-test".into())
            .spawn(|| panic!("boom {}", 42))
            .unwrap()
            .join();
        std::panic::set_hook(hook);
        let c = seen.lock().unwrap().take().unwrap();
        assert_eq!(c.message, "boom 42");
        assert_eq!(c.thread, "crash-test");
        assert!(c.location.contains("crash.rs"), "{}", c.location);
        assert_eq!(c.version, env!("CARGO_PKG_VERSION"));
    }
}
