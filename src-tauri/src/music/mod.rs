//! The song playing now, from Spotify, the system media session or a text file.
//! Sets the `music.*` variables and tells automation when the song changes.

pub mod spotify;
pub mod textfile;

#[cfg(windows)]
mod gsmtc;
#[cfg(target_os = "linux")]
mod mpris;

use crate::error::{AppResult, user_err};
use crate::hub::{Hub, Signal, ui};
use crate::model::music::{MusicSettings, MusicSource, MusicStatus, NowPlaying};
use crate::model::runtime::{ConnState, LogLevel};
use crate::store::secrets::{Secrets, keys};
use crate::store::settings::SettingsStore;
use serde_json::{Map, Value};
use spotify::{ApiError, StoredToken, TokenError};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::Notify;

/// Spotify while someone watches: every 4 seconds.
const SPOTIFY_ACTIVE: Duration = Duration::from_secs(4);
/// Spotify while nothing shows the song.
const IDLE: Duration = Duration::from_secs(30);
const SYSTEM_ACTIVE: Duration = Duration::from_secs(2);
const SYSTEM_IDLE: Duration = Duration::from_secs(10);
const FILE_CHECK: Duration = Duration::from_secs(1);
/// Nothing to do until settings change.
const PARKED: Duration = Duration::from_secs(60);
/// How long a sign-in link works.
const LOGIN_TTL_MS: i64 = 10 * 60 * 1000;
/// The app shows the song for this long after asking.
const WATCH_MS: i64 = 90_000;
/// Largest cover read from disk.
const MAX_ART_FILE: u64 = 5 * 1024 * 1024;

/// What the system media session gave.
pub struct SystemTrack {
    pub track: NowPlaying,
    pub player: String,
    /// Only set when the cover changed.
    pub art: Option<ArtSource>,
}

pub enum ArtSource {
    Bytes { mime: String, bytes: Vec<u8> },
}

/// A cover image served by the overlay server at `/music/art/<version>`.
#[derive(Clone)]
pub struct Art {
    pub version: u64,
    pub mime: String,
    pub bytes: Arc<Vec<u8>>,
}

#[derive(Default)]
struct SystemReader {
    #[cfg(target_os = "linux")]
    mpris: mpris::Reader,
    #[cfg(windows)]
    gsmtc: gsmtc::Reader,
}

pub const SYSTEM_SUPPORTED: bool = cfg!(any(windows, target_os = "linux"));

impl SystemReader {
    #[cfg(target_os = "linux")]
    async fn read(&mut self) -> Result<Option<SystemTrack>, String> {
        self.mpris.read().await
    }

    #[cfg(windows)]
    async fn read(&mut self) -> Result<Option<SystemTrack>, String> {
        self.gsmtc.read().await
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    async fn read(&mut self) -> Result<Option<SystemTrack>, String> {
        Err("macOS has no public way to read the playing song. Use Spotify or a text file.".into())
    }
}

struct Pending {
    state: String,
    verifier: String,
    redirect_uri: String,
    client_id: String,
    at: i64,
}

#[derive(Default)]
struct Inner {
    status: MusicStatus,
    pending: Option<Pending>,
    /// The song last seen, to notice changes. None until the first one.
    last_key: Option<String>,
    art: Option<Art>,
    art_seq: u64,
    /// File path the art came from (MPRIS gives file:// links).
    art_source: String,
    watch_until: i64,
    file_stamp: Option<(String, textfile::Stamp)>,
    /// 401s in a row, to stop retrying a token Spotify won't take.
    unauthorized: u32,
    /// Errors in a row, for backing off.
    errors: u32,
}

/// What the music service needs from the rest of the app.
pub struct Hooks {
    /// Overlay server port, for the Spotify redirect address.
    pub port: Box<dyn Fn() -> Option<u16> + Send + Sync>,
    /// Whether something shows the song right now (an open overlay with a
    /// Now playing layer, or an action waiting for song changes).
    pub wanted: Box<dyn Fn() -> bool + Send + Sync>,
}

pub struct MusicService {
    hub: Arc<Hub>,
    settings: Arc<SettingsStore>,
    secrets: Arc<Secrets>,
    http: reqwest::Client,
    accounts: String,
    api: String,
    hooks: OnceLock<Hooks>,
    inner: Mutex<Inner>,
    system: tokio::sync::Mutex<SystemReader>,
    wake: Notify,
}

pub fn redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}/spotify/callback")
}

