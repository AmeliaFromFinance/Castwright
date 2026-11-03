//! The soundboard: plays buttons on stream (through overlay pages), in the app, or
//! both. Clicks, hotkeys, the local API, actions, channel points and `!sound` all
//! come through here, so cooldowns and the mute apply the same way everywhere.

pub mod fuzzy;
#[cfg(test)]
mod tests;

use crate::error::{AppResult, user_err};
use crate::hub::{Hub, ui};
use crate::model::automation::Permission;
use crate::model::event::{Event, EventKind, UserRoles};
use crate::model::runtime::{LogLevel, OverlayMsg};
use crate::model::soundboard::{PlayOutcome, SoundButton, SoundCue, Soundboard, SoundboardStatus};
use crate::services::{SoundActions, TwitchActions};
use crate::store::project::ProjectStore;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Who asked for a sound, for the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    App,
    Hotkey,
    Api,
    Action,
    Reward,
    Request,
    Command,
}

#[derive(Default)]
struct State {
    last_play: HashMap<String, Instant>,
    last_any: Option<Instant>,
    next_play: u64,
    /// Last `!sound` per viewer.
    viewers: HashMap<String, Instant>,
}

pub struct SoundboardService {
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    twitch: RwLock<Option<Arc<dyn TwitchActions>>>,
    state: Mutex<State>,
    /// Counts open overlay pages that play stream sounds.
    stream_pages: OnceLock<Box<dyn Fn() -> u32 + Send + Sync>>,
}

fn left(last: Option<&Instant>, cooldown_s: u32, now: Instant) -> Duration {
    match last {
        Some(t) if cooldown_s > 0 => {
            (*t + Duration::from_secs(cooldown_s as u64)).saturating_duration_since(now)
        }
        _ => Duration::ZERO,
    }
}

fn rank(roles: &UserRoles) -> Permission {
    if roles.broadcaster {
        Permission::Broadcaster
    } else if roles.moderator {
        Permission::Moderator
    } else if roles.vip {
        Permission::Vip
    } else if roles.subscriber {
        Permission::Subscriber
    } else {
        Permission::Everyone
    }
}

fn text(e: &Event, key: &str) -> String {
    e.data
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The button a viewer meant, by label or alias.
pub fn find_sound<'a>(board: &'a Soundboard, query: &str) -> Option<&'a SoundButton> {
    let playable: Vec<&SoundButton> = board.buttons.iter().filter(|b| !b.src.is_empty()).collect();
    let names = playable
        .iter()
        .map(|b| std::iter::once(b.label.as_str()).chain(b.aliases.iter().map(String::as_str)));
    fuzzy::best_match(query, names).map(|i| playable[i])
}

impl SoundboardService {
    pub fn new(hub: Arc<Hub>, project: Arc<ProjectStore>) -> Arc<Self> {
        Arc::new(SoundboardService {
            hub,
            project,
            twitch: RwLock::new(None),
            state: Mutex::new(State::default()),
            stream_pages: OnceLock::new(),
        })
    }

    pub fn set_twitch(&self, t: Arc<dyn TwitchActions>) {
        *self.twitch.write().unwrap() = Some(t);
    }

    pub fn set_stream_pages(&self, f: Box<dyn Fn() -> u32 + Send + Sync>) {
        let _ = self.stream_pages.set(f);
    }

    pub fn board(&self) -> Soundboard {
        self.project.read(|p| p.soundboard.clone())
    }

    /// Listen for redemptions and `!sound` in chat.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        let mut events = self.hub.subscribe_events();
        crate::util::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(e) => me.on_event(&e),
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    pub fn status(&self) -> SoundboardStatus {
        self.status_at(Instant::now(), crate::util::now_ms())
    }

