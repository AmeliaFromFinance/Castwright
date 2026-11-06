pub mod alerts;
pub mod automation;
pub mod commands;
pub mod core;
pub mod diag;
pub mod discord;
pub mod error;
pub mod golive;
pub mod hotkeys;
pub mod hub;
pub mod hype;
pub mod launch;
pub mod model;
pub mod moments;
pub mod music;
pub mod obs;
pub mod paths;
pub mod play;
pub mod server;
pub mod services;
pub mod sessions;
pub mod soundboard;
pub mod store;
pub mod template;
pub mod timers;
pub mod twitch;
pub mod updates;
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
    {
        use tracing_subscriber::layer::SubscriberExt;
        use tracing_subscriber::util::SubscriberInitExt;
        let _ = tracing_subscriber::registry()
            .with(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "castwright=info,warn".into()),
            )
            .with(tracing_subscriber::fmt::layer())
            .with(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(diag::logbuf::Writer),
            )
            .try_init();
    }

    let layout = paths::Layout::detect();
    let mut context = tauri::generate_context!();
    layout.apply(context.config_mut());
    if let Some(dir) = &layout.portable {
        tracing::info!("portable mode, data in {}", dir.display());
    }

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let paths = paths::core_paths(&handle, &layout)?;
            let logs = diag::logs_dir(&paths.data_dir);
            if let Err(e) = diag::logbuf::sink().attach_dir(&logs) {
                tracing::warn!("couldn't write log files to {}: {e}", logs.display());
            }
            diag::crash::install(logs);
            app.manage(layout);
            app.manage(Arc::new(updates::Updates::default()));
            let core = tauri::async_runtime::block_on(core::Core::start(
                paths,
                Arc::new(TauriUi(handle.clone())),
            ))
            .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;
            app.manage(core.clone());

            let hotkeys = Arc::new(hotkeys::Hotkeys::default());
            app.manage(hotkeys.clone());
            match handle.plugin(hotkeys::plugin()) {
                Ok(()) => {
                    let status = hotkeys.apply(&handle, &core.settings.get().hotkeys);
                    hotkeys::log_errors(&core, &status);
                }
                Err(e) => tracing::warn!("global hotkeys unavailable: {e}"),
            }

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
            commands::list_overlay_templates,
            commands::save_overlay_template,
            commands::delete_overlay_template,
            commands::overlay_from_template,
            commands::actions_package,
            commands::export_actions,
            commands::read_actions_file,
            commands::parse_actions_package,
            commands::import_actions,
            commands::list_assets,
            commands::import_assets,
            commands::delete_asset,
            commands::list_backups,
            commands::create_backup,
            commands::restore_backup,
            commands::restore_backup_file,
            commands::delete_backup,
            commands::export_backup,
            commands::save_backup_settings,
            commands::project_dir,
            commands::set_project_dir,
            commands::alert_queue,
            commands::alert_pause,
            commands::alert_skip,
            commands::alert_remove,
            commands::alert_clear,
            commands::alert_replay,
            commands::alert_replay_last,
            commands::alert_mute,
            commands::test_event,
            commands::test_variation,
            commands::run_action,
            commands::get_vars,
            commands::set_var,
            commands::delete_var,
            commands::saved_var_keys,
            commands::rename_var,
            commands::reset_session,
            commands::list_sessions,
            commands::session_summary,
            commands::delete_session,
            commands::session_credits,
            commands::save_summary_settings,
            commands::save_export,
            commands::recent_events,
            commands::recent_chat,
            commands::clear_history,
            commands::export_history_csv,
            commands::get_logs,
            commands::open_link,
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
            commands::make_portable,
            commands::restart_app,
            commands::health_snapshot,
            commands::reload_overlay,
            commands::crash_notice,
            commands::bug_report_preview,
            commands::save_bug_report,
            commands::save_hotkeys,
            commands::hotkeys_recording,
            commands::save_golive,
            commands::golive_check,
            commands::golive_fix,
            commands::twitch_status,
            commands::twitch_login,
            commands::twitch_cancel_login,
            commands::twitch_logout,
            commands::twitch_search_categories,
            commands::twitch_update_stream_info,
            commands::twitch_send_chat,
            commands::twitch_delete_message,
            commands::twitch_ban,
            commands::twitch_unban,
            commands::twitch_shoutout,
            commands::twitch_chat_modes,
            commands::twitch_set_chat_mode,
            commands::twitch_viewer,
            commands::twitch_rewards,
            commands::twitch_save_reward,
            commands::twitch_delete_reward,
            commands::twitch_redemptions,
            commands::twitch_finish_redemptions,
            commands::twitch_interact_state,
            commands::twitch_start_poll,
            commands::twitch_end_poll,
            commands::twitch_start_prediction,
            commands::twitch_end_prediction,
            commands::twitch_ad_schedule,
            commands::twitch_snooze_ad,
            commands::twitch_run_ad,
            commands::save_ad_settings,
            commands::stream_add_marker,
            commands::stream_marker_note,
            commands::stream_create_clip,
            updates::update_prepare,
            updates::update_download,
            updates::update_restart,
            updates::update_cancel_restart,
            updates::save_update_settings,
            commands::save_discord_webhook,
            commands::delete_discord_webhook,
            commands::discord_send_test,
            commands::music_status,
            commands::save_music_settings,
            commands::music_watch,
            commands::spotify_login,
            commands::spotify_cancel_login,
            commands::spotify_logout,
            commands::save_chat_rules,
            commands::save_default_font,
            commands::soundboard_status,
            commands::save_soundboard,
            commands::sound_play,
            commands::sound_stop,
            commands::soundboard_mute,
            commands::timer_states,
            commands::timer_control,
            commands::play_state,
            commands::save_giveaway_settings,
            commands::giveaway_open,
            commands::giveaway_set_open,
            commands::giveaway_draw,
            commands::giveaway_reroll,
            commands::giveaway_claim,
            commands::giveaway_remove,
            commands::giveaway_finish,
            commands::giveaway_history,
            commands::giveaway_delete_record,
            commands::save_queue_settings,
            commands::queue_set_open,
            commands::queue_next,
            commands::queue_remove,
            commands::queue_clear,
            commands::queue_move,
            commands::queue_note,
            commands::obs_snapshot,
            commands::obs_connect,
            commands::obs_disconnect,
            commands::obs_test_connection,
            commands::obs_save_connection,
            commands::obs_set_program_scene,
            commands::obs_set_preview_scene,
            commands::obs_set_studio_mode,
            commands::obs_transition,
            commands::obs_set_transition,
            commands::obs_set_transition_duration,
            commands::obs_stream,
            commands::obs_record,
            commands::obs_replay,
            commands::obs_virtual_cam,
            commands::obs_set_volume,
            commands::obs_set_mute,
            commands::obs_set_monitoring,
            commands::obs_set_item_enabled,
            commands::obs_set_item_locked,
            commands::obs_levels,
            commands::obs_screenshot,
            commands::obs_add_overlay,
        ])
        .build(context)
        .expect("error while building Castwright");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event
            && let Some(core) = handle.try_state::<Arc<core::Core>>()
        {
            let core = core.inner().clone();
            let auto_install = core.settings.get().updates.auto_install;
            tauri::async_runtime::block_on(async move { core.shutdown().await });
            updates::install_on_exit(handle, auto_install);
        }
    });
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    /// Without a scope, `opener:allow-open-url` refuses every link.
    #[test]
    fn web_links_may_open_in_the_browser() {
        let caps: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let opener = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["identifier"] == "opener:allow-open-url")
            .expect("open-url permission with a scope");
        assert_eq!(
            opener["allow"],
            json!([{ "url": "https://*" }, { "url": "http://*" }])
        );
    }
}
