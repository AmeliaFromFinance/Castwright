//! One-click updates. Every download is checked against the public key in
//! tauri.conf.json before it is installed; an update that fails is never installed.

use crate::core::Core;
use crate::error::{AppError, AppResult, user_err};
use crate::hub::ui;
use crate::model::settings::UpdateSettings;
use crate::paths::Layout;
use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};
use ts_rs::TS;

/// How this copy of Castwright was installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Install {
    Nsis,
    Msi,
    App,
    AppImage,
    Deb,
    Rpm,
    /// A plain build, like `cargo run`.
    Unknown,
}

impl Install {
    pub fn from_bundle(bundle: Option<BundleType>) -> Install {
        match bundle {
            Some(BundleType::Nsis) => Install::Nsis,
            Some(BundleType::Msi) => Install::Msi,
            Some(BundleType::App | BundleType::Dmg) => Install::App,
            Some(BundleType::AppImage) => Install::AppImage,
            Some(BundleType::Deb) => Install::Deb,
            Some(BundleType::Rpm) => Install::Rpm,
            _ => Install::Unknown,
        }
    }

    pub fn current() -> Install {
        Install::from_bundle(tauri::utils::platform::bundle_type())
    }
}

/// Why this copy can't replace itself, or None when it can. The installer and the
/// AppImage update the files where they are, so portable copies work too.
pub fn manual_reason(install: Install, portable: bool) -> Option<&'static str> {
    match install {
        Install::Nsis | Install::AppImage | Install::App => None,
        Install::Msi | Install::Deb | Install::Rpm if portable => Some(
            "This portable copy was installed from a package, which would update a different copy.",
        ),
        Install::Msi | Install::Deb | Install::Rpm => None,
        Install::Unknown => {
            Some("This copy wasn't installed from a release, so it can't update itself.")
        }
    }
}

