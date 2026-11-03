//! Functions the app window calls with `invoke`.

use crate::core::Core;
use crate::error::{AppError, AppResult, user_err};
use crate::hub::ui;
use crate::model::alert::AlertConfig;
use crate::model::automation::Action;
use crate::model::event::{Event, EventKind};
use crate::model::overlay::Overlay;
use crate::model::project::Project;
use crate::model::runtime::{LogEntry, OverlayMsg, QueueState, ServerInfo};
use crate::model::settings::{
    AppearanceSettings, BackupSettings, GoLiveSettings, Settings, WindowEffect,
};
use crate::store::backup::{BackupInfo, BackupReason};
use crate::store::project::AssetInfo;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

type Ctx<'a> = State<'a, Arc<Core>>;

fn project_changed(core: &Core) {
    core.project.mark_dirty();
    core.hub.emit_ui(ui::PROJECT, &serde_json::json!({}));
}

// ---------- project ----------

#[tauri::command]
pub fn get_project(core: Ctx) -> Project {
    core.project.get()
}

#[tauri::command]
pub fn save_overlay(core: Ctx, mut overlay: Overlay) -> AppResult<Overlay> {
    if overlay.width < 16 || overlay.height < 16 || overlay.width > 7680 || overlay.height > 7680 {
        return user_err("Overlay size must be between 16 and 7680 pixels.");
    }
    if overlay.id.trim().is_empty() {
        overlay.id = crate::util::new_id();
    }
    overlay.updated_at = crate::util::now_ms();
    core.project.update(
        |p| match p.overlays.iter_mut().find(|o| o.id == overlay.id) {
            Some(existing) => *existing = overlay.clone(),
            None => p.overlays.push(overlay.clone()),
        },
    );
    core.hub.to_overlays(
        Some(&overlay.id),
        OverlayMsg::Overlay {
            overlay: overlay.clone(),
        },
    );
    project_changed(&core);
    Ok(overlay)
}

#[tauri::command]
pub fn delete_overlay(core: Ctx, id: String) -> AppResult<()> {
    core.project.update(|p| p.overlays.retain(|o| o.id != id));
    core.hub.to_overlays(Some(&id), OverlayMsg::Reload);
    project_changed(&core);
    Ok(())
}

#[tauri::command]
pub fn duplicate_overlay(core: Ctx, id: String) -> AppResult<Overlay> {
    let Some(mut copy) = core
        .project
        .read(|p| p.overlays.iter().find(|o| o.id == id).cloned())
    else {
        return Err(AppError::NotFound("overlay".into()));
    };
    copy.id = crate::util::new_id();
    copy.name = format!("{} copy", copy.name);
    for l in &mut copy.layers {
        l.id = crate::util::new_id();
    }
    copy.updated_at = crate::util::now_ms();
    core.project.update(|p| p.overlays.push(copy.clone()));
    project_changed(&core);
    Ok(copy)
}

#[tauri::command]
pub fn save_alerts(core: Ctx, config: AlertConfig) -> AppResult<()> {
    core.project.update(|p| p.alerts = config);
    project_changed(&core);
    Ok(())
}

#[tauri::command]
pub fn save_actions(core: Ctx, mut actions: Vec<Action>) -> AppResult<()> {
    for a in &mut actions {
        a.normalize();
    }
    let mut ids = std::collections::HashSet::new();
    if !actions.iter().all(|a| ids.insert(a.id.clone())) {
        return user_err("Two actions have the same id.");
    }
    core.project.update(|p| p.actions = actions);
    project_changed(&core);
    Ok(())
}

#[tauri::command]
pub fn rename_project(core: Ctx, name: String) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return user_err("The name can't be empty.");
    }
    core.project.update(|p| p.name = name.to_string());
    project_changed(&core);
    Ok(())
}

