//! Tokens and passwords. Kept in the system keychain (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux). If no keychain is available, they go
//! in a file only the current user can read, and the app shows a warning.
//! Portable mode always uses the file, so sign-ins travel with the app.

use crate::error::AppResult;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Mutex;

const SERVICE: &str = "com.castwright.studio";
/// Written into the file so anyone opening it knows what it is.
const NOTE_KEY: &str = "_note";
const NOTE: &str = "Castwright sign-ins and passwords. Not encrypted: anyone with this file can use these accounts. Don't share it.";

pub struct Secrets {
    fallback_file: PathBuf,
    /// False in portable mode: never read or write the system keychain.
    keychain: bool,
    /// Set once the keychain has failed, so we stop trying it.
    use_file: Mutex<bool>,
    /// In-memory only (tests).
    memory: Option<Mutex<Map<String, Value>>>,
}

impl Secrets {
    pub fn new(fallback_file: PathBuf) -> Self {
        Secrets {
            fallback_file,
            keychain: true,
            use_file: Mutex::new(false),
            memory: None,
        }
    }

    pub fn file_only(file: PathBuf) -> Self {
        Secrets {
            fallback_file: file,
            keychain: false,
            use_file: Mutex::new(true),
            memory: None,
        }
    }

    pub fn in_memory() -> Self {
        Secrets {
            fallback_file: PathBuf::new(),
            keychain: false,
            use_file: Mutex::new(true),
            memory: Some(Mutex::new(Map::new())),
        }
    }

    /// True when secrets are stored in a file because no keychain was available.
    pub fn using_file(&self) -> bool {
        self.memory.is_none() && *self.use_file.lock().unwrap()
    }

    pub fn get(&self, key: &str) -> Option<String> {
        if let Some(m) = &self.memory {
            return m
                .lock()
                .unwrap()
                .get(key)
                .and_then(|v| v.as_str().map(String::from));
        }
        if !*self.use_file.lock().unwrap() {
            match keyring::Entry::new(SERVICE, key).and_then(|e| e.get_password()) {
                Ok(v) => return Some(v),
                Err(keyring::Error::NoEntry) => {
                    // Also check the file, in case it was written while the keychain was down.
                    return self
                        .read_file()
                        .get(key)
                        .and_then(|v| v.as_str().map(String::from));
                }
                Err(e) => {
                    tracing::warn!("keychain unavailable, using file: {e}");
                    *self.use_file.lock().unwrap() = true;
                }
            }
        }
        self.read_file()
            .get(key)
            .and_then(|v| v.as_str().map(String::from))
    }

    pub fn set(&self, key: &str, value: &str) -> AppResult<()> {
        if let Some(m) = &self.memory {
            m.lock()
                .unwrap()
                .insert(key.into(), Value::String(value.into()));
            return Ok(());
        }
        if !*self.use_file.lock().unwrap() {
            match keyring::Entry::new(SERVICE, key).and_then(|e| e.set_password(value)) {
                Ok(()) => {
                    // Remove any older copy from the fallback file.
                    let mut f = self.read_file();
                    if f.remove(key).is_some() {
                        self.write_file(&f)?;
                    }
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!("keychain unavailable, using file: {e}");
                    *self.use_file.lock().unwrap() = true;
                }
            }
        }
        let mut f = self.read_file();
        f.insert(key.into(), Value::String(value.into()));
        self.write_file(&f)
    }

    pub fn delete(&self, key: &str) -> AppResult<()> {
        if let Some(m) = &self.memory {
            m.lock().unwrap().remove(key);
            return Ok(());
        }
        if self.keychain
            && let Ok(e) = keyring::Entry::new(SERVICE, key)
        {
            let _ = e.delete_credential();
        }
        let mut f = self.read_file();
        if f.remove(key).is_some() {
            self.write_file(&f)?;
        }
        Ok(())
    }

    fn read_file(&self) -> Map<String, Value> {
        std::fs::read(&self.fallback_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn write_file(&self, m: &Map<String, Value>) -> AppResult<()> {
        let mut m = m.clone();
        m.insert(NOTE_KEY.into(), Value::String(NOTE.into()));
        crate::util::write_atomic_private(&self.fallback_file, &serde_json::to_vec_pretty(&m)?)?;
        Ok(())
    }
}

pub mod keys {
    pub const TWITCH_BROADCASTER: &str = "twitch.broadcaster";
    pub const TWITCH_BOT: &str = "twitch.bot";
    pub const OBS_PASSWORD: &str = "obs.password";
    pub const ALL: [&str; 3] = [TWITCH_BROADCASTER, TWITCH_BOT, OBS_PASSWORD];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store() {
        let s = Secrets::in_memory();
        assert!(s.get("a").is_none());
        s.set("a", "1").unwrap();
        assert_eq!(s.get("a").as_deref(), Some("1"));
        s.delete("a").unwrap();
        assert!(s.get("a").is_none());
    }

    #[test]
    fn file_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let s = Secrets::new(dir.path().join("secrets.json"));
        *s.use_file.lock().unwrap() = true;
        s.set("k", "v").unwrap();
        let s2 = Secrets::new(dir.path().join("secrets.json"));
        *s2.use_file.lock().unwrap() = true;
        assert_eq!(s2.get("k").as_deref(), Some("v"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("secrets.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn file_only_is_marked() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("secrets.json");
        let s = Secrets::file_only(f.clone());
        assert!(s.using_file());
        s.set(keys::OBS_PASSWORD, "hunter2").unwrap();
        let raw = std::fs::read_to_string(&f).unwrap();
        assert!(raw.contains("Not encrypted"));
        assert_eq!(
            Secrets::file_only(f).get(keys::OBS_PASSWORD).as_deref(),
            Some("hunter2")
        );
        s.delete(keys::OBS_PASSWORD).unwrap();
        assert!(s.get(keys::OBS_PASSWORD).is_none());
    }
}
