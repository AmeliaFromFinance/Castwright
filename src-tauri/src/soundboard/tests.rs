use super::*;
use crate::hub::RecordingUi;
use crate::model::project::Project;
use crate::model::soundboard::{SoundOutput, SoundboardStatus};
use crate::services::Recorder;
use serde_json::json;

struct Rig {
    sb: Arc<SoundboardService>,
    hub: Arc<Hub>,
    ui: Arc<RecordingUi>,
    rec: Arc<Recorder>,
    _dir: tempfile::TempDir,
}

fn button(id: &str, label: &str, cooldown_s: u32) -> SoundButton {
    SoundButton {
        id: id.into(),
        label: label.into(),
        src: format!("assets/{id}.wav"),
        cooldown_s,
        ..SoundButton::default()
    }
}

fn rig(board: Soundboard) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = ProjectStore::open(dir.path()).unwrap();
    store.replace(Project {
        soundboard: board,
        ..Project::default()
    });
    let ui = Arc::new(RecordingUi::default());
    let hub = Hub::new(
        ui.clone(),
        Arc::new(crate::vars::Vars::new()),
        Arc::new(crate::store::db::Db::open_in_memory()),
    );
    let sb = SoundboardService::new(hub.clone(), Arc::new(store));
    let rec = Arc::new(Recorder::default());
    sb.set_twitch(rec.clone());
    Rig {
        sb,
        hub,
        ui,
        rec,
        _dir: dir,
    }
}

fn board() -> Soundboard {
    Soundboard {
        buttons: vec![
            button("horn", "Airhorn", 10),
            SoundButton {
                aliases: vec!["womp".into()],
                ..button("sad", "Sad trombone", 0)
            },
            button("drum", "Drum roll", 0),
        ],
        ..Soundboard::default()
    }
}

fn cues(ui: &RecordingUi) -> Vec<SoundCue> {
    ui.0.lock()
        .unwrap()
        .iter()
        .filter(|(n, _)| n == ui::SOUND)
        .map(|(_, v)| serde_json::from_value(v.clone()).unwrap())
        .collect()
}

fn played(ui: &RecordingUi) -> Vec<String> {
    cues(ui)
        .into_iter()
        .filter_map(|c| match c {
            SoundCue::Play { sound_id, .. } => Some(sound_id),
            SoundCue::Stop { .. } => None,
        })
        .collect()
}

