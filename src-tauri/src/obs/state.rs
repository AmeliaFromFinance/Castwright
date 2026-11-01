//! Applies OBS events to the snapshot. Anything an event doesn't carry is
//! returned as a follow-up for the service to fetch.

use super::convert::{clamp_volume_db, mul_to_db, top_first};
use crate::model::runtime::{ConnState, ObsSnapshot};
use serde_json::Value;

#[derive(Debug, Default, PartialEq)]
pub struct Followup {
    pub scenes: bool,
    pub items: bool,
    pub preview: bool,
    pub transition: bool,
    pub everything: bool,
    /// An input was created (name, kind); check whether it has audio.
    pub input: Option<(String, String)>,
    /// The program scene changed to this one.
    pub program_changed: Option<String>,
}

pub fn str_of(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or_default().to_string()
}

pub fn bool_of(v: &Value, key: &str) -> bool {
    v[key].as_bool().unwrap_or(false)
}

pub fn num_of(v: &Value, key: &str) -> f64 {
    v[key].as_f64().unwrap_or(0.0)
}

pub fn u64_of(v: &Value, key: &str) -> u64 {
    v[key]
        .as_u64()
        .or_else(|| v[key].as_f64().map(|f| f.max(0.0) as u64))
        .unwrap_or(0)
}

/// OBS sends -inf dB as null, so fall back to the multiplier.
pub fn volume_db(v: &Value) -> f64 {
    let db = v["inputVolumeDb"]
        .as_f64()
        .unwrap_or_else(|| mul_to_db(num_of(v, "inputVolumeMul")));
    clamp_volume_db(db)
}

pub fn monitoring(v: &Value) -> bool {
    !matches!(
        v["monitorType"].as_str(),
        None | Some("OBS_MONITORING_TYPE_NONE")
    )
}

/// Whether an output runs after a `*StateChanged` event. obs-websocket reports
/// `outputActive: false` while paused, starting or stopping, so the state decides.
pub fn output_active(d: &Value, current: bool) -> bool {
    match d["outputState"]
        .as_str()
        .and_then(|s| s.strip_prefix("OBS_WEBSOCKET_OUTPUT_"))
    {
        Some("STARTED" | "RESUMED" | "PAUSED" | "RECONNECTING" | "RECONNECTED") => true,
        Some("STOPPED") => false,
        Some("STARTING" | "STOPPING") => current,
        _ => bool_of(d, "outputActive"),
    }
}

/// Scene names in on-screen order from a `scenes` array.
pub fn scene_names(scenes: &Value) -> Vec<String> {
    let list = scenes.as_array().map(Vec::as_slice).unwrap_or_default();
    top_first(
        list.iter()
            .map(|s| (u64_of(s, "sceneIndex") as usize, str_of(s, "sceneName")))
            .collect(),
    )
}

/// Scene whose items the app shows: preview in Studio Mode, program otherwise.
pub fn edited_scene(s: &ObsSnapshot) -> &str {
    match (&s.preview_scene, s.studio_mode) {
        (Some(p), true) => p,
        _ => &s.program_scene,
    }
}

