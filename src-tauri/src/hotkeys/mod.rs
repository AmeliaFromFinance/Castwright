//! Global hotkeys: they work while another app, like a game, has focus.

pub mod keys;

use crate::core::Core;
use crate::error::AppResult;
use crate::model::runtime::LogLevel;
use crate::model::settings::{HotkeyAction, HotkeySettings};
use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct HotkeyError {
    pub keys: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct HotkeyStatus {
    /// False when the system has no global hotkey support at all.
    pub available: bool,
    /// Shown above the list, e.g. on Wayland.
    pub note: Option<String>,
    /// How many hotkeys are listening right now.
    pub active: u32,
    /// Combos the system refused.
    pub errors: Vec<HotkeyError>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct HotkeyReport {
    pub hotkeys: HotkeySettings,
    pub status: HotkeyStatus,
}

pub fn session_note() -> Option<String> {
    let var = |k: &str| std::env::var(k).ok();
    keys::session_note(
        crate::paths::Os::current(),
        var("WAYLAND_DISPLAY").as_deref(),
        var("XDG_SESSION_TYPE").as_deref(),
        var("DISPLAY").as_deref(),
    )
}

#[derive(Default)]
struct State {
    by_id: HashMap<u32, HotkeyAction>,
    recording: bool,
    status: Option<HotkeyStatus>,
}

#[derive(Default)]
pub struct Hotkeys {
    state: Mutex<State>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed
                && let Some(h) = app.try_state::<Arc<Hotkeys>>()
            {
                h.fire(app, shortcut.id());
            }
        })
        .build()
}

impl Hotkeys {
    pub fn status(&self) -> HotkeyStatus {
        self.state
            .lock()
            .unwrap()
            .status
            .clone()
            .unwrap_or_else(|| HotkeyStatus {
                available: false,
                note: Some("Global hotkeys couldn't start on this system.".into()),
                active: 0,
                errors: Vec::new(),
            })
    }

    /// Replace every registered hotkey with the ones in `settings`.
    pub fn apply(&self, app: &AppHandle, settings: &HotkeySettings) -> HotkeyStatus {
        let note = session_note();
        let Some(gs) = app.try_state::<tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>>()
        else {
            return self.status();
        };
        let _ = gs.unregister_all();
        let recording = self.state.lock().unwrap().recording;
        let mut by_id = HashMap::new();
        let mut errors = Vec::new();
        if !recording {
            for (binding, combo) in keys::active(settings) {
                let keys = combo.to_string();
                let result = Shortcut::from_str(&keys)
                    .map_err(|e| e.to_string())
                    .and_then(|s| {
                        app.global_shortcut()
                            .register(s)
                            .map(|_| s)
                            .map_err(|e| e.to_string())
                    });
                match result {
                    Ok(s) => {
                        by_id.insert(s.id(), binding.action.clone());
                    }
                    Err(e) => {
                        tracing::warn!("hotkey {keys} not registered: {e}");
                        errors.push(HotkeyError {
                            keys,
                            message: "Another app already uses this, or the system keeps it for itself. Pick a different combination.".into(),
                        });
                    }
                }
            }
        }
        let status = HotkeyStatus {
            available: true,
            note,
            active: by_id.len() as u32,
            errors,
        };
        let mut st = self.state.lock().unwrap();
        st.by_id = by_id;
        st.status = Some(status.clone());
        status
    }

    /// While a combo is being recorded, every hotkey is let go so the keys reach
    /// the app window and nothing fires.
    pub fn set_recording(
        &self,
        app: &AppHandle,
        on: bool,
        settings: &HotkeySettings,
    ) -> HotkeyStatus {
        self.state.lock().unwrap().recording = on;
        self.apply(app, settings)
    }

    fn fire(&self, app: &AppHandle, id: u32) {
        let action = {
            let st = self.state.lock().unwrap();
            if st.recording {
                return;
            }
            st.by_id.get(&id).cloned()
        };
        let (Some(action), Some(core)) = (action, app.try_state::<Arc<Core>>()) else {
            return;
        };
        if action == HotkeyAction::OpenGoLive
            && let Some(w) = app.get_webview_window("main")
        {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        if let Err(e) = perform(&core, &action) {
            core.hub.log(LogLevel::Warn, "hotkeys", e.to_string());
        }
    }
}

pub fn perform(core: &Core, action: &HotkeyAction) -> AppResult<()> {
    match action {
        HotkeyAction::ReplayLastAlert => core.alerts.replay_last(),
        HotkeyAction::SkipAlert => {
            core.alerts.skip();
            Ok(())
        }
        HotkeyAction::ToggleAlertPause => {
            core.alerts.set_paused(!core.alerts.queue_state().paused);
            Ok(())
        }
        HotkeyAction::ToggleAlertMute => core.alerts.set_muted(!core.alerts.queue_state().muted),
        HotkeyAction::OpenGoLive => {
            core.hub
                .emit_ui(crate::hub::ui::GOLIVE_OPEN, &serde_json::json!({}));
            Ok(())
        }
        HotkeyAction::RunAction { action_id } => core.automation.run_manual(action_id),
    }
}

/// Log combos the system refused, so they show up even if Settings is never opened.
pub fn log_errors(core: &Core, status: &HotkeyStatus) {
    for e in &status.errors {
        core.hub.log(
            LogLevel::Warn,
            "hotkeys",
            format!("{} couldn't be set as a hotkey. {}", e.keys, e.message),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::RecordingUi;

    async fn core(dir: &std::path::Path) -> (Arc<Core>, Arc<RecordingUi>) {
        let ui = Arc::new(RecordingUi::default());
        let paths = crate::core::Paths {
            config_dir: dir.join("config"),
            data_dir: dir.to_path_buf(),
            default_project_dir: dir.join("project"),
            backup_dir: dir.join("backups"),
            secrets_in_file: true,
        };
        (Core::start(paths, ui.clone()).await.unwrap(), ui)
    }

    #[tokio::test]
    async fn toggles_and_go_live() {
        let dir = tempfile::tempdir().unwrap();
        let (core, ui) = core(dir.path()).await;
        assert!(!core.alerts.queue_state().paused);
        perform(&core, &HotkeyAction::ToggleAlertPause).unwrap();
        assert!(core.alerts.queue_state().paused);
        perform(&core, &HotkeyAction::ToggleAlertPause).unwrap();
        assert!(!core.alerts.queue_state().paused);

        perform(&core, &HotkeyAction::ToggleAlertMute).unwrap();
        assert!(core.alerts.queue_state().muted);
        assert!(core.settings.get().alerts_muted);
        perform(&core, &HotkeyAction::ToggleAlertMute).unwrap();
        assert!(!core.alerts.queue_state().muted);

        perform(&core, &HotkeyAction::OpenGoLive).unwrap();
        assert!(
            ui.0.lock()
                .unwrap()
                .iter()
                .any(|(n, _)| n == crate::hub::ui::GOLIVE_OPEN)
        );

        assert!(
            perform(&core, &HotkeyAction::ReplayLastAlert).is_err(),
            "nothing played yet"
        );
        assert!(
            perform(
                &core,
                &HotkeyAction::RunAction {
                    action_id: "missing".into()
                }
            )
            .is_err()
        );
        core.shutdown().await;
    }
}