    fn status_at(&self, now: Instant, now_ms: i64) -> SoundboardStatus {
        let board = self.board();
        let st = self.state.lock().unwrap();
        let until = |d: Duration| now_ms + d.as_millis() as i64;
        let cooldowns = board
            .buttons
            .iter()
            .filter_map(|b| {
                let d = left(st.last_play.get(&b.id), b.cooldown_s, now);
                (!d.is_zero()).then(|| (b.id.clone(), until(d)))
            })
            .collect();
        let global = left(st.last_any.as_ref(), board.global_cooldown_s, now);
        SoundboardStatus {
            muted: board.muted,
            cooldowns,
            global_until: if global.is_zero() { 0 } else { until(global) },
            stream_pages: self.stream_pages.get().map(|f| f()).unwrap_or(0),
        }
    }

    fn emit_status(&self) {
        self.hub.emit_ui(ui::SOUNDBOARD, &self.status());
    }

    /// Save the buttons and settings. The mute isn't changed here.
    pub fn save(&self, board: Soundboard) -> Soundboard {
        let mut board = board.cleaned();
        self.project.update(|p| {
            board.muted = p.soundboard.muted;
            p.soundboard = board.clone();
        });
        self.state
            .lock()
            .unwrap()
            .last_play
            .retain(|id, _| board.buttons.iter().any(|b| &b.id == id));
        self.emit_status();
        board
    }

    pub fn set_muted(&self, muted: bool) {
        self.project.update(|p| p.soundboard.muted = muted);
        if muted {
            self.stop(None);
        }
        self.emit_status();
    }

    pub fn play(&self, id: &str, source: Source) -> PlayOutcome {
        self.play_at(id, source, Instant::now())
    }

    pub(crate) fn play_at(&self, id: &str, source: Source, now: Instant) -> PlayOutcome {
        let board = self.board();
        let Some(button) = board.buttons.iter().find(|b| b.id == id) else {
            return PlayOutcome::NotFound;
        };
        if button.src.is_empty() {
            return PlayOutcome::NoFile;
        }
        if board.muted {
            return PlayOutcome::Muted;
        }
        let play_id = {
            let mut st = self.state.lock().unwrap();
            let wait = left(st.last_play.get(id), button.cooldown_s, now).max(left(
                st.last_any.as_ref(),
                board.global_cooldown_s,
                now,
            ));
            if !wait.is_zero() {
                return PlayOutcome::Cooldown {
                    seconds_left: wait.as_secs_f64().ceil() as u32,
                };
            }
            st.last_play.insert(id.to_string(), now);
            st.last_any = Some(now);
            st.next_play += 1;
            st.next_play
        };
        let stream = button.output.on_stream();
        if stream {
            self.hub.to_overlays(
                None,
                OverlayMsg::SoundPlay {
                    play_id,
                    sound_id: button.id.clone(),
                    src: button.src.clone(),
                    volume: button.volume,
                },
            );
        }
        self.hub.emit_ui(
            ui::SOUND,
            &SoundCue::Play {
                play_id,
                sound_id: button.id.clone(),
                label: button.label.clone(),
                src: button.src.clone(),
                volume: button.volume,
                local: button.output.local(),
                stream,
                started_at: crate::util::now_ms(),
            },
        );
        if !matches!(source, Source::App) {
            tracing::info!("soundboard: {} from {source:?}", button.label);
        }
        self.emit_status();
        PlayOutcome::Played { play_id }
    }

    /// Stop one sound, or every sound with `None`.
    pub fn stop(&self, id: Option<&str>) {
        let sound_id = id.map(str::to_string);
        self.hub.to_overlays(
            None,
            OverlayMsg::SoundStop {
                sound_id: sound_id.clone(),
            },
        );
        self.hub.emit_ui(ui::SOUND, &SoundCue::Stop { sound_id });
    }

    pub fn on_event(self: &Arc<Self>, e: &Event) {
        if e.test {
            return;
        }
        match e.kind {
            EventKind::Redemption => self.on_redemption(e),
            EventKind::Chat => self.on_chat(e),
            _ => {}
        }
    }