pub fn apply(s: &mut ObsSnapshot, kind: &str, d: &Value) -> Followup {
    let mut f = Followup::default();
    match kind {
        "CurrentProgramSceneChanged" => {
            let name = str_of(d, "sceneName");
            if s.program_scene != name {
                s.program_scene.clone_from(&name);
                f.program_changed = Some(name);
                f.items = !s.studio_mode;
            }
        }
        "CurrentPreviewSceneChanged" => {
            let name = str_of(d, "sceneName");
            if s.studio_mode && s.preview_scene.as_deref() != Some(&name) {
                s.preview_scene = Some(name);
                f.items = true;
            }
        }
        "StudioModeStateChanged" => {
            s.studio_mode = bool_of(d, "studioModeEnabled");
            if s.studio_mode {
                f.preview = true;
            } else {
                s.preview_scene = None;
                f.items = true;
            }
        }
        "SceneListChanged" => s.scenes = scene_names(&d["scenes"]),
        "SceneCreated" => f.scenes = !bool_of(d, "isGroup"),
        "SceneRemoved" => {
            let name = str_of(d, "sceneName");
            if !bool_of(d, "isGroup") {
                s.scenes.retain(|n| *n != name);
                f.scenes = true;
            }
            remove_items_named(s, &name);
        }
        "SceneNameChanged" => {
            let (old, new) = (str_of(d, "oldSceneName"), str_of(d, "sceneName"));
            for n in s.scenes.iter_mut().filter(|n| **n == old) {
                n.clone_from(&new);
            }
            if s.program_scene == old {
                s.program_scene.clone_from(&new);
            }
            if s.preview_scene.as_deref() == Some(&old) {
                s.preview_scene = Some(new.clone());
            }
            rename_items(s, &old, &new);
        }
        "SceneItemCreated" | "SceneItemRemoved" | "SceneItemListReindexed" => {
            f.items = edited_scene(s) == d["sceneName"];
        }
        "SceneItemEnableStateChanged" | "SceneItemLockStateChanged" => {
            if edited_scene(s) == d["sceneName"] {
                let id = d["sceneItemId"].as_i64();
                let enabled = d["sceneItemEnabled"].as_bool();
                let locked = d["sceneItemLocked"].as_bool();
                for it in s.scene_items.iter_mut().filter(|it| Some(it.id) == id) {
                    if let Some(e) = enabled {
                        it.visible = e;
                    }
                    if let Some(l) = locked {
                        it.locked = l;
                    }
                }
            }
        }
        "InputCreated" => f.input = Some((str_of(d, "inputName"), str_of(d, "inputKind"))),
        "InputRemoved" => {
            let name = str_of(d, "inputName");
            s.inputs.retain(|i| i.name != name);
            remove_items_named(s, &name);
        }
        "InputNameChanged" => {
            let (old, new) = (str_of(d, "oldInputName"), str_of(d, "inputName"));
            for i in s.inputs.iter_mut().filter(|i| i.name == old) {
                i.name.clone_from(&new);
            }
            rename_items(s, &old, &new);
        }
        "InputMuteStateChanged" | "InputVolumeChanged" | "InputAudioMonitorTypeChanged" => {
            let name = str_of(d, "inputName");
            for i in s.inputs.iter_mut().filter(|i| i.name == name) {
                match kind {
                    "InputMuteStateChanged" => i.muted = bool_of(d, "inputMuted"),
                    "InputVolumeChanged" => i.volume_db = volume_db(d),
                    _ => i.monitoring = monitoring(d),
                }
            }
        }
        "StreamStateChanged" => {
            s.stream.active = output_active(d, s.stream.active);
            if !s.stream.active {
                s.stream.duration_ms = 0;
                s.stats.stream_kbps = 0.0;
                s.stats.stream_dropped_percent = 0.0;
            }
        }
        "RecordStateChanged" => {
            s.record.active = output_active(d, s.record.active);
            match d["outputState"].as_str() {
                Some("OBS_WEBSOCKET_OUTPUT_PAUSED") => s.record.paused = true,
                Some("OBS_WEBSOCKET_OUTPUT_RESUMED" | "OBS_WEBSOCKET_OUTPUT_STARTED") => {
                    s.record.paused = false;
                }
                _ => {}
            }
            if !s.record.active {
                s.record.paused = false;
                s.record.duration_ms = 0;
            }
        }
        "ReplayBufferStateChanged" => {
            s.replay_buffer = Some(output_active(d, s.replay_buffer.unwrap_or(false)));
        }
        "VirtualcamStateChanged" => s.virtual_cam = output_active(d, s.virtual_cam),
        "CurrentSceneTransitionChanged" => {
            let name = str_of(d, "transitionName");
            if !s.transitions.contains(&name) {
                s.transitions.push(name.clone());
            }
            s.current_transition = name;
            f.transition = true;
        }
        "CurrentSceneTransitionDurationChanged" => {
            s.transition_ms = u64_of(d, "transitionDuration").min(u64::from(u32::MAX)) as u32;
        }
        "CurrentSceneCollectionChanged" | "CurrentProfileChanged" => f.everything = true,
        _ => {}
    }
    f
}

