//! Tests against a real OBS. Start one with `tests/obs/run-obs.sh`, export what it
//! prints, then run `cargo test --lib -- --ignored obs`.

use super::*;
use crate::hub::RecordingUi;
use crate::store::db::Db;
use crate::vars::Vars;
use base64::Engine;
use serde_json::json;
use std::sync::OnceLock;
use tokio::sync::broadcast;

const WAIT: Duration = Duration::from_secs(10);

struct Env {
    host: String,
    port: u16,
    password: String,
}

fn env() -> Option<Env> {
    let raw = std::env::var("OBS_TEST_URL").ok()?;
    let url = url::Url::parse(&raw).expect("OBS_TEST_URL like ws://127.0.0.1:4455");
    Some(Env {
        host: url.host_str().unwrap_or("127.0.0.1").to_string(),
        port: url.port().unwrap_or(4455),
        password: std::env::var("OBS_TEST_PASSWORD").unwrap_or_default(),
    })
}

/// Tests share one OBS, so they take turns.
async fn serial() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

struct Rig {
    svc: Arc<ObsService>,
    hub: Arc<Hub>,
    ui: Arc<RecordingUi>,
    _dir: tempfile::TempDir,
}

fn rig(env: Env, auto_connect: bool) -> Rig {
    let ui = Arc::new(RecordingUi::default());
    let hub = Hub::new(
        ui.clone(),
        Arc::new(Vars::new()),
        Arc::new(Db::open_in_memory()),
    );
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    settings
        .update(|s| {
            s.obs.host = env.host.clone();
            s.obs.port = env.port;
            s.obs.auto_connect = auto_connect;
        })
        .unwrap();
    let svc = ObsService::new(hub.clone(), Arc::new(Secrets::in_memory()), settings);
    svc.save_password(Some(env.password.clone())).unwrap();
    Rig {
        svc,
        hub,
        ui,
        _dir: dir,
    }
}

/// Connected rig with OBS put back into its starting state.
async fn connected() -> Option<Rig> {
    let env = env()?;
    let r = rig(env, false);
    // OBS opens its port a little before it accepts logins.
    let end = Instant::now() + WAIT;
    loop {
        match r.svc.connect().await {
            Ok(()) => break,
            Err(e) if Instant::now() < end => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            Err(e) => panic!("connect: {e}"),
        }
    }
    let c = r.svc.client().unwrap();
    let _ = c
        .request(
            "SetStudioModeEnabled",
            json!({ "studioModeEnabled": false }),
        )
        .await;
    let _ = c.request("StopRecord", Value::Null).await;
    let _ = c.request("StopReplayBuffer", Value::Null).await;
    let _ = c
        .request("SetCurrentProgramScene", json!({ "sceneName": "Scene A" }))
        .await;
    wait_for(&r.svc, "reset", |s| {
        !s.studio_mode
            && !s.record.active
            && s.program_scene == "Scene A"
            && s.scene_items.len() >= 2
    })
    .await;
    Some(r)
}

async fn wait_for(svc: &ObsService, what: &str, f: impl Fn(&ObsSnapshot) -> bool) -> ObsSnapshot {
    wait_for_in(svc, what, WAIT, f).await
}

async fn wait_for_in(
    svc: &ObsService,
    what: &str,
    limit: Duration,
    f: impl Fn(&ObsSnapshot) -> bool,
) -> ObsSnapshot {
    let end = Instant::now() + limit;
    loop {
        let s = svc.snapshot();
        if f(&s) {
            return s;
        }
        if Instant::now() > end {
            panic!("timed out waiting for {what}; snapshot: {s:#?}");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn expect_signal(rx: &mut broadcast::Receiver<Signal>, want: Signal, limit: Duration) {
    let end = Instant::now() + limit;
    loop {
        let left = end.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, rx.recv()).await {
            Ok(Ok(s)) if s == want => return,
            Ok(Ok(_)) | Ok(Err(broadcast::error::RecvError::Lagged(_))) => {}
            _ => panic!("no {want:?} signal"),
        }
    }
}

fn item<'a>(s: &'a ObsSnapshot, name: &str) -> &'a SceneItem {
    s.scene_items
        .iter()
        .find(|i| i.name == name)
        .unwrap_or_else(|| panic!("no item {name} in {:?}", s.scene_items))
}

