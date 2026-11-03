use super::*;
use crate::hub::RecordingUi;
use crate::model::condition::{Condition, ConditionGroup, MatchMode, Op};
use crate::model::project::Project;
use crate::services::Recorder;
use serde_json::json;

struct Rig {
    auto: Arc<Automation>,
    hub: Arc<Hub>,
    ui: Arc<RecordingUi>,
    rec: Arc<Recorder>,
    project: Arc<ProjectStore>,
    _dir: tempfile::TempDir,
}

fn rig(actions: Vec<Action>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = ProjectStore::open(dir.path()).unwrap();
    store.replace(Project {
        actions,
        ..Project::starter()
    });
    let project = Arc::new(store);
    let ui = Arc::new(RecordingUi::default());
    let hub = Hub::new(
        ui.clone(),
        Arc::new(crate::vars::Vars::new()),
        Arc::new(crate::store::db::Db::open_in_memory()),
    );
    let alerts = AlertEngine::new(hub.clone(), project.clone());
    let auto = Automation::new(hub.clone(), project.clone(), alerts);
    let rec = Arc::new(Recorder::default());
    auto.set_twitch(rec.clone());
    auto.set_obs(rec.clone());
    auto.set_sounds(rec.clone());
    Rig {
        auto,
        hub,
        ui,
        rec,
        project,
        _dir: dir,
    }
}

