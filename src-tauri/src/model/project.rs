use super::alert::AlertConfig;
use super::automation::Action;
use super::chat::ChatRules;
use super::overlay::Overlay;
use super::soundboard::Soundboard;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 2: actions are graphs. Older projects are converted when they load.
pub const PROJECT_FORMAT: u32 = 2;

/// Everything the user builds, saved as `project.json` in the project folder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Project {
    pub format: u32,
    pub name: String,
    pub overlays: Vec<Overlay>,
    pub alerts: AlertConfig,
    pub actions: Vec<Action>,
    /// What the chat panel and chat layers hide and highlight.
    pub chat_rules: ChatRules,
    pub soundboard: Soundboard,
}

impl Default for Project {
    fn default() -> Self {
        Project {
            format: PROJECT_FORMAT,
            name: "My stream".into(),
            overlays: Vec::new(),
            alerts: AlertConfig::default(),
            actions: Vec::new(),
            chat_rules: ChatRules::default(),
            soundboard: Soundboard::default(),
        }
    }
}

impl Project {
    pub fn starter() -> Self {
        Project {
            overlays: vec![Overlay::starter()],
            alerts: AlertConfig::starter(),
            actions: Action::starters(),
            ..Project::default()
        }
    }

    /// Bring a loaded project up to the current format.
    pub fn normalize(&mut self) {
        for a in &mut self.actions {
            a.normalize();
        }
        self.format = PROJECT_FORMAT;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_round_trips() {
        let p = Project::starter();
        let back: Project =
            serde_json::from_str(&serde_json::to_string_pretty(&p).unwrap()).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn empty_object_loads() {
        let p: Project = serde_json::from_str("{}").unwrap();
        assert_eq!(p.format, PROJECT_FORMAT);
        assert!(p.overlays.is_empty());
    }

    #[test]
    fn starter_ids_are_unique() {
        let p = Project::starter();
        let mut ids = std::collections::HashSet::new();
        for o in &p.overlays {
            assert!(ids.insert(o.id.clone()));
            for l in &o.layers {
                assert!(ids.insert(l.id.clone()));
            }
        }
        for a in &p.actions {
            assert!(ids.insert(a.id.clone()));
        }
        for t in &p.alerts.types {
            for v in &t.variations {
                assert!(ids.insert(v.id.clone()));
            }
        }
    }
}
