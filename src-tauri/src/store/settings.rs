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
        let mut value: Settings = match std::fs::read(&file) {
            Err(_) => Settings::default(),
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                // Keep a copy and rescue whatever still reads, so one bad value
                // doesn't reset the overlay secret, folders and themes.
                let backup = file.with_file_name(format!(
                    "settings.unreadable-{}.json",
                    crate::util::now_ms()
                ));
                let _ = std::fs::write(&backup, &bytes);
                serde_json::from_slice::<serde_json::Value>(&bytes)
                    .map(|raw| crate::util::lenient_json(&raw))
                    .unwrap_or_default()
            }),
        };
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
    fn one_bad_value_keeps_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("settings.json");
        std::fs::write(
            &f,
            r#"{"server":{"port":7500,"token":"0123456789abcdef0123456789abcdef","allow_lan":false},
               "appearance":{"theme":"light","window_effect":"from_the_future","ui_scale":120,"reduce_motion":true,"custom_themes":[]},
               "project_dir":"/x"}"#,
        )
        .unwrap();
        let s = SettingsStore::open(f.clone()).get();
        assert_eq!(s.server.token, "0123456789abcdef0123456789abcdef");
        assert_eq!(s.server.port, 7500);
        assert_eq!(s.appearance.theme, "light");
        assert_eq!(s.appearance.ui_scale, 120);
        assert_eq!(s.project_dir, "/x");
        let backups = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("settings.unreadable-")
            })
            .count();
        assert_eq!(backups, 1);
    }

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
