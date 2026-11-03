//! Everything the running app owns, created once at startup.

use crate::alerts::AlertEngine;
use crate::automation::Automation;
use crate::error::{AppError, AppResult};
use crate::hub::{Hub, UiSink};
use crate::model::project::Project;
use crate::model::runtime::{LogLevel, OverlayMsg};
use crate::obs::ObsService;
use crate::server::OverlayServer;
use crate::store::backup::{BackupContent, BackupInfo, BackupReason, Backups};
use crate::store::db::Db;
use crate::store::project::{LoadOutcome, ProjectStore};
use crate::store::secrets::Secrets;
use crate::store::settings::SettingsStore;
use crate::twitch::TwitchService;
use crate::vars::Vars;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub struct Paths {
    pub config_dir: PathBuf,
    pub default_project_dir: PathBuf,
    pub backup_dir: PathBuf,
}

const DAY: Duration = Duration::from_secs(24 * 60 * 60);

pub struct Core {
    pub hub: Arc<Hub>,
    pub settings: Arc<SettingsStore>,
    pub secrets: Arc<Secrets>,
    pub project: Arc<ProjectStore>,
    pub backups: Arc<Backups>,
    pub alerts: Arc<AlertEngine>,
    pub automation: Arc<Automation>,
    pub server: Arc<OverlayServer>,
    pub twitch: Arc<TwitchService>,
    pub obs: Arc<ObsService>,
    pub paths: Paths,
}

