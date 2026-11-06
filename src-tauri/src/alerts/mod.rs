//! Picks the alert variation for each event, queues alerts and plays them one at a time.

pub mod samples;

// Skip is only honoured while an alert is playing, so a stray press never eats the next one.

use crate::hub::{Hub, ui};
use crate::model::alert::{AlertConfig, AlertSettings, Variation};
use crate::model::event::{Event, EventKind};
use crate::model::runtime::{AlertPlay, LogLevel, OverlayMsg, QueueState};
use crate::store::project::ProjectStore;
use crate::store::settings::SettingsStore;
use crate::template::render;
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{Notify, broadcast};

/// An alert has started playing. `run_action` comes from the variation.
#[derive(Debug, Clone)]
pub struct Played {
    pub play: AlertPlay,
    pub run_action: Option<String>,
}

pub struct AlertEngine {
    hub: Arc<Hub>,
    project: Arc<ProjectStore>,
    state: Mutex<QueueState>,
    /// Wakes the player when something is queued or the queue is resumed.
    wake: Notify,
    /// Ends the current alert early.
    skip: Notify,
    played: broadcast::Sender<Played>,
    pending_actions: Mutex<Vec<(String, Option<String>)>>,
    /// Where mute is saved. None in tests.
    settings: Mutex<Option<Arc<SettingsStore>>>,
}

impl AlertEngine {
    pub fn new(hub: Arc<Hub>, project: Arc<ProjectStore>) -> Arc<Self> {
        let (played, _) = broadcast::channel(64);
        Arc::new(AlertEngine {
            hub,
            project,
            state: Mutex::new(QueueState::default()),
            wake: Notify::new(),
            skip: Notify::new(),
            played,
            pending_actions: Mutex::new(Vec::new()),
            settings: Mutex::new(None),
        })
    }

    /// Load the saved mute and save it again whenever it changes.
    pub fn use_settings(&self, settings: Arc<SettingsStore>) {
        self.state.lock().unwrap().muted = settings.get().alerts_muted;
        *self.settings.lock().unwrap() = Some(settings);
    }

    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        let mut rx = self.hub.subscribe_events();
        crate::util::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => me.handle_event(&event),
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        me.hub.log(
                            LogLevel::Warn,
                            "alerts",
                            format!("Skipped {n} events (too many at once)."),
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let me = self.clone();
        crate::util::spawn(async move { me.player().await });
    }

    pub fn subscribe_played(&self) -> broadcast::Receiver<Played> {
        self.played.subscribe()
    }

    pub fn queue_state(&self) -> QueueState {
        self.state.lock().unwrap().clone()
    }

    pub fn handle_event(&self, event: &Event) {
        let config = self.project.read(|p| p.alerts.clone());
        let vars = self.hub.vars.snapshot();
        if let Some((play, run_action)) = build_play(&config, event, &vars) {
            self.enqueue(play, run_action, config.settings.max_queue);
        }
    }

    /// Queue an alert that didn't come from an event (automation "Play alert" step).
    pub fn enqueue_custom(
        &self,
        title: &str,
        message: &str,
        image: &str,
        sound: &str,
        duration_ms: u32,
    ) {
        let mut event = Event::new(EventKind::Custom);
        event.test = true;
        let v = Variation {
            title: title.to_string(),
            message: message.to_string(),
            image: image.to_string(),
            sound: sound.to_string(),
            duration_ms,
            ..Variation::default()
        };
        let max = self.project.read(|p| p.alerts.settings.max_queue);
        // The text is already filled in by the caller; don't fill it in twice.
        let mut play = render_play(&v, &event, &AlertSettings::default(), &Map::new());
        play.title = title.to_string();
        play.message = message.to_string();
        self.enqueue(play, None, max);
    }

