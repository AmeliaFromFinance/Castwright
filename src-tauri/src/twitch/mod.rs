//! Twitch: sign-in, EventSub, live stream info and chat/moderation actions.

mod actions;
pub mod auth;
mod badges;
mod eventsub;
mod helix;
pub mod normalize;
mod stream;

#[cfg(test)]
mod normalize_tests;
#[cfg(test)]
mod tests;

pub use actions::Category;

use crate::error::{AppError, AppResult};
use crate::hub::{Hub, ui};
use crate::model::runtime::{
    AccountRole, ConnState, DeviceLogin, LogLevel, StreamInfo, TwitchStatus,
};
use crate::store::secrets::{Secrets, keys};
use crate::store::settings::SettingsStore;
use crate::util::spawn;
use auth::{Poll, StoredToken};
use helix::HelixError;
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// How long a chat message being posted can still match its echo.
const SENDING_WINDOW: std::time::Duration = std::time::Duration::from_secs(15);

/// Where the Twitch APIs live. Tests point these at local mock servers.
#[derive(Debug, Clone, PartialEq)]
pub struct TwitchEndpoints {
    pub id_base: String,
    pub helix_base: String,
    pub eventsub_url: String,
}

impl Default for TwitchEndpoints {
    fn default() -> Self {
        TwitchEndpoints {
            id_base: "https://id.twitch.tv".into(),
            helix_base: "https://api.twitch.tv/helix".into(),
            eventsub_url: "wss://eventsub.wss.twitch.tv/ws".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Timing {
    /// One "second" of the device flow polling interval.
    pub poll_unit: Duration,
    /// Extra wait on top of Twitch's keepalive timeout before reconnecting.
    pub keepalive_margin: Duration,
    pub welcome_timeout: Duration,
    pub backoff_min: Duration,
    pub backoff_max: Duration,
    /// Uptime refresh; stream info is fetched every second tick.
    pub stream_tick: Duration,
    pub validate_every: Duration,
    /// Longest wait for a Helix rate limit to reset before giving up.
    pub max_rate_wait: Duration,
    pub badge_refresh: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            poll_unit: Duration::from_secs(1),
            keepalive_margin: Duration::from_secs(5),
            welcome_timeout: Duration::from_secs(15),
            backoff_min: Duration::from_secs(1),
            backoff_max: Duration::from_secs(60),
            stream_tick: Duration::from_secs(30),
            validate_every: Duration::from_secs(3600),
            max_rate_wait: Duration::from_secs(60),
            badge_refresh: Duration::from_secs(3 * 3600),
        }
    }
}

const NO_CLIENT_ID: &str =
    "Castwright needs a Twitch Client ID to sign in. Add one in Settings → Twitch.";
const SIGNED_OUT: &str = "Twitch signed you out. Sign in again in Settings.";
const SEEN_KEEP: usize = 2000;

fn idx(role: AccountRole) -> usize {
    match role {
        AccountRole::Broadcaster => 0,
        AccountRole::Bot => 1,
    }
}

fn secret_key(role: AccountRole) -> &'static str {
    match role {
        AccountRole::Broadcaster => keys::TWITCH_BROADCASTER,
        AccountRole::Bot => keys::TWITCH_BOT,
    }
}

fn role_name(role: AccountRole) -> &'static str {
    match role {
        AccountRole::Broadcaster => "broadcaster",
        AccountRole::Bot => "bot",
    }
}

#[derive(Default)]
struct State {
    status: TwitchStatus,
    tokens: [Option<StoredToken>; 2],
    logins: [Option<JoinHandle<()>>; 2],
    eventsub: Option<JoinHandle<()>>,
    stream: Option<JoinHandle<()>>,
    badges: Option<JoinHandle<()>>,
    validate: Option<JoinHandle<()>>,
    /// Live state from the last stream.online/offline event and when it came.
    /// Helix lags behind EventSub, so a poll right after is not trusted.
    stream_hint: Option<(bool, i64)>,
    stream_failing: bool,
    /// Stream info has been read at least once since start-up.
    stream_known: bool,
}

#[derive(Default)]
struct Seen {
    ids: HashSet<String>,
    order: VecDeque<String>,
}

