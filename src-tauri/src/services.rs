//! What automation needs from Twitch and OBS. The real services implement these;
//! tests use the recorders below.

use crate::error::AppResult;
use crate::model::automation::Toggle;
use crate::model::interact::{PollDraft, PredictionAction, PredictionDraft, RewardState};
use crate::model::moderation::ChatMode;
use async_trait::async_trait;
use std::sync::Mutex;

#[async_trait]
pub trait TwitchActions: Send + Sync {
    /// Send a chat message. `reply_to` is a chat message id.
    async fn send_chat(&self, message: &str, as_bot: bool, reply_to: Option<&str>)
    -> AppResult<()>;
    /// `color`: primary, blue, green, orange or purple.
    async fn announce(&self, message: &str, color: &str) -> AppResult<()>;
    async fn shoutout(&self, login: &str) -> AppResult<()>;
    /// Returns the clip's edit URL.
    async fn create_clip(&self) -> AppResult<String>;
    async fn create_marker(&self, description: &str) -> AppResult<()>;
    async fn run_ad(&self, length_s: u32) -> AppResult<()>;
    /// Empty strings leave that field unchanged. `category` is a name, matched by search.
    async fn set_stream_info(&self, title: &str, category: &str) -> AppResult<()>;
    async fn timeout_user(&self, login: &str, duration_s: u32, reason: &str) -> AppResult<()>;
    async fn delete_message(&self, message_id: &str) -> AppResult<()>;
    /// `value` is slow mode seconds or follower minutes.
    async fn set_chat_mode(&self, mode: ChatMode, state: Toggle, value: u32) -> AppResult<()>;
    /// Complete (or with `refund`, cancel) one channel point redemption.
    async fn finish_redemption(
        &self,
        reward_id: &str,
        redemption_id: &str,
        refund: bool,
    ) -> AppResult<()>;
    /// The reward is found by id, or by title when the id is unknown.
    async fn set_reward_state(&self, id: &str, title: &str, state: RewardState) -> AppResult<()>;
    async fn set_reward_cost(&self, id: &str, title: &str, cost: u32) -> AppResult<()>;
    async fn start_poll(&self, draft: &PollDraft) -> AppResult<()>;
    async fn end_poll(&self) -> AppResult<()>;
    async fn start_prediction(&self, draft: &PredictionDraft) -> AppResult<()>;
    /// `winner`: outcome id, title or number from 1. Only used to resolve.
    async fn end_prediction(&self, action: PredictionAction, winner: &str) -> AppResult<()>;
    async fn snooze_next_ad(&self) -> AppResult<()>;
}

#[async_trait]
pub trait DiscordActions: Send + Sync {
    /// Post plain text with a saved webhook. Mentions in it never ping.
    async fn post_text(&self, webhook_id: &str, text: &str) -> AppResult<()>;
}

#[async_trait]
pub trait ObsActions: Send + Sync {
    async fn switch_scene(&self, scene: &str) -> AppResult<()>;
    /// `scene` empty = current program scene.
    async fn set_source_visible(&self, scene: &str, source: &str, state: Toggle) -> AppResult<()>;
    async fn set_input_mute(&self, input: &str, state: Toggle) -> AppResult<()>;
    async fn set_recording(&self, state: Toggle) -> AppResult<()>;
    async fn save_replay(&self) -> AppResult<()>;
}

/// Records calls instead of doing them.
#[derive(Default)]
pub struct Recorder {
    pub calls: Mutex<Vec<String>>,
    pub fail: Mutex<bool>,
}

impl Recorder {
    fn push(&self, s: String) -> AppResult<()> {
        if *self.fail.lock().unwrap() {
            return crate::error::user_err(format!("failed: {s}"));
        }
        self.calls.lock().unwrap().push(s);
        Ok(())
    }
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}