    pub fn replay(&self, event_id: &str) -> crate::error::AppResult<()> {
        let Some(mut event) = self.hub.db.get_event(event_id)? else {
            return Err(crate::error::AppError::NotFound(
                "That event is no longer in history.".into(),
            ));
        };
        event.id = crate::util::new_id();
        let config = self.project.read(|p| p.alerts.clone());
        let vars = self.hub.vars.snapshot();
        match build_play(&config, &event, &vars) {
            Some((play, run_action)) => {
                self.enqueue(play, run_action, config.settings.max_queue);
                Ok(())
            }
            None => crate::error::user_err("No enabled alert matches that event."),
        }
    }

    fn enqueue(&self, play: AlertPlay, run_action: Option<String>, max_queue: u32) {
        {
            let mut st = self.state.lock().unwrap();
            if let Some(action) = run_action {
                self.pending_actions
                    .lock()
                    .unwrap()
                    .push((play.id.clone(), Some(action)));
            }
            // Highest priority first; same priority keeps arrival order.
            let pos = st
                .waiting
                .iter()
                .position(|w| w.priority < play.priority)
                .unwrap_or(st.waiting.len());
            st.waiting.insert(pos, play);
            let max = max_queue.max(1) as usize;
            while st.waiting.len() > max {
                // Drop the oldest of the lowest priority.
                let lowest = st.waiting.iter().map(|w| w.priority).min().unwrap_or(0);
                if let Some(i) = st.waiting.iter().position(|w| w.priority == lowest) {
                    let dropped = st.waiting.remove(i);
                    self.pending_actions
                        .lock()
                        .unwrap()
                        .retain(|(pid, _)| *pid != dropped.id);
                }
            }
        }
        self.emit_state();
        self.wake.notify_one();
    }

    pub fn set_paused(&self, paused: bool) {
        self.state.lock().unwrap().paused = paused;
        self.emit_state();
        if !paused {
            self.wake.notify_one();
        }
    }

    pub fn set_muted(&self, muted: bool) -> crate::error::AppResult<()> {
        self.state.lock().unwrap().muted = muted;
        let settings = self.settings.lock().unwrap().clone();
        if let Some(s) = settings {
            s.update(|s| s.alerts_muted = muted)?;
        }
        self.emit_state();
        Ok(())
    }

    /// Queue the last played alert again. Its action doesn't run a second time.
    /// Play one variation with `event`, even if another variation would win.
    pub fn test_variation(
        &self,
        variation_id: &str,
        mut event: Event,
    ) -> crate::error::AppResult<()> {
        let config = self.project.read(|p| p.alerts.clone());
        let Some(v) = config
            .types
            .iter()
            .filter(|t| t.kind == event.kind)
            .flat_map(|t| &t.variations)
            .find(|v| v.id == variation_id)
        else {
            return Err(crate::error::AppError::NotFound(
                "That variation no longer exists.".into(),
            ));
        };
        event.id = crate::util::new_id();
        event.ts = crate::util::now_ms();
        event.test = true;
        let vars = self.hub.vars.snapshot();
        let play = render_play(v, &event, &config.settings, &vars);
        self.enqueue(play, v.run_action.clone(), config.settings.max_queue);
        Ok(())
    }

    pub fn replay_last(&self) -> crate::error::AppResult<()> {
        let Some(mut play) = self.state.lock().unwrap().last.clone() else {
            return crate::error::user_err("No alert has played yet.");
        };
        play.id = crate::util::new_id();
        let max = self.project.read(|p| p.alerts.settings.max_queue);
        self.enqueue(play, None, max);
        Ok(())
    }

    /// End the alert on screen now.
    pub fn skip(&self) {
        if self.state.lock().unwrap().playing.is_some() {
            self.skip.notify_one();
        }
    }

    pub fn remove(&self, id: &str) {
        self.state.lock().unwrap().waiting.retain(|w| w.id != id);
        self.pending_actions
            .lock()
            .unwrap()
            .retain(|(pid, _)| pid != id);
        self.emit_state();
    }

    pub fn clear(&self) {
        self.state.lock().unwrap().waiting.clear();
        self.pending_actions.lock().unwrap().clear();
        self.emit_state();
    }

