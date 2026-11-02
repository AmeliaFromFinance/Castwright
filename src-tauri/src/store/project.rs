//! The project folder: `project.json`, `variables.json`, `assets/` and `snapshots/`.

use crate::error::{AppError, AppResult, user_err};
use crate::model::project::Project;
use crate::util::{now_ms, safe_file_name, write_atomic};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use ts_rs::TS;

pub const MAX_SNAPSHOTS: usize = 20;
/// Automatic snapshots are taken at most this often.
pub const SNAPSHOT_EVERY_MS: i64 = 10 * 60 * 1000;
/// Largest asset accepted (images, video, audio).
pub const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SnapshotInfo {
    pub file: String,
    #[ts(type = "number")]
    pub ts: i64,
    #[ts(type = "number")]
    pub bytes: u64,
}

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
    /// project.json was unreadable; a snapshot was restored (file name given).
    RecoveredFromSnapshot(String),
    /// project.json and all snapshots were unreadable; a new project was started.
    StartedFresh,
}

pub struct ProjectStore {
    dir: PathBuf,
    project: RwLock<Project>,
    last_snapshot: RwLock<i64>,
    dirty: std::sync::atomic::AtomicBool,
    changed: tokio::sync::Notify,
    /// One save at a time, so an older write can't land after a newer one.
    save_lock: std::sync::Mutex<()>,
}