/// The NSIS `/D=` option, so the installer updates the folder Castwright runs from
/// (a portable folder too) instead of the last install location.
pub fn nsis_dir_arg(folder: &Path) -> OsString {
    let text = folder.to_string_lossy();
    let plain = text.strip_prefix(r"\\?\").unwrap_or(&text);
    OsString::from(format!("/D={plain}"))
}

/// Restarting is held back while live until the stream ends or the person agrees.
#[derive(Debug, Default)]
pub struct RestartGate {
    waiting: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RestartOutcome {
    Restarting,
    AfterStream,
}

impl RestartGate {
    /// `confirmed`: the person chose to restart even though they're live.
    pub fn request(&mut self, live: bool, confirmed: bool) -> RestartOutcome {
        self.waiting = live && !confirmed;
        if self.waiting {
            RestartOutcome::AfterStream
        } else {
            RestartOutcome::Restarting
        }
    }

    /// Call with the live state while waiting. True once, when the stream has ended.
    pub fn stream_check(&mut self, live: bool) -> bool {
        let ended = self.waiting && !live;
        if ended {
            self.waiting = false;
        }
        ended
    }

    pub fn cancel(&mut self) {
        self.waiting = false;
    }

    pub fn waiting(&self) -> bool {
        self.waiting
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct UpdatePlan {
    /// None when no newer release can be installed from here.
    pub version: Option<String>,
    pub can_install: bool,
    /// Why "Download from GitHub" is shown instead.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct UpdateProgress {
    #[ts(type = "number")]
    pub downloaded: u64,
    /// None when the server didn't say.
    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

pub const BAD_SIGNATURE: &str = "The download didn't pass the signature check, so it wasn't installed. Download Castwright from GitHub instead.";

fn is_signature_error(e: &UpdaterError) -> bool {
    matches!(
        e,
        UpdaterError::Minisign(_)
            | UpdaterError::SignatureUtf8(_)
            | UpdaterError::Base64(_)
            | UpdaterError::SignedVersionMismatch { .. }
    )
}

fn download_error(e: UpdaterError) -> AppError {
    if is_signature_error(&e) {
        return AppError::User(BAD_SIGNATURE.into());
    }
    AppError::User(format!("The download failed. Try again later. ({e})"))
}

fn install_error(e: UpdaterError) -> AppError {
    if is_signature_error(&e) {
        return AppError::User(BAD_SIGNATURE.into());
    }
    AppError::User(format!(
        "The update couldn't be installed. Download it from GitHub instead. ({e})"
    ))
}

#[derive(Default)]
struct Inner {
    update: Option<Update>,
    bytes: Option<Arc<Vec<u8>>>,
    downloading: bool,
    gate: RestartGate,
}

#[derive(Default)]
pub struct Updates {
    inner: Mutex<Inner>,
    /// Set once the core has shut down, so the installer hook doesn't do it twice.
    closed: AtomicBool,
}

impl Updates {
    fn ready(&self) -> Option<(Update, Arc<Vec<u8>>)> {
        let st = self.inner.lock().unwrap();
        Some((st.update.clone()?, st.bytes.clone()?))
    }
}

/// Shut the core down before the Windows installer takes over and ends the process.
fn close_core(app: &AppHandle) {
    let Some(updates) = app.try_state::<Arc<Updates>>() else {
        return;
    };
    if updates.closed.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(core) = app.try_state::<Arc<Core>>() {
        let core = core.inner().clone();
        tauri::async_runtime::block_on(async move { core.shutdown().await });
    }
}

#[tauri::command]
pub async fn update_prepare(
    app: AppHandle,
    layout: State<'_, Layout>,
    updates: State<'_, Arc<Updates>>,
) -> AppResult<UpdatePlan> {
    let install = Install::current();
    if let Some(reason) = manual_reason(install, layout.portable.is_some()) {
        return Ok(UpdatePlan {
            version: None,
            can_install: false,
            reason: Some(reason.into()),
        });
    }
    let mut builder = app.updater_builder();
    let handle = app.clone();
    builder = builder.on_before_exit(move || close_core(&handle));
    if install == Install::Nsis
        && let Some(folder) = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(Path::to_path_buf))
    {
        builder = builder.installer_arg(nsis_dir_arg(&folder));
    }
    // Package installs only take their own package, never the AppImage.
    if let Some(kind) = match install {
        Install::Deb => Some("deb"),
        Install::Rpm => Some("rpm"),
        _ => None,
    } && let Some(target) = tauri_plugin_updater::target()
    {
        builder = builder.target(format!("{target}-{kind}"));
    }
    let checked = match builder.build() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    let manual = |reason: &str| UpdatePlan {
        version: None,
        can_install: false,
        reason: Some(reason.into()),
    };
    match checked {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let mut st = updates.inner.lock().unwrap();
            if st.update.as_ref().map(|u| &u.version) != Some(&version) {
                st.bytes = None;
            }
            st.update = Some(update);
            Ok(UpdatePlan {
                version: Some(version),
                can_install: true,
                reason: None,
            })
        }
        Ok(None)
        | Err(
            UpdaterError::ReleaseNotFound
            | UpdaterError::TargetNotFound(_)
            | UpdaterError::TargetsNotFound(_),
        ) => Ok(manual(
            "This release can't be installed from inside Castwright.",
        )),
        Err(e) => {
            tracing::warn!("update check failed: {e}");
            Ok(manual("Couldn't reach the update server."))
        }
    }
}

/// Download and check the update. Progress goes out as `cw://update-progress`.
#[tauri::command]
pub async fn update_download(
    core: State<'_, Arc<Core>>,
    updates: State<'_, Arc<Updates>>,
) -> AppResult<()> {
    let update = {
        let mut st = updates.inner.lock().unwrap();
        if st.bytes.is_some() {
            return Ok(());
        }
        if st.downloading {
            return user_err("The update is already downloading.");
        }
        let Some(u) = st.update.clone() else {
            return user_err("Check for updates first.");
        };
        st.downloading = true;
        u
    };
    let hub = core.hub.clone();
    let mut downloaded = 0u64;
    let mut last_sent = std::time::Instant::now() - Duration::from_secs(1);
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_sent.elapsed() >= Duration::from_millis(100) {
                    last_sent = std::time::Instant::now();
                    hub.emit_ui(ui::UPDATE_PROGRESS, &UpdateProgress { downloaded, total });
                }
            },
            || {},
        )
        .await;
    let mut st = updates.inner.lock().unwrap();
    st.downloading = false;
    match result {
        Ok(bytes) => {
            let total = bytes.len() as u64;
            core.hub.emit_ui(
                ui::UPDATE_PROGRESS,
                &UpdateProgress {
                    downloaded: total,
                    total: Some(total),
                },
            );
            st.bytes = Some(Arc::new(bytes));
            Ok(())
        }
        Err(e) => {
            tracing::warn!("update download failed: {e}");
            Err(download_error(e))
        }
    }
}

/// Install the downloaded update. While live this waits for the stream to end
/// (`cw://update-ask` is sent then) unless `confirmed`. After `Restarting` the
/// window relaunches the app; on Windows the installer does it.
#[tauri::command]
pub async fn update_restart(
    core: State<'_, Arc<Core>>,
    updates: State<'_, Arc<Updates>>,
    confirmed: bool,
) -> AppResult<RestartOutcome> {
    let Some((update, bytes)) = updates.ready() else {
        return user_err("Download the update first.");
    };
    let outcome = updates
        .inner
        .lock()
        .unwrap()
        .gate
        .request(core.is_live(), confirmed);
    if outcome == RestartOutcome::AfterStream {
        watch_stream(core.inner().clone(), updates.inner().clone());
        return Ok(outcome);
    }
    tokio::task::spawn_blocking(move || update.install(bytes.as_slice()))
        .await
        .map_err(|e| AppError::Other(e.into()))?
        .map_err(install_error)?;
    Ok(RestartOutcome::Restarting)
}

#[tauri::command]
pub fn update_cancel_restart(updates: State<'_, Arc<Updates>>) {
    updates.inner.lock().unwrap().gate.cancel();
}

#[tauri::command]
pub fn save_update_settings(
    core: State<'_, Arc<Core>>,
    settings: UpdateSettings,
) -> AppResult<UpdateSettings> {
    core.settings.update(|s| s.updates = settings.clone())?;
    Ok(settings)
}

fn watch_stream(core: Arc<Core>, updates: Arc<Updates>) {
    crate::util::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let live = core.is_live();
            let mut st = updates.inner.lock().unwrap();
            if !st.gate.waiting() {
                return;
            }
            if st.gate.stream_check(live) {
                drop(st);
                core.hub.emit_ui(ui::UPDATE_ASK, &serde_json::json!({}));
                return;
            }
        }
    });
}