async fn wait_calls(rec: &Recorder, n: usize) -> Vec<String> {
    for _ in 0..200 {
        if rec.calls.lock().unwrap().len() >= n {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    // give stray extra calls a moment to show up
    tokio::time::sleep(Duration::from_millis(20)).await;
    rec.take()
}

fn chat(text: &str, roles: UserRoles) -> Event {
    let mut e = Event::new(EventKind::Chat).with_user("viewer", "Viewer");
    e.user.as_mut().unwrap().id = "42".into();
    e.message = Some(text.into());
    e.roles = roles;
    e
}

fn modr() -> UserRoles {
    UserRoles {
        moderator: true,
        ..UserRoles::default()
    }
}

fn command(name: &str, perm: Permission, steps: Vec<Step>) -> Action {
    Action {
        name: name.into(),
        triggers: vec![Trigger::Command {
            name: name.into(),
            aliases: vec!["shoutout".into()],
            permission: perm,
            user_cooldown_s: 0,
        }],
        steps,
        ..Action::default()
    }
}

fn say(msg: &str) -> Step {
    Step::ChatSend {
        message: msg.into(),
        as_bot: false,
        reply: false,
    }
}

#[tokio::test]
async fn command_with_arguments_and_permission() {
    let r = rig(vec![command(
        "so",
        Permission::Moderator,
        vec![Step::Shoutout {
            user: "{{arg1}}".into(),
            message: "Follow {{arg1}}! ({{arg_count}} args, input={{input}})".into(),
        }],
    )]);
    r.auto.on_event(&chat("!so @Nova_Kat extra", modr()));
    let calls = wait_calls(&r.rec, 2).await;
    assert_eq!(
        calls,
        vec![
            "shoutout nova_kat".to_string(),
            "chat bot=true reply=false Follow Nova_Kat! (2 args, input=@Nova_Kat extra)"
                .to_string()
        ]
    );
    r.auto.on_event(&chat("!so someone", UserRoles::default()));
    assert!(
        wait_calls(&r.rec, 1).await.is_empty(),
        "viewers can't use a mod command"
    );
}

#[tokio::test]
async fn command_aliases_case_and_word_boundary() {
    let r = rig(vec![command("so", Permission::Everyone, vec![say("ok")])]);
    r.auto.on_event(&chat("!SHOUTOUT", UserRoles::default()));
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
    r.auto.on_event(&chat("!sox", UserRoles::default()));
    r.auto.on_event(&chat("so", UserRoles::default()));
    r.auto.on_event(&chat("hey !so", UserRoles::default()));
    assert!(wait_calls(&r.rec, 1).await.is_empty());
}

#[tokio::test]
async fn own_messages_and_bot_never_trigger_commands() {
    let r = rig(vec![command(
        "echo",
        Permission::Everyone,
        vec![say("!echo")],
    )]);
    let mut own = chat("!echo", UserRoles::default());
    own.data.insert("sent_by_castwright".into(), json!(true));
    r.auto.on_event(&own);
    r.auto.set_ignored_users(vec!["42".into()]);
    r.auto.on_event(&chat("!echo", UserRoles::default()));
    assert!(wait_calls(&r.rec, 1).await.is_empty());
}

#[tokio::test]
async fn own_chat_never_fires_chat_event_triggers() {
    let r = rig(vec![Action {
        name: "react".into(),
        triggers: vec![Trigger::Event {
            kind: EventKind::Chat,
            conditions: ConditionGroup::default(),
        }],
        steps: vec![say("hello")],
        ..Action::default()
    }]);
    let mut own = chat("hello", UserRoles::default());
    own.data.insert("sent_by_castwright".into(), json!(true));
    r.auto.on_event(&own);
    assert!(wait_calls(&r.rec, 1).await.is_empty());
    r.auto.on_event(&chat("hello", UserRoles::default()));
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
}

#[tokio::test]
async fn action_cooldown_does_not_use_up_viewer_cooldown() {
    let mut a = command("hi", Permission::Everyone, vec![say("hi")]);
    a.cooldown_s = 60;
    if let Trigger::Command {
        user_cooldown_s, ..
    } = &mut a.triggers[0]
    {
        *user_cooldown_s = 60;
    }
    let id = a.id.clone();
    let r = rig(vec![a]);
    // Someone else runs it; the action is now cooling down.
    r.auto.on_event(&chat("!hi", modr()));
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
    // The viewer is blocked by the action cooldown, not by their own.
    r.auto.on_event(&chat("!hi", UserRoles::default()));
    assert!(wait_calls(&r.rec, 1).await.is_empty());
    r.auto.last_run.lock().unwrap().remove(&id);
    r.auto.on_event(&chat("!hi", UserRoles::default()));
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
}

#[tokio::test]
async fn test_events_never_run_actions() {
    let r = rig(vec![Action {
        name: "raid".into(),
        triggers: vec![Trigger::Event {
            kind: EventKind::Raid,
            conditions: ConditionGroup::default(),
        }],
        steps: vec![say("welcome")],
        ..Action::default()
    }]);
    let mut e = Event::new(EventKind::Raid).with_user("x", "X");
    e.test = true;
    r.auto.on_event(&e);
    assert!(wait_calls(&r.rec, 1).await.is_empty());
    e.test = false;
    r.auto.on_event(&e);
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
}

#[tokio::test]
async fn user_cooldown_applies_to_viewers_not_mods() {
    let mut a = command("hi", Permission::Everyone, vec![say("hi")]);
    if let Trigger::Command {
        user_cooldown_s, ..
    } = &mut a.triggers[0]
    {
        *user_cooldown_s = 60;
    }
    let r = rig(vec![a]);
    r.auto.on_event(&chat("!hi", UserRoles::default()));
    r.auto.on_event(&chat("!hi", UserRoles::default()));
    assert_eq!(wait_calls(&r.rec, 2).await.len(), 1);
    r.auto.on_event(&chat("!hi", modr()));
    r.auto.on_event(&chat("!hi", modr()));
    assert_eq!(wait_calls(&r.rec, 2).await.len(), 2);
}

#[tokio::test]
async fn event_trigger_with_conditions() {
    let r = rig(vec![Action {
        triggers: vec![Trigger::Event {
            kind: EventKind::Raid,
            conditions: ConditionGroup {
                mode: MatchMode::All,
                conditions: vec![Condition {
                    field: "amount".into(),
                    op: Op::Gte,
                    value: json!(20),
                }],
            },
        }],
        steps: vec![Step::ChatAnnounce {
            message: "Welcome {{name}} +{{amount}}".into(),
            color: "purple".into(),
        }],
        ..Action::default()
    }]);
    let mut small = Event::new(EventKind::Raid).with_user("a", "Small");
    small.amount = Some(5.0);
    r.auto.on_event(&small);
    let mut big = Event::new(EventKind::Raid).with_user("b", "Big");
    big.amount = Some(212.0);
    r.auto.on_event(&big);
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["announce purple Welcome Big +212"]
    );
}

#[tokio::test]
async fn variables_flow_between_steps() {
    let r = rig(vec![]);
    let a = Action {
        steps: vec![
            Step::SetVariable {
                key: "game".into(),
                value: "Celeste".into(),
                persist: false,
            },
            Step::SetVariable {
                key: "lives".into(),
                value: "3".into(),
                persist: true,
            },
            Step::AddToVariable {
                key: "lives".into(),
                amount: -1.0,
                persist: true,
            },
            say("{{game}} lives={{lives}}"),
            Step::SetVariable {
                key: "bad key".into(),
                value: "x".into(),
                persist: false,
            },
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert_eq!(
        r.rec.take(),
        vec!["chat bot=false reply=false Celeste lives=2"]
    );
    assert_eq!(
        r.hub.vars.get("lives"),
        Some(json!(2)),
        "numbers are stored as numbers"
    );
    assert!(!run.ok);
    assert_eq!(run.errors.len(), 1);
}

#[tokio::test]
async fn if_else_and_stop() {
    let r = rig(vec![]);
    let cond = |v: i64| ConditionGroup {
        mode: MatchMode::All,
        conditions: vec![Condition {
            field: "amount".into(),
            op: Op::Gt,
            value: json!(v),
        }],
    };
    let a = Action {
        steps: vec![
            Step::If {
                conditions: cond(100),
                then: vec![say("big")],
                otherwise: vec![say("small")],
            },
            Step::If {
                conditions: cond(0),
                then: vec![Step::Stop],
                otherwise: vec![],
            },
            say("never"),
        ],
        ..Action::default()
    };
    let mut args = Map::new();
    args.insert("amount".into(), json!(500));
    r.auto.execute(&a, "test", args, None).await;
    assert_eq!(r.rec.take(), vec!["chat bot=false reply=false big"]);
}

#[tokio::test]
async fn failing_step_does_not_stop_the_rest() {
    let r = rig(vec![]);
    *r.rec.fail.lock().unwrap() = true;
    let a = Action {
        steps: vec![
            say("one"),
            Step::Log {
                message: "after".into(),
            },
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(!run.ok);
    assert!(r.hub.logs().iter().any(|l| l.message == "after"));
}

#[tokio::test]
async fn nested_actions_and_depth_limit() {
    let inner = Action {
        id: "inner".into(),
        steps: vec![say("inner")],
        ..Action::default()
    };
    let looping = Action {
        id: "loop".into(),
        steps: vec![Step::RunAction {
            action_id: "loop".into(),
        }],
        ..Action::default()
    };
    let r = rig(vec![inner, looping.clone()]);
    let outer = Action {
        steps: vec![Step::RunAction {
            action_id: "inner".into(),
        }],
        ..Action::default()
    };
    r.auto.execute(&outer, "test", Map::new(), None).await;
    assert_eq!(r.rec.take(), vec!["chat bot=false reply=false inner"]);
    let run = r.auto.execute(&looping, "test", Map::new(), None).await;
    assert!(run.errors.iter().any(|e| e.contains("too deeply")));
}

#[tokio::test]
async fn script_step() {
    let r = rig(vec![]);
    let a = Action {
        steps: vec![
            Step::RunScript {
                code: r#"save("counter.wins", 5); chat("wins: " + get("counter.wins"));"#.into(),
            },
            say("{{counter.wins}}"),
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(run.ok, "{:?}", run.errors);
    assert_eq!(r.hub.vars.get("counter.wins"), Some(json!(5)));
    assert_eq!(
        r.rec.take(),
        vec![
            "chat bot=true reply=false wins: 5",
            "chat bot=false reply=false 5"
        ]
    );
}

#[tokio::test]
async fn obs_steps_and_missing_services() {
    let r = rig(vec![]);
    let a = Action {
        steps: vec![
            Step::SwitchScene {
                scene: "BRB".into(),
            },
            Step::SetSourceVisible {
                scene: String::new(),
                source: "Cam".into(),
                state: Toggle::Toggle,
            },
            Step::SetInputMute {
                input: "Mic".into(),
                state: Toggle::On,
            },
            Step::Recording { state: Toggle::Off },
            Step::SaveReplay,
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(run.ok);
    assert_eq!(r.rec.take().len(), 5);
    let fresh = rig(vec![]);
    *fresh.auto.obs.write().unwrap() = None;
    let run = fresh.auto.execute(&a, "test", Map::new(), None).await;
    assert_eq!(run.errors.len(), 5);
    assert!(run.errors[0].contains("OBS isn't connected"));
}

#[tokio::test]
async fn alert_queue_steps() {
    let r = rig(vec![]);
    let pause = |state| Action {
        steps: vec![Step::PauseAlerts { state }, Step::SkipAlert],
        ..Action::default()
    };
    assert!(
        r.auto
            .execute(&pause(Toggle::On), "test", Map::new(), None)
            .await
            .ok
    );
    assert!(r.auto.alerts().queue_state().paused);
    assert!(
        r.auto
            .execute(&pause(Toggle::Toggle), "test", Map::new(), None)
            .await
            .ok
    );
    assert!(!r.auto.alerts().queue_state().paused);
    r.auto.alerts().set_paused(true);
    assert!(
        r.auto
            .execute(&pause(Toggle::Off), "test", Map::new(), None)
            .await
            .ok
    );
    assert!(!r.auto.alerts().queue_state().paused);
}

#[tokio::test]
async fn layer_visibility_updates_project_and_overlays() {
    let r = rig(vec![]);
    let (overlay_id, layer_id, before) = r.project.read(|p| {
        (
            p.overlays[0].id.clone(),
            p.overlays[0].layers[0].id.clone(),
            p.overlays[0].layers[0].visible,
        )
    });
    let mut ov = r.hub.subscribe_overlays();
    let a = Action {
        steps: vec![Step::SetLayerVisible {
            overlay_id: overlay_id.clone(),
            layer_id: layer_id.clone(),
            state: Toggle::Toggle,
        }],
        ..Action::default()
    };
    assert!(r.auto.execute(&a, "test", Map::new(), None).await.ok);
    let after = r.project.read(|p| p.overlays[0].layers[0].visible);
    assert_eq!(after, !before);
    let out = ov.recv().await.unwrap();
    assert_eq!(out.target.as_deref(), Some(overlay_id.as_str()));
    assert!(matches!(out.msg, OverlayMsg::LayerVisible { visible, .. } if visible == after));
}

#[tokio::test]
async fn burst_limit_breaks_loops() {
    let r = rig(vec![command("x", Permission::Everyone, vec![say("x")])]);
    for _ in 0..(BURST_LIMIT + 5) {
        r.auto.on_event(&chat("!x", modr()));
    }
    assert_eq!(wait_calls(&r.rec, BURST_LIMIT + 5).await.len(), BURST_LIMIT);
}

#[tokio::test]
async fn action_cooldown() {
    let mut a = command("cd", Permission::Everyone, vec![say("cd")]);
    a.cooldown_s = 60;
    let r = rig(vec![a]);
    r.auto.on_event(&chat("!cd", modr()));
    r.auto.on_event(&chat("!cd", modr()));
    assert_eq!(wait_calls(&r.rec, 2).await.len(), 1);
}

#[tokio::test]
async fn timers_respect_chat_activity_and_live() {
    let a = Action {
        id: "t".into(),
        triggers: vec![Trigger::Timer {
            interval_s: 60,
            only_when_live: true,
            min_chat_lines: 2,
        }],
        steps: vec![say("tick")],
        ..Action::default()
    };
    let r = rig(vec![a]);
    let t0 = Instant::now();
    r.auto.on_tick(t0);
    r.auto.on_tick(t0 + Duration::from_secs(61));
    assert!(wait_calls(&r.rec, 1).await.is_empty(), "offline");
    r.auto.set_live(true);
    r.auto.on_tick(t0 + Duration::from_secs(122));
    assert!(wait_calls(&r.rec, 1).await.is_empty(), "not enough chat");
    r.auto.on_event(&chat("hello", UserRoles::default()));
    r.auto.on_event(&chat("hello", UserRoles::default()));
    r.auto.on_tick(t0 + Duration::from_secs(183));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false tick"]
    );
    r.auto.on_tick(t0 + Duration::from_secs(190));
    assert!(
        wait_calls(&r.rec, 1).await.is_empty(),
        "interval not reached again"
    );
}

#[tokio::test]
async fn scene_change_trigger() {
    let a = Action {
        triggers: vec![Trigger::SceneChanged {
            scene: "brb".into(),
        }],
        steps: vec![say("in {{scene}}")],
        ..Action::default()
    };
    let r = rig(vec![a]);
    r.auto.on_signal(&Signal::SceneChanged {
        scene: "Gameplay".into(),
    });
    r.auto.on_signal(&Signal::SceneChanged {
        scene: "BRB".into(),
    });
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false in BRB"]
    );
}

#[tokio::test]
async fn song_change_trigger() {
    let a = Action {
        triggers: vec![Trigger::SongChanged],
        steps: vec![say("Now playing {{title}} by {{artist}}")],
        ..Action::default()
    };
    let r = rig(vec![a]);
    assert!(r.auto.wants_songs());
    r.auto
        .on_signal(&Signal::SongChanged(crate::model::music::NowPlaying {
            title: "Nightcall".into(),
            artist: "Kavinsky".into(),
            ..Default::default()
        }));
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Now playing Nightcall by Kavinsky"]
    );
    assert!(!rig(vec![]).auto.wants_songs());
}

#[tokio::test]
async fn soundboard_step() {
    let a = Action {
        triggers: vec![Trigger::Manual],
        steps: vec![Step::PlaySoundboardSound {
            sound_id: "airhorn".into(),
        }],
        ..Action::default()
    };
    let id = a.id.clone();
    let r = rig(vec![a]);
    r.auto.run_manual(&id).unwrap();
    assert_eq!(wait_calls(&r.rec, 1).await, vec!["sound airhorn"]);
}

#[tokio::test]
async fn hype_train_triggers() {
    let action = |t: Trigger, text: &str| Action {
        triggers: vec![t],
        steps: vec![say(text)],
        ..Action::default()
    };
    let r = rig(vec![
        action(Trigger::HypeTrainBegin, "Choo choo, level {{level}}"),
        action(
            Trigger::HypeTrainLevelUp,
            "Level {{previous_level}} to {{level}}, top bits {{top_bits_name}}",
        ),
        action(Trigger::HypeTrainEnd, "Ended at level {{level}}"),
    ]);
    let mut e = Event::new(EventKind::HypeTrainBegin);
    e.data.insert("level".into(), json!(1));
    r.auto.on_event(&e);
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Choo choo, level 1"]
    );

    let mut up = Event::new(EventKind::HypeTrainProgress);
    up.data.insert("level".into(), json!(3));
    up.data.insert(
        "top_contributions".into(),
        json!([{"name": "PogChamp", "type": "bits", "total": 900}]),
    );
    r.auto.on_event(&up);
    r.auto.on_signal(&Signal::HypeLevelUp {
        from: 2,
        event: Box::new(up),
    });
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Level 2 to 3, top bits PogChamp"],
        "progress alone runs nothing"
    );

    let mut end = Event::new(EventKind::HypeTrainEnd);
    end.data.insert("level".into(), json!(3));
    r.auto.on_event(&end);
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Ended at level 3"]
    );
}

#[tokio::test]
async fn giveaway_and_queue_triggers() {
    let mk = |t: Trigger, msg: &str| Action {
        triggers: vec![t],
        steps: vec![say(msg)],
        ..Action::default()
    };
    let r = rig(vec![
        mk(Trigger::GiveawayOpened, "open {{title}}"),
        mk(Trigger::GiveawayWinner, "won {{winner}}"),
        mk(Trigger::PlayerPicked, "up {{player}} ({{note}})"),
    ]);
    let args = |pairs: &[(&str, &str)]| {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect::<Map<String, Value>>()
    };
    r.auto.on_signal(&Signal::Play {
        trigger: PlayTrigger::GiveawayOpened,
        args: args(&[("title", "Key")]),
    });
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        ["chat bot=false reply=false open Key"]
    );
    r.auto.on_signal(&Signal::Play {
        trigger: PlayTrigger::GiveawayClosed,
        args: Map::new(),
    });
    r.auto.on_signal(&Signal::Play {
        trigger: PlayTrigger::GiveawayWinner,
        args: args(&[("winner", "Kat")]),
    });
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        ["chat bot=false reply=false won Kat"]
    );
    r.auto.on_signal(&Signal::Play {
        trigger: PlayTrigger::PlayerPicked,
        args: args(&[("player", "Rudy"), ("note", "Rudy#2")]),
    });
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        ["chat bot=false reply=false up Rudy (Rudy#2)"]
    );
}