impl ProjectStore {
    pub fn open(dir: &Path) -> AppResult<(ProjectStore, LoadOutcome)> {
        std::fs::create_dir_all(dir)?;
        std::fs::create_dir_all(dir.join("assets"))?;
        std::fs::create_dir_all(dir.join("snapshots"))?;
        let file = dir.join("project.json");
        let (project, outcome) = if file.exists() {
            match read_project(&file) {
                Ok(p) => (p, LoadOutcome::Loaded),
                // Saved by a newer version: leave it alone rather than "recover" over it.
                Err(e @ crate::error::AppError::User(_)) => return Err(e),
                Err(_) => {
                    let ts = now_ms();
                    let _ =
                        std::fs::rename(&file, dir.join(format!("project.unreadable-{ts}.json")));
                    match Self::newest_good_snapshot(dir) {
                        Some((p, name)) => (p, LoadOutcome::RecoveredFromSnapshot(name)),
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
            last_snapshot: RwLock::new(0),
            dirty: std::sync::atomic::AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
            save_lock: std::sync::Mutex::new(()),
        };
        if outcome != LoadOutcome::Loaded {
            store.save()?;
        }
        Ok((store, outcome))
    }

    fn newest_good_snapshot(dir: &Path) -> Option<(Project, String)> {
        let mut snaps = list_snapshots(dir);
        snaps.sort_by_key(|s| std::cmp::Reverse(s.ts));
        snaps.into_iter().find_map(|s| {
            read_project(&dir.join("snapshots").join(&s.file))
                .ok()
                .map(|p| (p, s.file))
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn assets_dir(&self) -> PathBuf {
        self.dir.join("assets")
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
        let file = self.dir.join("project.json");
        let now = now_ms();
        let due = now - *self.last_snapshot.read().unwrap() >= SNAPSHOT_EVERY_MS;
        if due && file.exists() {
            self.snapshot_file(&file, now)?;
        }
        let json = serde_json::to_vec_pretty(&*self.project.read().unwrap())?;
        write_atomic(&file, &json)?;
        Ok(())
    }

    /// Copy the saved project into `snapshots/` now, regardless of timing.
    pub fn snapshot_now(&self) -> AppResult<()> {
        self.save()?;
        self.snapshot_file(&self.dir.join("project.json"), now_ms())
    }

    fn snapshot_file(&self, file: &Path, now: i64) -> AppResult<()> {
        let snaps = self.dir.join("snapshots");
        std::fs::create_dir_all(&snaps)?;
        let mut name = format!("project-{now}.json");
        let mut n = 1;
        while snaps.join(&name).exists() {
            name = format!("project-{now}-{n}.json");
            n += 1;
        }
        std::fs::copy(file, snaps.join(name))?;
        *self.last_snapshot.write().unwrap() = now;
        let mut all = list_snapshots(&self.dir);
        all.sort_by(|a, b| b.ts.cmp(&a.ts).then(b.file.cmp(&a.file)));
        for old in all.into_iter().skip(MAX_SNAPSHOTS) {
            let _ = std::fs::remove_file(snaps.join(old.file));
        }
        Ok(())
    }

    pub fn snapshots(&self) -> Vec<SnapshotInfo> {
        let mut s = list_snapshots(&self.dir);
        s.sort_by_key(|s| std::cmp::Reverse(s.ts));
        s
    }

    /// Load a snapshot as the current project. The current one is snapshotted first.
    pub fn restore_snapshot(&self, file: &str) -> AppResult<()> {
        let Some(name) = safe_file_name(file) else {
            return user_err("Invalid snapshot name.");
        };
        let path = self.dir.join("snapshots").join(&name);
        if !path.exists() {
            return Err(AppError::NotFound(name));
        }
        let p = read_project(&path)?;
        self.snapshot_now()?;
        self.replace(p);
        self.save()
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
    pub fn import_asset(&self, source: &Path) -> AppResult<AssetInfo> {
        let meta = std::fs::metadata(source)?;
        if !meta.is_file() {
            return user_err("That isn't a file.");
        }
        if meta.len() > MAX_ASSET_BYTES {
            return user_err("Files over 512 MB can't be added.");
        }
        let original = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
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
        let Some(cleaned) = safe_file_name(cleaned.trim_start_matches('.')) else {
            return user_err("That file name can't be used.");
        };
        let (stem, ext) = match cleaned.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
            _ => (cleaned.clone(), String::new()),
        };
        let dir = self.assets_dir();
        std::fs::create_dir_all(&dir)?;
        let mut name = cleaned.clone();
        let mut n = 2;
        while dir.join(&name).exists() {
            name = format!("{stem}-{n}{ext}");
            n += 1;
        }
        std::fs::copy(source, dir.join(&name))?;
        Ok(AssetInfo {
            path: format!("assets/{name}"),
            kind: asset_kind(&name).into(),
            bytes: meta.len(),
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

fn read_project(path: &Path) -> AppResult<Project> {
    let bytes = std::fs::read(path)?;
    let mut p: Project = serde_json::from_slice(&bytes)?;
    if p.format > crate::model::project::PROJECT_FORMAT {
        return user_err(
            "This project was saved by a newer version of Castwright. Install the latest version to open it.",
        );
    }
    p.normalize();
    Ok(p)
}

fn list_snapshots(dir: &Path) -> Vec<SnapshotInfo> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir.join("snapshots")) {
        for entry in rd.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = file
                .strip_prefix("project-")
                .and_then(|r| r.strip_suffix(".json"))
            else {
                continue;
            };
            let ts = rest
                .split('-')
                .next()
                .and_then(|t| t.parse::<i64>().ok())
                .unwrap_or(0);
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(SnapshotInfo { file, ts, bytes });
        }
    }
    out
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
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        s.update(|p| p.name = "Good".into());
        s.snapshot_now().unwrap();
        std::fs::write(dir.path().join("project.json"), b"{ not json").unwrap();
        let (s2, outcome) = ProjectStore::open(dir.path()).unwrap();
        assert!(matches!(outcome, LoadOutcome::RecoveredFromSnapshot(_)));
        assert_eq!(s2.get().name, "Good");
        let kept = std::fs::read_dir(dir.path()).unwrap().flatten().any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("project.unreadable-")
        });
        assert!(kept, "the unreadable file is kept for the user");
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
    fn snapshots_are_capped() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        for _ in 0..(MAX_SNAPSHOTS + 5) {
            s.snapshot_now().unwrap();
        }
        assert_eq!(s.snapshots().len(), MAX_SNAPSHOTS);
    }

    #[test]
    fn restore_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let (s, _) = ProjectStore::open(dir.path()).unwrap();
        s.update(|p| p.name = "Before".into());
        s.snapshot_now().unwrap();
        let file = s.snapshots()[0].file.clone();
        s.update(|p| p.name = "After".into());
        s.save().unwrap();
        s.restore_snapshot(&file).unwrap();
        assert_eq!(s.get().name, "Before");
        assert!(s.restore_snapshot("../project.json").is_err());
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