/// With "Install updates automatically" on, a downloaded update is installed as
/// Castwright closes. It doesn't reopen.
pub fn install_on_exit(app: &AppHandle, auto_install: bool) {
    let Some(updates) = app.try_state::<Arc<Updates>>() else {
        return;
    };
    updates.closed.store(true, Ordering::SeqCst);
    if !auto_install {
        return;
    }
    let Some((update, bytes)) = updates.ready() else {
        return;
    };
    tracing::info!("installing update {} on exit", update.version);
    if let Err(e) = update
        .restart_after_install(false)
        .install(bytes.as_slice())
    {
        tracing::error!("couldn't install the update on exit: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn updater_config() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let u = &conf["plugins"]["updater"];
        assert_eq!(
            u["endpoints"],
            serde_json::json!([
                "https://github.com/AmeliaFromFinance/Castwright/releases/latest/download/latest.json"
            ])
        );
        let key = base64::engine::general_purpose::STANDARD
            .decode(u["pubkey"].as_str().unwrap())
            .unwrap();
        let key = String::from_utf8(key).unwrap();
        assert!(
            key.starts_with("untrusted comment: minisign public key: 241FCAB27A37F25B"),
            "{key}"
        );
        assert_eq!(u["windows"]["installMode"], "passive");
        assert!(
            conf["bundle"].get("createUpdaterArtifacts").is_none(),
            "the release workflow turns this on only when the signing key is there"
        );
    }

    #[test]
    fn settings_default_to_manual_stable() {
        let s = crate::model::settings::Settings::default();
        assert!(!s.updates.auto_install);
        assert_eq!(
            s.updates.channel,
            crate::model::settings::UpdateChannel::Stable
        );
        let old: crate::model::settings::Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.updates, UpdateSettings::default());
        assert_eq!(
            serde_json::to_value(&s.updates).unwrap(),
            serde_json::json!({"auto_install": false, "channel": "stable"})
        );
    }

    #[test]
    fn which_installs_update_in_place() {
        for i in [Install::Nsis, Install::AppImage, Install::App] {
            assert_eq!(manual_reason(i, false), None, "{i:?}");
            assert_eq!(manual_reason(i, true), None, "{i:?} portable");
        }
        for i in [Install::Msi, Install::Deb, Install::Rpm] {
            assert_eq!(manual_reason(i, false), None, "{i:?}");
            assert!(manual_reason(i, true).is_some(), "{i:?} portable");
        }
        assert!(manual_reason(Install::Unknown, false).is_some());
        assert_eq!(Install::from_bundle(None), Install::Unknown);
        assert_eq!(Install::from_bundle(Some(BundleType::Dmg)), Install::App);
        assert_eq!(
            Install::from_bundle(Some(BundleType::AppImage)),
            Install::AppImage
        );
    }

    #[test]
    fn nsis_installs_into_the_running_folder() {
        assert_eq!(
            nsis_dir_arg(Path::new(r"\\?\E:\Portable Apps\Castwright")),
            OsString::from(r"/D=E:\Portable Apps\Castwright")
        );
        assert_eq!(
            nsis_dir_arg(Path::new("/x/Castwright")),
            OsString::from("/D=/x/Castwright")
        );
    }

    #[test]
    fn restart_waits_for_the_stream() {
        let mut g = RestartGate::default();
        assert_eq!(g.request(false, false), RestartOutcome::Restarting);
        assert!(!g.waiting());
        assert!(!g.stream_check(false), "nothing to ask about");

        assert_eq!(g.request(true, false), RestartOutcome::AfterStream);
        assert!(g.waiting());
        assert!(!g.stream_check(true), "still live");
        assert!(g.stream_check(false), "stream ended: ask again");
        assert!(!g.stream_check(false), "asked once");
        assert!(!g.waiting());

        assert_eq!(
            g.request(true, true),
            RestartOutcome::Restarting,
            "the person agreed to restart while live"
        );
        assert!(!g.waiting());

        g.request(true, false);
        g.cancel();
        assert!(!g.stream_check(false), "cancelled");
    }

    #[test]
    fn signature_failures_are_clear() {
        let e = download_error(UpdaterError::SignedVersionMismatch {
            signed: "0.7.0".into(),
            announced: "0.8.0".into(),
        });
        assert_eq!(e.to_string(), BAD_SIGNATURE);
        let e = install_error(UpdaterError::SignatureUtf8("x".into()));
        assert_eq!(e.to_string(), BAD_SIGNATURE);
        let e = download_error(UpdaterError::Network("timed out".into()));
        assert!(e.to_string().starts_with("The download failed"), "{e}");
    }
}
