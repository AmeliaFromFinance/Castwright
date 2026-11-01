//! Realistic sample events for "Test" buttons and previews.

use crate::model::event::{Event, EventKind, EventUser, MessagePart};
use serde_json::json;

const NAMES: [&str; 8] = [
    "nova_kat",
    "pixelbyte",
    "raiding_rudy",
    "m0ss",
    "Tomasz",
    "quietfox",
    "LumenLark",
    "kettle_drum",
];

fn user(i: usize) -> EventUser {
    let name = NAMES[i % NAMES.len()];
    EventUser {
        id: format!("{}", 10_000 + i),
        login: name.to_lowercase(),
        display_name: name.to_string(),
    }
}

pub fn sample_event(kind: EventKind) -> Event {
    let seed = (crate::util::now_ms() as usize / 7) % NAMES.len();
    let mut e = Event::new(kind);
    e.test = true;
    e.user = Some(user(seed));
    match kind {
        EventKind::Sub => {
            e.tier = Some(1);
            e.months = Some(1);
        }
        EventKind::Resub => {
            e.tier = Some(1);
            e.months = Some(14);
            e.message = Some("Been here since the first stream!".into());
        }
        EventKind::GiftSub => {
            e.tier = Some(1);
            e.is_gift = true;
            e.recipient = Some(user(seed + 1));
        }
        EventKind::CommunityGift => {
            e.tier = Some(1);
            e.amount = Some(5.0);
            e.is_gift = true;
        }
        EventKind::Cheer => {
            e.amount = Some(500.0);
            e.message = Some("Cheer500 gg on that round".into());
        }
        EventKind::Raid => e.amount = Some(212.0),
        EventKind::Redemption => {
            e.amount = Some(500.0);
            e.data.insert("reward_title".into(), json!("Hydrate"));
            e.data.insert("reward_id".into(), json!("sample-reward"));
            e.message = Some("drink some water!".into());
        }
        EventKind::PowerUp => {
            e.amount = Some(100.0);
            e.data
                .insert("power_up_type".into(), json!("message_effect"));
            e.message = Some("look at this".into());
        }
        EventKind::HypeTrainBegin | EventKind::HypeTrainProgress | EventKind::HypeTrainEnd => {
            e.user = None;
            e.data.insert("level".into(), json!(2));
            e.data.insert("total".into(), json!(1450));
            e.data.insert("goal".into(), json!(1800));
            e.data.insert("progress".into(), json!(650));
        }
        EventKind::ShoutoutReceived => e.amount = Some(87.0),
        EventKind::AdBreak => {
            e.user = None;
            e.amount = Some(90.0);
            e.data.insert("is_automatic".into(), json!(false));
        }
        EventKind::Charity => {
            e.amount = Some(10.0);
            e.currency = Some("GBP".into());
            e.data
                .insert("charity_name".into(), json!("Example Charity"));
        }
        EventKind::PollBegin | EventKind::PollProgress | EventKind::PollEnd => {
            e.user = None;
            e.data.insert("title".into(), json!("Which map next?"));
            e.data.insert(
                "choices".into(),
                json!([{ "title": "Dust", "votes": 14 }, { "title": "Mirage", "votes": 9 }]),
            );
        }
        EventKind::PredictionBegin
        | EventKind::PredictionProgress
        | EventKind::PredictionLock
        | EventKind::PredictionEnd => {
            e.user = None;
            e.data.insert("title".into(), json!("Win this round?"));
            e.data.insert(
                "outcomes".into(),
                json!([{ "title": "Yes", "channel_points": 12000 }, { "title": "No", "channel_points": 4500 }]),
            );
        }
        EventKind::Chat => {
            let text = "that stinger transition is so clean";
            e.message = Some(text.into());
            e.message_parts = vec![MessagePart::Text { text: text.into() }];
            e.data.insert("color".into(), json!("#C9B3FF"));
        }
        EventKind::StreamOnline | EventKind::StreamOffline | EventKind::ChannelUpdate => {
            e.user = None;
        }
        EventKind::Follow | EventKind::Custom => {}
    }
    e
}

#[cfg(test)]
mod fixtures {
    /// Writes the starter project and sample events for the UI's demo mode,
    /// so the browser preview always matches what the app really creates.
    /// Ids and names are random, so it only runs with `npm run bindings`.
    #[test]
    #[ignore]
    fn export_ui_fixtures() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/api/fixtures");
        std::fs::create_dir_all(&dir).unwrap();
        let project = crate::model::project::Project::starter();
        std::fs::write(
            dir.join("starter-project.json"),
            serde_json::to_string_pretty(&project).unwrap(),
        )
        .unwrap();
        let samples: Vec<_> = crate::model::event::EventKind::ALL
            .iter()
            .map(|k| super::sample_event(*k))
            .collect();
        std::fs::write(
            dir.join("sample-events.json"),
            serde_json::to_string_pretty(&samples).unwrap(),
        )
        .unwrap();
    }
}