fn rename_items(s: &mut ObsSnapshot, old: &str, new: &str) {
    for it in s.scene_items.iter_mut().filter(|it| it.name == old) {
        it.name = new.to_string();
    }
}

fn remove_items_named(s: &mut ObsSnapshot, name: &str) {
    s.scene_items.retain(|it| it.name != name);
}

/// Snapshot shown while not connected: only the state and error.
pub fn offline(state: ConnState, error: Option<String>) -> ObsSnapshot {
    ObsSnapshot {
        state,
        error,
        ..ObsSnapshot::default()
    }
}

#[cfg(test)]
mod tests {
    use super::super::convert::SILENCE_DB;
    use super::*;
    use crate::model::runtime::{AudioInput, SceneItem};
    use serde_json::json;

    fn item(id: i64, name: &str) -> SceneItem {
        SceneItem {
            id,
            name: name.into(),
            kind: "color_source_v3".into(),
            visible: true,
            locked: false,
            is_group: false,
        }
    }

    fn base() -> ObsSnapshot {
        ObsSnapshot {
            scenes: vec!["A".into(), "B".into()],
            program_scene: "A".into(),
            scene_items: vec![item(1, "Cam"), item(2, "Mic")],
            inputs: vec![AudioInput {
                name: "Mic".into(),
                kind: "pulse_input_capture".into(),
                volume_db: 0.0,
                muted: false,
                monitoring: false,
            }],
            ..ObsSnapshot::default()
        }
    }

    fn scene(name: &str) -> Value {
        json!({ "sceneName": name, "sceneUuid": "x" })
    }

    #[test]
    fn program_scene_change() {
        let mut s = base();
        let f = apply(&mut s, "CurrentProgramSceneChanged", &scene("B"));
        assert_eq!(s.program_scene, "B");
        assert_eq!(f.program_changed.as_deref(), Some("B"));
        assert!(f.items);
        let f = apply(&mut s, "CurrentProgramSceneChanged", &scene("B"));
        assert_eq!(f, Followup::default(), "same scene again does nothing");
    }

    #[test]
    fn studio_mode_switches_edited_scene() {
        let mut s = base();
        let on = json!({ "studioModeEnabled": true });
        let f = apply(&mut s, "StudioModeStateChanged", &on);
        assert!(s.studio_mode && f.preview && !f.items);
        assert_eq!(edited_scene(&s), "A", "until the preview is known");
        let f = apply(&mut s, "CurrentPreviewSceneChanged", &scene("B"));
        assert!(f.items);
        assert_eq!(edited_scene(&s), "B");
        let f = apply(&mut s, "CurrentProgramSceneChanged", &scene("B"));
        assert!(!f.items, "program change doesn't touch the edited items");
        let off = json!({ "studioModeEnabled": false });
        let f = apply(&mut s, "StudioModeStateChanged", &off);
        assert!(f.items);
        assert_eq!(s.preview_scene, None);
    }

    #[test]
    fn preview_ignored_outside_studio_mode() {
        let mut s = base();
        apply(&mut s, "CurrentPreviewSceneChanged", &scene("B"));
        assert_eq!(s.preview_scene, None);
    }