#[tauri::command]
pub fn export_overlay(core: Ctx, id: String, path: String) -> AppResult<()> {
    let Some(overlay) = core
        .project
        .read(|p| p.overlays.iter().find(|o| o.id == id).cloned())
    else {
        return Err(AppError::NotFound("overlay".into()));
    };
    crate::store::package::export(&core.project, &overlay, &PathBuf::from(path))
}

#[tauri::command]
pub async fn import_overlay(core: Ctx<'_>, path: String) -> AppResult<Overlay> {
    let c = core.inner().clone();
    let overlay = tokio::task::spawn_blocking(move || {
        crate::store::package::import(&c.project, &PathBuf::from(path))
    })
    .await
    .map_err(|e| AppError::User(e.to_string()))??;
    core.project.update(|p| p.overlays.push(overlay.clone()));
    project_changed(&core);
    Ok(overlay)
}

#[tauri::command]
pub fn list_assets(core: Ctx) -> Vec<AssetInfo> {
    core.project.assets()
}

#[tauri::command]
pub async fn import_assets(core: Ctx<'_>, paths: Vec<String>) -> AppResult<Vec<AssetInfo>> {
    let c = core.inner().clone();
    tokio::task::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| c.project.import_asset(&PathBuf::from(p)))
            .collect::<AppResult<Vec<_>>>()
    })
    .await
    .map_err(|e| AppError::User(e.to_string()))?
}

#[tauri::command]
pub fn delete_asset(core: Ctx, name: String) -> AppResult<()> {
    core.project.delete_asset(&name)
}

/// Run blocking file work off the UI thread.
async fn blocking<T: Send + 'static>(
    core: &Arc<Core>,
    f: impl FnOnce(&Core) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let c = core.clone();
    tokio::task::spawn_blocking(move || f(&c))
        .await
        .map_err(|e| AppError::User(e.to_string()))?
}

#[tauri::command]
pub async fn list_backups(core: Ctx<'_>) -> AppResult<Vec<BackupInfo>> {
    blocking(&core, |c| Ok(c.backups.list())).await
}

/// None when nothing changed since the last backup.
#[tauri::command]
pub async fn create_backup(core: Ctx<'_>) -> AppResult<Option<BackupInfo>> {
    blocking(&core, |c| c.backup(BackupReason::Manual)).await
}

#[tauri::command]
pub async fn restore_backup(core: Ctx<'_>, file: String) -> AppResult<Project> {
    blocking(&core, move |c| {
        let path = c.backups.path_of(&file)?;
        c.restore(&path, BackupReason::BeforeRestore)
    })
    .await
}

/// Restore from a `.cwbackup` or `project.json` anywhere on disk.
#[tauri::command]
pub async fn restore_backup_file(core: Ctx<'_>, path: String) -> AppResult<Project> {
    blocking(&core, move |c| {
        c.restore(&PathBuf::from(path), BackupReason::BeforeImport)
    })
    .await
}

#[tauri::command]
pub async fn delete_backup(core: Ctx<'_>, file: String) -> AppResult<()> {
    blocking(&core, move |c| c.backups.delete(&file)).await
}

#[tauri::command]
pub async fn export_backup(core: Ctx<'_>, file: String, path: String) -> AppResult<()> {
    blocking(&core, move |c| {
        c.backups.export(&file, &PathBuf::from(path))
    })
    .await
}

#[tauri::command]
pub async fn save_backup_settings(
    core: Ctx<'_>,
    backups: BackupSettings,
) -> AppResult<BackupSettings> {
    let b = backups.clamped();
    core.settings.update(|s| s.backups = b.clone())?;
    let keep = b.clone();
    blocking(&core, move |c| {
        c.backups.prune(&keep);
        Ok(())
    })
    .await?;
    Ok(b)
}

#[tauri::command]
pub fn project_dir(core: Ctx) -> String {
    core.project_dir().to_string_lossy().into_owned()
}

/// Use a different project folder from the next start.
#[tauri::command]
pub fn set_project_dir(core: Ctx, dir: String) -> AppResult<()> {
    if !dir.is_empty() && !PathBuf::from(&dir).is_dir() {
        return user_err("That folder doesn't exist.");
    }
    core.settings.update(|s| s.project_dir = dir)?;
    Ok(())
}

