//! Project backups: one `.cwbackup` zip per backup in the app data `backups/` folder.
//! A backup holds `project.json` and `variables.json`. Settings, secrets, history
//! and assets are never included.

use crate::error::{AppError, AppResult, user_err};
use crate::model::project::Project;
use crate::model::settings::BackupSettings;
use crate::util::{now_ms, safe_file_name};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use ts_rs::TS;

pub const EXT: &str = "cwbackup";
const KIND: &str = "castwright-backup";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_PROJECT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_VARIABLES_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BackupReason {
    Startup,
    Daily,
    Manual,
    BeforeRestore,
    BeforeImport,
    BeforeMigration,
    BeforeRename,
}

impl BackupReason {
    const ALL: [BackupReason; 7] = [
        BackupReason::Startup,
        BackupReason::Daily,
        BackupReason::Manual,
        BackupReason::BeforeRestore,
        BackupReason::BeforeImport,
        BackupReason::BeforeMigration,
        BackupReason::BeforeRename,
    ];

    fn slug(self) -> &'static str {
        match self {
            BackupReason::Startup => "startup",
            BackupReason::Daily => "daily",
            BackupReason::Manual => "manual",
            BackupReason::BeforeRestore => "before-restore",
            BackupReason::BeforeImport => "before-import",
            BackupReason::BeforeMigration => "before-migration",
            BackupReason::BeforeRename => "before-rename",
        }
    }

    /// Startup and daily backups are kept one per day. The rest are kept by count.
    fn is_daily(self) -> bool {
        matches!(self, BackupReason::Startup | BackupReason::Daily)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct BackupInfo {
    pub file: String,
    #[ts(type = "number")]
    pub ts: i64,
    pub reason: BackupReason,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Project name at the time. Empty when the file can't be read.
    pub project: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    kind: String,
    app_version: String,
    ts: i64,
    reason: BackupReason,
    project: String,
    format: u32,
    /// Which project folder it came from (a hash, not the path).
    source: String,
    /// Content hash, to skip backups when nothing changed.
    hash: String,
}

struct Entry {
    info: BackupInfo,
    manifest: Option<Manifest>,
}

/// What goes into a backup.
pub struct BackupContent {
    pub project_json: Vec<u8>,
    pub variables_json: Vec<u8>,
    pub project_name: String,
    pub format: u32,
}

impl BackupContent {
    pub fn new(project: &Project, variables: &Map<String, Value>) -> AppResult<Self> {
        Ok(BackupContent {
            project_json: serde_json::to_vec_pretty(project)?,
            variables_json: serde_json::to_vec_pretty(variables)?,
            project_name: project.name.clone(),
            format: project.format,
        })
    }

    fn hash(&self) -> String {
        let mut h = Sha256::new();
        for part in [&self.project_json, &self.variables_json] {
            h.update((part.len() as u64).to_le_bytes());
            h.update(part);
        }
        hex(&h.finalize()[..16])
    }
}

/// A backup read back from disk.
pub struct Loaded {
    pub project: Project,
    /// None for a plain `project.json`, which has no variables.
    pub variables: Option<Map<String, Value>>,
}

/// Short id for a project folder, so backups of different projects can share one folder.
pub fn source_id(project_dir: &Path) -> String {
    let p = std::fs::canonicalize(project_dir).unwrap_or_else(|_| project_dir.to_path_buf());
    let mut s = p.to_string_lossy().into_owned();
    if cfg!(windows) {
        s = s.to_lowercase();
    }
    hex(&Sha256::digest(s.as_bytes())[..8])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Backups {
    dir: PathBuf,
    /// One change to the folder at a time.
    lock: Mutex<()>,
}

impl Backups {
    pub fn new(dir: PathBuf) -> Backups {
        Backups {
            dir,
            lock: Mutex::new(()),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Newest first.
    pub fn list(&self) -> Vec<BackupInfo> {
        self.entries().into_iter().map(|e| e.info).collect()
    }

    /// The newest backup of one project folder.
    pub fn newest(&self, source: &str) -> Option<BackupInfo> {
        self.entries()
            .into_iter()
            .find(|e| e.manifest.as_ref().is_some_and(|m| m.source == source))
            .map(|e| e.info)
    }

    fn entries(&self) -> Vec<Entry> {
        let mut out = Vec::new();
        let Ok(rd) = std::fs::read_dir(&self.dir) else {
            return out;
        };
        for entry in rd.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            if file.starts_with('.') || !file.ends_with(&format!(".{EXT}")) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let manifest = read_manifest(&entry.path()).ok();
            let info = match &manifest {
                Some(m) => BackupInfo {
                    file,
                    ts: m.ts,
                    reason: m.reason,
                    bytes: meta.len(),
                    project: m.project.clone(),
                },
                None => BackupInfo {
                    ts: meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0),
                    reason: BackupReason::ALL
                        .into_iter()
                        .find(|r| file.contains(&format!("_{}", r.slug())))
                        .unwrap_or(BackupReason::Manual),
                    bytes: meta.len(),
                    project: String::new(),
                    file,
                },
            };
            out.push(Entry { info, manifest });
        }
        out.sort_by(|a, b| {
            b.info
                .ts
                .cmp(&a.info.ts)
                .then(b.info.file.cmp(&a.info.file))
        });
        out
    }

    /// Write a backup and prune old ones. None when nothing changed since the
    /// newest backup of the same project.
    pub fn create(
        &self,
        content: &BackupContent,
        reason: BackupReason,
        source: &str,
        keep: &BackupSettings,
    ) -> AppResult<Option<BackupInfo>> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let hash = content.hash();
        let entries = self.entries();
        let newest = entries
            .iter()
            .filter_map(|e| e.manifest.as_ref())
            .find(|m| m.source == source);
        if newest.is_some_and(|m| m.hash == hash) {
            return Ok(None);
        }
        std::fs::create_dir_all(&self.dir)?;
        // Never older than the newest, so "newest" stays the last one written.
        let ts = now_ms().max(entries.first().map(|e| e.info.ts + 1).unwrap_or(0));
        let stamp = crate::commands::format_rfc3339(ts)
            .replace(':', "-")
            .replace('T', "_");
        let mut file = format!("{stamp}_{}.{EXT}", reason.slug());
        let mut n = 2;
        while self.dir.join(&file).exists() {
            file = format!("{stamp}_{}-{n}.{EXT}", reason.slug());
            n += 1;
        }
        let manifest = Manifest {
            kind: KIND.into(),
            app_version: env!("CARGO_PKG_VERSION").into(),
            ts,
            reason,
            project: content.project_name.clone(),
            format: content.format,
            source: source.into(),
            hash,
        };
        let path = self.dir.join(&file);
        write_zip(&path, &manifest, content)?;
        let bytes = std::fs::metadata(&path)?.len();
        self.prune_locked(keep);
        Ok(Some(BackupInfo {
            file,
            ts,
            reason,
            bytes,
            project: manifest.project,
        }))
    }

    pub fn prune(&self, keep: &BackupSettings) {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.prune_locked(keep);
    }

    /// Per project: the newest startup or daily backup of each of the last
    /// `keep_daily` days, plus the newest `keep_other` of the rest.
    /// Files that can't be read are left alone.
    fn prune_locked(&self, keep: &BackupSettings) {
        if let Ok(rd) = std::fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                if e.file_name()
                    .to_string_lossy()
                    .ends_with(&format!(".{EXT}.part"))
                {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
        let entries = self.entries();
        let mut sources: Vec<&str> = entries
            .iter()
            .filter_map(|e| e.manifest.as_ref().map(|m| m.source.as_str()))
            .collect();
        sources.sort_unstable();
        sources.dedup();
        for source in sources {
            let mine = || {
                entries
                    .iter()
                    .filter(move |e| e.manifest.as_ref().is_some_and(|m| m.source == source))
            };
            let mut days: Vec<i64> = Vec::new();
            for e in mine().filter(|e| e.info.reason.is_daily()) {
                let day = e.info.ts.div_euclid(DAY_MS);
                if days.last() != Some(&day) && days.len() < keep.keep_daily as usize {
                    days.push(day);
                    continue;
                }
                let _ = std::fs::remove_file(self.dir.join(&e.info.file));
            }
            for e in mine()
                .filter(|e| !e.info.reason.is_daily())
                .skip(keep.keep_other as usize)
            {
                let _ = std::fs::remove_file(self.dir.join(&e.info.file));
            }
        }
    }

    /// Full path of a backup in the folder, checked so it can't point elsewhere.
    pub fn path_of(&self, file: &str) -> AppResult<PathBuf> {
        let Some(name) = safe_file_name(file).filter(|n| n.ends_with(&format!(".{EXT}"))) else {
            return user_err("Invalid backup name.");
        };
        let p = self.dir.join(&name);
        if !p.is_file() {
            return Err(AppError::NotFound(name));
        }
        Ok(p)
    }

    pub fn delete(&self, file: &str) -> AppResult<()> {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        std::fs::remove_file(self.path_of(file)?)?;
        Ok(())
    }

    /// Copy a backup to `dest`, replacing a file already there.
    pub fn export(&self, file: &str, dest: &Path) -> AppResult<()> {
        let src = self.path_of(file)?;
        let bytes = std::fs::read(src)?;
        crate::util::write_atomic(dest, &bytes)?;
        Ok(())
    }

    /// Newest readable project among the backups of `source` (used to recover a broken project.json).
    pub fn newest_good(&self, source: &str) -> Option<(Project, String)> {
        self.entries()
            .into_iter()
            .filter(|e| e.manifest.as_ref().is_some_and(|m| m.source == source))
            .find_map(|e| {
                read_file(&self.dir.join(&e.info.file))
                    .ok()
                    .map(|l| (l.project, e.info.file))
            })
    }
}

fn write_zip(path: &Path, manifest: &Manifest, content: &BackupContent) -> AppResult<()> {
    let tmp = path.with_extension(format!("{EXT}.part"));
    let result = (|| -> AppResult<()> {
        let file = std::fs::File::create(&tmp)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in [
            ("backup.json", serde_json::to_vec_pretty(manifest)?),
            ("project.json", content.project_json.clone()),
            ("variables.json", content.variables_json.clone()),
        ] {
            zip.start_file(name, opts).map_err(zip_err)?;
            zip.write_all(&bytes)?;
        }
        zip.finish().map_err(zip_err)?.sync_all()?;
        Ok(())
    })();
    match result.and_then(|()| Ok(std::fs::rename(&tmp, path)?)) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn read_manifest(path: &Path) -> AppResult<Manifest> {
    let mut zip = open_zip(path)?;
    let bytes = read_entry(&mut zip, "backup.json", MAX_MANIFEST_BYTES)?
        .ok_or_else(|| AppError::User("No backup.json".into()))?;
    let m: Manifest = serde_json::from_slice(&bytes)?;
    if m.kind != KIND {
        return user_err("Not a Castwright backup.");
    }
    Ok(m)
}

fn open_zip(path: &Path) -> AppResult<zip::ZipArchive<std::fs::File>> {
    let file = std::fs::File::open(path)?;
    zip::ZipArchive::new(file).map_err(zip_err)
}

fn read_entry(
    zip: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
    cap: u64,
) -> AppResult<Option<Vec<u8>>> {
    let mut entry = match zip.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(zip_err(e)),
    };
    let mut buf = Vec::new();
    entry.by_ref().take(cap + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > cap {
        return user_err("The backup is too large.");
    }
    Ok(Some(buf))
}

/// Read a `.cwbackup`, or a plain `project.json`, the same way a project is opened:
/// newer formats are refused and older ones converted.
pub fn read_file(path: &Path) -> AppResult<Loaded> {
    let mut head = [0u8; 2];
    let n = std::fs::File::open(path)?.read(&mut head)?;
    if n == 2 && &head == b"PK" {
        let mut zip = open_zip(path)?;
        let Some(project) = read_entry(&mut zip, "project.json", MAX_PROJECT_BYTES)? else {
            return user_err("That file isn't a Castwright backup.");
        };
        let project = parse(&project)?;
        let variables = match read_entry(&mut zip, "variables.json", MAX_VARIABLES_BYTES)? {
            Some(b) => Some(serde_json::from_slice(&b).map_err(|e| {
                AppError::User(format!("The variables in that backup can't be read: {e}"))
            })?),
            None => None,
        };
        return Ok(Loaded { project, variables });
    }
    if std::fs::metadata(path)?.len() > MAX_PROJECT_BYTES {
        return user_err("That file is too large to be a project.");
    }
    let project = parse(&std::fs::read(path)?)?;
    Ok(Loaded {
        project,
        variables: None,
    })
}

fn parse(bytes: &[u8]) -> AppResult<Project> {
    crate::store::project::parse_project(bytes).map_err(|e| match e {
        AppError::User(_) => e,
        e => AppError::User(format!("That backup can't be read: {e}")),
    })
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::User(format!("That backup can't be read: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keep(daily: u32, other: u32) -> BackupSettings {
        BackupSettings {
            keep_daily: daily,
            keep_other: other,
        }
    }

    fn content(name: &str) -> BackupContent {
        let p = Project {
            name: name.into(),
            ..Project::default()
        };
        let mut vars = Map::new();
        vars.insert("counter.deaths".into(), 3.into());
        BackupContent::new(&p, &vars).unwrap()
    }

    /// Write a backup as if it was made at `ts`.
    fn backdated(b: &Backups, name: &str, reason: BackupReason, ts: i64) {
        let info = b
            .create(&content(name), reason, "src", &keep(1000, 1000))
            .unwrap()
            .unwrap();
        let path = b.dir().join(&info.file);
        let mut m = read_manifest(&path).unwrap();
        m.ts = ts;
        std::fs::remove_file(&path).unwrap();
        write_zip(
            &b.dir().join(format!("{ts}_{}.{EXT}", reason.slug())),
            &m,
            &content(name),
        )
        .unwrap();
    }

    #[test]
    fn creates_and_lists() {
        let dir = tempfile::tempdir().unwrap();
        let b = Backups::new(dir.path().join("backups"));
        assert!(b.list().is_empty());
        let info = b
            .create(&content("Show"), BackupReason::Startup, "src", &keep(14, 5))
            .unwrap()
            .unwrap();
        assert!(info.file.ends_with("_startup.cwbackup"), "{}", info.file);
        assert!(!info.file.contains(':'), "no colons, for Windows");
        assert_eq!(b.list(), vec![info.clone()]);
        assert_eq!(b.list()[0].project, "Show");
        let loaded = read_file(&b.path_of(&info.file).unwrap()).unwrap();
        assert_eq!(loaded.project.name, "Show");
        assert_eq!(loaded.variables.unwrap()["counter.deaths"], 3);
        let leftovers = std::fs::read_dir(b.dir()).unwrap().count();
        assert_eq!(leftovers, 1, "no temporary files left");
    }

    #[test]
    fn skips_when_nothing_changed() {
        let dir = tempfile::tempdir().unwrap();
        let b = Backups::new(dir.path().to_path_buf());
        let k = keep(14, 5);
        assert!(
            b.create(&content("A"), BackupReason::Startup, "src", &k)
                .unwrap()
                .is_some()
        );
        assert!(
            b.create(&content("A"), BackupReason::Daily, "src", &k)
                .unwrap()
                .is_none()
        );
        assert!(
            b.create(&content("A"), BackupReason::Manual, "src", &k)
                .unwrap()
                .is_none()
        );
        // Another project folder with the same content still gets its own.
        assert!(
            b.create(&content("A"), BackupReason::Startup, "other", &k)
                .unwrap()
                .is_some()
        );
        assert!(
            b.create(&content("B"), BackupReason::Manual, "src", &k)
                .unwrap()
                .is_some()
        );
        assert_eq!(b.list().len(), 3);
    }

    #[test]
    fn prunes_per_day_and_by_count() {
        let dir = tempfile::tempdir().unwrap();
        let b = Backups::new(dir.path().to_path_buf());
        let day0 = 20_000 * DAY_MS;
        for d in 0..20 {
            // Two a day; only the later one of each day survives.
            backdated(
                &b,
                &format!("d{d}a"),
                BackupReason::Startup,
                day0 + d * DAY_MS + 1000,
            );
            backdated(
                &b,
                &format!("d{d}b"),
                BackupReason::Daily,
                day0 + d * DAY_MS + 2000,
            );
        }
        for i in 0..8 {
            backdated(
                &b,
                &format!("o{i}"),
                BackupReason::BeforeRestore,
                day0 + i * 10,
            );
        }
        // A file that can't be read is never deleted automatically.
        std::fs::write(dir.path().join("broken_manual.cwbackup"), b"nope").unwrap();
        b.prune(&keep(14, 5));
        let list = b.list();
        let daily: Vec<_> = list.iter().filter(|i| i.reason.is_daily()).collect();
        assert_eq!(daily.len(), 14);
        assert!(daily.iter().all(|i| i.reason == BackupReason::Daily));
        assert_eq!(daily[0].project, "d19b");
        assert_eq!(daily[13].project, "d6b");
        let other: Vec<_> = list
            .iter()
            .filter(|i| !i.reason.is_daily() && !i.project.is_empty())
            .map(|i| i.project.as_str())
            .collect();
        assert_eq!(other, vec!["o7", "o6", "o5", "o4", "o3"]);
        assert!(list.iter().any(|i| i.file == "broken_manual.cwbackup"));
    }

    #[test]
    fn delete_and_export_check_names() {
        let dir = tempfile::tempdir().unwrap();
        let b = Backups::new(dir.path().join("backups"));
        let info = b
            .create(&content("A"), BackupReason::Manual, "src", &keep(14, 5))
            .unwrap()
            .unwrap();
        let out = dir.path().join("copy.cwbackup");
        b.export(&info.file, &out).unwrap();
        assert_eq!(read_file(&out).unwrap().project.name, "A");
        std::fs::write(dir.path().join("secret.txt"), b"x").unwrap();
        for bad in ["../secret.txt", "..\\secret.txt", "secret.txt", ""] {
            assert!(b.delete(bad).is_err(), "{bad}");
            assert!(b.export(bad, &out).is_err(), "{bad}");
        }
        assert!(dir.path().join("secret.txt").exists());
        b.delete(&info.file).unwrap();
        assert!(b.list().is_empty());
    }

    #[test]
    fn reads_plain_project_json_and_rejects_junk() {
        let dir = tempfile::tempdir().unwrap();
        let json = dir.path().join("project.json");
        std::fs::write(&json, serde_json::to_vec(&Project::starter()).unwrap()).unwrap();
        let l = read_file(&json).unwrap();
        assert!(l.variables.is_none());
        let junk = dir.path().join("junk.cwbackup");
        std::fs::write(&junk, b"PK not really").unwrap();
        assert!(matches!(read_file(&junk), Err(AppError::User(_))));
        std::fs::write(&junk, b"{ nope").unwrap();
        assert!(matches!(read_file(&junk), Err(AppError::User(_))));
    }
}
