use super::*;
use crate::model::condition::{Condition, ConditionGroup, MatchMode, Op};
use crate::model::project::Project;
use crate::services::Recorder;
use serde_json::json;

struct Rig {
    auto: Arc<Automation>,
    hub: Arc<Hub>,
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
    let hub = Hub::test();
    let alerts = AlertEngine::new(hub.clone(), project.clone());
    let auto = Automation::new(hub.clone(), project.clone(), alerts);
    let rec = Arc::new(Recorder::default());
    auto.set_twitch(rec.clone());
    auto.set_obs(rec.clone());
    Rig {
        auto,
        hub,
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
        assert!(!a.steps.is_empty(), "{} has no steps", a.name);
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