async fn wait_calls(rec: &Recorder, n: usize) -> Vec<String> {
    for _ in 0..200 {
        if rec.calls.lock().unwrap().len() >= n {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    tokio::time::sleep(Duration::from_millis(20)).await;
    rec.take()
}

#[test]
fn plays_to_overlays_and_the_app_by_output() {
    let mut b = board();
    b.buttons[0].output = SoundOutput::Stream;
    b.buttons[1].output = SoundOutput::Local;
    b.buttons[2].output = SoundOutput::Both;
    b.buttons[2].volume = 35;
    let r = rig(b);
    let mut overlays = r.hub.subscribe_overlays();
    for id in ["horn", "sad", "drum"] {
        assert!(r.sb.play(id, Source::App).played());
    }
    let mut sent = Vec::new();
    while let Ok(o) = overlays.try_recv() {
        if let OverlayMsg::SoundPlay {
            sound_id, volume, ..
        } = o.msg
        {
            sent.push((sound_id, volume));
        }
    }
    assert_eq!(
        sent,
        vec![("horn".to_string(), 80), ("drum".to_string(), 35)],
        "only stream sounds reach overlays"
    );
    let local: Vec<(String, bool, bool)> = cues(&r.ui)
        .into_iter()
        .filter_map(|c| match c {
            SoundCue::Play {
                sound_id,
                local,
                stream,
                ..
            } => Some((sound_id, local, stream)),
            _ => None,
        })
        .collect();
    assert_eq!(
        local,
        vec![
            ("horn".into(), false, true),
            ("sad".into(), true, false),
            ("drum".into(), true, true)
        ]
    );

    r.sb.stop(Some("drum"));
    r.sb.stop(None);
    let stops: Vec<Option<String>> = cues(&r.ui)
        .into_iter()
        .filter_map(|c| match c {
            SoundCue::Stop { sound_id } => Some(sound_id),
            _ => None,
        })
        .collect();
    assert_eq!(stops, vec![Some("drum".to_string()), None]);
}

#[test]
fn per_sound_and_global_cooldowns() {
    let r = rig(board());
    let t0 = Instant::now();
    let at = |s: u64| t0 + Duration::from_secs(s);
    assert!(r.sb.play_at("horn", Source::App, t0).played());
    assert_eq!(
        r.sb.play_at("horn", Source::App, at(3)),
        PlayOutcome::Cooldown { seconds_left: 7 }
    );
    assert!(
        r.sb.play_at("sad", Source::App, at(3)).played(),
        "other sounds aren't held back"
    );
    let status: SoundboardStatus = r.sb.status_at(at(4), 1_000);
    assert_eq!(status.cooldowns.get("horn"), Some(&7_000));
    assert!(!status.cooldowns.contains_key("sad"));
    assert_eq!(status.global_until, 0);
    assert!(r.sb.play_at("horn", Source::App, at(10)).played());

    // A global cooldown holds back every sound.
    let mut b = r.sb.board();
    b.global_cooldown_s = 5;
    r.sb.save(b);
    assert_eq!(
        r.sb.play_at("drum", Source::App, at(12)),
        PlayOutcome::Cooldown { seconds_left: 3 }
    );
    assert_eq!(r.sb.status_at(at(12), 0).global_until, 3_000);
    assert!(r.sb.play_at("drum", Source::App, at(15)).played());
}

#[test]
fn mute_missing_and_empty_sounds() {
    let mut b = board();
    b.buttons.push(SoundButton {
        src: String::new(),
        ..button("empty", "Empty", 0)
    });
    let r = rig(b);
    assert_eq!(r.sb.play("nope", Source::Api), PlayOutcome::NotFound);
    assert_eq!(r.sb.play("empty", Source::Api), PlayOutcome::NoFile);
    r.sb.set_muted(true);
    assert!(r.sb.status().muted);
    assert_eq!(r.sb.play("drum", Source::Api), PlayOutcome::Muted);
    assert!(
        cues(&r.ui).contains(&SoundCue::Stop { sound_id: None }),
        "muting stops what plays"
    );
    // Saving the board keeps the mute.
    let mut b = r.sb.board();
    b.muted = false;
    assert!(r.sb.save(b).muted);
    r.sb.set_muted(false);
    assert!(r.sb.play("drum", Source::Api).played());
    assert!(PlayOutcome::Muted.reason().unwrap().contains("muted"));
}

fn redemption(reward_id: &str, input: &str, status: &str) -> Event {
    let mut e = Event::new(EventKind::Redemption).with_user("nova", "Nova");
    e.message = (!input.is_empty()).then(|| input.to_string());
    e.data.insert("reward_id".into(), json!(reward_id));
    e.data.insert("redemption_id".into(), json!("red-1"));
    e.data.insert("status".into(), json!(status));
    e
}

#[tokio::test]
async fn linked_rewards_complete_or_refund() {
    let mut b = board();
    b.buttons[0].reward_id = "rw-horn".into();
    let r = rig(b);
    r.sb.on_event(&redemption("rw-horn", "", "unfulfilled"));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["redemption rw-horn/red-1 refund=false"]
    );
    assert_eq!(played(&r.ui), vec!["horn"]);

    // On cooldown: refunded, nothing plays.
    r.sb.on_event(&redemption("rw-horn", "", "unfulfilled"));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["redemption rw-horn/red-1 refund=true"]
    );
    assert_eq!(played(&r.ui).len(), 1);

    // Already complete (skips the queue): nothing to finish.
    r.sb.on_event(&redemption("rw-horn", "", "fulfilled"));
    assert!(wait_calls(&r.rec, 1).await.is_empty());
    // Other rewards and test events are left alone.
    r.sb.on_event(&redemption("rw-other", "", "unfulfilled"));
    let mut test = redemption("rw-horn", "", "unfulfilled");
    test.test = true;
    r.sb.on_event(&test);
    assert!(wait_calls(&r.rec, 1).await.is_empty());
}