// ---------- alerts ----------

#[tauri::command]
pub fn alert_queue(core: Ctx) -> QueueState {
    core.alerts.queue_state()
}

#[tauri::command]
pub fn alert_pause(core: Ctx, paused: bool) {
    core.alerts.set_paused(paused);
}

#[tauri::command]
pub fn alert_skip(core: Ctx) {
    core.alerts.skip();
}

#[tauri::command]
pub fn alert_remove(core: Ctx, id: String) {
    core.alerts.remove(&id);
}

#[tauri::command]
pub fn alert_clear(core: Ctx) {
    core.alerts.clear();
}

#[tauri::command]
pub fn alert_replay(core: Ctx, event_id: String) -> AppResult<()> {
    core.alerts.replay(&event_id)
}

#[tauri::command]
pub fn alert_replay_last(core: Ctx) -> AppResult<()> {
    core.alerts.replay_last()
}

#[tauri::command]
pub fn alert_mute(core: Ctx, muted: bool) -> AppResult<()> {
    core.alerts.set_muted(muted)
}

/// Send a sample event through the whole app (alerts, automation, overlays).
#[tauri::command]
pub fn test_event(core: Ctx, kind: EventKind) {
    core.hub.publish(crate::alerts::samples::sample_event(kind));
}

// ---------- automation ----------

#[tauri::command]
pub fn run_action(core: Ctx, id: String) -> AppResult<()> {
    core.automation.run_manual(&id)
}

// ---------- variables ----------

#[tauri::command]
pub fn get_vars(core: Ctx) -> Map<String, Value> {
    core.hub.vars.snapshot()
}

#[tauri::command]
pub fn set_var(core: Ctx, key: String, value: Value, persist: bool) -> AppResult<()> {
    if !crate::vars::valid_key(&key) {
        return user_err("Variable names can use letters, numbers, dots, dashes and underscores.");
    }
    core.hub.set_var(&key, value, persist);
    Ok(())
}

#[tauri::command]
pub fn delete_var(core: Ctx, key: String) {
    core.hub.delete_var(&key);
}

#[tauri::command]
pub fn reset_session(core: Ctx) {
    let ch = core.hub.vars.reset_session();
    core.hub.broadcast_vars(ch);
}

// ---------- history and logs ----------

#[tauri::command]
pub fn recent_events(
    core: Ctx,
    limit: u32,
    kinds: Vec<String>,
    search: String,
    include_tests: bool,
) -> AppResult<Vec<Event>> {
    core.hub
        .db
        .recent_events(limit, &kinds, &search, include_tests)
}

#[tauri::command]
pub fn recent_chat(core: Ctx) -> Vec<Event> {
    core.hub.recent_chat()
}

#[tauri::command]
pub fn clear_history(core: Ctx) -> AppResult<()> {
    core.hub.db.clear_events()
}

#[tauri::command]
pub fn export_history_csv(core: Ctx, path: String) -> AppResult<u32> {
    let events = core.hub.db.recent_events(5000, &[], "", false)?;
    let csv = history_csv(&events);
    crate::util::write_atomic(&PathBuf::from(path), csv.as_bytes())?;
    Ok(events.len() as u32)
}