fn input<'a>(s: &'a ObsSnapshot, name: &str) -> &'a AudioInput {
    s.inputs
        .iter()
        .find(|i| i.name == name)
        .unwrap_or_else(|| panic!("no input {name} in {:?}", s.inputs))
}

/// Removes an input and waits until the name is free. The test OBS only frees a
/// removed input once its scene items are gone too, so those are removed first.
async fn remove_input(c: &ObsClient, name: &str) {
    for scene in ["Scene A", "Scene B"] {
        let list = c
            .request("GetSceneItemList", json!({ "sceneName": scene }))
            .await
            .unwrap();
        for it in list["sceneItems"].as_array().unwrap() {
            if it["sourceName"] == name {
                let id = &it["sceneItemId"];
                let _ = c
                    .request(
                        "RemoveSceneItem",
                        json!({ "sceneName": scene, "sceneItemId": id }),
                    )
                    .await;
            }
        }
    }
    let _ = c.request("RemoveInput", json!({ "inputName": name })).await;
    let end = Instant::now() + WAIT;
    while c
        .request("GetInputSettings", json!({ "inputName": name }))
        .await
        .is_ok()
    {
        assert!(Instant::now() < end, "{name} wasn't removed");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn script(action: &str) {
    let dir = std::env::var("OBS_TEST_DIR").expect("OBS_TEST_DIR");
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/obs/run-obs.sh");
    let out = std::process::Command::new("bash")
        .arg(path)
        .arg(action)
        .env("OBS_TEST_DIR", dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "run-obs.sh {action}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_snapshot_after_connect() {
    let _g = serial().await;
    let Some(env) = env() else { return };
    let r = rig(env, false);
    let mut sig = r.hub.subscribe_signals();
    r.svc.connect().await.unwrap();
    expect_signal(&mut sig, Signal::ObsConnected, WAIT).await;
    r.svc.set_program_scene("Scene A").await.unwrap();
    r.svc.set_studio_mode(false).await.unwrap();
    let s = wait_for(&r.svc, "scene A", |s| {
        s.program_scene == "Scene A" && !s.studio_mode
    })
    .await;

    assert_eq!(s.state, ConnState::Connected);
    assert!(s.obs_version.starts_with("30."), "{}", s.obs_version);
    assert!(s.websocket_version.starts_with("5."));
    assert_eq!(s.scenes, vec!["Scene A", "Scene B"]);
    assert_eq!(s.preview_scene, None);
    assert_eq!((s.base_width, s.base_height), (1280, 720));
    let names: Vec<_> = s.scene_items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(&names[names.len() - 2..], ["Music", "Red"], "top first");
    assert_eq!(item(&s, "Red").kind, "color_source_v3");
    assert_eq!(item(&s, "Music").kind, "ffmpeg_source");
    assert!(
        s.inputs.iter().all(|i| i.name != "Red"),
        "no audio on colour sources"
    );
    assert_eq!(input(&s, "Music").kind, "ffmpeg_source");
    assert!(s.transitions.contains(&"Fade".to_string()));
    assert!(s.transitions.contains(&"Cut".to_string()));
    assert!(!s.current_transition.is_empty());
    assert_eq!(s.replay_buffer, Some(false), "enabled in the test profile");

    assert_eq!(r.hub.vars.get("obs.connected"), Some(Value::Bool(true)));
    assert_eq!(
        r.hub.vars.get("obs.scene"),
        Some(Value::String("Scene A".into()))
    );
    assert_eq!(r.hub.vars.get("obs.streaming"), Some(Value::Bool(false)));
    let emitted = r.ui.0.lock().unwrap();
    assert!(
        emitted
            .iter()
            .any(|(n, v)| n == ui::OBS && v["state"] == "connected")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_wrong_password_and_ports() {
    let _g = serial().await;
    let Some(env) = env() else { return };
    let (host, port, password) = (env.host.clone(), env.port, env.password.clone());
    let r = rig(env, false);

    r.svc
        .save_password(Some("not-the-password".into()))
        .unwrap();
    let e = r.svc.connect().await.unwrap_err().to_string();
    assert!(e.contains("didn't accept the password"), "{e}");
    let s = r.svc.snapshot();
    assert_eq!(s.state, ConnState::Error);
    assert_eq!(s.error.as_deref(), Some(e.as_str()));
    assert!(!r.svc.is_connected());

    r.svc.save_password(None).unwrap();
    assert!(!r.svc.settings.get().obs.has_password);
    let e = r.svc.connect().await.unwrap_err().to_string();
    assert!(e.contains("needs a password"), "{e}");

    let v = r
        .svc
        .test_connection(&host, port, Some(&password))
        .await
        .unwrap();
    assert!(v.starts_with("30."), "{v}");
    let e = r
        .svc
        .test_connection(&host, port, Some("nope"))
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("password"), "{e}");

    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let free = closed.local_addr().unwrap().port();
    drop(closed);
    let e = r
        .svc
        .test_connection("127.0.0.1", free, None)
        .await
        .unwrap_err()
        .to_string();
    // OBS is running here, so the hint is about the WebSocket server settings.
    assert!(e.contains("Tools → WebSocket Server Settings"), "{e}");
    assert!(e.contains(&free.to_string()), "{e}");

    // Something that isn't OBS.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let other = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        while let Ok((mut s, _)) = listener.accept().await {
            let _ = s
                .write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n")
                .await;
        }
    });
    let e = r
        .svc
        .test_connection("127.0.0.1", other, None)
        .await
        .unwrap_err()
        .to_string();
    server.abort();
    assert!(e.contains("isn't OBS"), "{e}");

    r.svc.save_password(Some(password)).unwrap();
    r.svc.connect().await.unwrap();
    assert_eq!(r.svc.snapshot().state, ConnState::Connected);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_scene_switch() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let mut sig = r.hub.subscribe_signals();

    r.svc.set_program_scene("Scene B").await.unwrap();
    expect_signal(
        &mut sig,
        Signal::SceneChanged {
            scene: "Scene B".into(),
        },
        WAIT,
    )
    .await;
    let s = wait_for(&r.svc, "scene B items", |s| {
        s.program_scene == "Scene B" && s.scene_items.iter().any(|i| i.name == "Blue")
    })
    .await;
    assert!(s.scene_items.iter().all(|i| i.name != "Red"));
    assert_eq!(
        r.hub.vars.get("obs.scene"),
        Some(Value::String("Scene B".into()))
    );

    ObsActions::switch_scene(&*r.svc, "Scene A").await.unwrap();
    wait_for(&r.svc, "back to A", |s| s.program_scene == "Scene A").await;

    let e = r.svc.set_program_scene("Nope").await.unwrap_err();
    assert!(matches!(e, AppError::Obs(_)), "{e}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_studio_mode() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };

    let e = r
        .svc
        .set_preview_scene("Scene B")
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("Studio Mode"), "{e}");

    r.svc.set_studio_mode(true).await.unwrap();
    wait_for(&r.svc, "studio mode", |s| {
        s.studio_mode && s.preview_scene.is_some()
    })
    .await;
    r.svc.set_preview_scene("Scene B").await.unwrap();
    let s = wait_for(&r.svc, "preview B items", |s| {
        s.preview_scene.as_deref() == Some("Scene B")
            && s.scene_items.iter().any(|i| i.name == "Blue")
    })
    .await;
    assert_eq!(s.program_scene, "Scene A", "program untouched");

    r.svc.set_transition("Cut").await.unwrap();
    wait_for(&r.svc, "cut", |s| s.current_transition == "Cut").await;
    r.svc.trigger_transition().await.unwrap();
    wait_for(&r.svc, "program B", |s| s.program_scene == "Scene B").await;

    r.svc.set_transition("Fade").await.unwrap();
    r.svc.set_transition_duration(450).await.unwrap();
    wait_for(&r.svc, "fade 450", |s| {
        s.current_transition == "Fade" && s.transition_ms == 450
    })
    .await;

    r.svc.set_studio_mode(false).await.unwrap();
    let s = wait_for(&r.svc, "studio off", |s| !s.studio_mode).await;
    assert_eq!(s.preview_scene, None);
    r.svc.set_transition_duration(300).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_scene_item_visibility() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let red = item(&r.svc.snapshot(), "Red").id;

    r.svc
        .set_scene_item_enabled("Scene A", red, false)
        .await
        .unwrap();
    wait_for(&r.svc, "red hidden", |s| !item(s, "Red").visible).await;

    ObsActions::set_source_visible(&*r.svc, "", "Red", Toggle::Toggle)
        .await
        .unwrap();
    wait_for(&r.svc, "red shown", |s| item(s, "Red").visible).await;
    ObsActions::set_source_visible(&*r.svc, "Scene A", "Red", Toggle::Off)
        .await
        .unwrap();
    wait_for(&r.svc, "red hidden again", |s| !item(s, "Red").visible).await;
    ObsActions::set_source_visible(&*r.svc, "Scene A", "Red", Toggle::On)
        .await
        .unwrap();
    wait_for(&r.svc, "red on", |s| item(s, "Red").visible).await;

    r.svc
        .set_scene_item_locked("Scene A", red, true)
        .await
        .unwrap();
    wait_for(&r.svc, "locked", |s| item(s, "Red").locked).await;
    r.svc
        .set_scene_item_locked("Scene A", red, false)
        .await
        .unwrap();
    wait_for(&r.svc, "unlocked", |s| !item(s, "Red").locked).await;

    let e = ObsActions::set_source_visible(&*r.svc, "Scene A", "Ghost", Toggle::On)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("no source \"Ghost\""), "{e}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_audio() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };

    r.svc.set_input_volume_db("Music", -20.0).await.unwrap();
    wait_for(&r.svc, "-20 dB", |s| {
        (input(s, "Music").volume_db + 20.0).abs() < 0.05
    })
    .await;
    r.svc.set_input_volume_db("Music", -500.0).await.unwrap();
    wait_for(&r.svc, "silent", |s| input(s, "Music").volume_db == -100.0).await;
    r.svc.set_input_volume_db("Music", -6.0).await.unwrap();

    r.svc.set_input_mute("Music", true).await.unwrap();
    wait_for(&r.svc, "muted", |s| input(s, "Music").muted).await;
    ObsActions::set_input_mute(&*r.svc, "Music", Toggle::Toggle)
        .await
        .unwrap();
    wait_for(&r.svc, "unmuted", |s| !input(s, "Music").muted).await;
    ObsActions::set_input_mute(&*r.svc, "Music", Toggle::On)
        .await
        .unwrap();
    wait_for(&r.svc, "muted (action)", |s| input(s, "Music").muted).await;
    r.svc.set_input_mute("Music", false).await.unwrap();

    r.svc.set_input_monitoring("Music", true).await.unwrap();
    wait_for(&r.svc, "monitoring", |s| input(s, "Music").monitoring).await;
    r.svc.set_input_monitoring("Music", false).await.unwrap();
    wait_for(&r.svc, "monitoring off", |s| !input(s, "Music").monitoring).await;

    // A new audio input shows up in the mixer and goes away again.
    let c = r.svc.client().unwrap();
    remove_input(&c, "Clip").await;
    remove_input(&c, "Clip 2").await;
    c.request(
        "CreateInput",
        json!({ "sceneName": "Scene B", "inputName": "Clip", "inputKind": "ffmpeg_source" }),
    )
    .await
    .unwrap();
    wait_for(&r.svc, "clip input", |s| {
        s.inputs.iter().any(|i| i.name == "Clip")
    })
    .await;
    c.request(
        "SetInputName",
        json!({ "inputName": "Clip", "newInputName": "Clip 2" }),
    )
    .await
    .unwrap();
    wait_for(&r.svc, "renamed", |s| {
        s.inputs.iter().any(|i| i.name == "Clip 2")
    })
    .await;
    c.request("RemoveInput", json!({ "inputName": "Clip 2" }))
        .await
        .unwrap();
    wait_for(&r.svc, "clip gone", |s| {
        s.inputs.iter().all(|i| !i.name.starts_with("Clip"))
    })
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_levels() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let count = || {
        r.ui.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == ui::OBS_LEVELS)
            .count()
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(count(), 0, "no meters until the mixer is open");

    r.svc.set_levels_enabled(true).await.unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let n = count();
    assert!((5..=45).contains(&n), "about 20 a second, got {n} in 2 s");
    let last =
        r.ui.0
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(n, _)| n == ui::OBS_LEVELS)
            .map(|(_, v)| v.clone())
            .unwrap();
    let levels: Vec<AudioLevel> = serde_json::from_value(last).unwrap();
    let music = levels
        .iter()
        .find(|l| l.name == "Music")
        .expect("music meter");
    assert!(
        music.peaks_db.iter().all(|p| *p == -100.0),
        "no file = silence"
    );

    r.svc.set_levels_enabled(false).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let n = count();
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(count(), n, "meters stop when the mixer closes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_ensure_browser_source() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let c = r.svc.client().unwrap();
    let kinds = c.request("GetInputKindList", Value::Null).await.unwrap();
    let has_browser = kinds["inputKinds"]
        .as_array()
        .unwrap()
        .iter()
        .any(|k| k == "browser_source");
    remove_input(&c, "Overlay").await;

    let (kind, first, second) = if has_browser {
        (
            "browser_source",
            convert::browser_settings("http://127.0.0.1:1/a", 1280, 720),
            convert::browser_settings("http://127.0.0.1:1/b", 640, 360),
        )
    } else {
        // This OBS build has no browser plugin: the friendly error, then the same
        // create/update path with a colour source.
        let e = r
            .svc
            .ensure_browser_source("Scene B", "Overlay", "http://x", 1280, 720)
            .await
            .unwrap_err()
            .to_string();
        assert!(e.contains("Browser Source plugin"), "{e}");
        (
            "color_source_v3",
            serde_json::json!({"color": 4278255360u32, "width": 200, "height": 100}),
            serde_json::json!({"color": 4278255360u32, "width": 300, "height": 150}),
        )
    };

    r.svc
        .ensure_input("Scene B", "Overlay", kind, first.clone(), true)
        .await
        .unwrap();
    let id = r.svc.item_id(&c, "Scene B", "Overlay").await.unwrap();
    let t = c
        .request(
            "GetSceneItemTransform",
            json!({ "sceneName": "Scene B", "sceneItemId": id }),
        )
        .await
        .unwrap();
    let t = &t["sceneItemTransform"];
    assert_eq!(
        (t["positionX"].as_f64(), t["positionY"].as_f64()),
        (Some(0.0), Some(0.0))
    );
    assert_eq!(t["boundsType"], "OBS_BOUNDS_STRETCH");
    assert_eq!(t["boundsWidth"].as_f64(), Some(1280.0));
    assert_eq!(
        t["boundsHeight"].as_f64(),
        Some(720.0),
        "stretched over the canvas"
    );
    let settings = |c: Arc<ObsClient>| async move {
        c.request("GetInputSettings", json!({ "inputName": "Overlay" }))
            .await
            .unwrap()["inputSettings"]
            .clone()
    };
    let got = settings(c.clone()).await;
    assert_eq!(got["width"], first["width"]);

    r.svc
        .ensure_input("Scene B", "Overlay", kind, second.clone(), true)
        .await
        .unwrap();
    let got = settings(c.clone()).await;
    assert_eq!(got["width"], second["width"]);
    assert_eq!(got["height"], second["height"]);
    if has_browser {
        assert_eq!(got["url"], "http://127.0.0.1:1/b");
        assert_eq!(got["reroute_audio"], true);
    }
    let items = c
        .request("GetSceneItemList", json!({ "sceneName": "Scene B" }))
        .await
        .unwrap();
    let count = items["sceneItems"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["sourceName"] == "Overlay")
        .count();
    assert_eq!(count, 1, "updated, not added again");

    let e = r
        .svc
        .ensure_input("Scene B", "Blue", "ffmpeg_source", Value::Null, true)
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("different type"), "{e}");

    remove_input(&c, "Overlay").await;
}