#[tokio::test]
async fn giveaway_and_queue_steps() {
    let r = rig(vec![]);
    let a = Action {
        steps: vec![
            Step::OpenGiveaway {
                title: "{{prize}}".into(),
            },
            Step::CloseGiveaway,
            Step::DrawGiveaway { count: 2 },
            Step::SetQueueOpen { state: Toggle::On },
            Step::SetQueueOpen {
                state: Toggle::Toggle,
            },
            Step::QueueNext {
                count: 0,
                random: true,
            },
            Step::ClearQueue,
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(!run.ok, "nothing set up yet");
    r.auto.set_play(r.rec.clone());
    let mut args = Map::new();
    args.insert("prize".into(), json!("Mouse"));
    let run = r.auto.execute(&a, "test", args, None).await;
    assert!(run.ok, "{:?}", run.errors);
    assert_eq!(
        r.rec.take(),
        [
            "giveaway open Mouse",
            "giveaway close",
            "giveaway draw 2",
            "queue open Some(true)",
            "queue open None",
            "queue next 0 random=true",
            "queue clear"
        ]
    );
}

#[tokio::test]
async fn disabled_actions_dont_run_but_manual_does() {
    let mut a = command("off", Permission::Everyone, vec![say("ran")]);
    a.enabled = false;
    let id = a.id.clone();
    let r = rig(vec![a]);
    r.auto.on_event(&chat("!off", modr()));
    assert!(wait_calls(&r.rec, 1).await.is_empty());
    r.auto.run_manual(&id).unwrap();
    assert_eq!(wait_calls(&r.rec, 1).await.len(), 1);
    assert!(r.auto.run_manual("missing").is_err());
}

#[tokio::test]
async fn http_rejects_bad_urls() {
    let r = rig(vec![]);
    for url in ["file:///etc/passwd", "not a url", "ftp://x"] {
        let a = Action {
            steps: vec![Step::HttpRequest {
                method: HttpMethod::Get,
                url: url.into(),
                body: String::new(),
                save_to: String::new(),
            }],
            ..Action::default()
        };
        assert!(
            !r.auto.execute(&a, "test", Map::new(), None).await.ok,
            "{url}"
        );
    }
}

#[tokio::test]
async fn http_request_saves_response() {
    use axum::{Router, routing::post};
    let app = Router::new().route(
        "/hook",
        post(|body: String| async move { format!("got {body}") }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let r = rig(vec![]);
    let a = Action {
        steps: vec![Step::HttpRequest {
            method: HttpMethod::Post,
            url: format!("http://{addr}/hook"),
            body: r#"{"who":"{{name}}"}"#.into(),
            save_to: "last.response".into(),
        }],
        ..Action::default()
    };
    let mut args = Map::new();
    args.insert("name".into(), json!("Nova"));
    let run = r.auto.execute(&a, "test", args, None).await;
    assert!(run.ok, "{:?}", run.errors);
    assert_eq!(
        r.hub.vars.get("last.response"),
        Some(json!(r#"got {"who":"Nova"}"#))
    );
}

#[test]
fn starter_actions_are_valid() {
    let p = Project::starter();
    assert!(!p.actions.is_empty());
    for a in &p.actions {
        assert!(!a.triggers.is_empty(), "{} has no trigger", a.name);
        assert!(a.steps.is_empty(), "{} still has a step list", a.name);
        assert!(
            a.graph.nodes.len() > a.triggers.len(),
            "{} has no steps",
            a.name
        );
        let plan = a.graph.start_plan(Some(0));
        assert!(!plan.first.is_empty(), "{} trigger leads nowhere", a.name);
    }
}

#[test]
fn run_now_from_a_plain_thread_does_not_panic() {
    // Tauri runs sync commands on the main thread, outside any Tokio runtime.
    let rt = tokio::runtime::Runtime::new().unwrap();
    let r = rt.block_on(async {
        rig(vec![command(
            "deaths",
            Permission::Everyone,
            vec![say("x")],
        )])
    });
    let id = r.project.read(|p| p.actions[0].id.clone());
    let auto = r.auto.clone();
    std::thread::spawn(move || auto.run_manual(&id).unwrap())
        .join()
        .expect("run_manual panicked outside a runtime");
}

// Graphs

use crate::model::automation::{EdgeBranch, EdgeSide, Graph, GraphEdge, GraphNode, NodeKind};

fn at(id: &str, x: f64, y: f64, kind: NodeKind) -> GraphNode {
    GraphNode {
        id: id.into(),
        x,
        y,
        kind,
    }
}

fn trig(id: &str, x: f64, t: Trigger) -> GraphNode {
    at(id, x, 0.0, NodeKind::Trigger { trigger: t })
}

fn step(id: &str, x: f64, y: f64, s: Step) -> GraphNode {
    at(id, x, y, NodeKind::Step { step: s })
}

fn line(from: &str, to: &str, branch: EdgeBranch) -> GraphEdge {
    GraphEdge {
        id: format!("{from}-{to}-{branch:?}"),
        from: from.into(),
        from_side: EdgeSide::Right,
        to: to.into(),
        to_side: EdgeSide::Left,
        branch,
    }
}

fn next(from: &str, to: &str) -> GraphEdge {
    line(from, to, EdgeBranch::Next)
}

fn graph(name: &str, nodes: Vec<GraphNode>, edges: Vec<GraphEdge>) -> Action {
    let mut a = Action {
        id: name.into(),
        name: name.into(),
        graph: Graph {
            nodes,
            edges,
            ..Graph::default()
        },
        ..Action::default()
    };
    a.normalize();
    a
}

#[tokio::test]
async fn notes_and_frames_do_not_change_runs() {
    use crate::model::automation::{GraphFrame, GraphNote};
    let r = rig(vec![]);
    let mut a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("a", 0.0, 200.0, say("a")),
            step("b", 0.0, 400.0, say("b")),
        ],
        vec![next("t", "a"), next("a", "b")],
    );
    // A note above everything and a collapsed frame around the steps.
    a.graph.notes.push(GraphNote {
        id: "note".into(),
        y: -500.0,
        text: "Read me".into(),
        ..GraphNote::default()
    });
    a.graph.frames.push(GraphFrame {
        id: "frame".into(),
        y: -400.0,
        collapsed: true,
        members: vec!["a".into(), "b".into(), "note".into()],
        ..GraphFrame::default()
    });
    a.normalize();
    assert_eq!(a.triggers, vec![Trigger::Manual]);
    assert_eq!(a.graph.start_plan(None).first, vec!["a".to_string()]);
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(run.ok);
    assert_eq!(chat_lines(r.rec.take()), vec!["a", "b"]);
    let ids: Vec<&str> = run.nodes.iter().map(|n| n.node_id.as_str()).collect();
    assert_eq!(ids, vec!["t", "a", "b"]);
}

fn amount_over(v: i64) -> Step {
    Step::If {
        conditions: ConditionGroup {
            mode: MatchMode::All,
            conditions: vec![Condition {
                field: "amount".into(),
                op: Op::Gt,
                value: json!(v),
            }],
        },
        then: vec![],
        otherwise: vec![],
    }
}

fn chat_lines(calls: Vec<String>) -> Vec<String> {
    calls
        .into_iter()
        .map(|c| {
            c.trim_start_matches("chat bot=false reply=false ")
                .to_string()
        })
        .collect()
}

#[tokio::test]
async fn depth_first_by_position_and_merges_run_each_time() {
    let r = rig(vec![]);
    // b sits higher than a, so its path runs first; c is reached twice.
    let a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("a", 0.0, 300.0, say("a")),
            step("b", 400.0, 200.0, say("b")),
            step("c", 0.0, 500.0, say("c")),
            step("d", 0.0, 600.0, say("d")),
        ],
        vec![
            next("t", "a"),
            next("t", "b"),
            next("a", "c"),
            next("b", "c"),
            next("c", "d"),
        ],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(run.ok);
    assert_eq!(chat_lines(r.rec.take()), vec!["b", "c", "d", "a", "c", "d"]);
    let ids: Vec<&str> = run.nodes.iter().map(|n| n.node_id.as_str()).collect();
    assert_eq!(ids, vec!["t", "b", "c", "d", "a"]);
    assert!(run.nodes.iter().all(|n| n.state == NodeState::Ok));
}

#[tokio::test]
async fn if_follows_then_or_otherwise_and_always_lines() {
    let r = rig(vec![]);
    let a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("if", 0.0, 100.0, amount_over(100)),
            step("big", 0.0, 200.0, say("big")),
            step("small", 300.0, 200.0, say("small")),
            step("always", 600.0, 200.0, say("always")),
        ],
        vec![
            next("t", "if"),
            line("if", "big", EdgeBranch::Then),
            line("if", "small", EdgeBranch::Otherwise),
            next("if", "always"),
        ],
    );
    let mut args = Map::new();
    args.insert("amount".into(), json!(500));
    let run = r.auto.execute(&a, "test", args, None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["big", "always"]);
    let small = run.nodes.iter().find(|n| n.node_id == "small").unwrap();
    assert_eq!(small.state, NodeState::Skipped);
    let mut args = Map::new();
    args.insert("amount".into(), json!(5));
    r.auto.execute(&a, "test", args, None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["small", "always"]);
}

#[tokio::test]
async fn loops_stop_at_the_budget() {
    let r = rig(vec![]);
    let a = graph(
        "loop",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("a", 0.0, 100.0, say("a")),
            step("b", 0.0, 200.0, say("b")),
        ],
        vec![next("t", "a"), next("a", "b"), next("b", "a")],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(!run.ok);
    assert_eq!(r.rec.take().len(), MAX_NODE_RUNS as usize);
    assert!(
        run.errors[0].contains("Stopped after 500 steps"),
        "{:?}",
        run.errors
    );
}

#[tokio::test]
async fn stop_ends_the_whole_run() {
    let r = rig(vec![]);
    let a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("stop", 0.0, 100.0, Step::Stop),
            step("later", 300.0, 200.0, say("later")),
        ],
        vec![next("t", "stop"), next("t", "later")],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert!(run.ok);
    assert!(r.rec.take().is_empty());
    let later = run.nodes.iter().find(|n| n.node_id == "later").unwrap();
    assert_eq!(later.state, NodeState::Skipped);
}