    fn emit_state(&self) {
        let st = self.state.lock().unwrap().clone();
        self.hub.emit_ui(ui::QUEUE, &st);
    }

    fn next(&self) -> Option<AlertPlay> {
        let mut st = self.state.lock().unwrap();
        if st.paused || st.waiting.is_empty() {
            return None;
        }
        let play = st.waiting.remove(0);
        st.playing = Some(play.clone());
        st.last = Some(play.clone());
        Some(if st.muted { silenced(play) } else { play })
    }

    async fn player(self: Arc<Self>) {
        loop {
            let Some(play) = self.next() else {
                self.wake.notified().await;
                continue;
            };
            self.emit_state();
            let run_action = {
                let mut pending = self.pending_actions.lock().unwrap();
                let idx = pending.iter().position(|(id, _)| *id == play.id);
                idx.and_then(|i| pending.remove(i).1)
            };
            self.hub
                .to_overlays(None, OverlayMsg::AlertPlay { play: play.clone() });
            if !play.event.test {
                self.hub.sessions.on_alert(&play.title);
            }
            let _ = self.played.send(Played {
                play: play.clone(),
                run_action,
            });
            let total = play.duration_ms.max(500) + play.exit.duration_ms;
            // Drop a skip pressed for the previous alert (or pressed twice).
            let _ = futures_util::FutureExt::now_or_never(self.skip.notified());
            tokio::select! {
                biased;
                _ = tokio::time::sleep(Duration::from_millis(total as u64)) => {}
                _ = self.skip.notified() => {
                    self.hub.to_overlays(None, OverlayMsg::AlertStop { id: play.id.clone() });
                    // Let the exit animation finish before the next alert starts.
                    tokio::time::sleep(Duration::from_millis(play.exit.duration_ms.min(5000) as u64)).await;
                }
            }
            self.state.lock().unwrap().playing = None;
            self.emit_state();
            let gap = self.project.read(|p| p.alerts.settings.gap_ms);
            tokio::time::sleep(Duration::from_millis(gap as u64)).await;
        }
    }
}

fn silenced(mut play: AlertPlay) -> AlertPlay {
    play.sound.clear();
    play.volume = 0;
    play.tts = false;
    play
}

/// Event fields plus every variable; event fields win on a clash.
fn alert_context(event: &Event, vars: &Map<String, Value>) -> Value {
    let mut ctx = event.as_context();
    if let Value::Object(map) = &mut ctx {
        for (k, v) in vars {
            if !map.contains_key(k) {
                map.insert(k.clone(), v.clone());
            }
        }
    }
    ctx
}

/// Decide whether an event gets an alert and render it. None = no alert.
pub fn build_play(
    config: &AlertConfig,
    event: &Event,
    vars: &Map<String, Value>,
) -> Option<(AlertPlay, Option<String>)> {
    if !event.kind.is_alertable() {
        return None;
    }
    let s = &config.settings;
    match event.kind {
        EventKind::Cheer if (event.amount.unwrap_or(0.0) as u32) < s.min_bits => return None,
        EventKind::Raid if (event.amount.unwrap_or(0.0) as u32) < s.min_raid_viewers => {
            return None;
        }
        EventKind::GiftSub if s.combine_gifts && event.data.contains_key("community_gift_id") => {
            return None;
        }
        EventKind::CommunityGift if !s.combine_gifts => return None,
        _ => {}
    }
    let alert_type = config.type_for(event.kind)?;
    if !alert_type.enabled {
        return None;
    }
    let ctx = alert_context(event, vars);
    let variation = alert_type
        .variations
        .iter()
        .find(|v| v.enabled && v.conditions.evaluate(&ctx))?;
    Some((
        render_play(variation, event, s, vars),
        variation.run_action.clone(),
    ))
}