impl MusicService {
    pub fn new(hub: Arc<Hub>, settings: Arc<SettingsStore>, secrets: Arc<Secrets>) -> Arc<Self> {
        Self::with_urls(hub, settings, secrets, spotify::ACCOUNTS, spotify::API)
    }

    pub fn with_urls(
        hub: Arc<Hub>,
        settings: Arc<SettingsStore>,
        secrets: Arc<Secrets>,
        accounts: &str,
        api: &str,
    ) -> Arc<Self> {
        let me = Arc::new(MusicService {
            hub,
            settings,
            secrets,
            http: reqwest::Client::builder()
                .user_agent(concat!("Castwright/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
            accounts: accounts.trim_end_matches('/').to_string(),
            api: api.trim_end_matches('/').to_string(),
            hooks: OnceLock::new(),
            inner: Mutex::new(Inner::default()),
            system: tokio::sync::Mutex::new(SystemReader::default()),
            wake: Notify::new(),
        });
        {
            let mut g = me.inner.lock().unwrap();
            g.status.source = me.settings.get().music.source;
            g.status.system_supported = SYSTEM_SUPPORTED;
            g.status.spotify_user = me.token().map(|t| t.display_name);
        }
        me
    }

    pub fn set_hooks(&self, hooks: Hooks) {
        let _ = self.hooks.set(hooks);
    }

    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        crate::util::spawn(async move {
            loop {
                let wait = me.poll_once().await;
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = me.wake.notified() => {}
                }
            }
        });
    }

    pub fn status(&self) -> MusicStatus {
        let mut s = self.inner.lock().unwrap().status.clone();
        s.redirect_uri = self.redirect().unwrap_or_default();
        s
    }

    fn redirect(&self) -> Option<String> {
        let port = (self.hooks.get()?.port)()?;
        Some(redirect_uri(port))
    }

    fn emit(&self) {
        self.hub.emit_ui(ui::MUSIC, &self.status());
    }

    fn update(&self, f: impl FnOnce(&mut MusicStatus)) {
        let before = self.inner.lock().unwrap().status.clone();
        let after = {
            let mut g = self.inner.lock().unwrap();
            f(&mut g.status);
            g.status.clone()
        };
        if before != after {
            self.emit();
        }
    }

    fn set_error(&self, state: ConnState, msg: Option<String>) {
        self.update(|s| {
            s.state = state;
            s.error = msg;
        });
    }

    /// The app shows the song (Music settings, or a Now playing layer in the editor).
    pub fn watch(&self, on: bool) {
        self.inner.lock().unwrap().watch_until = if on {
            crate::util::now_ms() + WATCH_MS
        } else {
            0
        };
        if on {
            self.wake.notify_one();
        }
    }

    fn active(&self) -> bool {
        let watched = self.inner.lock().unwrap().watch_until > crate::util::now_ms();
        watched || self.hooks.get().is_some_and(|h| (h.wanted)())
    }

    pub fn save_settings(&self, music: MusicSettings) -> AppResult<MusicSettings> {
        let music = music.cleaned();
        let before = self.settings.get().music;
        self.settings.update(|s| s.music = music.clone())?;
        if before.source != music.source || before.text_file != music.text_file {
            self.reset_track();
        }
        if before.text_format != music.text_format {
            self.inner.lock().unwrap().file_stamp = None;
        }
        if before.spotify_client_id != music.spotify_client_id
            && !before.spotify_client_id.is_empty()
        {
            // Tokens belong to the old app.
            self.forget_spotify();
        }
        self.update(|s| {
            s.source = music.source;
            s.error = None;
            s.state = ConnState::Disconnected;
        });
        self.wake.notify_one();
        Ok(music)
    }