    fn on_redemption(self: &Arc<Self>, e: &Event) {
        let board = self.board();
        let reward_id = text(e, "reward_id");
        if reward_id.is_empty() {
            return;
        }
        let who = e
            .user
            .as_ref()
            .map(|u| u.display_name.clone())
            .unwrap_or_default();
        let outcome = if let Some(b) = board.buttons.iter().find(|b| b.reward_id == reward_id) {
            self.play(&b.id, Source::Reward)
        } else if board.request_reward_id == reward_id {
            let input = e.message.clone().unwrap_or_default();
            match find_sound(&board, &input) {
                Some(b) => self.play(&b.id, Source::Request),
                None => {
                    self.hub.log(
                        LogLevel::Info,
                        "soundboard",
                        format!(
                            "{who} asked for \"{}\", which matches no sound. Refunded.",
                            input.trim()
                        ),
                    );
                    PlayOutcome::NotFound
                }
            }
        } else {
            return;
        };
        if let Some(reason) = outcome.reason()
            && !matches!(outcome, PlayOutcome::NotFound)
        {
            self.hub.log(
                LogLevel::Info,
                "soundboard",
                format!("{who}'s redemption was refunded. {reason}"),
            );
        }
        // Rewards that skip the queue are already complete and can't be refunded.
        if text(e, "status") != "unfulfilled" {
            return;
        }
        let Some(twitch) = self.twitch.read().unwrap().clone() else {
            return;
        };
        let redemption_id = text(e, "redemption_id");
        let refund = !outcome.played();
        let hub = self.hub.clone();
        crate::util::spawn(async move {
            if let Err(err) = twitch
                .finish_redemption(&reward_id, &redemption_id, refund)
                .await
            {
                hub.log(
                    LogLevel::Warn,
                    "soundboard",
                    format!(
                        "Couldn't {} the redemption: {err}",
                        if refund { "refund" } else { "complete" }
                    ),
                );
            }
        });
    }

    fn on_chat(&self, e: &Event) {
        let board = self.board();
        let cmd = &board.command;
        if !cmd.enabled || e.data.get("sent_by_castwright").and_then(Value::as_bool) == Some(true) {
            return;
        }
        let Some(rest) = e
            .message
            .as_deref()
            .map(str::trim)
            .and_then(|t| t.strip_prefix('!'))
        else {
            return;
        };
        let (word, query) = match rest.find(char::is_whitespace) {
            Some(i) => (&rest[..i], rest[i..].trim()),
            None => (rest, ""),
        };
        if !word.eq_ignore_ascii_case(&cmd.name) || query.is_empty() {
            return;
        }
        if rank(&e.roles) < cmd.permission {
            return;
        }
        let Some(button) = find_sound(&board, query) else {
            return;
        };
        let skips = e.roles.broadcaster || e.roles.moderator;
        let viewer = e.user.as_ref().map(|u| u.id.clone()).unwrap_or_default();
        let now = Instant::now();
        if !skips && cmd.cooldown_s > 0 && !viewer.is_empty() {
            let st = self.state.lock().unwrap();
            if !left(st.viewers.get(&viewer), cmd.cooldown_s, now).is_zero() {
                return;
            }
        }
        if self.play_at(&button.id, Source::Command, now).played() && !viewer.is_empty() {
            let mut st = self.state.lock().unwrap();
            st.viewers.insert(viewer, now);
            if st.viewers.len() > 10_000 {
                st.viewers
                    .retain(|_, t| now.duration_since(*t) < Duration::from_secs(MAX_VIEWER_S));
            }
        }
    }
}

const MAX_VIEWER_S: u64 = crate::model::soundboard::MAX_COOLDOWN_S as u64;

impl SoundActions for SoundboardService {
    fn play_sound(&self, sound_id: &str) -> AppResult<()> {
        match self.play(sound_id, Source::Action).reason() {
            None => Ok(()),
            Some(reason) => user_err(reason),
        }
    }
}