impl Core {
    /// Open stores and start background services. Must run inside the tokio runtime.
    pub async fn start(paths: Paths, ui: Arc<dyn UiSink>) -> anyhow::Result<Arc<Core>> {
        std::fs::create_dir_all(&paths.config_dir)?;
        let settings = Arc::new(SettingsStore::open(paths.config_dir.join("settings.json")));
        let secrets = Arc::new(Secrets::new(paths.config_dir.join("secrets.json")));

        let wanted = settings.get().project_dir;
        let project_dir = if wanted.trim().is_empty() {
            paths.default_project_dir.clone()
        } else {
            PathBuf::from(wanted)
        };
        let backups = Arc::new(Backups::new(paths.backup_dir.clone()));
        let open = |dir: &Path| {
            let source = crate::store::backup::source_id(dir);
            ProjectStore::open_with(dir, &|| backups.newest_good(&source))
        };
        let (project, outcome, project_dir) = match open(&project_dir) {
            Ok((p, o)) => (p, o, project_dir),
            Err(e) => {
                tracing::error!("couldn't open project at {}: {e}", project_dir.display());
                let (p, o) = open(&paths.default_project_dir)?;
                (p, o, paths.default_project_dir.clone())
            }
        };
        let project = Arc::new(project);
        // The file on disk is still in the old format until the next save.
        let before_migration = project.migrated_from().and_then(|format| {
            Some(BackupContent {
                project_json: std::fs::read(project_dir.join("project.json")).ok()?,
                variables_json: std::fs::read(project_dir.join("variables.json"))
                    .unwrap_or_else(|_| b"{}".to_vec()),
                project_name: project.read(|p| p.name.clone()),
                format,
            })
        });

        let db = Arc::new(match Db::open(&project_dir.join("events.sqlite")) {
            Ok(db) => db,
            Err(e) => {
                tracing::error!("event history unavailable: {e}");
                Db::open_in_memory()
            }
        });
        let vars = Arc::new(Vars::new());
        vars.load(project.load_variables());
        let hub = Hub::new(ui, vars, db);

        match &outcome {
            LoadOutcome::RecoveredFromBackup(f) => hub.log(
                LogLevel::Warn,
                "project",
                format!("Your project file couldn't be read, so the backup {f} was restored. The unreadable file was kept in the project folder."),
            ),
            LoadOutcome::StartedFresh => hub.log(
                LogLevel::Error,
                "project",
                "Your project file couldn't be read and no backup worked, so a new project was started. The unreadable file was kept in the project folder.",
            ),
            _ => {}
        }
        if secrets.using_file() {
            hub.log(
                LogLevel::Warn,
                "secrets",
                "No system keychain found; sign-in details are stored in a private file instead.",
            );
        }

        let alerts = AlertEngine::new(hub.clone(), project.clone());
        alerts.use_settings(settings.clone());
        alerts.start();
        let automation = Automation::new(hub.clone(), project.clone(), alerts.clone());
        automation.start();

        let twitch = TwitchService::new(hub.clone(), secrets.clone(), settings.clone());
        automation.set_twitch(twitch.clone());
        twitch.start();
        {
            // Keep automation in step with Twitch: the bot account never triggers
            // commands, and timers know whether the stream is live.
            let twitch = twitch.clone();
            let automation = automation.clone();
            let hub_sync = hub.clone();
            crate::util::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_secs(5));
                loop {
                    tick.tick().await;
                    let st = twitch.status();
                    let (login, name, id) = st
                        .broadcaster
                        .as_ref()
                        .map(|b| (b.login.clone(), b.display_name.clone(), b.id.clone()))
                        .unwrap_or_default();
                    hub_sync.set_var("twitch.login", login.into(), false);
                    hub_sync.set_var("twitch.display_name", name.into(), false);
                    hub_sync.set_var("twitch.user_id", id.into(), false);
                    automation.set_ignored_users(st.bot.map(|b| vec![b.id]).unwrap_or_default());
                    automation.set_live(st.stream.live);
                }
            });
        }

        let obs = ObsService::new(hub.clone(), secrets.clone(), settings.clone());
        automation.set_obs(obs.clone());
        obs.start();

        let s = settings.get();
        let server = OverlayServer::new(
            hub.clone(),
            project.clone(),
            automation.clone(),
            s.server.token.clone(),
        );
        let info = server.start(s.server.port, s.server.allow_lan).await;
        match &info.error {
            Some(e) if info.running => hub.log(LogLevel::Warn, "server", e.clone()),
            Some(e) => hub.log(LogLevel::Error, "server", e.clone()),
            None => {}
        }

        {
            let hub2 = hub.clone();
            crate::util::spawn(project.clone().autosave_loop(move |e| {
                hub2.log(
                    LogLevel::Error,
                    "project",
                    format!("Couldn't save the project: {e}"),
                );
            }));
        }
        {
            let hub2 = hub.clone();
            let project2 = project.clone();
            crate::util::spawn(async move {
                let mut tick = tokio::time::interval(Duration::from_secs(1));
                loop {
                    tick.tick().await;
                    save_vars(&hub2, &project2);
                }
            });
        }

        let core = Arc::new(Core {
            hub,
            settings,
            secrets,
            project,
            backups,
            alerts,
            automation,
            server,
            twitch,
            obs,
            paths,
        });
        crate::util::spawn(core.clone().backup_loop(before_migration));
        Ok(core)
    }

    /// A backup on start (and before a format upgrade), then one a day while running.
    async fn backup_loop(self: Arc<Self>, before_migration: Option<BackupContent>) {
        if let Some(content) = before_migration {
            let me = self.clone();
            let r = tokio::task::spawn_blocking(move || {
                me.backups.create(
                    &content,
                    BackupReason::BeforeMigration,
                    &me.source(),
                    &me.settings.get().backups,
                )
            })
            .await;
            self.log_backup_error(r);
        }
        let mut reason = BackupReason::Startup;
        loop {
            let me = self.clone();
            let r = tokio::task::spawn_blocking(move || me.backup(reason)).await;
            self.log_backup_error(r);
            reason = BackupReason::Daily;
            tokio::time::sleep(DAY).await;
        }
    }

    fn log_backup_error<T>(&self, r: Result<AppResult<T>, tokio::task::JoinError>) {
        let err = match r {
            Ok(Ok(_)) => return,
            Ok(Err(e)) => e.to_string(),
            Err(e) => e.to_string(),
        };
        self.hub.log(
            LogLevel::Error,
            "backup",
            format!("Couldn't back up the project: {err}"),
        );
    }

    fn source(&self) -> String {
        crate::store::backup::source_id(self.project.dir())
    }

    /// Back up the current project, unsaved changes included. None when nothing
    /// changed since the last backup. Blocks; call it off the UI thread.
    pub fn backup(&self, reason: BackupReason) -> AppResult<Option<BackupInfo>> {
        let content = BackupContent::new(&self.project.get(), &self.hub.vars.saved())?;
        self.backups.create(
            &content,
            reason,
            &self.source(),
            &self.settings.get().backups,
        )
    }

    /// Load a backup file (or a plain project.json) as the project. The current
    /// project is backed up first. On any error the current project stays as it was.
    pub fn restore(&self, file: &Path, reason: BackupReason) -> AppResult<Project> {
        let loaded = crate::store::backup::read_file(file)?;
        self.backup(reason).map_err(|e| {
            AppError::User(format!(
                "Couldn't back up the current project first, so nothing was changed. {e}"
            ))
        })?;
        self.project.restore(loaded.project)?;
        if let Some(vars) = loaded.variables {
            let changes = self.hub.vars.replace_saved(vars);
            save_vars(&self.hub, &self.project);
            self.hub.broadcast_vars(changes);
        }
        let p = self.project.get();
        for o in &p.overlays {
            self.hub
                .to_overlays(Some(&o.id), OverlayMsg::Overlay { overlay: o.clone() });
        }
        self.hub
            .emit_ui(crate::hub::ui::PROJECT, &serde_json::json!({}));
        Ok(p)
    }

    /// Save everything that's pending. Called when the app exits.
    pub async fn shutdown(&self) {
        self.obs.shutdown().await;
        self.shutdown_sync();
    }

    fn shutdown_sync(&self) {
        if let Err(e) = self.project.flush() {
            tracing::error!("couldn't save project on exit: {e}");
        }
        save_vars(&self.hub, &self.project);
        self.server.stop();
        self.twitch.shutdown();
    }

    pub fn project_dir(&self) -> &Path {
        self.project.dir()
    }
}