#[tokio::test]
async fn sound_requests_match_by_name() {
    let mut b = board();
    b.request_reward_id = "rw-request".into();
    let r = rig(b);
    r.sb.on_event(&redemption("rw-request", "sad tromboen", "unfulfilled"));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["redemption rw-request/red-1 refund=false"]
    );
    r.sb.on_event(&redemption("rw-request", "WOMP", "unfulfilled"));
    wait_calls(&r.rec, 1).await;
    assert_eq!(played(&r.ui), vec!["sad", "sad"], "aliases count");

    r.sb.on_event(&redemption("rw-request", "kazoo solo", "unfulfilled"));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["redemption rw-request/red-1 refund=true"]
    );
    assert!(
        r.hub
            .logs()
            .iter()
            .any(|l| l.message.contains("\"kazoo solo\", which matches no sound"))
    );
    r.sb.on_event(&redemption("rw-request", "", "unfulfilled"));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["redemption rw-request/red-1 refund=true"],
        "nothing typed"
    );
}

fn chat(text: &str, user: &str, roles: UserRoles) -> Event {
    let mut e = Event::new(EventKind::Chat).with_user(user, user);
    e.user.as_mut().unwrap().id = format!("id-{user}");
    e.message = Some(text.into());
    e.roles = roles;
    e
}

#[test]
fn chat_command_with_permission_and_cooldown() {
    let mut b = board();
    b.command.enabled = true;
    b.command.permission = Permission::Subscriber;
    b.command.cooldown_s = 60;
    let r = rig(b);
    let sub = UserRoles {
        subscriber: true,
        ..UserRoles::default()
    };
    let moderator = UserRoles {
        moderator: true,
        ..UserRoles::default()
    };
    r.sb.on_event(&chat("!sound drum roll", "viewer", UserRoles::default()));
    assert!(played(&r.ui).is_empty(), "not a subscriber");
    r.sb.on_event(&chat("!SOUND drumroll", "subby", sub.clone()));
    assert_eq!(played(&r.ui), vec!["drum"]);
    r.sb.on_event(&chat("!sound sad", "subby", sub.clone()));
    assert_eq!(played(&r.ui).len(), 1, "viewer cooldown");
    r.sb.on_event(&chat("!sound sad", "mod", moderator.clone()));
    r.sb.on_event(&chat("!sound drum", "mod", moderator));
    assert_eq!(played(&r.ui), vec!["drum", "sad", "drum"], "mods skip it");
    r.sb.on_event(&chat("!sound", "other", sub.clone()));
    r.sb.on_event(&chat("!sounds drum", "other", sub.clone()));
    r.sb.on_event(&chat("!sound kazoo", "other", sub.clone()));
    assert_eq!(played(&r.ui).len(), 3);
    let mut own = chat("!sound drum", "other", sub);
    own.data.insert("sent_by_castwright".into(), json!(true));
    r.sb.on_event(&own);
    assert_eq!(played(&r.ui).len(), 3, "own messages");
}

#[test]
fn chat_command_is_off_by_default() {
    let r = rig(board());
    let broadcaster = UserRoles {
        broadcaster: true,
        ..UserRoles::default()
    };
    r.sb.on_event(&chat("!sound drum", "me", broadcaster));
    assert!(played(&r.ui).is_empty());
}

#[test]
fn saving_cleans_the_board() {
    let r = rig(Soundboard::default());
    let mut b = board();
    b.buttons.push(button("horn", "Duplicate", 0));
    b.buttons[0].volume = 250;
    b.buttons[0].group = " Memes ".into();
    b.groups = vec!["Main".into(), "Main".into(), " ".into()];
    b.command.name = "!Sfx".into();
    let saved = r.sb.save(b);
    assert_eq!(saved.buttons.len(), 3);
    assert_eq!(saved.buttons[0].volume, 100);
    assert_eq!(saved.groups, vec!["Main", "Memes"]);
    assert_eq!(saved.command.name, "sfx");
    assert_eq!(r.sb.board(), saved);
    assert!(
        r.ui.0
            .lock()
            .unwrap()
            .iter()
            .any(|(n, _)| n == ui::SOUNDBOARD)
    );
}

#[test]
fn the_step_reports_why_nothing_played() {
    let r = rig(board());
    assert!(r.sb.play_sound("drum").is_ok());
    let err = r.sb.play_sound("missing").unwrap_err().to_string();
    assert!(err.contains("no longer exists"), "{err}");
}