#[tokio::test]
async fn failed_node_is_marked_and_the_run_goes_on() {
    let r = rig(vec![]);
    let a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step(
                "bad",
                0.0,
                100.0,
                Step::SetVariable {
                    key: "bad key".into(),
                    value: "x".into(),
                    persist: false,
                },
            ),
            step("ok", 0.0, 200.0, say("ok")),
        ],
        vec![next("t", "bad"), next("bad", "ok")],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["ok"]);
    let bad = run.nodes.iter().find(|n| n.node_id == "bad").unwrap();
    assert_eq!(bad.state, NodeState::Error);
    assert!(bad.errors[0].contains("valid variable name"));
    assert_eq!(run.errors.len(), 1);
}

fn two_starts(first: Trigger, second: Trigger) -> Action {
    graph(
        "two",
        vec![
            trig("t0", 0.0, first),
            trig("t1", 400.0, second),
            step("s0", 0.0, 200.0, say("first")),
            step("s1", 400.0, 200.0, say("second")),
        ],
        vec![next("t0", "s0"), next("t1", "s1")],
    )
}

#[tokio::test]
async fn runs_start_at_the_trigger_that_fired() {
    let cmd = |n: &str| Trigger::Command {
        name: n.into(),
        aliases: vec![],
        permission: Permission::Everyone,
        user_cooldown_s: 0,
    };
    let r = rig(vec![two_starts(cmd("a"), cmd("b"))]);
    r.auto.on_event(&chat("!b", modr()));
    assert_eq!(chat_lines(wait_calls(&r.rec, 1).await), vec!["second"]);
    r.auto.on_event(&chat("!a", modr()));
    assert_eq!(chat_lines(wait_calls(&r.rec, 1).await), vec!["first"]);
    // A Button trigger is where Test and Stream Deck start.
    let r = rig(vec![two_starts(cmd("a"), Trigger::Manual)]);
    r.auto.run_manual("two").unwrap();
    assert_eq!(chat_lines(wait_calls(&r.rec, 1).await), vec!["second"]);
}