pub fn history_csv(events: &[Event]) -> String {
    fn cell(s: &str) -> String {
        // Prevent spreadsheet formula injection and quote everything.
        let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
            format!("'{s}")
        } else {
            s.to_string()
        };
        format!("\"{}\"", s.replace('"', "\"\""))
    }
    let mut out = String::from("time,kind,user,amount,currency,tier,months,message\r\n");
    for e in events {
        let time = format_rfc3339(e.ts);
        let user = e
            .user
            .as_ref()
            .map(|u| u.display_name.as_str())
            .unwrap_or("");
        let amount = e
            .amount
            .map(crate::model::condition::format_number)
            .unwrap_or_default();
        let row = [
            time,
            e.kind.as_str().to_string(),
            user.to_string(),
            amount,
            e.currency.clone().unwrap_or_default(),
            e.tier.map(|t| t.to_string()).unwrap_or_default(),
            e.months.map(|m| m.to_string()).unwrap_or_default(),
            e.message.clone().unwrap_or_default(),
        ];
        out.push_str(&row.iter().map(|c| cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

/// UTC timestamp without pulling in a date library.
pub fn format_rfc3339(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[tauri::command]
pub fn get_logs(core: Ctx) -> Vec<LogEntry> {
    core.hub.logs()
}

// ---------- server ----------

#[tauri::command]
pub fn server_info(core: Ctx) -> ServerInfo {
    core.server.info()
}

#[tauri::command]
pub fn overlay_url(core: Ctx, id: String) -> AppResult<String> {
    core.server
        .overlay_url(&id)
        .ok_or_else(|| AppError::User("The overlay server isn't running.".into()))
}

#[tauri::command]
pub fn regenerate_token(core: Ctx) -> AppResult<ServerInfo> {
    let token = crate::util::random_token();
    core.settings.update(|s| s.server.token = token.clone())?;
    core.server.set_token(token);
    let info = core.server.info();
    core.hub.emit_ui(ui::SERVER, &info);
    Ok(info)
}

#[tauri::command]
pub async fn restart_server(core: Ctx<'_>, port: u16, allow_lan: bool) -> AppResult<ServerInfo> {
    if port < 1024 {
        return user_err("Use a port between 1024 and 65535.");
    }
    core.settings.update(|s| {
        s.server.port = port;
        s.server.allow_lan = allow_lan;
    })?;
    let info = core.server.start(port, allow_lan).await;
    core.hub.emit_ui(ui::SERVER, &info);
    Ok(info)
}

// ---------- twitch ----------

use crate::model::runtime::{AccountRole, DeviceLogin, TwitchStatus};
use crate::services::TwitchActions;
use crate::twitch::Category;

#[tauri::command]
pub fn twitch_status(core: Ctx) -> TwitchStatus {
    core.twitch.status()
}

#[tauri::command]
pub async fn twitch_login(core: Ctx<'_>, role: AccountRole) -> AppResult<DeviceLogin> {
    core.twitch.start_login(role).await
}

#[tauri::command]
pub fn twitch_cancel_login(core: Ctx, role: AccountRole) {
    core.twitch.cancel_login(role);
}

#[tauri::command]
pub async fn twitch_logout(core: Ctx<'_>, role: AccountRole) -> AppResult<()> {
    core.twitch.logout(role).await
}

#[tauri::command]
pub async fn twitch_search_categories(core: Ctx<'_>, query: String) -> AppResult<Vec<Category>> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    core.twitch.search_categories(query.trim()).await
}

#[tauri::command]
pub async fn twitch_update_stream_info(
    core: Ctx<'_>,
    title: String,
    category_id: String,
    tags: Vec<String>,
) -> AppResult<()> {
    if title.chars().count() > 140 {
        return user_err("Stream titles can be at most 140 characters.");
    }
    if tags.len() > 10 {
        return user_err("Twitch allows at most 10 tags.");
    }
    core.twitch
        .update_stream_info(&title, &category_id, tags)
        .await
}

#[tauri::command]
pub async fn twitch_send_chat(core: Ctx<'_>, message: String, as_bot: bool) -> AppResult<()> {
    core.twitch.send_chat(&message, as_bot, None).await
}

// ---------- obs ----------

use crate::model::runtime::ObsSnapshot;

#[tauri::command]
pub fn obs_snapshot(core: Ctx) -> ObsSnapshot {
    core.obs.snapshot()
}

#[tauri::command]
pub async fn obs_connect(core: Ctx<'_>) -> AppResult<()> {
    core.obs.connect().await
}

#[tauri::command]
pub async fn obs_disconnect(core: Ctx<'_>) -> AppResult<()> {
    core.obs.disconnect().await
}

#[tauri::command]
pub async fn obs_test_connection(
    core: Ctx<'_>,
    host: String,
    port: u16,
    password: Option<String>,
) -> AppResult<String> {
    // An empty password box with a saved password means "use the saved one".
    let saved = if password.is_none() && core.settings.get().obs.has_password {
        core.secrets.get(crate::store::secrets::keys::OBS_PASSWORD)
    } else {
        None
    };
    let pw = password.or(saved);
    core.obs
        .test_connection(host.trim(), port, pw.as_deref().filter(|p| !p.is_empty()))
        .await
}

#[tauri::command]
pub async fn obs_save_connection(
    core: Ctx<'_>,
    host: String,
    port: u16,
    password: Option<String>,
    keep_password: bool,
    auto_connect: bool,
) -> AppResult<()> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return user_err("Enter the address of the computer running OBS (usually 127.0.0.1).");
    }
    if port == 0 {
        return user_err("Enter the OBS WebSocket port (usually 4455).");
    }
    core.settings.update(|s| {
        s.obs.host = host;
        s.obs.port = port;
        s.obs.auto_connect = auto_connect;
    })?;
    if !keep_password {
        core.obs.save_password(password.filter(|p| !p.is_empty()))?;
    }
    let _ = core.obs.disconnect().await;
    core.obs.start();
    if !auto_connect {
        core.obs.connect().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn obs_set_program_scene(core: Ctx<'_>, scene: String) -> AppResult<()> {
    core.obs.set_program_scene(&scene).await
}

#[tauri::command]
pub async fn obs_set_preview_scene(core: Ctx<'_>, scene: String) -> AppResult<()> {
    core.obs.set_preview_scene(&scene).await
}

#[tauri::command]
pub async fn obs_set_studio_mode(core: Ctx<'_>, enabled: bool) -> AppResult<()> {
    core.obs.set_studio_mode(enabled).await
}

#[tauri::command]
pub async fn obs_transition(core: Ctx<'_>) -> AppResult<()> {
    core.obs.trigger_transition().await
}

#[tauri::command]
pub async fn obs_set_transition(core: Ctx<'_>, name: String) -> AppResult<()> {
    core.obs.set_transition(&name).await
}

#[tauri::command]
pub async fn obs_set_transition_duration(core: Ctx<'_>, ms: u32) -> AppResult<()> {
    core.obs.set_transition_duration(ms.min(20_000)).await
}

#[tauri::command]
pub async fn obs_stream(core: Ctx<'_>, action: String) -> AppResult<()> {
    match action.as_str() {
        "start" => core.obs.start_stream().await,
        "stop" => core.obs.stop_stream().await,
        "toggle" => core.obs.toggle_stream().await,
        _ => user_err("Unknown stream action."),
    }
}

#[tauri::command]
pub async fn obs_record(core: Ctx<'_>, action: String) -> AppResult<()> {
    match action.as_str() {
        "start" => core.obs.start_record().await,
        "stop" => core.obs.stop_record().await,
        "toggle" => core.obs.toggle_record().await,
        "pause" => core.obs.pause_record().await,
        "resume" => core.obs.resume_record().await,
        _ => user_err("Unknown recording action."),
    }
}

#[tauri::command]
pub async fn obs_replay(core: Ctx<'_>, action: String) -> AppResult<()> {
    match action.as_str() {
        "toggle" => core.obs.toggle_replay_buffer().await,
        "save" => core.obs.save_replay().await,
        _ => user_err("Unknown replay action."),
    }
}

#[tauri::command]
pub async fn obs_virtual_cam(core: Ctx<'_>) -> AppResult<()> {
    core.obs.toggle_virtual_cam().await
}

#[tauri::command]
pub async fn obs_set_volume(core: Ctx<'_>, input: String, db: f64) -> AppResult<()> {
    core.obs
        .set_input_volume_db(&input, db.clamp(-100.0, 26.0))
        .await
}

#[tauri::command]
pub async fn obs_set_mute(core: Ctx<'_>, input: String, muted: bool) -> AppResult<()> {
    core.obs.set_input_mute(&input, muted).await
}

#[tauri::command]
pub async fn obs_set_monitoring(core: Ctx<'_>, input: String, enabled: bool) -> AppResult<()> {
    core.obs.set_input_monitoring(&input, enabled).await
}

#[tauri::command]
pub async fn obs_set_item_enabled(
    core: Ctx<'_>,
    scene: String,
    item_id: i64,
    enabled: bool,
) -> AppResult<()> {
    core.obs
        .set_scene_item_enabled(&scene, item_id, enabled)
        .await
}

#[tauri::command]
pub async fn obs_set_item_locked(
    core: Ctx<'_>,
    scene: String,
    item_id: i64,
    locked: bool,
) -> AppResult<()> {
    core.obs
        .set_scene_item_locked(&scene, item_id, locked)
        .await
}

#[tauri::command]
pub async fn obs_levels(core: Ctx<'_>, enabled: bool) -> AppResult<()> {
    core.obs.set_levels_enabled(enabled).await
}

#[tauri::command]
pub async fn obs_screenshot(core: Ctx<'_>, source: String, width: u32) -> AppResult<String> {
    core.obs.screenshot(&source, width.clamp(64, 1920)).await
}

/// Add (or update) a Browser Source for an overlay in an OBS scene.
#[tauri::command]
pub async fn obs_add_overlay(core: Ctx<'_>, overlay_id: String, scene: String) -> AppResult<()> {
    let Some(overlay) = core
        .project
        .read(|p| p.overlays.iter().find(|o| o.id == overlay_id).cloned())
    else {
        return Err(AppError::NotFound("overlay".into()));
    };
    let url = core
        .server
        .overlay_url(&overlay.id)
        .ok_or_else(|| AppError::User("The overlay server isn't running.".into()))?;
    let name = format!("Castwright · {}", overlay.name);
    core.obs
        .ensure_browser_source(&scene, &name, &url, overlay.width, overlay.height)
        .await
}

// ---------- settings ----------

#[tauri::command]
pub fn get_settings(core: Ctx) -> Settings {
    core.settings.get()
}

#[tauri::command]
pub fn save_appearance(core: Ctx, appearance: AppearanceSettings) -> AppResult<()> {
    let mut a = appearance;
    a.ui_scale = a.ui_scale.clamp(50, 250);
    if a.custom_themes.len() > 100 {
        return user_err("That's too many custom themes (100 max).");
    }
    core.settings.update(|s| s.appearance = a)?;
    Ok(())
}

#[tauri::command]
pub fn set_first_run_done(core: Ctx, done: bool) -> AppResult<()> {
    core.settings.update(|s| s.first_run_done = done)?;
    Ok(())
}

#[tauri::command]
pub async fn set_twitch_client_id(core: Ctx<'_>, client_id: String) -> AppResult<()> {
    let id = client_id.trim().to_string();
    if !id.is_empty() && (id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric())) {
        return user_err("That doesn't look like a Twitch client ID.");
    }
    if core.twitch.client_id().unwrap_or_default() == id {
        core.settings.update(|s| s.twitch.client_id = id)?;
        return Ok(());
    }
    // Sign-ins belong to the old app, so sign out before switching.
    for role in [AccountRole::Bot, AccountRole::Broadcaster] {
        core.twitch.logout(role).await?;
    }
    core.settings.update(|s| s.twitch.client_id = id)?;
    Ok(())
}

const CHECKLIST_MAX: usize = 30;
const CHECKLIST_LABEL_MAX: usize = 80;

pub fn clean_golive(mut g: GoLiveSettings) -> AppResult<GoLiveSettings> {
    g.items.retain(|i| !i.label.trim().is_empty());
    if g.items.len() > CHECKLIST_MAX {
        return user_err(format!("Keep the list to {CHECKLIST_MAX} items or fewer."));
    }
    let mut ids = std::collections::HashSet::new();
    for item in &mut g.items {
        item.label = item
            .label
            .trim()
            .chars()
            .take(CHECKLIST_LABEL_MAX)
            .collect();
        if item.id.trim().is_empty() || !ids.insert(item.id.clone()) {
            item.id = crate::util::new_id();
            ids.insert(item.id.clone());
        }
    }
    Ok(g)
}

#[tauri::command]
pub fn save_golive(core: Ctx, golive: GoLiveSettings) -> AppResult<GoLiveSettings> {
    let g = clean_golive(golive)?;
    core.settings.update(|s| s.golive = g.clone())?;
    Ok(g)
}

#[tauri::command]
pub async fn golive_check(core: Ctx<'_>) -> AppResult<Vec<crate::golive::Check>> {
    let input = crate::golive::gather(&core).await;
    Ok(crate::golive::evaluate(&input))
}

#[tauri::command]
pub async fn golive_fix(core: Ctx<'_>, fix: crate::golive::CheckFix) -> AppResult<()> {
    crate::golive::fix(&core, fix).await
}

#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub project_dir: String,
    pub config_dir: String,
    pub backup_dir: String,
    pub secrets_in_file: bool,
    pub built_in_client_id: bool,
}

#[tauri::command]
pub fn app_info(core: Ctx) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        project_dir: core.project_dir().to_string_lossy().into_owned(),
        config_dir: core.paths.config_dir.to_string_lossy().into_owned(),
        backup_dir: core.backups.dir().to_string_lossy().into_owned(),
        secrets_in_file: core.secrets.using_file(),
        built_in_client_id: option_env!("CASTWRIGHT_TWITCH_CLIENT_ID")
            .is_some_and(|s| !s.is_empty()),
    }
}

