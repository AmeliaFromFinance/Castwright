//! `settings.json` in the app config folder.

use crate::error::AppResult;
use crate::model::settings::Settings;
use std::path::PathBuf;
use std::sync::RwLock;

pub struct SettingsStore {
    file: PathBuf,
    value: RwLock<Settings>,
}

impl SettingsStore {
    pub fn open(file: PathBuf) -> SettingsStore {
        let mut value: Settings = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if value.server.token.len() < 16 {
            value.server.token = crate::util::random_token();
        }
        if value.server.port < 1024 {
            value.server.port = crate::model::settings::DEFAULT_SERVER_PORT;
        }
        let store = SettingsStore {
            file,
            value: RwLock::new(value),
        };
        let _ = store.save();
        store
    }

    pub fn get(&self) -> Settings {
        self.value.read().unwrap().clone()
    }

    pub fn update<R>(&self, f: impl FnOnce(&mut Settings) -> R) -> AppResult<R> {
        let r = f(&mut self.value.write().unwrap());
        self.save()?;
        Ok(r)
    }

    fn save(&self) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(&*self.value.read().unwrap())?;
        crate::util::write_atomic(&self.file, &json)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("settings.json");
        let s = SettingsStore::open(f.clone());
        let token = s.get().server.token.clone();
        assert_eq!(token.len(), 32);
        s.update(|v| v.obs.port = 4456).unwrap();
        let s2 = SettingsStore::open(f.clone());
        assert_eq!(s2.get().obs.port, 4456);
        assert_eq!(s2.get().server.token, token, "token is kept between runs");
    }

    #[test]
    fn repairs_bad_values() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("settings.json");
        std::fs::write(&f, br#"{"server":{"port":80,"token":"x"}}"#).unwrap();
        let s = SettingsStore::open(f);
        assert_eq!(
            s.get().server.port,
            crate::model::settings::DEFAULT_SERVER_PORT
        );
        assert_eq!(s.get().server.token.len(), 32);
    }
}