#[tokio::test]
async fn timers_start_their_own_trigger() {
    let timer = |s: u32| Trigger::Timer {
        interval_s: s,
        only_when_live: false,
        min_chat_lines: 0,
    };
    let r = rig(vec![two_starts(timer(60), timer(600))]);
    let t0 = Instant::now();
    r.auto.on_tick(t0);
    r.auto.on_tick(t0 + Duration::from_secs(61));
    assert_eq!(chat_lines(wait_calls(&r.rec, 1).await), vec!["first"]);
    r.auto.on_tick(t0 + Duration::from_secs(601));
    let mut both = chat_lines(wait_calls(&r.rec, 2).await);
    both.sort();
    assert_eq!(both, vec!["first", "second"]);
}

#[tokio::test]
async fn manual_runs_without_a_button_start_from_every_trigger() {
    let r = rig(vec![]);
    let a = two_starts(Trigger::StreamOnline, Trigger::StreamOffline);
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["first", "second"]);
    assert_eq!(run.nodes.len(), 4);
    // Converted lists: several triggers share the first step, which runs once.
    let old = Action {
        triggers: vec![Trigger::StreamOnline, Trigger::StreamOffline],
        steps: vec![say("once")],
        ..Action::default()
    };
    r.auto.execute(&old, "test", Map::new(), None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["once"]);
}

