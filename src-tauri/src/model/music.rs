use super::runtime::ConnState;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where the current song comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MusicSource {
    #[default]
    Off,
    Spotify,
    /// The media session of the operating system (Windows and Linux).
    System,
    TextFile,
}

pub const DEFAULT_TEXT_FORMAT: &str = "{artist} - {title}";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export)]
pub struct MusicSettings {
    pub source: MusicSource,
    /// Client ID of the user's own Spotify app.
    pub spotify_client_id: String,
    /// Text file another program writes the current song to.
    pub text_file: String,
    /// How the file's text splits into fields, with `{title}`, `{artist}` and `{album}`.
    pub text_format: String,
}

impl Default for MusicSettings {
    fn default() -> Self {
        MusicSettings {
            source: MusicSource::Off,
            spotify_client_id: String::new(),
            text_file: String::new(),
            text_format: DEFAULT_TEXT_FORMAT.into(),
        }
    }
}

impl MusicSettings {
    pub fn cleaned(mut self) -> Self {
        self.spotify_client_id = self.spotify_client_id.trim().to_string();
        self.text_file = self.text_file.trim().to_string();
        if self.text_format.trim().is_empty() {
            self.text_format = DEFAULT_TEXT_FORMAT.into();
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct NowPlaying {
    /// Tells songs apart. Spotify's track id, or title and artist.
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// A web address, or `/music/art/<n>` on the overlay server.
    pub art_url: String,
    pub playing: bool,
    #[ts(type = "number")]
    pub progress_ms: u64,
    /// 0 when unknown.
    #[ts(type = "number")]
    pub duration_ms: u64,
}

impl NowPlaying {
    pub fn key(&self) -> String {
        if self.id.is_empty() {
            format!("{}\u{1f}{}", self.title, self.artist)
        } else {
            self.id.clone()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub struct MusicStatus {
    pub source: MusicSource,
    pub state: ConnState,
    pub error: Option<String>,
    /// Spotify account name when signed in.
    pub spotify_user: Option<String>,
    /// Waiting for the browser to come back from Spotify.
    pub login_pending: bool,
    /// Add this to the Spotify app.
    pub redirect_uri: String,
    /// False on systems without a media session Castwright can read (macOS).
    pub system_supported: bool,
    /// The app playing, for the system source.
    pub player: String,
    pub track: Option<NowPlaying>,
}
