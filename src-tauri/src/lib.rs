pub mod alerts;
pub mod automation;
pub mod commands;
pub mod core;
pub mod error;
pub mod hub;
pub mod model;
pub mod server;
pub mod services;
pub mod store;
pub mod template;
pub mod twitch;
pub mod util;
pub mod vars;
pub mod window;

use std::sync::Arc;
use tauri::{Emitter, Manager};

struct TauriUi(tauri::AppHandle);

impl hub::UiSink for TauriUi {
    fn emit(&self, name: &str, payload: serde_json::Value) {
        let _ = self.0.emit(name, payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "castwright=info,warn".into()),
        )
        .try_init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let paths = core::Paths {
                config_dir: app.path().app_config_dir()?,
                default_project_dir: app.path().app_data_dir()?.join("Projects").join("Default"),
            };
            let core = tauri::async_runtime::block_on(core::Core::start(
                paths,
                Arc::new(TauriUi(handle.clone())),
            ))
            .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;
            app.manage(core.clone());

            if let Some(window) = app.get_webview_window("main") {
                let a = core.settings.get().appearance;
                let dark = !matches!(a.theme.as_str(), "light");
                window::apply_effect(&window, a.window_effect, dark);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_project,
            commands::save_overlay,
            commands::delete_overlay,
            commands::duplicate_overlay,
            commands::save_alerts,
            commands::save_actions,
            commands::rename_project,
            commands::export_overlay,
            commands::import_overlay,
            commands::list_assets,
            commands::import_assets,
            commands::delete_asset,
            commands::list_snapshots,
            commands::create_snapshot,
            commands::restore_snapshot,
            commands::project_dir,
            commands::set_project_dir,
            commands::alert_queue,
            commands::alert_pause,
            commands::alert_skip,
            commands::alert_remove,
            commands::alert_clear,
            commands::alert_replay,
            commands::test_event,
            commands::run_action,
            commands::get_vars,
            commands::set_var,
            commands::delete_var,
            commands::reset_session,
            commands::recent_events,
            commands::recent_chat,
            commands::clear_history,
            commands::export_history_csv,
            commands::get_logs,
            commands::server_info,
            commands::overlay_url,
            commands::regenerate_token,
            commands::restart_server,
            commands::get_settings,
            commands::save_appearance,
            commands::set_first_run_done,
            commands::set_twitch_client_id,
            commands::app_info,
            commands::set_window_effect,
            commands::twitch_status,
            commands::twitch_login,
            commands::twitch_cancel_login,
            commands::twitch_logout,
            commands::twitch_search_categories,
            commands::twitch_update_stream_info,
            commands::twitch_send_chat,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Castwright");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event
            && let Some(core) = handle.try_state::<Arc<core::Core>>()
        {
            core.shutdown();
        }
    });
}