#[tokio::test]
async fn run_action_starts_the_other_action_like_a_button() {
    let callee = two_starts(Trigger::Manual, Trigger::StreamOnline);
    let r = rig(vec![callee]);
    let caller = Action {
        steps: vec![
            Step::RunAction {
                action_id: "two".into(),
            },
            say("back"),
        ],
        ..Action::default()
    };
    let run = r.auto.execute(&caller, "test", Map::new(), None).await;
    assert_eq!(chat_lines(r.rec.take()), vec!["first", "back"]);
    // Only the caller's nodes are reported.
    assert_eq!(run.nodes.len(), 2);
}

#[tokio::test]
async fn runs_report_each_step_and_the_line_taken() {
    let r = rig(vec![]);
    let a = graph(
        "g",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step("if", 0.0, 100.0, amount_over(100)),
            step("big", 0.0, 200.0, say("big")),
            step("small", 300.0, 200.0, say("small")),
        ],
        vec![
            next("t", "if"),
            line("if", "big", EdgeBranch::Then),
            line("if", "small", EdgeBranch::Otherwise),
        ],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    let steps: Vec<(&str, Option<&str>)> = run
        .steps
        .iter()
        .map(|s| (s.node_id.as_str(), s.via.as_deref()))
        .collect();
    assert_eq!(
        steps,
        vec![
            ("t", None),
            ("if", Some("t-if-Next")),
            ("small", Some("if-small-Otherwise")),
        ]
    );
    // Live progress: steps say when they start, and every node when it finishes.
    let sent: Vec<RunProgress> =
        r.ui.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == ui::ACTION_PROGRESS)
            .map(|(_, v)| serde_json::from_value(v.clone()).unwrap())
            .collect();
    let seen: Vec<(&str, Option<NodeState>)> =
        sent.iter().map(|p| (p.node_id.as_str(), p.state)).collect();
    assert_eq!(
        seen,
        vec![
            ("t", Some(NodeState::Ok)),
            ("if", Some(NodeState::Ok)),
            ("small", None),
            ("small", Some(NodeState::Ok)),
        ]
    );
    assert!(
        sent.iter()
            .all(|p| p.run_id == run.run_id && p.action_id == "g")
    );
    // Each run gets its own id.
    let again = r.auto.execute(&a, "test", Map::new(), None).await;
    assert_ne!(again.run_id, run.run_id);
}