    /// Forget the song, for a new source.
    fn reset_track(&self) {
        {
            let mut g = self.inner.lock().unwrap();
            g.last_key = None;
            g.file_stamp = None;
            g.art = None;
            g.art_source.clear();
            g.errors = 0;
            g.status.track = None;
            g.status.player.clear();
        }
        self.publish(None, true);
    }

    pub fn art(&self, version: u64) -> Option<Art> {
        self.inner
            .lock()
            .unwrap()
            .art
            .clone()
            .filter(|a| a.version == version)
    }

    // ---------- Spotify sign-in ----------

    fn token(&self) -> Option<StoredToken> {
        self.secrets
            .get(keys::SPOTIFY)
            .and_then(|s| serde_json::from_str(&s).ok())
    }

    fn save_token(&self, t: &StoredToken) {
        if let Err(e) = self
            .secrets
            .set(keys::SPOTIFY, &serde_json::to_string(t).unwrap_or_default())
        {
            self.hub.log(
                LogLevel::Error,
                "music",
                format!("Couldn't save the Spotify sign-in: {e}"),
            );
        }
    }

    fn forget_spotify(&self) {
        let _ = self.secrets.delete(keys::SPOTIFY);
        self.update(|s| s.spotify_user = None);
    }

    /// Starts signing in. Returns the Spotify page to open in the browser.
    pub fn start_login(&self) -> AppResult<String> {
        let client_id = self.settings.get().music.spotify_client_id;
        if client_id.is_empty() {
            return user_err("Paste the client ID of your Spotify app first.");
        }
        let Some(redirect) = self.redirect() else {
            return user_err(
                "The overlay server isn't running, and Spotify sign-in needs it. Check Settings → Overlay server.",
            );
        };
        let verifier = spotify::code_verifier();
        let state = crate::util::random_token();
        let url = spotify::authorize_url(
            &self.accounts,
            &client_id,
            &redirect,
            &spotify::code_challenge(&verifier),
            &state,
        );
        self.inner.lock().unwrap().pending = Some(Pending {
            state,
            verifier,
            redirect_uri: redirect,
            client_id,
            at: crate::util::now_ms(),
        });
        self.update(|s| {
            s.login_pending = true;
            s.error = None;
        });
        Ok(url)
    }

    pub fn cancel_login(&self) {
        self.inner.lock().unwrap().pending = None;
        self.update(|s| s.login_pending = false);
    }

    pub fn logout(&self) {
        self.forget_spotify();
        if self.settings.get().music.source == MusicSource::Spotify {
            self.reset_track();
        }
        self.set_error(ConnState::Disconnected, None);
    }

