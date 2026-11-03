//! "Make portable": copy this computer's data into a `data` folder next to the app.

use crate::error::AppResult;
use crate::store::secrets::Secrets;
use crate::store::settings::SettingsStore;
use std::path::Path;

pub struct Sources<'a> {
    pub config_dir: &'a Path,
    pub data_dir: &'a Path,
    pub default_project_dir: &'a Path,
}

const CONFIG_FILES: [&str; 2] = ["settings.json", ".window-state.json"];
const DATA_DIRS: [&str; 2] = ["Projects", "backups"];

/// Copy settings, the default project, backups and sign-ins into `target`.
/// Nothing appears at `target` unless every step worked.
pub fn copy_data(src: &Sources, target: &Path, secrets: &[(&str, String)]) -> AppResult<()> {
    let parent = target.parent().unwrap_or(Path::new("."));
    let tmp = parent.join(format!(".data-{}.tmp", crate::util::new_id()));
    let result = fill(src, &tmp, secrets).and_then(|_| Ok(std::fs::rename(&tmp, target)?));
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    result
}

fn fill(src: &Sources, out: &Path, secrets: &[(&str, String)]) -> AppResult<()> {
    std::fs::create_dir_all(out)?;
    for name in CONFIG_FILES {
        let from = src.config_dir.join(name);
        if from.is_file() {
            std::fs::copy(&from, out.join(name))?;
        }
    }
    for name in DATA_DIRS {
        let from = src.data_dir.join(name);
        if from.is_dir() {
            copy_dir(&from, &out.join(name))?;
        }
    }
    // A project folder set to the old default now means the new default.
    let settings = SettingsStore::open(out.join("settings.json"));
    let dir = settings.get().project_dir;
    if !dir.is_empty() && Path::new(&dir) == src.default_project_dir {
        settings.update(|s| s.project_dir.clear())?;
    }
    if !secrets.is_empty() {
        let file = Secrets::file_only(out.join("secrets.json"));
        for (k, v) in secrets {
            file.set(k, v)?;
        }
    }
    Ok(())
}

/// Copy a folder tree. Links are skipped so nothing outside it gets pulled in.
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::secrets::keys;

    #[test]
    fn copies_everything_and_rewrites_the_default_folder() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        let data = dir.path().join("share");
        let default_project = data.join("Projects").join("Default");
        std::fs::create_dir_all(&default_project).unwrap();
        std::fs::create_dir_all(data.join("backups")).unwrap();
        std::fs::create_dir_all(data.join("WebKitCache")).unwrap();
        std::fs::write(default_project.join("project.json"), b"{}").unwrap();
        std::fs::write(data.join("backups").join("a.cwbackup"), b"x").unwrap();
        SettingsStore::open(config.join("settings.json"))
            .update(|s| s.project_dir = default_project.to_string_lossy().into_owned())
            .unwrap();
        std::fs::write(config.join(".window-state.json"), b"{}").unwrap();

        let target = dir.path().join("stick").join("data");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        let src = Sources {
            config_dir: &config,
            data_dir: &data,
            default_project_dir: &default_project,
        };
        copy_data(&src, &target, &[(keys::OBS_PASSWORD, "pw".into())]).unwrap();

        assert!(target.join("Projects/Default/project.json").is_file());
        assert!(target.join("backups/a.cwbackup").is_file());
        assert!(target.join(".window-state.json").is_file());
        assert!(
            !target.join("WebKitCache").exists(),
            "only Castwright's own files"
        );
        assert_eq!(
            SettingsStore::open(target.join("settings.json"))
                .get()
                .project_dir,
            ""
        );
        assert_eq!(
            Secrets::file_only(target.join("secrets.json"))
                .get(keys::OBS_PASSWORD)
                .as_deref(),
            Some("pw")
        );
        let leftovers = std::fs::read_dir(target.parent().unwrap()).unwrap().count();
        assert_eq!(leftovers, 1, "no temporary folder left behind");
    }

    #[test]
    fn keeps_a_custom_project_folder() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        SettingsStore::open(config.join("settings.json"))
            .update(|s| s.project_dir = "/elsewhere/show".into())
            .unwrap();
        let target = dir.path().join("data");
        let src = Sources {
            config_dir: &config,
            data_dir: &dir.path().join("none"),
            default_project_dir: &dir.path().join("none/Projects/Default"),
        };
        copy_data(&src, &target, &[]).unwrap();
        assert_eq!(
            SettingsStore::open(target.join("settings.json"))
                .get()
                .project_dir,
            "/elsewhere/show"
        );
        assert!(!target.join("secrets.json").exists());
    }

    #[test]
    fn failure_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("data");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("mine.txt"), b"keep").unwrap();
        let src = Sources {
            config_dir: &dir.path().join("none"),
            data_dir: &dir.path().join("none"),
            default_project_dir: &dir.path().join("none"),
        };
        assert!(copy_data(&src, &target, &[]).is_err());
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