    #[test]
    fn scene_list_is_top_first() {
        let mut s = base();
        let d = json!({ "scenes": [
            { "sceneName": "Bottom", "sceneIndex": 0 },
            { "sceneName": "Top", "sceneIndex": 1 },
        ]});
        apply(&mut s, "SceneListChanged", &d);
        assert_eq!(s.scenes, vec!["Top", "Bottom"]);
        assert!(scene_names(&Value::Null).is_empty());
    }

    #[test]
    fn scene_rename_and_remove() {
        let mut s = base();
        s.scene_items.push(SceneItem {
            kind: "scene".into(),
            ..item(3, "B")
        });
        let d = json!({ "oldSceneName": "A", "sceneName": "Main" });
        apply(&mut s, "SceneNameChanged", &d);
        assert_eq!(s.scenes, vec!["Main", "B"]);
        assert_eq!(s.program_scene, "Main");
        let d = json!({ "sceneName": "B", "isGroup": false });
        let f = apply(&mut s, "SceneRemoved", &d);
        assert!(f.scenes);
        assert_eq!(s.scenes, vec!["Main"]);
        assert!(s.scene_items.iter().all(|i| i.name != "B"));
        let g = json!({ "sceneName": "G", "isGroup": true });
        assert!(
            !apply(&mut s, "SceneCreated", &g).scenes,
            "groups aren't scenes"
        );
    }

    #[test]
    fn item_changes_only_for_edited_scene() {
        let mut s = base();
        let other = json!({ "sceneName": "B", "sourceName": "x", "sceneItemId": 9 });
        assert!(!apply(&mut s, "SceneItemCreated", &other).items);
        let this = json!({ "sceneName": "A", "sceneItems": [] });
        assert!(apply(&mut s, "SceneItemListReindexed", &this).items);

        let hide = json!({ "sceneName": "A", "sceneItemId": 2, "sceneItemEnabled": false });
        apply(&mut s, "SceneItemEnableStateChanged", &hide);
        let lock = json!({ "sceneName": "A", "sceneItemId": 1, "sceneItemLocked": true });
        apply(&mut s, "SceneItemLockStateChanged", &lock);
        let elsewhere = json!({ "sceneName": "B", "sceneItemId": 1, "sceneItemEnabled": false });
        apply(&mut s, "SceneItemEnableStateChanged", &elsewhere);
        assert!(s.scene_items[0].visible && s.scene_items[0].locked);
        assert!(!s.scene_items[1].visible && !s.scene_items[1].locked);
    }

    #[test]
    fn input_updates() {
        let mut s = base();
        let silent = json!({ "inputName": "Mic", "inputVolumeMul": 0.0, "inputVolumeDb": null });
        apply(&mut s, "InputVolumeChanged", &silent);
        assert_eq!(s.inputs[0].volume_db, SILENCE_DB);
        let half = json!({ "inputName": "Mic", "inputVolumeMul": 0.5, "inputVolumeDb": -6.0 });
        apply(&mut s, "InputVolumeChanged", &half);
        assert_eq!(s.inputs[0].volume_db, -6.0);
        let mute = json!({ "inputName": "Mic", "inputMuted": true });
        apply(&mut s, "InputMuteStateChanged", &mute);
        let mon = json!({ "inputName": "Mic", "monitorType": "OBS_MONITORING_TYPE_MONITOR_ONLY" });
        apply(&mut s, "InputAudioMonitorTypeChanged", &mon);
        assert!(s.inputs[0].muted && s.inputs[0].monitoring);
        let rename = json!({ "oldInputName": "Mic", "inputName": "Voice" });
        apply(&mut s, "InputNameChanged", &rename);
        assert_eq!(s.inputs[0].name, "Voice");
        assert_eq!(s.scene_items[1].name, "Voice");
        apply(&mut s, "InputRemoved", &json!({ "inputName": "Voice" }));
        assert!(s.inputs.is_empty());
        assert_eq!(s.scene_items.len(), 1);
    }