    /// The browser came back to `/spotify/callback`. `result` is the code or
    /// Spotify's error. Returns a line for the browser tab.
    pub async fn finish_login(
        &self,
        state: &str,
        result: Result<String, String>,
    ) -> Result<String, String> {
        let pending = {
            let mut g = self.inner.lock().unwrap();
            match &g.pending {
                Some(p) if crate::util::secure_eq(&p.state, state) => g.pending.take(),
                _ => None,
            }
        };
        let Some(p) = pending else {
            return Err(
                "This sign-in link is old or was already used. Start again from Castwright.".into(),
            );
        };
        let fail = |msg: String| {
            self.update(|s| {
                s.login_pending = false;
                s.error = Some(msg.clone());
            });
            Err(msg)
        };
        if crate::util::now_ms() - p.at > LOGIN_TTL_MS {
            return fail("The sign-in took too long. Start again from Castwright.".into());
        }
        let code = match result {
            Ok(c) => c,
            Err(e) if e == "access_denied" => {
                return fail("Sign-in was cancelled on Spotify.".into());
            }
            Err(e) => return fail(format!("Spotify sign-in failed: {e}")),
        };
        let t = match spotify::exchange_code(
            &self.http,
            &self.accounts,
            &p.client_id,
            &code,
            &p.redirect_uri,
            &p.verifier,
        )
        .await
        {
            Ok(t) => t,
            Err(TokenError::Invalid(m)) => {
                return fail(format!(
                    "Spotify didn't accept the sign-in. Check that the redirect URI in your Spotify app is exactly {}. {m}",
                    p.redirect_uri
                ).trim().to_string());
            }
            Err(TokenError::Network(m)) => return fail(m),
        };
        let mut stored = StoredToken::default();
        stored.apply(t, crate::util::now_ms());
        stored.display_name =
            spotify::display_name(&self.http, &self.api, &stored.access_token).await;
        self.save_token(&stored);
        {
            let mut g = self.inner.lock().unwrap();
            g.unauthorized = 0;
            g.errors = 0;
        }
        let name = stored.display_name.clone();
        self.update(|s| {
            s.login_pending = false;
            s.error = None;
            s.spotify_user = Some(name.clone());
        });
        self.hub
            .log(LogLevel::Info, "music", "Signed in to Spotify");
        self.wake.notify_one();
        Ok(if name.is_empty() {
            "Spotify is connected.".into()
        } else {
            format!("Spotify is connected as {name}.")
        })
    }

    /// A fresh access token, refreshing it when it's about to run out.
    pub async fn spotify_token(&self, force: bool) -> Result<StoredToken, String> {
        let Some(mut t) = self.token() else {
            return Err("Sign in to Spotify in Settings → Music.".into());
        };
        let now = crate::util::now_ms();
        if !force && !t.stale(now) {
            return Ok(t);
        }
        let client_id = self.settings.get().music.spotify_client_id;
        match spotify::refresh(&self.http, &self.accounts, &client_id, &t.refresh_token).await {
            Ok(r) => {
                t.apply(r, crate::util::now_ms());
                self.save_token(&t);
                Ok(t)
            }
            Err(TokenError::Invalid(_)) => {
                self.forget_spotify();
                self.hub.log(
                    LogLevel::Warn,
                    "music",
                    "The Spotify sign-in ran out. Sign in again in Settings → Music.",
                );
                Err("The Spotify sign-in ran out. Sign in again.".into())
            }
            Err(TokenError::Network(m)) => Err(m),
        }
    }

    // ---------- polling ----------

    /// Reads the song once. Returns how long to wait before the next read.
    pub async fn poll_once(&self) -> Duration {
        let s = self.settings.get().music;
        let active = self.active();
        let wait = match s.source {
            MusicSource::Off => {
                self.set_error(ConnState::Disconnected, None);
                PARKED
            }
            MusicSource::Spotify => self.poll_spotify(&s, active).await,
            MusicSource::System => self.poll_system(active).await,
            MusicSource::TextFile => self.poll_file(&s),
        };
        // A sign-in link that was never used.
        let expired = {
            let mut g = self.inner.lock().unwrap();
            let old = g
                .pending
                .as_ref()
                .is_some_and(|p| crate::util::now_ms() - p.at > LOGIN_TTL_MS);
            if old {
                g.pending = None;
            }
            old
        };
        if expired {
            self.update(|s| s.login_pending = false);
        }
        wait
    }

    fn backoff(&self) -> Duration {
        let n = {
            let mut g = self.inner.lock().unwrap();
            g.errors = (g.errors + 1).min(6);
            g.errors
        };
        Duration::from_secs((5u64 << n).min(120))
    }

