//! The project folder: `project.json`, `variables.json` and `assets/`.

use crate::error::{AppResult, user_err};
use crate::model::project::{PROJECT_FORMAT, Project};
use crate::util::{now_ms, safe_file_name, write_atomic};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use ts_rs::TS;

/// Largest asset accepted (images, video, audio).
pub const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct AssetInfo {
    pub name: String,
    /// `assets/<name>`, the path used in layers and alerts.
    pub path: String,
    #[ts(type = "number")]
    pub bytes: u64,
    /// image, video, audio, font or other.
    pub kind: String,
}

/// What happened when the project was opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadOutcome {
    Loaded,
    Created,
    /// project.json was unreadable; a backup was restored (file name given).
    RecoveredFromBackup(String),
    /// project.json and all backups were unreadable; a new project was started.
    StartedFresh,
}

/// Finds the newest good backup when project.json can't be read.
pub type Recover<'a> = &'a dyn Fn() -> Option<(Project, String)>;

pub struct ProjectStore {
    dir: PathBuf,
    project: RwLock<Project>,
    /// Format of project.json when it was opened, if older than the current one.
    migrated_from: Option<u32>,
    dirty: std::sync::atomic::AtomicBool,
    changed: tokio::sync::Notify,
    /// One save at a time, so an older write can't land after a newer one.
    save_lock: std::sync::Mutex<()>,
}

impl ProjectStore {
    pub fn open(dir: &Path) -> AppResult<(ProjectStore, LoadOutcome)> {
        Self::open_with(dir, &|| None)
    }

    pub fn open_with(dir: &Path, recover: Recover) -> AppResult<(ProjectStore, LoadOutcome)> {
        std::fs::create_dir_all(dir)?;
        std::fs::create_dir_all(dir.join("assets"))?;
        let file = dir.join("project.json");
        let mut migrated_from = None;
        let (project, outcome) = if file.exists() {
            match std::fs::read(&file)
                .map_err(Into::into)
                .and_then(|b| Ok((stored_format(&b), parse_project(&b)?)))
            {
                Ok((format, p)) => {
                    migrated_from = (format < PROJECT_FORMAT).then_some(format);
                    (p, LoadOutcome::Loaded)
                }
                // Saved by a newer version: leave it alone rather than "recover" over it.
                Err(e @ crate::error::AppError::User(_)) => return Err(e),
                Err(_) => {
                    let ts = now_ms();
                    let _ =
                        std::fs::rename(&file, dir.join(format!("project.unreadable-{ts}.json")));
                    match recover().or_else(|| newest_old_snapshot(dir)) {
                        Some((p, name)) => (p, LoadOutcome::RecoveredFromBackup(name)),
                        None => (Project::starter(), LoadOutcome::StartedFresh),
                    }
                }
            }
        } else {
            (Project::starter(), LoadOutcome::Created)
        };
        let store = ProjectStore {
            dir: dir.to_path_buf(),
            project: RwLock::new(project),
            migrated_from,
            dirty: std::sync::atomic::AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
            save_lock: std::sync::Mutex::new(()),
        };
        if outcome != LoadOutcome::Loaded {
            store.save()?;
        }
        Ok((store, outcome))
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.dir.join("assets")
    }

    /// Format of project.json when it was opened, when older than the current one.
    /// The file on disk stays in that format until the next save.
    pub fn migrated_from(&self) -> Option<u32> {
        self.migrated_from
    }

    pub fn read<R>(&self, f: impl FnOnce(&Project) -> R) -> R {
        f(&self.project.read().unwrap())
    }

    pub fn get(&self) -> Project {
        self.project.read().unwrap().clone()
    }

    /// Change the project in memory. Call `save` (or let the autosaver do it) afterwards.
    pub fn update<R>(&self, f: impl FnOnce(&mut Project) -> R) -> R {
        f(&mut self.project.write().unwrap())
    }

    pub fn replace(&self, mut project: Project) {
        project.normalize();
        *self.project.write().unwrap() = project;
    }

    /// Ask the autosaver to write the project soon.
    pub fn mark_dirty(&self) {
        self.dirty.store(true, std::sync::atomic::Ordering::SeqCst);
        self.changed.notify_one();
    }

