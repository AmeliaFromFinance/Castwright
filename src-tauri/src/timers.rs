//! Start, pause and reset for countdown and stopwatch layers. The app keeps the
//! state so every overlay page shows the same time, also after a reload.

use crate::error::{AppResult, user_err};
use crate::hub::{Hub, ui};
use crate::model::overlay::{LayerKind, TimerMode};
use crate::model::runtime::OverlayMsg;
pub use crate::model::runtime::{TimerAction, TimerChange, TimerRun};
use crate::store::project::ProjectStore;
use std::collections::HashMap;
use std::sync::Mutex;

/// The state after `action`. `limit` is a countdown's length; it stops counting there.
pub fn apply(
    run: Option<TimerRun>,
    action: TimerAction,
    add_ms: i64,
    limit: Option<i64>,
    now: i64,
) -> TimerRun {
    let running = run.is_some_and(|r| r.running);
    let mut elapsed = run.map_or(0, |r| r.elapsed(now));
    if let Some(limit) = limit {
        elapsed = elapsed.min(limit.max(0));
    }
    let at = |running: bool, elapsed_ms: i64| TimerRun {
        running,
        elapsed_ms,
        at: now,
    };
    match action {
        TimerAction::Start => at(true, 0),
        TimerAction::Reset => at(false, 0),
        TimerAction::Pause => at(false, elapsed),
        TimerAction::Resume => at(true, elapsed),
        TimerAction::Toggle => at(!running, elapsed),
        TimerAction::Add => {
            let next = if limit.is_some() {
                elapsed - add_ms
            } else {
                (elapsed + add_ms).max(0)
            };
            at(running, next)
        }
    }
}

/// Timer state per layer id.
#[derive(Default)]
pub struct Timers {
    runs: Mutex<HashMap<String, TimerRun>>,
}

impl Timers {
    pub fn get(&self, layer_id: &str) -> Option<TimerRun> {
        self.runs.lock().unwrap().get(layer_id).copied()
    }

    pub fn all(&self) -> HashMap<String, TimerRun> {
        self.runs.lock().unwrap().clone()
    }

    /// The ones for these layers.
    pub fn for_layers<'a>(
        &self,
        ids: impl IntoIterator<Item = &'a str>,
    ) -> HashMap<String, TimerRun> {
        let g = self.runs.lock().unwrap();
        ids.into_iter()
            .filter_map(|id| g.get(id).map(|r| (id.to_string(), *r)))
            .collect()
    }

    fn set(&self, layer_id: &str, run: TimerRun) {
        self.runs.lock().unwrap().insert(layer_id.to_string(), run);
    }
}

