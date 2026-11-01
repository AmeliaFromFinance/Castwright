//! What automation needs from Twitch and OBS. The real services implement these;
//! tests use the recorders below.

use crate::error::AppResult;
use crate::model::automation::Toggle;
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