    /// Save after changes settle (500 ms without further changes). Runs until the app exits.
    pub async fn autosave_loop(
        self: std::sync::Arc<Self>,
        on_error: impl Fn(String) + Send + 'static,
    ) {
        use std::sync::atomic::Ordering;
        loop {
            self.changed.notified().await;
            loop {
                tokio::select! {
                    _ = self.changed.notified() => continue,
                    _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => break,
                }
            }
            if self.dirty.swap(false, Ordering::SeqCst) {
                let me = self.clone();
                let result = tokio::task::spawn_blocking(move || me.save()).await;
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        self.dirty.store(true, Ordering::SeqCst);
                        on_error(e.to_string());
                    }
                    Err(e) => on_error(e.to_string()),
                }
            }
        }
    }

    /// Write now if anything is waiting to be saved (used on exit).
    pub fn flush(&self) -> AppResult<()> {
        if self.dirty.swap(false, std::sync::atomic::Ordering::SeqCst) {
            self.save()?;
        }
        Ok(())
    }

    pub fn save(&self) -> AppResult<()> {
        let _guard = self.save_lock.lock().unwrap_or_else(|e| e.into_inner());
        self.write_file()
    }

    fn write_file(&self) -> AppResult<()> {
        let json = serde_json::to_vec_pretty(&*self.project.read().unwrap())?;
        write_atomic(&self.dir.join("project.json"), &json)?;
        Ok(())
    }

    /// Replace the project and save it. If saving fails, the old project is kept.
    pub fn restore(&self, mut project: Project) -> AppResult<()> {
        project.normalize();
        let _guard = self.save_lock.lock().unwrap_or_else(|e| e.into_inner());
        let old = std::mem::replace(&mut *self.project.write().unwrap(), project);
        if let Err(e) = self.write_file() {
            *self.project.write().unwrap() = old;
            return Err(e);
        }
        Ok(())
    }

    pub fn load_variables(&self) -> serde_json::Map<String, serde_json::Value> {
        std::fs::read(self.dir.join("variables.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save_variables(
        &self,
        vars: &serde_json::Map<String, serde_json::Value>,
    ) -> AppResult<()> {
        write_atomic(
            &self.dir.join("variables.json"),
            &serde_json::to_vec_pretty(vars)?,
        )?;
        Ok(())
    }

    pub fn assets(&self) -> Vec<AssetInfo> {
        let mut out = Vec::new();
        if let Ok(rd) = std::fs::read_dir(self.assets_dir()) {
            for entry in rd.flatten() {
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                out.push(AssetInfo {
                    path: format!("assets/{name}"),
                    kind: asset_kind(&name).into(),
                    bytes: meta.len(),
                    name,
                });
            }
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        out
    }

    /// Copy a file into `assets/`, renaming it if the name is taken. Returns the new asset.
    /// The copy streams through a hidden temp file, so a failed or oversized copy leaves nothing behind.
    pub fn import_asset(&self, source: &Path) -> AppResult<AssetInfo> {
        self.import_asset_capped(source, MAX_ASSET_BYTES)
    }

    fn import_asset_capped(&self, source: &Path, max: u64) -> AppResult<AssetInfo> {
        use std::io::{Read, Write};
        let meta = std::fs::metadata(source)?;
        if !meta.is_file() {
            return user_err("That isn't a file.");
        }
        let original = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if meta.len() > max {
            return too_big(&original, meta.len(), max);
        }
        let Some(cleaned) = clean_asset_name(&original) else {
            return user_err("That file name can't be used.");
        };
        let (stem, ext) = match cleaned.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
            _ => (cleaned.clone(), String::new()),
        };
        let dir = self.assets_dir();
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!(".import-{}", crate::util::new_id()));
        let copied = (|| -> std::io::Result<u64> {
            let mut from = std::io::BufReader::new(std::fs::File::open(source)?);
            let mut to = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
            // The file may grow while it's copied; stop one byte past the cap.
            let n = std::io::copy(&mut (&mut from).take(max + 1), &mut to)?;
            to.flush()?;
            Ok(n)
        })();
        let bytes = match copied {
            Ok(n) if n <= max => n,
            Ok(n) => {
                let _ = std::fs::remove_file(&tmp);
                return too_big(&original, n, max);
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return Err(e.into());
            }
        };
        let mut name = cleaned;
        let mut n = 2;
        while dir.join(&name).exists() {
            name = format!("{stem}-{n}{ext}");
            n += 1;
        }
        if let Err(e) = std::fs::rename(&tmp, dir.join(&name)) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(AssetInfo {
            path: format!("assets/{name}"),
            kind: asset_kind(&name).into(),
            bytes,
            name,
        })
    }

    pub fn delete_asset(&self, name: &str) -> AppResult<()> {
        let Some(name) = safe_file_name(name) else {
            return user_err("Invalid asset name.");
        };
        let p = self.assets_dir().join(name);
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        Ok(())
    }

    /// Resolve `assets/<name>` safely; None if it would leave the assets folder.
    pub fn asset_path(&self, name: &str) -> Option<PathBuf> {
        let name = safe_file_name(name)?;
        let p = self.assets_dir().join(name);
        p.is_file().then_some(p)
    }
}