fn render_play(
    v: &Variation,
    event: &Event,
    s: &AlertSettings,
    vars: &Map<String, Value>,
) -> AlertPlay {
    let mut event = event.clone();
    let mut tts = v.tts;
    if let Some(msg) = &event.message {
        let mut cleaned = if s.hide_links {
            hide_links(msg)
        } else {
            msg.clone()
        };
        if contains_blocked(&cleaned, &s.blocked_words) {
            cleaned.clear();
            tts = false;
        }
        event.message = Some(cleaned);
    }
    let ctx = alert_context(&event, vars);
    AlertPlay {
        id: crate::util::new_id(),
        kind: event.kind,
        variation_id: v.id.clone(),
        priority: v.priority,
        title: render(&v.title, &ctx),
        message: render(&v.message, &ctx),
        image: v.image.clone(),
        video: v.video.clone(),
        sound: v.sound.clone(),
        volume: v.volume.min(100),
        duration_ms: v.duration_ms.clamp(500, 120_000),
        enter: v.enter.clone(),
        exit: v.exit.clone(),
        layout: v.layout,
        title_style: v.title_style.clone(),
        message_style: v.message_style.clone(),
        accent: v.accent.clone(),
        background: v.background.clone(),
        card: v.card.clone(),
        tts,
        event,
    }
}