#[tokio::test]
async fn failed_steps_and_nested_actions_in_the_trace() {
    let callee = graph(
        "inner",
        vec![
            trig("it", 0.0, Trigger::Manual),
            step("is", 0.0, 100.0, say("inner")),
        ],
        vec![next("it", "is")],
    );
    let r = rig(vec![callee]);
    let a = graph(
        "outer",
        vec![
            trig("t", 0.0, Trigger::Manual),
            step(
                "bad",
                0.0,
                100.0,
                Step::SetVariable {
                    key: "bad key".into(),
                    value: "x".into(),
                    persist: false,
                },
            ),
            step(
                "call",
                0.0,
                200.0,
                Step::RunAction {
                    action_id: "inner".into(),
                },
            ),
        ],
        vec![next("t", "bad"), next("bad", "call")],
    );
    let run = r.auto.execute(&a, "test", Map::new(), None).await;
    let steps: Vec<(&str, NodeState)> = run
        .steps
        .iter()
        .map(|s| (s.node_id.as_str(), s.state))
        .collect();
    // The other action's nodes aren't part of this trace.
    assert_eq!(
        steps,
        vec![
            ("t", NodeState::Ok),
            ("bad", NodeState::Error),
            ("call", NodeState::Ok)
        ]
    );
}

fn redemption(reward_id: &str, title: &str) -> Event {
    let mut e = Event::new(EventKind::Redemption).with_user("nova", "Nova");
    e.amount = Some(250.0);
    e.message = Some("lofi please".into());
    e.data.insert("reward_id".into(), json!(reward_id));
    e.data.insert("reward_title".into(), json!(title));
    e.data.insert("redemption_id".into(), json!("red-1"));
    e
}

fn on(trigger: Trigger, steps: Vec<Step>) -> Action {
    Action {
        name: "interact".into(),
        triggers: vec![trigger],
        steps,
        ..Action::default()
    }
}

#[tokio::test]
async fn redemption_trigger_picks_its_reward_and_finishes_it() {
    let r = rig(vec![on(
        Trigger::Redemption {
            reward_id: "r1".into(),
            reward_title: String::new(),
        },
        vec![
            say("{{user}} redeemed {{reward}} for {{cost}}: {{input}}"),
            Step::FinishRedemption { refund: true },
        ],
    )]);
    r.auto.on_event(&redemption("r2", "Other"));
    assert!(wait_calls(&r.rec, 1).await.is_empty(), "other rewards");
    r.auto.on_event(&redemption("r1", "Song"));
    assert_eq!(
        wait_calls(&r.rec, 2).await,
        vec![
            "chat bot=false reply=false Nova redeemed Song for 250: lofi please".to_string(),
            "redemption r1/red-1 refund=true".to_string(),
        ]
    );
}

