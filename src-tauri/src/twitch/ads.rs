//! Ad schedule, snoozes and the ad break running right now. Castwright never
//! switches OBS scenes for ads: subscribers and Turbo viewers keep watching.

use super::TwitchService;
use super::helix::HelixError;
use super::normalize::{num_of, parse_rfc3339};
use crate::error::{AppError, AppResult};
use crate::hub::{Signal, ui};
use crate::model::ads::{AdSchedule, clock, same_ad};
use crate::model::event::Event;
use crate::model::runtime::{AccountRole, LogLevel};
use reqwest::Method;
use serde_json::{Value, json};
use std::sync::Arc;

/// A time from the ad schedule: RFC 3339, or Unix seconds as a number or string.
fn time_of(v: &Value, key: &str) -> i64 {
    let unix = |n: f64| {
        if n <= 0.0 {
            0
        } else if n < 1e11 {
            (n * 1000.0) as i64
        } else {
            n as i64
        }
    };
    match v.get(key) {
        Some(Value::Number(n)) => unix(n.as_f64().unwrap_or(0.0)),
        Some(Value::String(s)) => {
            let s = s.trim();
            match s.parse::<f64>() {
                Ok(n) => unix(n),
                Err(_) => parse_rfc3339(s).unwrap_or(0),
            }
        }
        _ => 0,
    }
}

fn count(v: &Value, key: &str) -> u32 {
    num_of(v, key).clamp(0.0, u32::MAX as f64) as u32
}

/// `data[0]` of Get Ad Schedule. The running ad isn't part of it, so it's kept from `before`.
pub(crate) fn parse_schedule(v: &Value, before: &AdSchedule) -> AdSchedule {
    let d = TwitchService::first(v).cloned().unwrap_or_default();
    AdSchedule {
        known: true,
        next_ad_at: time_of(&d, "next_ad_at"),
        length_s: count(&d, "duration"),
        last_ad_at: time_of(&d, "last_ad_at"),
        preroll_free_s: count(&d, "preroll_free_time"),
        snoozes: count(&d, "snooze_count"),
        snooze_refresh_at: time_of(&d, "snooze_refresh_at"),
        running_until: before.running_until,
        running_length_s: before.running_length_s,
    }
}

/// Schedule after a snooze: Twitch answers with the new ad time and snoozes left.
pub(crate) fn apply_snooze(v: &Value, before: &AdSchedule) -> AdSchedule {
    let d = TwitchService::first(v).cloned().unwrap_or_default();
    let mut s = before.clone();
    let next = time_of(&d, "next_ad_at");
    if next > 0 {
        s.next_ad_at = next;
    }
    s.snoozes = count(&d, "snooze_count");
    let refresh = time_of(&d, "snooze_refresh_at");
    if refresh > 0 {
        s.snooze_refresh_at = refresh;
    }
    s
}

/// Schedule once an ad starts at `started` (ms) for `length_s` seconds.
pub(crate) fn begin_ad(before: &AdSchedule, started: i64, length_s: u32) -> AdSchedule {
    let mut s = before.clone();
    s.running_until = started + length_s as i64 * 1000;
    s.running_length_s = length_s;
    s.last_ad_at = started;
    if s.next_ad_at > 0 && (same_ad(s.next_ad_at, started) || s.next_ad_at <= s.running_until) {
        s.next_ad_at = 0;
    }
    s
}

fn snooze_error(e: HelixError) -> AppError {
    let msg = e.message().to_lowercase();
    match e.status() {
        Some(429) => {
            AppError::Twitch("No snoozes left right now. Twitch adds one back every hour.".into())
        }
        Some(401 | 403) if msg.contains("scope") || msg.contains("authorization") => {
            AppError::Twitch(
                "Snoozing ads needs a newer sign-in. Sign out and in again in Settings → Twitch."
                    .into(),
            )
        }
        Some(400) if !e.message().is_empty() => {
            AppError::Twitch(format!("Couldn't snooze the ad: {}", e.message()))
        }
        _ => e.into_app("snooze ads"),
    }
}

impl TwitchService {
    pub fn ad_schedule(&self) -> AdSchedule {
        self.state.lock().unwrap().ads.clone()
    }

