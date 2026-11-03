//! Soundboard buttons, kept in the project, and the live state sent to the app.

use super::automation::Permission;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

/// Where a sound is heard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SoundOutput {
    /// Through overlay pages, so OBS captures it.
    #[default]
    Stream,
    /// In the app only.
    Local,
    Both,
}

impl SoundOutput {
    pub fn on_stream(self) -> bool {
        matches!(self, SoundOutput::Stream | SoundOutput::Both)
    }

    pub fn local(self) -> bool {
        matches!(self, SoundOutput::Local | SoundOutput::Both)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct SoundButton {
    pub id: String,
    pub label: String,
    /// Asset path, like `assets/airhorn.mp3`.
    pub src: String,
    pub emoji: String,
    /// Hex colour. Empty uses the theme.
    pub color: String,
    /// 0 to 100.
    pub volume: u8,
    /// Seconds before it can play again. 0 = no cooldown.
    pub cooldown_s: u32,
    pub output: SoundOutput,
    /// Page it's on. Empty = the first page.
    pub group: String,
    /// A channel point reward Castwright made. Redeeming it plays the sound.
    pub reward_id: String,
    pub reward_title: String,
    /// Other names for `!sound` and sound requests.
    pub aliases: Vec<String>,
}

impl Default for SoundButton {
    fn default() -> Self {
        SoundButton {
            id: crate::util::new_id(),
            label: "Sound".into(),
            src: String::new(),
            emoji: String::new(),
            color: String::new(),
            volume: 80,
            cooldown_s: 0,
            output: SoundOutput::Stream,
            group: String::new(),
            reward_id: String::new(),
            reward_title: String::new(),
            aliases: Vec::new(),
        }
    }
}

/// The `!sound name` chat command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct SoundCommand {
    pub enabled: bool,
    /// Without the `!`.
    pub name: String,
    pub permission: Permission,
    /// Seconds per viewer. Moderators and the streamer skip it.
    pub cooldown_s: u32,
}

impl Default for SoundCommand {
    fn default() -> Self {
        SoundCommand {
            enabled: false,
            name: "sound".into(),
            permission: Permission::Subscriber,
            cooldown_s: 30,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct Soundboard {
    /// In grid order.
    pub buttons: Vec<SoundButton>,
    /// Page names, in order.
    pub groups: Vec<String>,
    /// Separate from the alert mute.
    pub muted: bool,
    /// Seconds between any two sounds. 0 = off.
    pub global_cooldown_s: u32,
    /// A reward where viewers type the name of a sound.
    pub request_reward_id: String,
    pub request_reward_title: String,
    pub command: SoundCommand,
}

pub const MAX_COOLDOWN_S: u32 = 24 * 60 * 60;

impl Soundboard {
    /// Trimmed, in range, with unique ids and every page listed once.
    pub fn cleaned(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.buttons
            .retain(|b| !b.id.trim().is_empty() && seen.insert(b.id.clone()));
        let mut groups: Vec<String> = Vec::new();
        for g in self.groups.iter().map(|g| g.trim()) {
            if !g.is_empty() && !groups.iter().any(|x| x == g) {
                groups.push(g.to_string());
            }
        }
        for b in &mut self.buttons {
            b.label = b.label.trim().to_string();
            b.src = b.src.trim().to_string();
            b.emoji = b.emoji.trim().chars().take(8).collect();
            b.color = b.color.trim().to_string();
            b.volume = b.volume.min(100);
            b.cooldown_s = b.cooldown_s.min(MAX_COOLDOWN_S);
            b.group = b.group.trim().to_string();
            b.reward_id = b.reward_id.trim().to_string();
            b.aliases = b
                .aliases
                .iter()
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect();
            if !b.group.is_empty() && !groups.contains(&b.group) {
                groups.push(b.group.clone());
            }
        }
        self.groups = groups;
        self.global_cooldown_s = self.global_cooldown_s.min(MAX_COOLDOWN_S);
        self.request_reward_id = self.request_reward_id.trim().to_string();
        self.command.name = self
            .command
            .name
            .trim()
            .trim_start_matches('!')
            .to_lowercase();
        if self.command.name.is_empty() {
            self.command.name = "sound".into();
        }
        self.command.cooldown_s = self.command.cooldown_s.min(MAX_COOLDOWN_S);
        self
    }
}

/// Sent to the app window when sounds start or stop.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum SoundCue {
    Play {
        #[ts(type = "number")]
        play_id: u64,
        sound_id: String,
        label: String,
        src: String,
        volume: u8,
        /// Play it in the app.
        local: bool,
        /// Sent to overlay pages.
        stream: bool,
        #[ts(type = "number")]
        started_at: i64,
    },
    /// `None` stops every sound.
    Stop { sound_id: Option<String> },
}

/// What happened to a play request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "result", rename_all = "snake_case")]
#[ts(export)]
pub enum PlayOutcome {
    Played {
        #[ts(type = "number")]
        play_id: u64,
    },
    Muted,
    Cooldown {
        seconds_left: u32,
    },
    NotFound,
    NoFile,
}

impl PlayOutcome {
    pub fn played(&self) -> bool {
        matches!(self, PlayOutcome::Played { .. })
    }

    /// Why it didn't play, for logs, run errors and the local API.
    pub fn reason(&self) -> Option<String> {
        match self {
            PlayOutcome::Played { .. } => None,
            PlayOutcome::Muted => Some("The soundboard is muted.".into()),
            PlayOutcome::Cooldown { seconds_left } => {
                Some(format!("On cooldown for {seconds_left} more seconds."))
            }
            PlayOutcome::NotFound => Some("That sound no longer exists.".into()),
            PlayOutcome::NoFile => Some("That sound has no file.".into()),
        }
    }
}

/// Live state for the app window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct SoundboardStatus {
    pub muted: bool,
    /// When each sound can play again (ms since the epoch). Only sounds still cooling down.
    #[ts(type = "Record<string, number>")]
    pub cooldowns: HashMap<String, i64>,
    /// When any sound can play again, for the global cooldown. 0 = now.
    #[ts(type = "number")]
    pub global_until: i64,
    /// Open overlay pages that play stream sounds (ones with an Alerts layer).
    pub stream_pages: u32,
}