pub struct TwitchService {
    hub: Arc<Hub>,
    secrets: Arc<Secrets>,
    settings: Arc<SettingsStore>,
    endpoints: TwitchEndpoints,
    timing: Timing,
    http: reqwest::Client,
    state: Mutex<State>,
    refresh_locks: [tokio::sync::Mutex<()>; 2],
    stream_poke: Notify,
    seen: Mutex<Seen>,
    badges: Mutex<badges::BadgeCache>,
    /// Ids of chat messages Castwright posted, so their echo never triggers commands.
    sent: Mutex<std::collections::VecDeque<String>>,
    /// Messages being posted right now (sender id, text), since Twitch may echo
    /// them back before the post call returns their id.
    sending: Mutex<std::collections::VecDeque<(String, String, std::time::Instant)>>,
}

impl TwitchService {
    pub fn new(hub: Arc<Hub>, secrets: Arc<Secrets>, settings: Arc<SettingsStore>) -> Arc<Self> {
        Self::with_endpoints(hub, secrets, settings, TwitchEndpoints::default())
    }

    pub fn with_endpoints(
        hub: Arc<Hub>,
        secrets: Arc<Secrets>,
        settings: Arc<SettingsStore>,
        endpoints: TwitchEndpoints,
    ) -> Arc<Self> {
        Self::build(hub, secrets, settings, endpoints, Timing::default())
    }

    pub(crate) fn build(
        hub: Arc<Hub>,
        secrets: Arc<Secrets>,
        settings: Arc<SettingsStore>,
        endpoints: TwitchEndpoints,
        timing: Timing,
    ) -> Arc<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("Castwright/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        let mut state = State::default();
        for role in [AccountRole::Broadcaster, AccountRole::Bot] {
            let token = secrets
                .get(secret_key(role))
                .and_then(|s| serde_json::from_str::<StoredToken>(&s).ok())
                .filter(|t| !t.access_token.is_empty());
            if let Some(t) = &token {
                match role {
                    AccountRole::Broadcaster => state.status.broadcaster = Some(t.account()),
                    AccountRole::Bot => state.status.bot = Some(t.account()),
                }
            }
            state.tokens[idx(role)] = token;
        }
        Arc::new(TwitchService {
            hub,
            secrets,
            settings,
            endpoints,
            timing,
            http,
            state: Mutex::new(state),
            refresh_locks: Default::default(),
            stream_poke: Notify::new(),
            seen: Mutex::new(Seen::default()),
            badges: Mutex::default(),
            sent: Mutex::new(std::collections::VecDeque::new()),
            sending: Mutex::new(std::collections::VecDeque::new()),
        })
    }

    /// Starts background work for whoever is already signed in.
    pub fn start(self: &Arc<Self>) {
        let (has_broadcaster, has_any) = {
            let st = self.state.lock().unwrap();
            (
                st.tokens[0].is_some(),
                st.tokens.iter().any(Option::is_some),
            )
        };
        if has_any {
            self.ensure_validate_task();
        }
        if has_broadcaster {
            self.start_broadcaster_tasks();
        }
    }

    pub fn shutdown(&self) {
        {
            let mut st = self.state.lock().unwrap();
            let handles = [
                st.eventsub.take(),
                st.stream.take(),
                st.badges.take(),
                st.validate.take(),
                st.logins[0].take(),
                st.logins[1].take(),
            ];
            for h in handles.into_iter().flatten() {
                h.abort();
            }
        }
        self.update_status(|s| s.eventsub = ConnState::Disconnected);
    }

    pub(crate) fn remember_sent(&self, message_id: &str) {
        if message_id.is_empty() {
            return;
        }
        let mut q = self.sent.lock().unwrap();
        q.push_back(message_id.to_string());
        while q.len() > 200 {
            q.pop_front();
        }
    }

    pub(crate) fn was_sent_by_app(&self, message_id: &str) -> bool {
        self.sent.lock().unwrap().iter().any(|m| m == message_id)
    }

    pub(crate) fn remember_sending(&self, sender_id: &str, text: &str) {
        let mut q = self.sending.lock().unwrap();
        q.retain(|(_, _, at)| at.elapsed() < SENDING_WINDOW);
        q.push_back((
            sender_id.to_string(),
            text.to_string(),
            std::time::Instant::now(),
        ));
        while q.len() > 50 {
            q.pop_front();
        }
    }