/// Read project JSON: newer formats are refused, older ones converted.
/// Opening a project and restoring a backup both go through here.
pub fn parse_project(bytes: &[u8]) -> AppResult<Project> {
    let mut p: Project = serde_json::from_slice(bytes)?;
    if p.format > PROJECT_FORMAT {
        return user_err(
            "This project was saved by a newer version of Castwright. Install the latest version to open it.",
        );
    }
    p.normalize();
    Ok(p)
}

fn stored_format(bytes: &[u8]) -> u32 {
    #[derive(serde::Deserialize)]
    struct F {
        format: Option<u32>,
    }
    serde_json::from_slice::<F>(bytes)
        .ok()
        .and_then(|f| f.format)
        .unwrap_or(PROJECT_FORMAT)
}

/// Copies older versions kept in `snapshots/`, used only when there's no backup.
fn newest_old_snapshot(dir: &Path) -> Option<(Project, String)> {
    let mut files: Vec<String> = std::fs::read_dir(dir.join("snapshots"))
        .ok()?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|f| f.starts_with("project-") && f.ends_with(".json"))
        .collect();
    files.sort_by(|a, b| b.cmp(a));
    files.into_iter().find_map(|f| {
        let bytes = std::fs::read(dir.join("snapshots").join(&f)).ok()?;
        parse_project(&bytes).ok().map(|p| (p, f))
    })
}

/// Longest asset name kept, in characters (before a "-2" suffix).
const MAX_NAME_CHARS: usize = 120;

/// A safe asset name: letters, digits, `.`, `-` and `_`, with a lowercase extension.
fn clean_asset_name(original: &str) -> Option<String> {
    let cleaned: String = original
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.');
    let (stem, ext) = match cleaned.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => (s, format!(".{}", e.to_lowercase())),
        _ => (cleaned, String::new()),
    };
    let stem: String = stem.chars().take(MAX_NAME_CHARS).collect();
    safe_file_name(&format!("{stem}{ext}"))
}

fn too_big<T>(name: &str, bytes: u64, max: u64) -> AppResult<T> {
    const MB: u64 = 1024 * 1024;
    user_err(format!(
        "\"{name}\" is {} MB. Files can be up to {} MB.",
        bytes.div_ceil(MB),
        max / MB
    ))
}