#[tokio::test]
async fn reward_poll_and_prediction_steps() {
    let r = rig(vec![on(
        Trigger::Manual,
        vec![
            Step::SetRewardState {
                reward_id: "r1".into(),
                reward_title: "Hydrate".into(),
                state: crate::model::interact::RewardState::Pause,
            },
            Step::SetRewardCost {
                reward_id: String::new(),
                reward_title: "Hydrate".into(),
                cost: "{{counter.price}}".into(),
            },
            Step::StartPoll {
                title: "Next map?".into(),
                choices: vec!["Dust".into(), " ".into(), "Mirage".into()],
                duration_s: 60,
                points_per_vote: 0,
            },
            Step::EndPoll,
            Step::StartPrediction {
                title: "Win?".into(),
                outcomes: vec!["Yes".into(), "No".into()],
                window_s: 90,
            },
            Step::EndPrediction {
                action: PredictionAction::Resolve,
                winner: "2".into(),
            },
        ],
    )]);
    r.hub.set_var("counter.price", json!(750), false);
    let id = r.project.read(|p| p.actions[0].id.clone());
    r.auto.run_manual(&id).unwrap();
    assert_eq!(
        wait_calls(&r.rec, 6).await,
        vec![
            "reward r1|Hydrate Pause".to_string(),
            "reward |Hydrate cost=750".to_string(),
            "poll Next map? [Dust,Mirage] 60s points=0".to_string(),
            "end poll".to_string(),
            "prediction Win? [Yes,No] 90s".to_string(),
            "prediction Resolve 2".to_string(),
        ]
    );
}

#[tokio::test]
async fn finish_redemption_needs_a_redemption() {
    let action = on(
        Trigger::Manual,
        vec![Step::FinishRedemption { refund: false }],
    );
    let r = rig(vec![action.clone()]);
    let run = r.auto.execute(&action, "manual", Map::new(), None).await;
    assert!(!run.ok);
    assert!(run.errors[0].contains("needs a channel point redemption"));
    let bad = on(
        Trigger::Manual,
        vec![Step::StartPoll {
            title: "Q".into(),
            choices: vec!["Only one".into()],
            duration_s: 60,
            points_per_vote: 0,
        }],
    );
    let run = r.auto.execute(&bad, "manual", Map::new(), None).await;
    assert!(run.errors[0].contains("2 to 5 choices"), "{:?}", run.errors);
    assert!(r.rec.take().is_empty());
}

#[tokio::test]
async fn poll_and_prediction_triggers() {
    let r = rig(vec![
        on(Trigger::PollEnd, vec![say("Winner: {{poll.winner}}")]),
        on(
            Trigger::PredictionBegin,
            vec![say("Predict: {{prediction.title}}")],
        ),
    ]);
    let mut end = Event::new(EventKind::PollEnd);
    end.data.insert("status".into(), json!("completed"));
    end.data.insert(
        "choices".into(),
        json!([{"title": "Dust", "votes": 4}, {"title": "Mirage", "votes": 1}]),
    );
    r.auto.on_event(&end);
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Winner: Dust".to_string()]
    );
    end.id = "again".into();
    end.data.insert("status".into(), json!("archived"));
    r.auto.on_event(&end);
    assert!(
        wait_calls(&r.rec, 1).await.is_empty(),
        "archiving isn't a new end"
    );
    let mut begin = Event::new(EventKind::PredictionBegin);
    begin.data.insert("title".into(), json!("Win?"));
    r.auto.on_event(&begin);
    assert_eq!(
        wait_calls(&r.rec, 1).await,
        vec!["chat bot=false reply=false Predict: Win?".to_string()]
    );
}

#[tokio::test]
async fn roll_credits_shows_the_layer_and_sends_names() {
    use crate::model::overlay::{CreditNames, CreditStart, LayerKind, default_credit_sections};
    let r = rig(vec![]);
    let overlay_id = r.project.read(|p| p.overlays[0].id.clone());
    let layer_id = r.project.update(|p| {
        let mut layer = p.overlays[0].layers[0].clone();
        layer.id = "credits1".into();
        layer.visible = false;
        layer.kind = LayerKind::Credits {
            sections: default_credit_sections(),
            speed: 60,
            fit_s: 0,
            repeat: false,
            start: CreditStart::Trigger,
            heading: String::new(),
            footer: String::new(),
            names: CreditNames::Plain,
            columns: 1,
            fade_edges: true,
            show_amounts: true,
            max_chatters: 10,
            page_s: 6,
            style: Default::default(),
            title_style: Default::default(),
            heading_style: Default::default(),
            section_box: Default::default(),
        };
        p.overlays[0].layers.push(layer);
        "credits1".to_string()
    });
    let mut ov = r.hub.subscribe_overlays();
    let roll = |layer_id: &str| Action {
        steps: vec![Step::RollCredits {
            overlay_id: overlay_id.clone(),
            layer_id: layer_id.into(),
        }],
        ..Action::default()
    };
    assert!(
        r.auto
            .execute(&roll(&layer_id), "test", Map::new(), None)
            .await
            .ok
    );
    assert!(
        r.project
            .read(|p| p.overlays[0].layers.last().unwrap().visible),
        "shown"
    );
    let first = ov.recv().await.unwrap();
    assert!(matches!(
        first.msg,
        OverlayMsg::LayerVisible { visible: true, .. }
    ));
    let out = ov.recv().await.unwrap();
    assert_eq!(out.target.as_deref(), Some(overlay_id.as_str()));
    assert!(matches!(&out.msg, OverlayMsg::CreditsRoll { layer_id: l, .. } if l == "credits1"));

    // Not a credits layer, or gone.
    let other = r.project.read(|p| p.overlays[0].layers[0].id.clone());
    assert!(
        !r.auto
            .execute(&roll(&other), "test", Map::new(), None)
            .await
            .ok
    );
    assert!(
        !r.auto
            .execute(&roll("nope"), "test", Map::new(), None)
            .await
            .ok
    );
}