    async fn poll_spotify(&self, s: &MusicSettings, active: bool) -> Duration {
        if s.spotify_client_id.is_empty() {
            self.set_error(
                ConnState::Disconnected,
                Some("Add the client ID of your Spotify app.".into()),
            );
            return PARKED;
        }
        if self.token().is_none() {
            self.set_error(ConnState::Disconnected, None);
            return PARKED;
        }
        let force = self.inner.lock().unwrap().unauthorized > 0;
        let token = match self.spotify_token(force).await {
            Ok(t) => t,
            Err(e) => {
                let signed_out = self.token().is_none();
                self.set_error(ConnState::Error, Some(e));
                return if signed_out { PARKED } else { self.backoff() };
            }
        };
        match spotify::currently_playing(&self.http, &self.api, &token.access_token).await {
            Ok(track) => {
                {
                    let mut g = self.inner.lock().unwrap();
                    g.unauthorized = 0;
                    g.errors = 0;
                }
                self.set_error(ConnState::Connected, None);
                let nothing = track.is_none();
                self.apply(track, String::new(), None);
                match (active, nothing) {
                    (false, _) => IDLE,
                    (true, false) => SPOTIFY_ACTIVE,
                    (true, true) => Duration::from_secs(5),
                }
            }
            Err(ApiError::Unauthorized) => {
                let n = {
                    let mut g = self.inner.lock().unwrap();
                    g.unauthorized += 1;
                    g.unauthorized
                };
                if n > 2 {
                    self.set_error(
                        ConnState::Error,
                        Some("Spotify keeps refusing the sign-in. Sign out and in again.".into()),
                    );
                    return PARKED;
                }
                Duration::from_millis(200)
            }
            Err(ApiError::RateLimited(secs)) => {
                self.hub.log(
                    LogLevel::Warn,
                    "music",
                    format!("Spotify asked to slow down; waiting {secs} seconds."),
                );
                Duration::from_secs(secs.max(5))
            }
            Err(ApiError::Other(msg)) => {
                self.set_error(ConnState::Error, Some(msg));
                self.backoff()
            }
        }
    }

    async fn poll_system(&self, active: bool) -> Duration {
        let got = self.system.lock().await.read().await;
        match got {
            Ok(Some(t)) => {
                self.set_error(ConnState::Connected, None);
                self.inner.lock().unwrap().errors = 0;
                self.apply(Some(t.track), t.player, t.art);
            }
            Ok(None) => {
                self.set_error(ConnState::Connected, None);
                self.apply(None, String::new(), None);
            }
            Err(e) => {
                self.set_error(ConnState::Error, Some(e));
                return if SYSTEM_SUPPORTED {
                    self.backoff()
                } else {
                    PARKED
                };
            }
        }
        if active { SYSTEM_ACTIVE } else { SYSTEM_IDLE }
    }

    fn poll_file(&self, s: &MusicSettings) -> Duration {
        if s.text_file.is_empty() {
            self.set_error(
                ConnState::Disconnected,
                Some("Pick the text file to read.".into()),
            );
            return PARKED;
        }
        let path = std::path::Path::new(&s.text_file);
        let stamp = match textfile::stamp(path) {
            Ok(st) => st,
            Err(_) => {
                self.set_error(
                    ConnState::Error,
                    Some(format!(
                        "Can't find {}. Check the path, or start the program that writes it.",
                        s.text_file
                    )),
                );
                return Duration::from_secs(3);
            }
        };
        let seen = self.inner.lock().unwrap().file_stamp.clone();
        if seen
            .as_ref()
            .is_some_and(|(p, st)| p == &s.text_file && *st == stamp)
        {
            return FILE_CHECK;
        }
        match textfile::read(path) {
            Ok(text) => {
                self.inner.lock().unwrap().file_stamp = Some((s.text_file.clone(), stamp));
                self.set_error(ConnState::Connected, None);
                let np = textfile::parse(&text, &s.text_format);
                let player = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                self.apply(Some(np), player, None);
            }
            Err(e) => self.set_error(
                ConnState::Error,
                Some(format!("Couldn't read {}: {e}", s.text_file)),
            ),
        }
        FILE_CHECK
    }