/// Apply a window effect. Returns the effect actually in use (Solid when unsupported).
#[tauri::command]
pub fn set_window_effect(
    core: Ctx,
    window: tauri::WebviewWindow,
    effect: WindowEffect,
    dark: bool,
) -> AppResult<WindowEffect> {
    let applied = crate::window::apply_effect(&window, effect, dark);
    core.settings
        .update(|s| s.appearance.window_effect = effect)?;
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339() {
        assert_eq!(format_rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339(1_793_522_947_000), "2026-11-01T08:49:07Z");
        assert_eq!(format_rfc3339(951_782_400_000), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn checklist_is_cleaned() {
        use crate::model::settings::ChecklistItem;
        let item = |id: &str, label: &str| ChecklistItem {
            id: id.into(),
            label: label.into(),
        };
        let g = clean_golive(GoLiveSettings {
            open_on_live: false,
            items: vec![
                item("a", "  Mic on "),
                item("", "Water"),
                item("a", "Cam"),
                item("b", "  "),
            ],
        })
        .unwrap();
        let labels: Vec<_> = g.items.iter().map(|i| i.label.as_str()).collect();
        assert_eq!(labels, ["Mic on", "Water", "Cam"]);
        assert_eq!(g.items[0].id, "a");
        assert!(!g.items[1].id.is_empty());
        assert_ne!(g.items[2].id, "a", "duplicate ids are replaced");
        let too_many = GoLiveSettings {
            open_on_live: true,
            items: (0..31).map(|n| item("", &n.to_string())).collect(),
        };
        assert!(clean_golive(too_many).is_err());
    }

    #[test]
    fn csv_is_escaped() {
        let mut e = Event::new(EventKind::Cheer).with_user("a", "A \"quoted\"");
        e.ts = 0;
        e.amount = Some(100.0);
        e.message = Some("=HYPERLINK(\"x\")".into());
        let csv = history_csv(&[e]);
        let line = csv.lines().nth(1).unwrap();
        assert!(line.contains("\"A \"\"quoted\"\"\""));
        assert!(line.contains("\"'=HYPERLINK(\"\"x\"\")\""));
        assert!(line.contains("\"100\""));
    }
}