    #[test]
    fn new_input_is_checked_for_audio() {
        let mut s = base();
        let d = json!({ "inputName": "Music", "inputKind": "ffmpeg_source" });
        let f = apply(&mut s, "InputCreated", &d);
        assert_eq!(f.input, Some(("Music".into(), "ffmpeg_source".into())));
    }

    #[test]
    fn outputs() {
        let mut s = base();
        let out = |active: bool, state: &str| json!({ "outputActive": active, "outputState": format!("OBS_WEBSOCKET_OUTPUT_{state}") });
        apply(&mut s, "StreamStateChanged", &out(true, "STARTED"));
        s.stats.stream_kbps = 6000.0;
        s.stream.duration_ms = 5000;
        assert!(s.stream.active);
        apply(&mut s, "StreamStateChanged", &out(false, "STOPPED"));
        assert!(!s.stream.active);
        assert_eq!(s.stats.stream_kbps, 0.0);
        assert_eq!(s.stream.duration_ms, 0);

        apply(&mut s, "RecordStateChanged", &out(false, "STARTING"));
        assert!(!s.record.active);
        apply(&mut s, "RecordStateChanged", &out(true, "STARTED"));
        // OBS really sends outputActive: false with PAUSED.
        apply(&mut s, "RecordStateChanged", &out(false, "PAUSED"));
        assert!(s.record.active && s.record.paused);
        apply(&mut s, "RecordStateChanged", &out(true, "RESUMED"));
        assert!(!s.record.paused);
        apply(&mut s, "RecordStateChanged", &out(false, "PAUSED"));
        apply(&mut s, "RecordStateChanged", &out(false, "STOPPING"));
        assert!(s.record.active, "still writing while stopping");
        apply(&mut s, "RecordStateChanged", &out(false, "STOPPED"));
        assert!(!s.record.active && !s.record.paused);

        apply(&mut s, "ReplayBufferStateChanged", &out(true, "STARTED"));
        assert_eq!(s.replay_buffer, Some(true));
        apply(&mut s, "VirtualcamStateChanged", &out(true, "STARTED"));
        assert!(s.virtual_cam);
        apply(&mut s, "StreamStateChanged", &out(false, "RECONNECTING"));
        assert!(s.stream.active, "reconnecting still counts as live");
        let odd = json!({ "outputActive": true, "outputState": "SOMETHING_NEW" });
        apply(&mut s, "VirtualcamStateChanged", &odd);
        assert!(s.virtual_cam);
    }

    #[test]
    fn transitions() {
        let mut s = base();
        s.transitions = vec!["Fade".into()];
        let cut = json!({ "transitionName": "Cut" });
        let f = apply(&mut s, "CurrentSceneTransitionChanged", &cut);
        assert!(f.transition);
        assert_eq!(s.current_transition, "Cut");
        assert_eq!(s.transitions, vec!["Fade", "Cut"]);
        let dur = json!({ "transitionDuration": 450 });
        apply(&mut s, "CurrentSceneTransitionDurationChanged", &dur);
        assert_eq!(s.transition_ms, 450);
    }

    #[test]
    fn collection_change_and_unknown() {
        let mut s = base();
        let d = json!({ "sceneCollectionName": "x" });
        assert!(apply(&mut s, "CurrentSceneCollectionChanged", &d).everything);
        let before = s.clone();
        assert_eq!(
            apply(&mut s, "SomethingNew", &Value::Null),
            Followup::default()
        );
        assert_eq!(s, before);
    }

    #[test]
    fn helpers_tolerate_missing_fields() {
        let v = json!({ "n": 2.7, "s": 5 });
        assert_eq!(str_of(&v, "missing"), "");
        assert_eq!(str_of(&v, "s"), "");
        assert_eq!(u64_of(&v, "n"), 2);
        assert!(!bool_of(&Value::Null, "x"));
        assert!(!monitoring(&json!({})));
        assert_eq!(volume_db(&json!({})), SILENCE_DB);
    }
}
