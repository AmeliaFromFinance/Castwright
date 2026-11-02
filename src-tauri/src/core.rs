//! Everything the running app owns, created once at startup.

use crate::alerts::AlertEngine;
use crate::automation::Automation;
use crate::hub::{Hub, UiSink};
use crate::model::runtime::LogLevel;
use crate::obs::ObsService;
use crate::server::OverlayServer;
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
}

pub struct Core {
    pub hub: Arc<Hub>,
    pub settings: Arc<SettingsStore>,
    pub secrets: Arc<Secrets>,
    pub project: Arc<ProjectStore>,
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
        let (project, outcome, project_dir) = match ProjectStore::open(&project_dir) {
            Ok((p, o)) => (p, o, project_dir),
            Err(e) => {
                tracing::error!("couldn't open project at {}: {e}", project_dir.display());
                let (p, o) = ProjectStore::open(&paths.default_project_dir)?;
                (p, o, paths.default_project_dir.clone())
            }
        };
        let project = Arc::new(project);

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
            LoadOutcome::RecoveredFromSnapshot(f) => hub.log(
                LogLevel::Warn,
                "project",
                format!("Your project file couldn't be read, so the snapshot {f} was restored. The unreadable file was kept in the project folder."),
            ),
            LoadOutcome::StartedFresh => hub.log(
                LogLevel::Error,
                "project",
                "Your project file couldn't be read and no snapshot worked, so a new project was started. The unreadable file was kept in the project folder.",
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

        Ok(Arc::new(Core {
            hub,
            settings,
            secrets,
            project,
            alerts,
            automation,
            server,
            twitch,
            obs,
            paths,
        }))
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
            },
            Arc::new(crate::hub::NullUi),
        )
        .await
        .unwrap();
        assert_eq!(core.project_dir(), dir.path().join("default"));
        core.shutdown().await;
    }
}