#[async_trait]
impl TwitchActions for Recorder {
    async fn send_chat(
        &self,
        message: &str,
        as_bot: bool,
        reply_to: Option<&str>,
    ) -> AppResult<()> {
        self.push(format!(
            "chat bot={as_bot} reply={} {message}",
            reply_to.is_some()
        ))
    }
    async fn announce(&self, message: &str, color: &str) -> AppResult<()> {
        self.push(format!("announce {color} {message}"))
    }
    async fn shoutout(&self, login: &str) -> AppResult<()> {
        self.push(format!("shoutout {login}"))
    }
    async fn create_clip(&self) -> AppResult<String> {
        self.push("clip".into())?;
        Ok("https://clips.twitch.tv/test".into())
    }
    async fn create_marker(&self, description: &str) -> AppResult<()> {
        self.push(format!("marker {description}"))
    }
    async fn run_ad(&self, length_s: u32) -> AppResult<()> {
        self.push(format!("ad {length_s}"))
    }
    async fn set_stream_info(&self, title: &str, category: &str) -> AppResult<()> {
        self.push(format!("info {title}|{category}"))
    }
    async fn timeout_user(&self, login: &str, duration_s: u32, reason: &str) -> AppResult<()> {
        self.push(format!("timeout {login} {duration_s} {reason}"))
    }
    async fn delete_message(&self, message_id: &str) -> AppResult<()> {
        self.push(format!("delete {message_id}"))
    }
    async fn set_chat_mode(&self, mode: ChatMode, state: Toggle, value: u32) -> AppResult<()> {
        self.push(format!("mode {mode:?} {state:?} {value}"))
    }
    async fn finish_redemption(
        &self,
        reward_id: &str,
        redemption_id: &str,
        refund: bool,
    ) -> AppResult<()> {
        self.push(format!(
            "redemption {reward_id}/{redemption_id} refund={refund}"
        ))
    }
    async fn set_reward_state(&self, id: &str, title: &str, state: RewardState) -> AppResult<()> {
        self.push(format!("reward {id}|{title} {state:?}"))
    }
    async fn set_reward_cost(&self, id: &str, title: &str, cost: u32) -> AppResult<()> {
        self.push(format!("reward {id}|{title} cost={cost}"))
    }
    async fn start_poll(&self, draft: &PollDraft) -> AppResult<()> {
        self.push(format!(
            "poll {} [{}] {}s points={}",
            draft.title,
            draft.choices.join(","),
            draft.duration_s,
            draft.points_per_vote
        ))
    }
    async fn end_poll(&self) -> AppResult<()> {
        self.push("end poll".into())
    }
    async fn start_prediction(&self, draft: &PredictionDraft) -> AppResult<()> {
        self.push(format!(
            "prediction {} [{}] {}s",
            draft.title,
            draft.outcomes.join(","),
            draft.window_s
        ))
    }
    async fn end_prediction(&self, action: PredictionAction, winner: &str) -> AppResult<()> {
        self.push(format!("prediction {action:?} {winner}"))
    }
    async fn snooze_next_ad(&self) -> AppResult<()> {
        self.push("snooze ad".into())
    }
}

#[async_trait]
impl DiscordActions for Recorder {
    async fn post_text(&self, webhook_id: &str, text: &str) -> AppResult<()> {
        self.push(format!("discord {webhook_id} {text}"))
    }
}

#[async_trait]
impl ObsActions for Recorder {
    async fn switch_scene(&self, scene: &str) -> AppResult<()> {
        self.push(format!("scene {scene}"))
    }
    async fn set_source_visible(&self, scene: &str, source: &str, state: Toggle) -> AppResult<()> {
        self.push(format!("source {scene}/{source} {state:?}"))
    }
    async fn set_input_mute(&self, input: &str, state: Toggle) -> AppResult<()> {
        self.push(format!("mute {input} {state:?}"))
    }
    async fn set_recording(&self, state: Toggle) -> AppResult<()> {
        self.push(format!("record {state:?}"))
    }
    async fn save_replay(&self) -> AppResult<()> {
        self.push("replay".into())
    }
}
