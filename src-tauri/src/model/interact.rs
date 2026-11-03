//! Channel point rewards and redemptions, polls and predictions.

use super::event::EventUser;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A custom channel point reward. Numbers set to 0 mean "off".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct Reward {
    /// Empty for a reward that isn't made yet.
    pub id: String,
    pub title: String,
    pub cost: u32,
    pub prompt: String,
    pub input_required: bool,
    /// Hex colour, e.g. `#9147FF`. Empty lets Twitch pick.
    pub color: String,
    pub enabled: bool,
    pub paused: bool,
    pub skip_queue: bool,
    pub max_per_stream: u32,
    pub max_per_user: u32,
    pub cooldown_s: u32,
    /// Made by Castwright. Twitch only lets an app change rewards it made.
    pub manageable: bool,
    pub image_url: String,
}

impl Default for Reward {
    fn default() -> Self {
        Reward {
            id: String::new(),
            title: String::new(),
            cost: 100,
            prompt: String::new(),
            input_required: false,
            color: String::new(),
            enabled: true,
            paused: false,
            skip_queue: false,
            max_per_stream: 0,
            max_per_user: 0,
            cooldown_s: 0,
            manageable: true,
            image_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RedemptionStatus {
    #[default]
    Unfulfilled,
    Fulfilled,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Redemption {
    pub id: String,
    pub reward_id: String,
    pub reward_title: String,
    pub cost: u32,
    pub user: EventUser,
    pub input: String,
    pub status: RedemptionStatus,
    /// ms since the epoch.
    #[ts(type = "number")]
    pub redeemed_at: i64,
}

/// Which redemption to complete or refund.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RedemptionRef {
    pub id: String,
    pub reward_id: String,
}

/// Sent to the app when a redemption is completed or refunded anywhere.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RedemptionUpdate {
    pub id: String,
    pub reward_id: String,
    pub status: RedemptionStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PollDraft {
    pub title: String,
    pub choices: Vec<String>,
    pub duration_s: u32,
    /// Extra votes for channel points: cost per vote. 0 = off.
    #[serde(default)]
    pub points_per_vote: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PredictionDraft {
    pub title: String,
    pub outcomes: Vec<String>,
    /// How long viewers can predict.
    pub window_s: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PredictionAction {
    #[default]
    Lock,
    Resolve,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RewardState {
    #[default]
    Enable,
    Disable,
    Pause,
    Resume,
}

/// The latest poll and prediction, shaped like their events so the app and
/// overlays read them the same way.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct InteractState {
    pub poll: Option<super::event::Event>,
    pub prediction: Option<super::event::Event>,
}

pub const MAX_REWARD_TITLE: usize = 45;
pub const MAX_PROMPT: usize = 200;
pub const MAX_POLL_TITLE: usize = 60;
pub const MAX_PREDICTION_TITLE: usize = 45;
pub const MAX_CHOICE: usize = 25;
pub const MAX_COOLDOWN_S: u32 = 7 * 24 * 3600;

fn too_long(s: &str, max: usize) -> bool {
    s.chars().count() > max
}

fn is_hex_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
}

impl Reward {
    /// Problems Twitch would reject, as a message for the streamer.
    pub fn check(&self) -> Result<(), String> {
        let title = self.title.trim();
        if title.is_empty() {
            return Err("Give the reward a title.".into());
        }
        if too_long(title, MAX_REWARD_TITLE) {
            return Err(format!(
                "Reward titles can be up to {MAX_REWARD_TITLE} characters."
            ));
        }
        if self.cost == 0 {
            return Err("The cost has to be at least 1 point.".into());
        }
        if too_long(self.prompt.trim(), MAX_PROMPT) {
            return Err(format!(
                "The description can be up to {MAX_PROMPT} characters."
            ));
        }
        let color = self.color.trim();
        if !color.is_empty() && !is_hex_color(color) {
            return Err("Use a colour like #9147FF.".into());
        }
        if self.cooldown_s > MAX_COOLDOWN_S {
            return Err("Cooldowns can be up to 7 days.".into());
        }
        Ok(())
    }
}

fn check_options(list: &[String], min: usize, max: usize, what: &str) -> Result<(), String> {
    let items: Vec<&str> = list.iter().map(|s| s.trim()).collect();
    if items.len() < min || items.len() > max {
        return Err(format!("Use {min} to {max} {what}."));
    }
    if items.iter().any(|s| s.is_empty()) {
        return Err(format!("Fill in every {}.", &what[..what.len() - 1]));
    }
    if items.iter().any(|s| too_long(s, MAX_CHOICE)) {
        return Err(format!(
            "Each {} can be up to {MAX_CHOICE} characters.",
            &what[..what.len() - 1]
        ));
    }
    Ok(())
}

impl PollDraft {
    pub fn check(&self) -> Result<(), String> {
        let title = self.title.trim();
        if title.is_empty() {
            return Err("Give the poll a question.".into());
        }
        if too_long(title, MAX_POLL_TITLE) {
            return Err(format!(
                "Poll questions can be up to {MAX_POLL_TITLE} characters."
            ));
        }
        check_options(&self.choices, 2, 5, "choices")?;
        if !(15..=1800).contains(&self.duration_s) {
            return Err("Polls run from 15 seconds to 30 minutes.".into());
        }
        if self.points_per_vote > 1_000_000 {
            return Err("Extra votes can cost up to 1,000,000 points.".into());
        }
        Ok(())
    }
}

impl PredictionDraft {
    pub fn check(&self) -> Result<(), String> {
        let title = self.title.trim();
        if title.is_empty() {
            return Err("Give the prediction a question.".into());
        }
        if too_long(title, MAX_PREDICTION_TITLE) {
            return Err(format!(
                "Prediction questions can be up to {MAX_PREDICTION_TITLE} characters."
            ));
        }
        check_options(&self.outcomes, 2, 10, "outcomes")?;
        if !(30..=1800).contains(&self.window_s) {
            return Err("Predictions stay open from 30 seconds to 30 minutes.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn poll(choices: &[&str], duration_s: u32) -> PollDraft {
        PollDraft {
            title: "Next map?".into(),
            choices: choices.iter().map(|s| s.to_string()).collect(),
            duration_s,
            points_per_vote: 0,
        }
    }

    #[test]
    fn reward_rules() {
        let ok = Reward {
            title: "Hydrate".into(),
            color: "#9147ff".into(),
            ..Reward::default()
        };
        assert!(ok.check().is_ok());
        let bad = |f: fn(&mut Reward)| {
            let mut r = ok.clone();
            f(&mut r);
            r.check().unwrap_err()
        };
        assert!(bad(|r| r.title = "  ".into()).contains("title"));
        assert!(bad(|r| r.title = "x".repeat(46)).contains("45"));
        assert!(bad(|r| r.cost = 0).contains("at least 1"));
        assert!(bad(|r| r.color = "purple".into()).contains("#9147FF"));
        assert!(bad(|r| r.cooldown_s = MAX_COOLDOWN_S + 1).contains("7 days"));
    }

    #[test]
    fn poll_and_prediction_rules() {
        assert!(poll(&["A", "B"], 60).check().is_ok());
        assert!(poll(&["A"], 60).check().unwrap_err().contains("2 to 5"));
        assert!(poll(&["A", "B", "C", "D", "E", "F"], 60).check().is_err());
        assert!(
            poll(&["A", " "], 60)
                .check()
                .unwrap_err()
                .contains("every choice")
        );
        assert!(
            poll(&["A", "B"], 10)
                .check()
                .unwrap_err()
                .contains("15 seconds")
        );
        assert!(
            poll(&["A", &"b".repeat(26)], 60)
                .check()
                .unwrap_err()
                .contains("25")
        );
        let p = PredictionDraft {
            title: "Win?".into(),
            outcomes: vec!["Yes".into(), "No".into()],
            window_s: 120,
        };
        assert!(p.check().is_ok());
        let mut q = p.clone();
        q.window_s = 20;
        assert!(q.check().is_err());
        q = p.clone();
        q.outcomes = (0..11).map(|i| i.to_string()).collect();
        assert!(q.check().unwrap_err().contains("2 to 10 outcomes"));
    }
}
