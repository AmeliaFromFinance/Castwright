//! Stream markers and clips from hotkeys and the command palette. The window
//! hears about each one through `cw://moment` and shows a toast for it.

use crate::core::Core;
use crate::error::AppResult;
use crate::hub::ui;
use crate::model::session::{ClipEntry, MarkerEntry};
use serde::Serialize;
use std::sync::Arc;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MomentKind {
    Marker,
    Clip,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum MomentEvent {
    /// A marker was added. Its note can still be changed.
    Marker { marker: MarkerEntry },
    /// Twitch is making a clip.
    ClipStarted { id: String },
    /// The clip is ready to share.
    ClipReady { clip: ClipEntry },
    /// Twitch took too long. The link usually works a little later.
    ClipSlow { id: String, url: String },
    /// Only sent for hotkeys; the palette shows the error itself.
    Failed { what: MomentKind, message: String },
}

/// 5025 -> "1:23:45", 309 -> "0:05:09".
pub fn clock(seconds: u64) -> String {
    format!(
        "{}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
}

/// What Twitch shows for a marker, like "Marker 3 · 1:23:45".
pub fn marker_description(number: u32, live_ms: i64) -> String {
    format!(
        "Marker {number} · {}",
        clock((live_ms.max(0) / 1000) as u64)
    )
}

/// How long the stream has been live, in ms.
fn live_for(core: &Core, now: i64) -> i64 {
    let twitch = core.twitch.status().stream.started_at;
    let started = if twitch > 0 {
        twitch
    } else {
        core.hub
            .sessions
            .current()
            .map(|s| s.started_at)
            .unwrap_or(now)
    };
    now - started
}

pub async fn add_marker(core: &Core) -> AppResult<MarkerEntry> {
    let now = crate::util::now_ms();
    let number = core.hub.sessions.marker_count() + 1;
    let description = marker_description(number, live_for(core, now));
    let m = core.twitch.add_marker(&description).await?;
    let marker = MarkerEntry {
        ts: now,
        description: m.description,
        id: m.id,
        position_s: m.position_s,
        note: String::new(),
    };
    core.hub.emit_ui(
        ui::MOMENT,
        &MomentEvent::Marker {
            marker: marker.clone(),
        },
    );
    Ok(marker)
}

pub fn set_note(core: &Core, id: &str, note: &str) -> AppResult<()> {
    let note: String = note.trim().chars().take(200).collect();
    if !core.hub.sessions.set_marker_note(id, &note)? {
        return crate::error::user_err("That marker wasn't found.");
    }
    Ok(())
}

/// Starts a clip and returns its id. The link follows as a `ClipReady` event.
pub async fn create_clip(core: &Arc<Core>) -> AppResult<String> {
    let clip = core.twitch.start_clip().await?;
    core.hub.emit_ui(
        ui::MOMENT,
        &MomentEvent::ClipStarted {
            id: clip.id.clone(),
        },
    );
    let (core, id) = (core.clone(), clip.id.clone());
    crate::util::spawn(async move {
        let event = match core.twitch.wait_for_clip(&id).await {
            Some(clip) => MomentEvent::ClipReady { clip },
            None => MomentEvent::ClipSlow {
                url: crate::twitch::moments::clip_url(&id),
                id,
            },
        };
        core.hub.emit_ui(ui::MOMENT, &event);
    });
    Ok(clip.id)
}

/// Run from a global hotkey: nothing waits for the result, so errors become events.
pub fn from_hotkey(core: &Arc<Core>, what: MomentKind) {
    let core = core.clone();
    crate::util::spawn(async move {
        let result = match what {
            MomentKind::Marker => add_marker(&core).await.map(|_| ()),
            MomentKind::Clip => create_clip(&core).await.map(|_| ()),
        };
        if let Err(e) = result {
            core.hub.emit_ui(
                ui::MOMENT,
                &MomentEvent::Failed {
                    what,
                    message: e.to_string(),
                },
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_text() {
        assert_eq!(clock(0), "0:00:00");
        assert_eq!(clock(309), "0:05:09");
        assert_eq!(clock(5025), "1:23:45");
        assert_eq!(clock(36_000), "10:00:00");
        assert_eq!(marker_description(3, 5_025_400), "Marker 3 · 1:23:45");
        assert_eq!(marker_description(1, -50), "Marker 1 · 0:00:00");
    }

    #[test]
    fn events_have_a_type() {
        let v = serde_json::to_value(MomentEvent::Failed {
            what: MomentKind::Marker,
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"type": "failed", "what": "marker", "message": "x"})
        );
    }
}