    /// Whether this chat message is the echo of one being posted. Each post matches once.
    pub(crate) fn is_echo_of_sending(&self, sender_id: &str, text: &str) -> bool {
        let mut q = self.sending.lock().unwrap();
        q.retain(|(_, _, at)| at.elapsed() < SENDING_WINDOW);
        match q
            .iter()
            .position(|(s, t, _)| s == sender_id && t.trim() == text.trim())
        {
            Some(i) => {
                q.remove(i);
                true
            }
            None => false,
        }
    }

    /// Whether `status().stream` reflects Twitch yet, rather than the default.
    pub fn stream_known(&self) -> bool {
        self.state.lock().unwrap().stream_known
    }

    pub fn status(&self) -> TwitchStatus {
        let mut s = self.state.lock().unwrap().status.clone();
        s.has_client_id = self.client_id().is_some();
        s
    }

    pub fn client_id(&self) -> Option<String> {
        let from_settings = self.settings.get().twitch.client_id.trim().to_string();
        if !from_settings.is_empty() {
            return Some(from_settings);
        }
        option_env!("CASTWRIGHT_TWITCH_CLIENT_ID")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    }

    /// Begins signing in. Show the returned code to the user; the rest happens in the background.
    pub async fn start_login(self: &Arc<Self>, role: AccountRole) -> AppResult<DeviceLogin> {
        let Some(client_id) = self.client_id() else {
            return Err(AppError::User(NO_CLIENT_ID.into()));
        };
        self.cancel_login(role);
        let code = auth::request_device_code(&self.http, &self.endpoints.id_base, &client_id, role)
            .await
            .map_err(AppError::Twitch)?;
        let login = DeviceLogin {
            user_code: code.user_code.clone(),
            verification_uri: code.verification_uri.clone(),
            expires_in_s: code.expires_in.min(u32::MAX as u64) as u32,
        };
        self.update_status(|s| s.error = None);
        let me = self.clone();
        let handle = spawn(async move { me.login_task(role, client_id, code).await });
        if let Some(old) = self.state.lock().unwrap().logins[idx(role)].replace(handle) {
            old.abort();
        }
        Ok(login)
    }

    pub fn cancel_login(&self, role: AccountRole) {
        if let Some(h) = self.state.lock().unwrap().logins[idx(role)].take() {
            h.abort();
        }
    }

    pub async fn logout(&self, role: AccountRole) -> AppResult<()> {
        self.cancel_login(role);
        let token = self.token(role);
        if let (Some(t), Some(cid)) = (&token, self.client_id()) {
            auth::revoke(&self.http, &self.endpoints.id_base, &cid, &t.access_token).await;
        }
        self.forget(role, None);
        if let Some(t) = token {
            self.hub.log(
                LogLevel::Info,
                "twitch",
                format!("Signed out {} ({})", t.display_name, role_name(role)),
            );
        }
        Ok(())
    }

    async fn login_task(
        self: Arc<Self>,
        role: AccountRole,
        client_id: String,
        code: auth::DeviceCode,
    ) {
        let expires = self.timing.poll_unit * code.expires_in.clamp(1, 3600) as u32;
        let deadline = tokio::time::Instant::now() + expires;
        let mut interval = code.interval.clamp(1, 60) as u32;
        loop {
            tokio::time::sleep(self.timing.poll_unit * interval).await;
            if tokio::time::Instant::now() >= deadline {
                self.login_failed("The sign-in code expired. Start again to get a new code.");
                return;
            }
            let poll = auth::poll_device_token(
                &self.http,
                &self.endpoints.id_base,
                &client_id,
                role,
                &code.device_code,
            )
            .await;
            match poll {
                Poll::Pending => {}
                Poll::SlowDown => interval += 5,
                Poll::Failed(msg) => {
                    self.login_failed(&msg);
                    return;
                }
                Poll::Done(t) => {
                    let mut token = StoredToken::default();
                    token.apply(t);
                    if let Err(e) = self.fill_user(&mut token, &client_id).await {
                        self.login_failed(&e);
                        return;
                    }
                    if let Err(e) = self.store_token(role, &token) {
                        self.login_failed(&format!("Couldn't save the sign-in: {e}"));
                        return;
                    }
                    self.hub.log(
                        LogLevel::Info,
                        "twitch",
                        format!("Signed in as {} ({})", token.display_name, role_name(role)),
                    );
                    self.update_status(|s| s.error = None);
                    self.ensure_validate_task();
                    if role == AccountRole::Broadcaster {
                        self.start_broadcaster_tasks();
                    }
                    return;
                }
            }
        }
    }