pub fn asset_kind(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "apng" => "image",
        "webm" | "mp4" | "mov" | "m4v" => "video",
        "mp3" | "ogg" | "wav" | "m4a" | "aac" | "flac" | "opus" => "audio",
        "ttf" | "otf" | "woff" | "woff2" => "font",
        "json" => "lottie",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_then_loads() {
        let dir = tempfile::tempdir().unwrap();
        let (s, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(outcome, LoadOutcome::Created);
        s.update(|p| p.name = "Saturday".into());
        s.save().unwrap();
        let (s2, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert_eq!(s2.get().name, "Saturday");
    }

    #[test]
    fn recovers_from_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        ProjectStore::open(dir.path()).unwrap();
        std::fs::write(dir.path().join("project.json"), b"{ not json").unwrap();
        let recover = || {
            let mut p = Project::starter();
            p.name = "Good".into();
            Some((p, "b.cwbackup".to_string()))
        };
        let (s2, outcome) = ProjectStore::open_with(dir.path(), &recover).unwrap();
        assert_eq!(
            outcome,
            LoadOutcome::RecoveredFromBackup("b.cwbackup".into())
        );
        assert_eq!(s2.get().name, "Good");
        let kept = std::fs::read_dir(dir.path()).unwrap().flatten().any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("project.unreadable-")
        });
        assert!(kept, "the unreadable file is kept for the user");
    }

    #[test]
    fn falls_back_to_old_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let snaps = dir.path().join("snapshots");
        std::fs::create_dir_all(&snaps).unwrap();
        for (ts, name) in [
            (1_700_000_000_000_i64, "Older"),
            (1_700_000_100_000, "Newer"),
        ] {
            let mut p = Project::starter();
            p.name = name.into();
            std::fs::write(
                snaps.join(format!("project-{ts}.json")),
                serde_json::to_vec(&p).unwrap(),
            )
            .unwrap();
        }
        std::fs::write(dir.path().join("project.json"), b"garbage").unwrap();
        let (s, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert!(matches!(outcome, LoadOutcome::RecoveredFromBackup(_)));
        assert_eq!(s.get().name, "Newer");
    }

    #[test]
    fn corrupt_with_no_snapshots_starts_fresh() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("project.json"), b"garbage").unwrap();
        let (s, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(outcome, LoadOutcome::StartedFresh);
        assert!(!s.get().overlays.is_empty());
    }

    #[test]
    fn restore_replaces_and_saves() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        let mut p = Project::starter();
        p.name = "Restored".into();
        s.restore(p).unwrap();
        let (s2, _) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(s2.get().name, "Restored");
    }

    #[test]
    fn failed_restore_keeps_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        s.update(|p| p.name = "Current".into());
        let file = dir.path().join("project.json");
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        assert!(s.restore(Project::default()).is_err());
        assert_eq!(s.get().name, "Current");
    }

    #[test]
    fn assets() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        let src = dir.path().join("my logo!.png");
        std::fs::write(&src, b"png").unwrap();
        let a = s.import_asset(&src).unwrap();
        assert_eq!(a.name, "my-logo-.png");
        assert_eq!(a.kind, "image");
        let b = s.import_asset(&src).unwrap();
        assert_eq!(b.name, "my-logo--2.png");
        assert_eq!(s.assets().len(), 2);
        assert!(s.asset_path("my-logo-.png").is_some());
        assert!(s.asset_path("../project.json").is_none());
        s.delete_asset(&a.name).unwrap();
        assert_eq!(s.assets().len(), 1);
    }

    #[test]
    fn imports_odd_named_videos() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        let src_dir = dir.path().join("my clips (2026)");
        std::fs::create_dir_all(&src_dir).unwrap();
        let body: Vec<u8> = (0..3 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
        for (file, want) in [
            (
                "Follow Alert ünï 🎉 final.MP4",
                "Follow-Alert-ünï---final.mp4",
            ),
            ("..hidden.webm", "hidden.webm"),
            (
                &format!("{}.webm", "x".repeat(200)),
                &format!("{}.webm", "x".repeat(120)),
            ),
        ] {
            let src = src_dir.join(file);
            std::fs::write(&src, &body).unwrap();
            let a = s.import_asset(&src).unwrap();
            assert_eq!(a.name, want);
            assert_eq!(a.kind, "video");
            assert_eq!(a.bytes, body.len() as u64);
            assert_eq!(std::fs::read(s.asset_path(&a.name).unwrap()).unwrap(), body);
        }
        assert_eq!(s.assets().len(), 3, "no temp files listed");
    }

    #[test]
    fn refuses_files_over_the_limit_and_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        let src = dir.path().join("huge stream.mp4");
        // Sparse, so it takes no real disk space.
        std::fs::File::create(&src)
            .unwrap()
            .set_len(MAX_ASSET_BYTES + 1)
            .unwrap();
        let err = s.import_asset(&src).unwrap_err().to_string();
        assert!(err.contains("up to 512 MB"), "{err}");

        let small = dir.path().join("clip.webm");
        std::fs::write(&small, vec![7u8; 4096]).unwrap();
        let err = s.import_asset_capped(&small, 1000).unwrap_err().to_string();
        assert!(err.contains("\"clip.webm\" is 1 MB"), "{err}");
        let left: Vec<_> = std::fs::read_dir(s.assets_dir())
            .map(|rd| rd.flatten().map(|e| e.file_name()).collect())
            .unwrap_or_default();
        assert!(left.is_empty(), "{left:?}");
    }

    #[tokio::test(start_paused = true)]
    async fn autosave_debounces() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        let s = std::sync::Arc::new(s);
        tokio::spawn(s.clone().autosave_loop(|e| panic!("{e}")));
        s.update(|p| p.name = "One".into());
        s.mark_dirty();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        s.update(|p| p.name = "Two".into());
        s.mark_dirty();
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
        // spawn_blocking runs on a real thread; give it a moment
        for _ in 0..50 {
            let on_disk: Project =
                serde_json::from_slice(&std::fs::read(dir.path().join("project.json")).unwrap())
                    .unwrap();
            if on_disk.name == "Two" {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        panic!("project was not autosaved");
    }

    #[test]
    fn flush_saves_pending_changes() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        s.update(|p| p.name = "Pending".into());
        s.mark_dirty();
        s.flush().unwrap();
        let (s2, _) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(s2.get().name, "Pending");
    }

    #[test]
    fn rejects_newer_format() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = serde_json::to_value(Project::starter()).unwrap();
        p["format"] = 999.into();
        let file = dir.path().join("project.json");
        std::fs::write(&file, serde_json::to_vec(&p).unwrap()).unwrap();
        assert!(ProjectStore::open(dir.path()).is_err());
        // Left untouched for the newer version.
        assert_eq!(
            std::fs::read(&file).unwrap(),
            serde_json::to_vec(&p).unwrap()
        );
    }

    #[test]
    fn converts_step_lists_from_format_1() {
        let dir = tempfile::tempdir().unwrap();
        let old = serde_json::json!({
            "format": 1,
            "name": "Old",
            "actions": [{
                "id": "a1",
                "name": "Deaths",
                "triggers": [{ "type": "command", "name": "death" }],
                "steps": [
                    { "type": "add_to_variable", "key": "deaths", "amount": 1 },
                    { "type": "if", "conditions": { "mode": "all", "conditions": [] },
                      "then": [{ "type": "log", "message": "yes" }], "else": [] },
                    { "type": "chat_send", "message": "Deaths: {{deaths}}" }
                ]
            }]
        });
        std::fs::write(
            dir.path().join("project.json"),
            serde_json::to_vec(&old).unwrap(),
        )
        .unwrap();
        let (s, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert_eq!(s.migrated_from(), Some(1));
        let p = s.get();
        assert_eq!(p.format, crate::model::project::PROJECT_FORMAT);
        let a = &p.actions[0];
        assert!(a.steps.is_empty());
        assert_eq!(a.graph.nodes.len(), 5);
        assert_eq!(a.graph.edges.len(), 5);
        assert_eq!(a.triggers.len(), 1);
        // Saved in the new form; reading it again changes nothing.
        s.save().unwrap();
        let (s2, _) = ProjectStore::open(dir.path()).unwrap();
        assert_eq!(s2.migrated_from(), None);
        assert_eq!(s2.get(), p);
        let raw: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("project.json")).unwrap())
                .unwrap();
        assert_eq!(raw["format"], 2);
    }

    #[test]
    fn variables_file() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        assert!(s.load_variables().is_empty());
        let mut m = serde_json::Map::new();
        m.insert("a".into(), 1.into());
        s.save_variables(&m).unwrap();
        assert_eq!(s.load_variables()["a"], 1);
    }
}