/// Runs `action` on the timer layer `layer_id` and tells its overlay. `seconds` is for Add.
pub fn control(
    hub: &Hub,
    project: &ProjectStore,
    layer_id: &str,
    action: TimerAction,
    seconds: f64,
) -> AppResult<TimerRun> {
    let found = project.read(|p| {
        p.overlays.iter().find_map(|o| {
            o.layers
                .iter()
                .find(|l| l.id == layer_id)
                .map(|l| (o.id.clone(), l.kind.clone()))
        })
    });
    let Some((overlay_id, kind)) = found else {
        return user_err("That overlay layer no longer exists.");
    };
    let limit = match kind {
        LayerKind::Timer {
            mode: TimerMode::Countdown,
            duration_s,
            ..
        } => Some(i64::from(duration_s) * 1000),
        LayerKind::Timer {
            mode: TimerMode::Stopwatch,
            ..
        } => None,
        LayerKind::Timer { .. } => {
            return user_err("Only countdown and stopwatch timers can be started and paused.");
        }
        _ => return user_err("That layer isn't a timer."),
    };
    let add_ms = if seconds.is_finite() {
        (seconds * 1000.0).round() as i64
    } else {
        0
    };
    let run = apply(
        hub.timers.get(layer_id),
        action,
        add_ms,
        limit,
        crate::util::now_ms(),
    );
    hub.timers.set(layer_id, run);
    hub.to_overlays(
        Some(&overlay_id),
        OverlayMsg::Timer {
            layer_id: layer_id.to_string(),
            run,
        },
    );
    hub.emit_ui(
        ui::TIMERS,
        &TimerChange {
            layer_id: layer_id.to_string(),
            run,
        },
    );
    Ok(run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use TimerAction::*;

    const MIN: i64 = 60_000;

    fn run(running: bool, elapsed_ms: i64, at: i64) -> Option<TimerRun> {
        Some(TimerRun {
            running,
            elapsed_ms,
            at,
        })
    }

    #[test]
    fn start_pause_resume_and_reset() {
        let limit = Some(5 * MIN);
        let started = apply(None, Start, 0, limit, 1_000);
        assert_eq!(started, run(true, 0, 1_000).unwrap());
        let paused = apply(Some(started), Pause, 0, limit, 31_000);
        assert_eq!(paused, run(false, 30_000, 31_000).unwrap());
        // Time passing while paused changes nothing.
        assert_eq!(paused.elapsed(500_000), 30_000);
        let resumed = apply(Some(paused), Resume, 0, limit, 90_000);
        assert_eq!(resumed.elapsed(100_000), 40_000);
        let reset = apply(Some(resumed), Reset, 0, limit, 100_000);
        assert_eq!(reset, run(false, 0, 100_000).unwrap());
        // Start begins again even mid-run.
        assert_eq!(
            apply(Some(resumed), Start, 0, limit, 200_000).elapsed(200_000),
            0
        );
    }

    #[test]
    fn toggle_flips_running() {
        let a = apply(None, Toggle, 0, None, 0);
        assert!(a.running);
        let b = apply(Some(a), Toggle, 0, None, 5_000);
        assert_eq!(b, run(false, 5_000, 5_000).unwrap());
    }

    #[test]
    fn add_time_to_a_countdown_or_stopwatch() {
        let limit = Some(MIN);
        // A countdown 20s in gets 30s more: 70s left.
        let cd = apply(run(true, 0, 0), Add, 30_000, limit, 20_000);
        assert_eq!(cd.elapsed(20_000), -10_000);
        assert!(cd.running);
        // A stopwatch counts the added time, never below zero.
        let sw = apply(run(false, 5_000, 0), Add, 30_000, None, 9_000);
        assert_eq!(sw.elapsed(9_000), 35_000);
        assert_eq!(apply(Some(sw), Add, -60_000, None, 9_000).elapsed(9_000), 0);
    }

    #[test]
    fn a_finished_countdown_starts_counting_from_its_end() {
        // Ran out long ago; adding 10s gives 10s, not nothing.
        let done = run(true, 0, 0);
        let more = apply(done, Add, 10_000, Some(MIN), 10 * MIN);
        assert_eq!(more.elapsed(10 * MIN), MIN - 10_000);
        let paused = apply(done, Pause, 0, Some(MIN), 10 * MIN);
        assert_eq!(paused.elapsed_ms, MIN);
    }

    #[test]
    fn untouched_timers_are_at_the_start() {
        assert_eq!(
            apply(None, Pause, 0, Some(MIN), 7),
            run(false, 0, 7).unwrap()
        );
        assert_eq!(
            apply(None, Resume, 0, Some(MIN), 7),
            run(true, 0, 7).unwrap()
        );
    }

    #[test]
    fn store_keeps_runs_per_layer() {
        let t = Timers::default();
        t.set("a", run(true, 0, 0).unwrap());
        t.set("b", run(false, 1, 0).unwrap());
        assert_eq!(t.for_layers(["a", "c"]).len(), 1);
        assert_eq!(t.all().len(), 2);
        assert_eq!(t.get("b").unwrap().elapsed_ms, 1);
    }
}