    /// Cover for a local file link (MPRIS players save covers to disk).
    fn art_from_file(&self, url: &str) -> Option<String> {
        let path = url::Url::parse(url).ok()?.to_file_path().ok()?;
        let mut g = self.inner.lock().unwrap();
        if g.art_source == url
            && let Some(a) = &g.art
        {
            return Some(format!("/music/art/{}", a.version));
        }
        let meta = std::fs::metadata(&path).ok()?;
        if meta.len() == 0 || meta.len() > MAX_ART_FILE {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        let mime = mime_guess::from_path(&path)
            .first_or(mime_guess::mime::IMAGE_JPEG)
            .to_string();
        g.art_seq += 1;
        let version = g.art_seq;
        g.art = Some(Art {
            version,
            mime,
            bytes: Arc::new(bytes),
        });
        g.art_source = url.to_string();
        Some(format!("/music/art/{version}"))
    }

    fn store_art(&self, art: ArtSource) -> String {
        let ArtSource::Bytes { mime, bytes } = art;
        let mut g = self.inner.lock().unwrap();
        g.art_seq += 1;
        let version = g.art_seq;
        g.art = Some(Art {
            version,
            mime,
            bytes: Arc::new(bytes),
        });
        g.art_source.clear();
        format!("/music/art/{version}")
    }

    /// Takes a reading. `None` means nothing plays: the last song stays, paused.
    pub fn apply(&self, track: Option<NowPlaying>, player: String, art: Option<ArtSource>) {
        let previous = self.inner.lock().unwrap().status.track.clone();
        let next = match track {
            Some(mut t) => {
                let same = previous.as_ref().is_some_and(|p| p.key() == t.key());
                if let Some(a) = art {
                    t.art_url = self.store_art(a);
                } else if t.art_url.starts_with("file:") {
                    t.art_url = self.art_from_file(&t.art_url).unwrap_or_default();
                } else if t.art_url.is_empty() && same {
                    t.art_url = previous
                        .as_ref()
                        .map(|p| p.art_url.clone())
                        .unwrap_or_default();
                }
                Some(t)
            }
            None => previous.clone().map(|p| NowPlaying {
                playing: false,
                ..p
            }),
        };
        let changed_song = {
            let mut g = self.inner.lock().unwrap();
            let key = next
                .as_ref()
                .filter(|t| !t.title.is_empty())
                .map(NowPlaying::key);
            let changed = match (&g.last_key, &key) {
                (Some(old), Some(new)) => old != new,
                _ => false,
            };
            if key.is_some() {
                g.last_key = key;
            }
            g.status.track = next.clone();
            if !player.is_empty() {
                g.status.player = player;
            }
            changed
        };
        let shown_changed = previous.as_ref().map(|p| (p.key(), p.playing, &p.art_url))
            != next.as_ref().map(|p| (p.key(), p.playing, &p.art_url));
        self.publish(next.as_ref(), false);
        if shown_changed {
            self.emit();
        }
        if changed_song && let Some(t) = next {
            self.hub.signal(Signal::SongChanged(t));
        }
    }

    /// Updates the `music.*` variables. `clear` empties them.
    fn publish(&self, track: Option<&NowPlaying>, clear: bool) {
        let empty = NowPlaying::default();
        let t = if clear {
            &empty
        } else {
            track.unwrap_or(&empty)
        };
        let values: [(&str, Value); 7] = [
            ("music.title", t.title.clone().into()),
            ("music.artist", t.artist.clone().into()),
            ("music.album", t.album.clone().into()),
            ("music.art_url", t.art_url.clone().into()),
            ("music.playing", t.playing.into()),
            ("music.progress_ms", t.progress_ms.into()),
            ("music.duration_ms", t.duration_ms.into()),
        ];
        let mut changes = Map::new();
        for (k, v) in values {
            changes.extend(self.hub.vars.set(k, v, false));
        }
        self.hub.broadcast_vars(changes);
    }
}

#[cfg(test)]
mod tests;