    /// Changes the schedule and tells the app, overlays and automation.
    pub(crate) fn set_ads(&self, s: AdSchedule) {
        let changed = {
            let mut st = self.state.lock().unwrap();
            let changed = st.ads != s;
            st.ads = s.clone();
            changed
        };
        if !changed {
            return;
        }
        self.hub.emit_ui(ui::ADS, &s);
        let now = crate::util::now_ms();
        let values = [
            ("ads.next_at", json!(s.next_ad_at)),
            ("ads.length_s", json!(s.length_s)),
            ("ads.running", json!(s.running(now))),
            ("ads.ends_at", json!(s.running_until)),
            ("ads.running_length_s", json!(s.running_length_s)),
            ("ads.snoozes", json!(s.snoozes)),
        ];
        for (k, v) in values {
            self.hub.set_var(k, v, false);
        }
        self.hub.signal(Signal::AdSchedule(s));
    }

    /// Reads the schedule again soon (after a snooze, an ad or going live).
    pub(crate) fn poke_ads(&self) {
        self.ads_poke.notify_one();
    }

    pub(crate) async fn fetch_ads(&self) -> Result<AdSchedule, HelixError> {
        let id = self.broadcaster_id().ok_or(HelixError::NotSignedIn)?;
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::GET,
                "/channels/ads",
                &[("broadcaster_id", id)],
                None,
            )
            .await?;
        Ok(parse_schedule(&v, &self.ad_schedule()))
    }

    async fn refresh_ads(&self) {
        match self.fetch_ads().await {
            Ok(s) => {
                let was_failing =
                    std::mem::replace(&mut self.state.lock().unwrap().ads_failing, false);
                if was_failing {
                    self.hub
                        .log(LogLevel::Info, "twitch", "Ad schedule is updating again");
                }
                self.set_ads(s);
            }
            Err(e) => {
                let first = !std::mem::replace(&mut self.state.lock().unwrap().ads_failing, true);
                if first {
                    self.hub.log(
                        LogLevel::Warn,
                        "twitch",
                        format!(
                            "Couldn't read the ad schedule: {}",
                            e.explain("read the ad schedule")
                        ),
                    );
                }
            }
        }
    }

    /// Snoozes the next ad by 5 minutes and returns the new schedule.
    pub async fn snooze_ad(&self) -> AppResult<AdSchedule> {
        let id = self.require_broadcaster()?;
        let v = self
            .helix(
                AccountRole::Broadcaster,
                Method::POST,
                "/channels/ads/schedule/snooze",
                &[("broadcaster_id", id)],
                None,
            )
            .await
            .map_err(snooze_error)?;
        let s = apply_snooze(&v, &self.ad_schedule());
        self.set_ads(s.clone());
        self.hub.log(
            LogLevel::Info,
            "twitch",
            format!("Snoozed the next ad. {} snoozes left", s.snoozes),
        );
        self.poke_ads();
        Ok(s)
    }

    /// An ad started (EventSub `channel.ad_break.begin`).
    pub(crate) fn on_ad_begin(&self, e: &Event) {
        let length = e.amount.unwrap_or(0.0).clamp(0.0, 600.0) as u32;
        let now = crate::util::now_ms();
        // The message time is when the ad began; a late delivery shouldn't make it end early.
        let started = if (now - e.ts).abs() < 60_000 {
            e.ts
        } else {
            now
        };
        let s = begin_ad(&self.ad_schedule(), started, length);
        self.set_ads(s);
        self.hub.signal(Signal::AdBegin { length_s: length });
        self.hub.log(
            LogLevel::Info,
            "twitch",
            format!("Ad break started ({})", clock(length)),
        );
        self.poke_ads();
    }

    /// Ends a finished ad and warns about the next one. Runs every second while live.
    pub(crate) fn ads_tick(&self, now: i64) {
        let s = self.ad_schedule();
        if s.running_until > 0 && now >= s.running_until {
            let length = s.running_length_s;
            let mut next = s.clone();
            next.running_until = 0;
            next.running_length_s = 0;
            self.set_ads(next);
            self.hub.signal(Signal::AdEnd { length_s: length });
            self.hub.log(LogLevel::Info, "twitch", "Ad break ended");
            self.poke_ads();
            return;
        }
        let lead = self.settings.get().ads.lead_s();
        let warn = self.state.lock().unwrap().ad_alarm.check(&s, now, lead);
        if warn {
            self.hub.emit_ui(ui::AD_WARNING, &s);
        }
    }

    pub(crate) async fn ads_loop(self: Arc<Self>) {
        let mut last_read: Option<tokio::time::Instant> = None;
        loop {
            let poked = tokio::select! {
                _ = tokio::time::sleep(self.timing.ads_tick) => false,
                _ = self.ads_poke.notified() => true,
            };
            if !self.status().stream.live {
                if last_read.take().is_some() || self.ad_schedule() != AdSchedule::default() {
                    self.set_ads(AdSchedule::default());
                }
                continue;
            }
            let due = poked || last_read.is_none_or(|t| t.elapsed() >= self.timing.ads_poll);
            if due {
                last_read = Some(tokio::time::Instant::now());
                self.refresh_ads().await;
            }
            self.ads_tick(crate::util::now_ms());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_schedule_in_any_time_format() {
        let rfc = json!({"data": [{
            "next_ad_at": "2024-01-01T00:04:32Z", "last_ad_at": "2024-01-01T00:00:00Z",
            "duration": 90, "preroll_free_time": 600, "snooze_count": 2,
            "snooze_refresh_at": "2024-01-01T01:00:00Z"
        }]});
        let running = AdSchedule {
            running_until: 5,
            running_length_s: 30,
            ..AdSchedule::default()
        };
        let s = parse_schedule(&rfc, &running);
        assert!(s.known);
        assert_eq!(s.next_ad_at, 1_704_067_472_000);
        assert_eq!(s.last_ad_at, 1_704_067_200_000);
        assert_eq!((s.length_s, s.preroll_free_s, s.snoozes), (90, 600, 2));
        assert_eq!(s.snooze_refresh_at, 1_704_070_800_000);
        assert_eq!(
            (s.running_until, s.running_length_s),
            (5, 30),
            "running ad kept"
        );

        let unix = json!({"data": [{
            "next_ad_at": "1704067472", "last_ad_at": 1704067200, "duration": "60",
            "preroll_free_time": "0", "snooze_count": "3", "snooze_refresh_at": 0
        }]});
        let s = parse_schedule(&unix, &AdSchedule::default());
        assert_eq!(s.next_ad_at, 1_704_067_472_000);
        assert_eq!(s.last_ad_at, 1_704_067_200_000);
        assert_eq!((s.length_s, s.snoozes, s.snooze_refresh_at), (60, 3, 0));

        let none = parse_schedule(
            &json!({"data": [{"next_ad_at": "", "duration": 0}]}),
            &AdSchedule::default(),
        );
        assert_eq!(none.next_ad_at, 0);
        assert!(none.known);
        assert_eq!(
            parse_schedule(&json!({}), &AdSchedule::default()).next_ad_at,
            0
        );
    }

    #[test]
    fn snooze_and_ad_start_update_the_schedule() {
        let before = AdSchedule {
            known: true,
            next_ad_at: 1_000_000,
            length_s: 90,
            snoozes: 3,
            snooze_refresh_at: 9,
            ..AdSchedule::default()
        };
        let v = json!({"data": [{"snooze_count": "2", "snooze_refresh_at": "2024-01-01T01:00:00Z",
                                  "next_ad_at": "2024-01-01T00:09:32Z"}]});
        let s = apply_snooze(&v, &before);
        assert_eq!(s.snoozes, 2);
        assert_eq!(s.next_ad_at, 1_704_067_772_000);
        assert_eq!(s.snooze_refresh_at, 1_704_070_800_000);
        assert_eq!(s.length_s, 90);

        let s = begin_ad(&before, 1_005_000, 90);
        assert_eq!(s.running_until, 1_095_000);
        assert_eq!(s.running_length_s, 90);
        assert_eq!(s.next_ad_at, 0, "the scheduled ad is the one running");
        let later = AdSchedule {
            next_ad_at: 5_000_000,
            ..before
        };
        assert_eq!(
            begin_ad(&later, 1_005_000, 30).next_ad_at,
            5_000_000,
            "a manual ad keeps the next one"
        );
    }
}