/// Width and height from a baseline or progressive JPEG header.
fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    while i + 9 < b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        let len = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
        if matches!(marker, 0xC0..=0xC2) {
            let h = u16::from_be_bytes([b[i + 5], b[i + 6]]);
            let w = u16::from_be_bytes([b[i + 7], b[i + 8]]);
            return Some((w.into(), h.into()));
        }
        i += 2 + len;
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_screenshot() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    for source in ["Scene A", "Red"] {
        let url = r.svc.screenshot(source, 320).await.unwrap();
        let b64 = url
            .strip_prefix("data:image/jpeg;base64,")
            .unwrap_or_else(|| panic!("{}", &url[..40.min(url.len())]));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .unwrap();
        assert_eq!(&bytes[..2], [0xFF, 0xD8], "JPEG");
        assert_eq!(jpeg_size(&bytes), Some((320, 180)));
    }
    assert!(r.svc.screenshot("Ghost", 320).await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_recording() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let dir = std::env::var("OBS_TEST_DIR").ok();
    let before = dir.as_ref().map(|d| list_files(&format!("{d}/recordings")));

    r.svc.start_record().await.unwrap();
    let s = wait_for(&r.svc, "recording", |s| s.record.active).await;
    assert!(!s.record.paused);
    r.svc.start_record().await.expect("starting twice is fine");
    assert_eq!(r.hub.vars.get("obs.recording"), Some(Value::Bool(true)));
    wait_for(&r.svc, "duration", |s| s.record.duration_ms > 0).await;
    wait_for(&r.svc, "stats", |s| s.stats.active_fps > 0.0).await;

    r.svc.pause_record().await.unwrap();
    wait_for(&r.svc, "paused", |s| s.record.paused).await;
    r.svc.resume_record().await.unwrap();
    wait_for(&r.svc, "resumed", |s| !s.record.paused).await;

    tokio::time::sleep(Duration::from_millis(1500)).await;
    ObsActions::set_recording(&*r.svc, Toggle::Off)
        .await
        .unwrap();
    let s = wait_for(&r.svc, "stopped", |s| !s.record.active).await;
    assert_eq!(s.record.duration_ms, 0);
    assert_eq!(r.hub.vars.get("obs.recording"), Some(Value::Bool(false)));
    r.svc.stop_record().await.expect("stopping twice is fine");
    let e = r.svc.pause_record().await.unwrap_err().to_string();
    assert!(e.contains("isn't running"), "{e}");

    // OBS keeps finishing the file briefly after reporting "stopped" and ignores
    // a start sent in that window.
    tokio::time::sleep(Duration::from_millis(1000)).await;
    ObsActions::set_recording(&*r.svc, Toggle::Toggle)
        .await
        .unwrap();
    wait_for(&r.svc, "toggled on", |s| s.record.active).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    r.svc.toggle_record().await.unwrap();
    wait_for(&r.svc, "toggled off", |s| !s.record.active).await;

    if let (Some(d), Some(before)) = (dir, before) {
        let dir = format!("{d}/recordings");
        let end = Instant::now() + WAIT;
        loop {
            let new: Vec<_> = list_files(&dir)
                .into_iter()
                .filter(|f| !before.contains(f))
                .collect();
            let sizes: Vec<u64> = new
                .iter()
                .map(|f| std::fs::metadata(f).map(|m| m.len()).unwrap_or(0))
                .collect();
            if new.len() == 2 && sizes.iter().all(|s| *s > 0) {
                break;
            }
            assert!(Instant::now() < end, "recordings: {new:?} {sizes:?}");
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    }
}

fn list_files(dir: &str) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .map(|d| d.flatten().map(|e| e.path()).collect())
        .unwrap_or_default()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_replay_buffer() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let e = r.svc.save_replay().await.unwrap_err().to_string();
    assert!(e.contains("isn't running"), "{e}");
    r.svc.toggle_replay_buffer().await.unwrap();
    wait_for(&r.svc, "replay on", |s| s.replay_buffer == Some(true)).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    ObsActions::save_replay(&*r.svc).await.unwrap();
    r.svc.toggle_replay_buffer().await.unwrap();
    wait_for(&r.svc, "replay off", |s| s.replay_buffer == Some(false)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_disconnect_and_reconnect() {
    let _g = serial().await;
    let Some(r) = connected().await else { return };
    let mut sig = r.hub.subscribe_signals();

    // Connecting again replaces the connection cleanly.
    r.svc.connect().await.unwrap();
    expect_signal(&mut sig, Signal::ObsDisconnected, WAIT).await;
    expect_signal(&mut sig, Signal::ObsConnected, WAIT).await;
    assert_eq!(r.svc.snapshot().state, ConnState::Connected);
    r.svc.set_program_scene("Scene B").await.unwrap();
    wait_for(&r.svc, "events still flow", |s| {
        s.program_scene == "Scene B"
    })
    .await;
    r.svc.set_program_scene("Scene A").await.unwrap();

    r.svc.disconnect().await.unwrap();
    expect_signal(&mut sig, Signal::ObsDisconnected, WAIT).await;
    let s = r.svc.snapshot();
    assert_eq!(s.state, ConnState::Disconnected);
    assert!(s.scenes.is_empty());
    assert_eq!(r.hub.vars.get("obs.connected"), Some(Value::Bool(false)));
    let e = ObsActions::switch_scene(&*r.svc, "Scene B")
        .await
        .unwrap_err();
    assert_eq!(e.to_string(), "OBS isn't connected.");
    assert!(r.svc.screenshot("Scene A", 100).await.is_err());

    // Manual disconnect stops the reconnect loop.
    r.svc
        .settings
        .update(|s| s.obs.auto_connect = true)
        .unwrap();
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(!r.svc.is_connected());

    r.svc.start();
    wait_for(&r.svc, "auto connect", |s| s.state == ConnState::Connected).await;
    r.svc.shutdown().await;
    assert!(!r.svc.is_connected());
    assert_eq!(r.svc.snapshot().state, ConnState::Disconnected);
}

/// Kills OBS and starts it again. Needs OBS_TEST_DIR (printed by run-obs.sh).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "needs OBS from tests/obs/run-obs.sh"]
async fn live_obs_reconnects_after_restart() {
    let _g = serial().await;
    let Some(env) = env() else { return };
    if std::env::var("OBS_TEST_DIR").is_err() {
        return;
    }
    let r = rig(env, true);
    let mut sig = r.hub.subscribe_signals();
    r.svc.start();
    expect_signal(&mut sig, Signal::ObsConnected, WAIT).await;

    script("kill");
    expect_signal(&mut sig, Signal::ObsDisconnected, WAIT).await;
    let s = wait_for(&r.svc, "retrying", |s| s.state == ConnState::Error).await;
    assert!(
        s.error.as_deref().unwrap_or("").contains("isn't running"),
        "{:?}",
        s.error
    );

    script("restart");
    expect_signal(&mut sig, Signal::ObsConnected, Duration::from_secs(40)).await;
    let s = wait_for(&r.svc, "fresh snapshot", |s| {
        s.state == ConnState::Connected
    })
    .await;
    assert_eq!(s.scenes.len(), 2, "{:?}", s.scenes);
    r.svc.set_program_scene("Scene A").await.unwrap();
    r.svc.shutdown().await;
}
