//! Sandboxed Rhai scripts for the "Run script" step. Scripts can read and set
//! variables, read the run's arguments, write to the log and queue chat messages.
//! They can't touch files or the network, and are stopped after a time limit.

use rhai::{Dynamic, Engine, EvalAltResult, Map as RhaiMap, Scope};
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const TIME_LIMIT: Duration = Duration::from_secs(2);

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ScriptEffects {
    /// (key, value, persist)
    pub set_vars: Vec<(String, Value, bool)>,
    pub chat: Vec<String>,
    pub logs: Vec<String>,
}

#[derive(Default)]
struct Shared {
    effects: ScriptEffects,
    values: Map<String, Value>,
}

/// Run `code`. `vars` is a copy of the current variables plus the run's arguments.
pub fn run(
    code: &str,
    args: &Map<String, Value>,
    vars: Map<String, Value>,
) -> Result<ScriptEffects, String> {
    let shared = Arc::new(Mutex::new(Shared {
        effects: ScriptEffects::default(),
        values: vars,
    }));
    let mut engine = Engine::new();
    engine.set_max_operations(500_000);
    engine.set_max_call_levels(32);
    engine.set_max_expr_depths(64, 32);
    engine.set_max_string_size(64 * 1024);
    engine.set_max_array_size(10_000);
    engine.set_max_map_size(10_000);
    let started = Instant::now();
    engine.on_progress(move |_| {
        if started.elapsed() > TIME_LIMIT {
            Some(Dynamic::from(
                "Script took longer than 2 seconds and was stopped.",
            ))
        } else {
            None
        }
    });
    engine.disable_symbol("eval");

    let s = shared.clone();
    engine.register_fn("get", move |key: &str| -> Dynamic {
        let g = s.lock().unwrap();
        g.values
            .get(key)
            .and_then(|v| rhai::serde::to_dynamic(v).ok())
            .unwrap_or(Dynamic::UNIT)
    });
    let s = shared.clone();
    engine.register_fn("set", move |key: &str, value: Dynamic| {
        set_value(&s, key, value, false);
    });
    let s = shared.clone();
    engine.register_fn("save", move |key: &str, value: Dynamic| {
        set_value(&s, key, value, true);
    });
    let s = shared.clone();
    engine.register_fn("log", move |msg: Dynamic| {
        s.lock().unwrap().effects.logs.push(msg.to_string());
    });
    let s = shared.clone();
    engine.register_fn("chat", move |msg: Dynamic| {
        let text = msg.to_string();
        if !text.trim().is_empty() {
            s.lock().unwrap().effects.chat.push(text);
        }
    });
    engine.register_fn("random", |min: i64, max: i64| -> i64 {
        use rand::Rng;
        if max <= min {
            min
        } else {
            rand::rng().random_range(min..=max)
        }
    });
    engine.register_fn("now_ms", || -> i64 { crate::util::now_ms() });

    let mut scope = Scope::new();
    let args_map: RhaiMap = args
        .iter()
        .filter_map(|(k, v)| {
            rhai::serde::to_dynamic(v)
                .ok()
                .map(|d| (k.as_str().into(), d))
        })
        .collect();
    scope.push_constant("args", args_map);

    let result = engine.run_with_scope(&mut scope, code);
    match result {
        Ok(()) => Ok(std::mem::take(&mut shared.lock().unwrap().effects)),
        Err(e) => Err(friendly_error(&e)),
    }
}

fn set_value(shared: &Arc<Mutex<Shared>>, key: &str, value: Dynamic, persist: bool) {
    let json: Value = rhai::serde::from_dynamic(&value).unwrap_or(Value::Null);
    let mut g = shared.lock().unwrap();
    g.values.insert(key.to_string(), json.clone());
    g.effects.set_vars.push((key.to_string(), json, persist));
}

fn friendly_error(e: &EvalAltResult) -> String {
    match e {
        EvalAltResult::ErrorTerminated(reason, _) => reason.to_string(),
        EvalAltResult::ErrorTooManyOperations(_) => {
            "Script did too much work and was stopped.".into()
        }
        other => format!("Script error: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn args() -> Map<String, Value> {
        json!({ "name": "Nova", "amount": 500 })
            .as_object()
            .unwrap()
            .clone()
    }

    #[test]
    fn reads_args_and_vars_and_sets() {
        let mut vars = Map::new();
        vars.insert("counter.deaths".into(), json!(3));
        let fx = run(
            r#"
            let d = get("counter.deaths");
            save("counter.deaths", d + 1);
            set("last.greeting", "hi " + args.name);
            if args.amount > 100 { chat("Thanks " + args.name + "!"); }
            log(`deaths now ${get("counter.deaths")}`);
            "#,
            &args(),
            vars,
        )
        .unwrap();
        assert_eq!(fx.set_vars[0], ("counter.deaths".into(), json!(4), true));
        assert_eq!(
            fx.set_vars[1],
            ("last.greeting".into(), json!("hi Nova"), false)
        );
        assert_eq!(fx.chat, vec!["Thanks Nova!"]);
        assert_eq!(fx.logs, vec!["deaths now 4"]);
    }

    #[test]
    fn infinite_loop_is_stopped() {
        let err = run("loop { }", &args(), Map::new()).unwrap_err();
        assert!(err.contains("stopped"), "{err}");
    }

    #[test]
    fn syntax_errors_are_reported() {
        let err = run("let = ;", &args(), Map::new()).unwrap_err();
        assert!(err.starts_with("Script error"), "{err}");
    }

    #[test]
    fn args_are_read_only() {
        assert!(run("args = 1;", &args(), Map::new()).is_err());
    }

    #[test]
    fn missing_var_is_unit() {
        let fx = run(
            r#"if get("nope") == () { log("none"); }"#,
            &args(),
            Map::new(),
        )
        .unwrap();
        assert_eq!(fx.logs, vec!["none"]);
    }

    #[test]
    fn random_in_range() {
        let fx = run(
            r#"let r = random(1, 3); if r < 1 || r > 3 { log("bad"); }"#,
            &args(),
            Map::new(),
        )
        .unwrap();
        assert!(fx.logs.is_empty());
    }
}