fn save_vars(hub: &Hub, project: &ProjectStore) {
    if let Some(vars) = hub.vars.take_dirty()
        && let Err(e) = project.save_variables(&vars)
    {
        hub.log(
            LogLevel::Error,
            "variables",
            format!("Couldn't save variables: {e}"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn starts_and_shuts_down_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths {
            config_dir: dir.path().join("config"),
            default_project_dir: dir.path().join("project"),
            backup_dir: dir.path().join("backups"),
        };
        let core = Core::start(paths, Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        assert!(core.server.info().running || core.server.info().error.is_some());
        core.hub.set_var("counter.x", serde_json::json!(1), true);
        core.project.update(|p| p.name = "Exit test".into());
        core.project.mark_dirty();
        core.shutdown().await;
        let saved: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("project/project.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(saved["name"], "Exit test");
        let vars: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("project/variables.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(vars["counter.x"], 1);
    }

    fn paths(dir: &Path) -> Paths {
        Paths {
            config_dir: dir.join("config"),
            default_project_dir: dir.join("project"),
            backup_dir: dir.join("backups"),
        }
    }

    async fn wait_for_backups(core: &Core, n: usize) -> Vec<BackupInfo> {
        for _ in 0..100 {
            let list = core.backups.list();
            if list.len() >= n {
                return list;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("expected {n} backups, got {:?}", core.backups.list());
    }

    fn zip_entries(path: &Path) -> Vec<(String, Vec<u8>)> {
        use std::io::Read;
        let mut z = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        (0..z.len())
            .map(|i| {
                let mut e = z.by_index(i).unwrap();
                let mut buf = Vec::new();
                e.read_to_end(&mut buf).unwrap();
                (e.name().to_string(), buf)
            })
            .collect()
    }

    fn format_1_project() -> serde_json::Value {
        serde_json::json!({
            "format": 1,
            "name": "Old show",
            "actions": [{
                "id": "a1",
                "name": "Deaths",
                "triggers": [{ "type": "command", "name": "death" }],
                "steps": [{ "type": "add_to_variable", "key": "counter.deaths", "amount": 1 }]
            }]
        })
    }

    #[tokio::test]
    async fn backs_up_on_start_without_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(
            config.join("secrets.json"),
            br#"{"twitch.broadcaster":"oauth-SECRET-123"}"#,
        )
        .unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        let list = wait_for_backups(&core, 1).await;
        assert_eq!(list[0].reason, BackupReason::Startup);
        let token = core.settings.get().server.token;
        let entries = zip_entries(&core.backups.dir().join(&list[0].file));
        let names: Vec<_> = entries.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["backup.json", "project.json", "variables.json"]);
        for (name, bytes) in &entries {
            let text = String::from_utf8_lossy(bytes);
            assert!(!text.contains(&token), "{name} has the link secret");
            assert!(!text.contains("oauth-SECRET-123"), "{name} has a sign-in");
        }
        // Nothing changed, so no new backup.
        assert!(core.backup(BackupReason::Manual).unwrap().is_none());
        core.shutdown().await;
    }

    #[tokio::test]
    async fn restores_a_format_1_backup() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        wait_for_backups(&core, 1).await;
        core.hub
            .set_var("counter.deaths", serde_json::json!(9), true);
        core.hub.set_var("counter.gone", serde_json::json!(1), true);

        let file = dir.path().join("old.cwbackup");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("project.json", opts).unwrap();
        z.write_all(format_1_project().to_string().as_bytes())
            .unwrap();
        z.start_file("variables.json", opts).unwrap();
        z.write_all(br#"{"counter.deaths": 3}"#).unwrap();
        z.finish().unwrap();

        let p = core.restore(&file, BackupReason::BeforeImport).unwrap();
        assert_eq!(p.name, "Old show");
        assert_eq!(p.format, crate::model::project::PROJECT_FORMAT);
        assert!(p.actions[0].steps.is_empty());
        assert!(!p.actions[0].graph.nodes.is_empty());
        assert_eq!(
            core.hub.vars.get("counter.deaths"),
            Some(serde_json::json!(3))
        );
        assert_eq!(core.hub.vars.get("counter.gone"), None);
        let on_disk: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("project/project.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(on_disk["name"], "Old show");

        // The state before the restore was backed up and can be restored again.
        let list = core.backups.list();
        assert_eq!(list[0].reason, BackupReason::BeforeImport);
        let back = core.backups.path_of(&list[0].file).unwrap();
        let p = core.restore(&back, BackupReason::BeforeRestore).unwrap();
        assert_eq!(p.name, "My stream");
        assert_eq!(
            core.hub.vars.get("counter.deaths"),
            Some(serde_json::json!(9))
        );
        assert_eq!(core.backups.list()[0].reason, BackupReason::BeforeRestore);
        core.shutdown().await;
    }

    #[tokio::test]
    async fn failed_restore_leaves_the_project_alone() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        wait_for_backups(&core, 1).await;
        core.project.update(|p| p.name = "Keep me".into());
        core.hub.set_var("counter.x", serde_json::json!(1), true);
        let before = core.backups.list();

        let mut newer = format_1_project();
        newer["format"] = 999.into();
        let cases = [
            ("broken.cwbackup", b"PK\x03\x04 truncated".to_vec()),
            ("junk.json", b"{ not json".to_vec()),
            ("newer.json", newer.to_string().into_bytes()),
        ];
        for (name, bytes) in cases {
            let f = dir.path().join(name);
            std::fs::write(&f, bytes).unwrap();
            let err = core.restore(&f, BackupReason::BeforeImport).unwrap_err();
            assert!(matches!(err, AppError::User(_)), "{name}: {err}");
        }
        assert!(
            core.restore(
                &dir.path().join("missing.cwbackup"),
                BackupReason::BeforeImport
            )
            .is_err()
        );
        assert_eq!(core.project.get().name, "Keep me");
        assert_eq!(core.hub.vars.get("counter.x"), Some(serde_json::json!(1)));
        assert_eq!(
            core.backups.list(),
            before,
            "no backup made for a failed restore"
        );

        // No room for the safety backup: nothing changes either.
        let good = dir.path().join("good.json");
        std::fs::write(&good, format_1_project().to_string()).unwrap();
        std::fs::remove_dir_all(core.backups.dir()).unwrap();
        std::fs::write(core.backups.dir(), b"not a folder").unwrap();
        let err = core.restore(&good, BackupReason::BeforeImport).unwrap_err();
        assert!(err.to_string().contains("nothing was changed"), "{err}");
        assert_eq!(core.project.get().name, "Keep me");
        core.shutdown().await;
    }

    #[tokio::test]
    async fn backs_up_before_a_format_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let raw = format_1_project().to_string();
        std::fs::create_dir_all(dir.path().join("project")).unwrap();
        std::fs::write(dir.path().join("project/project.json"), &raw).unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        let list = wait_for_backups(&core, 2).await;
        let pre = list
            .iter()
            .find(|b| b.reason == BackupReason::BeforeMigration)
            .unwrap();
        let entries = zip_entries(&core.backups.dir().join(&pre.file));
        let project = entries.iter().find(|(n, _)| n == "project.json").unwrap();
        assert_eq!(project.1, raw.as_bytes(), "the original file, unchanged");
        core.shutdown().await;
    }

    #[tokio::test]
    async fn broken_project_file_is_recovered_from_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        wait_for_backups(&core, 1).await;
        core.project.update(|p| p.name = "Saved".into());
        core.backup(BackupReason::Manual).unwrap().unwrap();
        core.shutdown().await;
        drop(core);
        std::fs::write(dir.path().join("project/project.json"), b"{ broken").unwrap();
        let core = Core::start(paths(dir.path()), Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        assert_eq!(core.project.get().name, "Saved");
        core.shutdown().await;
    }

    #[tokio::test]
    async fn bad_project_dir_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file-not-folder");
        std::fs::write(&blocker, b"x").unwrap();
        let config = dir.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(
            config.join("settings.json"),
            serde_json::json!({ "project_dir": blocker.join("inside") }).to_string(),
        )
        .unwrap();
        let core = Core::start(
            Paths {
                config_dir: config,
                default_project_dir: dir.path().join("default"),
                backup_dir: dir.path().join("backups"),
            },
            Arc::new(crate::hub::NullUi),
        )
        .await
        .unwrap();
        assert_eq!(core.project_dir(), dir.path().join("default"));
        core.shutdown().await;
    }
}