    fn login_failed(&self, msg: &str) {
        self.hub.log(LogLevel::Warn, "twitch", msg);
        self.update_status(|s| s.error = Some(msg.to_string()));
    }

    async fn fill_user(&self, token: &mut StoredToken, client_id: &str) -> Result<(), String> {
        let res = self
            .http
            .get(format!("{}/users", self.endpoints.helix_base))
            .header("Client-Id", client_id)
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|_| "Couldn't reach Twitch. Check your internet connection.".to_string())?;
        if !res.status().is_success() {
            return Err(format!(
                "Signed in, but Twitch wouldn't share the account details ({}).",
                res.status().as_u16()
            ));
        }
        let v: serde_json::Value = res
            .json()
            .await
            .map_err(|_| "Twitch sent an unexpected reply.".to_string())?;
        let u = v.pointer("/data/0").cloned().unwrap_or_default();
        token.user_id = normalize::str_of(&u, "id");
        token.login = normalize::str_of(&u, "login");
        token.display_name = normalize::str_of(&u, "display_name");
        token.profile_image_url = normalize::str_of(&u, "profile_image_url");
        if token.user_id.is_empty() {
            return Err("Twitch didn't return the account that signed in.".into());
        }
        if token.display_name.is_empty() {
            token.display_name = token.login.clone();
        }
        Ok(())
    }

    fn token(&self, role: AccountRole) -> Option<StoredToken> {
        self.state.lock().unwrap().tokens[idx(role)].clone()
    }

    fn broadcaster_id(&self) -> Option<String> {
        self.token(AccountRole::Broadcaster).map(|t| t.user_id)
    }

    fn store_token(&self, role: AccountRole, token: &StoredToken) -> AppResult<()> {
        self.secrets
            .set(secret_key(role), &serde_json::to_string(token)?)?;
        self.state.lock().unwrap().tokens[idx(role)] = Some(token.clone());
        let account = Some(token.account());
        self.update_status(|s| match role {
            AccountRole::Broadcaster => s.broadcaster = account,
            AccountRole::Bot => s.bot = account,
        });
        Ok(())
    }

    /// Drops an account locally (after sign-out, or when Twitch rejected its tokens).
    fn forget(&self, role: AccountRole, error: Option<String>) {
        let _ = self.secrets.delete(secret_key(role));
        let handles = {
            let mut st = self.state.lock().unwrap();
            st.tokens[idx(role)] = None;
            let mut handles = Vec::new();
            if role == AccountRole::Broadcaster {
                handles.extend(st.eventsub.take());
                handles.extend(st.stream.take());
                handles.extend(st.badges.take());
                st.stream_hint = None;
            }
            if st.tokens.iter().all(Option::is_none) {
                handles.extend(st.validate.take());
            }
            handles
        };
        for h in handles {
            h.abort();
        }
        self.update_status(|s| {
            match role {
                AccountRole::Broadcaster => {
                    s.broadcaster = None;
                    s.eventsub = ConnState::Disconnected;
                    s.failed_subscriptions.clear();
                    s.stream = StreamInfo::default();
                }
                AccountRole::Bot => s.bot = None,
            }
            if error.is_some() {
                s.error = error.clone();
            }
        });
        if role == AccountRole::Broadcaster {
            *self.badges.lock().unwrap() = Default::default();
            self.publish_stream_vars(&StreamInfo::default());
        }
        if let Some(e) = error {
            self.hub.log(LogLevel::Warn, "twitch", e);
        }
    }

    /// A token for Helix, refreshed first when it's about to expire.
    async fn fresh_token(&self, role: AccountRole) -> Result<StoredToken, HelixError> {
        let t = self.token(role).ok_or(HelixError::NotSignedIn)?;
        if t.expires_at != 0 && t.expires_at < crate::util::now_ms() + 60_000 {
            return self.refresh(role, &t.access_token).await;
        }
        Ok(t)
    }

    /// Refresh tokens can only be used once, so refreshes are serialized and a
    /// caller holding an already-replaced token just gets the new one.
    async fn refresh(&self, role: AccountRole, used: &str) -> Result<StoredToken, HelixError> {
        let _guard = self.refresh_locks[idx(role)].lock().await;
        let current = self.token(role).ok_or(HelixError::NotSignedIn)?;
        if current.access_token != used {
            return Ok(current);
        }
        let client_id = self.client_id().ok_or(HelixError::NoClientId)?;
        match auth::refresh(
            &self.http,
            &self.endpoints.id_base,
            &client_id,
            &current.refresh_token,
        )
        .await
        {
            Ok(t) => {
                let mut next = current;
                next.apply(t);
                if let Err(e) = self.store_token(role, &next) {
                    self.hub.log(
                        LogLevel::Warn,
                        "twitch",
                        format!("Couldn't save refreshed sign-in: {e}"),
                    );
                }
                Ok(next)
            }
            Err(auth::RefreshError::Invalid) => {
                self.forget(role, Some(SIGNED_OUT.into()));
                Err(HelixError::SignedOut)
            }
            Err(auth::RefreshError::Network(_)) => Err(HelixError::Network),
        }
    }

    fn ensure_validate_task(self: &Arc<Self>) {
        let mut st = self.state.lock().unwrap();
        if st.validate.as_ref().is_some_and(|h| !h.is_finished()) {
            return;
        }
        let me = self.clone();
        st.validate = Some(spawn(async move { me.validate_loop().await }));
    }

    /// Twitch asks apps to validate tokens at startup and then hourly.
    async fn validate_loop(self: Arc<Self>) {
        loop {
            for role in [AccountRole::Broadcaster, AccountRole::Bot] {
                self.validate_role(role).await;
            }
            tokio::time::sleep(self.timing.validate_every).await;
        }
    }

    async fn validate_role(&self, role: AccountRole) {
        let Some(t) = self.token(role) else { return };
        match auth::validate(&self.http, &self.endpoints.id_base, &t.access_token).await {
            Ok(v) => {
                let mut next = t.clone();
                if !v.scopes.is_empty() {
                    next.scopes = v.scopes;
                }
                if !v.login.is_empty() {
                    next.login = v.login;
                }
                if v.expires_in > 0 {
                    next.expires_at = crate::util::now_ms() + v.expires_in * 1000;
                }
                if next != t && self.token(role).as_ref() == Some(&t) {
                    let _ = self.store_token(role, &next);
                }
            }
            Err(auth::ValidateError::Invalid) => {
                if self.refresh(role, &t.access_token).await.is_ok() {
                    self.hub.log(
                        LogLevel::Info,
                        "twitch",
                        format!("Renewed {} sign-in", role_name(role)),
                    );
                }
            }
            Err(auth::ValidateError::Network(_)) => {}
        }
    }

    fn start_broadcaster_tasks(self: &Arc<Self>) {
        let (es, stream, badges) = {
            let (me, me2, me3) = (self.clone(), self.clone(), self.clone());
            (
                spawn(async move { me.eventsub_loop().await }),
                spawn(async move { me2.stream_loop().await }),
                spawn(async move { me3.badge_loop().await }),
            )
        };
        let old = {
            let mut st = self.state.lock().unwrap();
            st.stream_hint = None;
            [
                st.eventsub.replace(es),
                st.stream.replace(stream),
                st.badges.replace(badges),
            ]
        };
        for h in old.into_iter().flatten() {
            h.abort();
        }
    }

    /// Changes status and tells the app window when anything actually changed.
    fn update_status(&self, f: impl FnOnce(&mut TwitchStatus)) {
        let changed = {
            let mut st = self.state.lock().unwrap();
            let before = st.status.clone();
            f(&mut st.status);
            (st.status != before).then(|| st.status.clone())
        };
        if let Some(mut s) = changed {
            s.has_client_id = self.client_id().is_some();
            self.hub.emit_ui(ui::TWITCH, &s);
        }
    }

    /// False when this message id was already handled.
    fn first_sighting(&self, id: &str) -> bool {
        if id.is_empty() {
            return true;
        }
        let mut seen = self.seen.lock().unwrap();
        if !seen.ids.insert(id.to_string()) {
            return false;
        }
        seen.order.push_back(id.to_string());
        while seen.order.len() > SEEN_KEEP {
            if let Some(old) = seen.order.pop_front() {
                seen.ids.remove(&old);
            }
        }
        true
    }
}