pub fn contains_blocked(text: &str, words: &[String]) -> bool {
    let lower = text.to_lowercase();
    words
        .iter()
        .map(|w| w.trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .any(|w| lower.contains(&w))
}

/// Replace anything that looks like a web address with "[link]".
pub fn hide_links(text: &str) -> String {
    text.split(' ')
        .map(|word| {
            if looks_like_link(word) {
                "[link]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_link(word: &str) -> bool {
    let w = word
        .trim_matches(|c: char| {
            matches!(
                c,
                '(' | ')' | '[' | ']' | '<' | '>' | '"' | '\'' | ',' | '!' | '?'
            )
        })
        .to_lowercase();
    if w.starts_with("http://") || w.starts_with("https://") || w.starts_with("www.") {
        return true;
    }
    // domain.tld or domain.tld/path, where tld is 2+ letters
    let host = w.split('/').next().unwrap_or("");
    let host = host.trim_end_matches('.');
    let mut parts = host.split('.');
    let (Some(first), Some(_)) = (parts.next(), parts.clone().next()) else {
        return false;
    };
    let tld = host.rsplit('.').next().unwrap_or("");
    !first.is_empty()
        && first.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && tld.len() >= 2
        && tld.chars().all(|c| c.is_ascii_alphabetic())
        && host.split('.').all(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::alert::AlertType;
    use crate::model::condition::{Condition, ConditionGroup, MatchMode, Op};

    fn cfg() -> AlertConfig {
        AlertConfig::starter()
    }

    fn sub(tier: u8) -> Event {
        let mut e = Event::new(EventKind::Sub).with_user("nova", "Nova");
        e.tier = Some(tier);
        e
    }

    #[test]
    fn first_matching_variation_wins() {
        let (p, _) = build_play(&cfg(), &sub(3), &Map::new()).unwrap();
        assert_eq!(p.title, "Nova is a legend!");
        assert_eq!(p.priority, 2);
        let (p, _) = build_play(&cfg(), &sub(1), &Map::new()).unwrap();
        assert_eq!(p.title, "Nova subscribed!");
        assert_eq!(p.message, "Tier 1");
    }

    #[test]
    fn disabled_type_or_variation() {
        let mut c = cfg();
        c.types
            .iter_mut()
            .find(|t| t.kind == EventKind::Sub)
            .unwrap()
            .variations[0]
            .enabled = false;
        assert_eq!(
            build_play(&c, &sub(3), &Map::new()).unwrap().0.title,
            "Nova subscribed!"
        );
        c.types
            .iter_mut()
            .find(|t| t.kind == EventKind::Sub)
            .unwrap()
            .enabled = false;
        assert!(build_play(&c, &sub(3), &Map::new()).is_none());
    }

    #[test]
    fn no_match_means_no_alert() {
        let mut c = cfg();
        c.types = vec![AlertType {
            kind: EventKind::Sub,
            enabled: true,
            variations: vec![Variation {
                conditions: ConditionGroup {
                    mode: MatchMode::All,
                    conditions: vec![Condition {
                        field: "tier".into(),
                        op: Op::Eq,
                        value: 2.into(),
                    }],
                },
                ..Variation::default()
            }],
        }];
        assert!(build_play(&c, &sub(1), &Map::new()).is_none());
    }

    #[test]
    fn chat_and_unconfigured_kinds_never_alert() {
        assert!(build_play(&cfg(), &Event::new(EventKind::Chat), &Map::new()).is_none());
        assert!(build_play(&cfg(), &Event::new(EventKind::PollBegin), &Map::new()).is_none());
    }

    #[test]
    fn gift_combining() {
        let mut c = cfg();
        let mut single = Event::new(EventKind::GiftSub).with_user("a", "A");
        single.data.insert("community_gift_id".into(), "x".into());
        let community = Event::new(EventKind::CommunityGift).with_user("a", "A");
        let direct = Event::new(EventKind::GiftSub).with_user("a", "A");
        assert!(build_play(&c, &single, &Map::new()).is_none());
        assert!(build_play(&c, &community, &Map::new()).is_some());
        assert!(build_play(&c, &direct, &Map::new()).is_some());
        c.settings.combine_gifts = false;
        assert!(build_play(&c, &single, &Map::new()).is_some());
        assert!(build_play(&c, &community, &Map::new()).is_none());
    }

    #[test]
    fn minimums() {
        let mut c = cfg();
        c.settings.min_bits = 100;
        let mut cheer = Event::new(EventKind::Cheer).with_user("a", "A");
        cheer.amount = Some(99.0);
        assert!(build_play(&c, &cheer, &Map::new()).is_none());
        cheer.amount = Some(100.0);
        assert!(build_play(&c, &cheer, &Map::new()).is_some());
    }

    #[test]
    fn message_moderation() {
        let mut c = cfg();
        c.settings.blocked_words = vec!["  BadWord ".into(), "".into()];
        let mut cheer = Event::new(EventKind::Cheer).with_user("a", "A");
        cheer.amount = Some(100.0);
        cheer.message = Some("go to example.com/x now".into());
        let (p, _) = build_play(&c, &cheer, &Map::new()).unwrap();
        assert_eq!(p.message, "go to [link] now");
        cheer.message = Some("you badword".into());
        let (p, _) = build_play(&c, &cheer, &Map::new()).unwrap();
        assert_eq!(p.message, "");
        assert!(!p.tts);
    }

    #[test]
    fn link_detection() {
        for yes in [
            "https://x.y",
            "www.site.org",
            "example.com",
            "Example.COM/path?q",
            "(bit.ly/abc)",
        ] {
            assert!(looks_like_link(yes), "{yes}");
        }
        for no in ["hello", "3.5", "gg.", "...", "e.g.", "v1.2", "a.b1"] {
            assert!(!looks_like_link(no), "{no}");
        }
        assert_eq!(hide_links("a  b"), "a  b");
    }

    #[test]
    fn test_variation_plays_that_variation() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let store = Arc::new(store);
        let ids: Vec<String> = store.read(|p| {
            p.alerts
                .type_for(EventKind::Sub)
                .unwrap()
                .variations
                .iter()
                .map(|v| v.id.clone())
                .collect()
        });
        assert!(ids.len() >= 2, "the starter sub alert has variations");
        let engine = AlertEngine::new(Hub::test(), store);
        engine.set_paused(true);
        // A tier 1 sub would normally play the first variation; the test picks the last.
        let last = ids.last().unwrap();
        engine.test_variation(last, sub(1)).unwrap();
        let q = engine.queue_state();
        assert_eq!(q.waiting.len(), 1);
        assert_eq!(&q.waiting[0].variation_id, last);
        assert!(q.waiting[0].event.test);
        assert!(engine.test_variation("nope", sub(1)).is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn queue_plays_by_priority_then_order() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let hub = Hub::test();
        let engine = AlertEngine::new(hub.clone(), Arc::new(store));
        let mut ov = hub.subscribe_overlays();
        engine.set_paused(true);
        engine.handle_event(&sub(1));
        let mut low = Event::new(EventKind::Follow).with_user("f", "F");
        low.id = "follow".into();
        engine.handle_event(&low);
        engine.handle_event(&sub(3));
        assert_eq!(engine.queue_state().waiting.len(), 3);
        let titles: Vec<_> = engine
            .queue_state()
            .waiting
            .iter()
            .map(|w| w.title.clone())
            .collect();
        assert_eq!(
            titles,
            vec!["Nova is a legend!", "Nova subscribed!", "F followed"]
        );
        engine.start();
        engine.set_paused(false);
        let mut played = Vec::new();
        while played.len() < 3 {
            if let OverlayMsg::AlertPlay { play } = ov.recv().await.unwrap().msg {
                played.push(play.title);
            }
        }
        assert_eq!(played, titles);
    }

    #[tokio::test(start_paused = true)]
    async fn skip_ends_current_alert() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let hub = Hub::test();
        let engine = AlertEngine::new(hub.clone(), Arc::new(store));
        let mut ov = hub.subscribe_overlays();
        engine.start();
        engine.handle_event(&sub(1));
        loop {
            if let OverlayMsg::AlertPlay { .. } = ov.recv().await.unwrap().msg {
                break;
            }
        }
        engine.skip();
        loop {
            if let OverlayMsg::AlertStop { .. } = ov.recv().await.unwrap().msg {
                break;
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn double_skip_does_not_skip_the_next_alert() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let hub = Hub::test();
        let engine = AlertEngine::new(hub.clone(), Arc::new(store));
        let mut ov = hub.subscribe_overlays();
        engine.start();
        engine.handle_event(&sub(1));
        engine.handle_event(&sub(3));
        loop {
            if let OverlayMsg::AlertPlay { .. } = ov.recv().await.unwrap().msg {
                break;
            }
        }
        engine.skip();
        loop {
            if let OverlayMsg::AlertStop { .. } = ov.recv().await.unwrap().msg {
                break;
            }
        }
        // Pressed again during the exit animation.
        engine.skip();
        loop {
            if let OverlayMsg::AlertPlay { .. } = ov.recv().await.unwrap().msg {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        while let Ok(out) = ov.try_recv() {
            assert!(
                !matches!(out.msg, OverlayMsg::AlertStop { .. }),
                "second alert was skipped"
            );
        }
        assert!(
            engine.queue_state().playing.is_some(),
            "second alert still playing"
        );
    }

    fn engine() -> (Arc<AlertEngine>, Arc<Hub>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let hub = Hub::test();
        (AlertEngine::new(hub.clone(), Arc::new(store)), hub, dir)
    }

    async fn next_play(ov: &mut broadcast::Receiver<crate::hub::OverlayOut>) -> AlertPlay {
        loop {
            if let OverlayMsg::AlertPlay { play } = ov.recv().await.unwrap().msg {
                return play;
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn pause_lets_the_current_alert_finish_and_holds_the_rest() {
        let (engine, hub, _dir) = engine();
        let mut ov = hub.subscribe_overlays();
        engine.start();
        engine.handle_event(&sub(3));
        engine.handle_event(&sub(1));
        let first = next_play(&mut ov).await;
        assert_eq!(first.title, "Nova is a legend!");
        engine.set_paused(true);
        tokio::time::sleep(Duration::from_secs(60)).await;
        let st = engine.queue_state();
        assert!(st.playing.is_none(), "first alert finished");
        assert_eq!(st.waiting.len(), 1, "second alert waits");
        while let Ok(out) = ov.try_recv() {
            assert!(!matches!(out.msg, OverlayMsg::AlertPlay { .. }));
        }
        engine.set_paused(false);
        assert_eq!(next_play(&mut ov).await.title, "Nova subscribed!");
    }

    #[tokio::test(start_paused = true)]
    async fn mute_silences_alerts_until_turned_off() {
        let (engine, hub, _dir) = engine();
        let mut ov = hub.subscribe_overlays();
        engine.start();
        engine.set_muted(true).unwrap();
        assert!(engine.queue_state().muted);
        engine.enqueue_custom("quiet", "", "", "assets/ding.mp3", 1000);
        let p = next_play(&mut ov).await;
        assert_eq!((p.sound.as_str(), p.volume, p.tts), ("", 0, false));
        assert_eq!(
            engine.queue_state().last.unwrap().sound,
            "assets/ding.mp3",
            "replay keeps the real sound"
        );
        engine.set_muted(false).unwrap();
        engine.enqueue_custom("loud", "", "", "assets/ding.mp3", 1000);
        let p = next_play(&mut ov).await;
        assert_eq!(p.sound, "assets/ding.mp3");
        assert!(p.volume > 0);
    }

    #[test]
    fn mute_is_saved_and_pause_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        let (first, _, _d) = engine();
        first.use_settings(Arc::new(SettingsStore::open(file.clone())));
        first.set_muted(true).unwrap();
        first.set_paused(true);
        let (after_restart, _, _d2) = engine();
        after_restart.use_settings(Arc::new(SettingsStore::open(file)));
        let st = after_restart.queue_state();
        assert!(st.muted);
        assert!(!st.paused);
    }

    #[tokio::test(start_paused = true)]
    async fn replay_last_queues_the_last_alert_again() {
        let (engine, hub, _dir) = engine();
        let mut ov = hub.subscribe_overlays();
        assert!(engine.replay_last().is_err(), "nothing played yet");
        engine.start();
        engine.handle_event(&sub(1));
        let first = next_play(&mut ov).await;
        engine.replay_last().unwrap();
        let again = next_play(&mut ov).await;
        assert_eq!(again.title, first.title);
        assert_ne!(again.id, first.id);
    }

    #[test]
    fn queue_is_capped() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let engine = AlertEngine::new(Hub::test(), Arc::new(store));
        engine.set_paused(true);
        for _ in 0..5 {
            engine.enqueue_custom("x", "", "", "", 1000);
        }
        let play = build_play(&cfg(), &sub(3), &Map::new()).unwrap().0;
        engine.enqueue(play, None, 3);
        let st = engine.queue_state();
        assert_eq!(st.waiting.len(), 3);
        assert_eq!(st.waiting[0].priority, 2, "high priority alert survives");
    }

    #[test]
    fn alert_text_can_use_variables() {
        let mut c = cfg();
        for v in &mut c
            .types
            .iter_mut()
            .find(|t| t.kind == EventKind::Sub)
            .unwrap()
            .variations
        {
            v.title = "{{name}} is sub #{{session.subs}}".into();
        }
        let mut vars = Map::new();
        vars.insert("session.subs".into(), 7.into());
        vars.insert("name".into(), "not the event".into());
        let (p, _) = build_play(&c, &sub(1), &vars).unwrap();
        assert_eq!(p.title, "Nova is sub #7");
    }

    #[test]
    fn custom_alert_text_is_not_filled_in_twice() {
        let dir = tempfile::tempdir().unwrap();
        let (store, _) = ProjectStore::open(dir.path()).unwrap();
        let engine = AlertEngine::new(Hub::test(), Arc::new(store));
        engine.set_paused(true);
        engine.enqueue_custom("{{kind}} said hi", "{{name}}", "", "", 1000);
        let st = engine.queue_state();
        assert_eq!(st.waiting[0].title, "{{kind}} said hi");
        assert_eq!(st.waiting[0].message, "{{name}}");
    }

    #[test]
    fn samples_cover_every_kind() {
        for k in EventKind::ALL {
            let e = samples::sample_event(k);
            assert!(e.test);
            assert_eq!(e.kind, k);
        }
        let c = cfg();
        for t in &c.types {
            assert!(
                build_play(&c, &samples::sample_event(t.kind), &Map::new()).is_some(),
                "{:?}",
                t.kind
            );
        }
    }
}
