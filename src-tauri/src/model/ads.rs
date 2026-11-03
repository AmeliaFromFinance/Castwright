//! Ad breaks: Twitch's ad schedule and when to give a heads-up about the next ad.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Twitch's ad schedule, plus the ad running right now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
#[serde(default)]
#[ts(export)]
pub struct AdSchedule {
    /// Read from Twitch at least once since the stream went live.
    pub known: bool,
    /// ms since epoch; 0 when no ad is scheduled.
    #[ts(type = "number")]
    pub next_ad_at: i64,
    /// Length of the next ad in seconds.
    pub length_s: u32,
    #[ts(type = "number")]
    pub last_ad_at: i64,
    /// Seconds of preroll-free time left.
    pub preroll_free_s: u32,
    pub snoozes: u32,
    /// When another snooze is added (ms; 0 = unknown).
    #[ts(type = "number")]
    pub snooze_refresh_at: i64,
    /// When the running ad ends (ms); 0 when no ad is running.
    #[ts(type = "number")]
    pub running_until: i64,
    pub running_length_s: u32,
}

/// Two readings closer than this are the same ad. Twitch's times move a little between calls.
pub const SAME_AD_MS: i64 = 30_000;

pub fn same_ad(a: i64, b: i64) -> bool {
    a > 0 && b > 0 && (a - b).abs() < SAME_AD_MS
}

impl AdSchedule {
    pub fn running(&self, now: i64) -> bool {
        self.running_until > now
    }

    /// Whole seconds until the next ad, rounded up. None when none is coming.
    pub fn seconds_to_next(&self, now: i64) -> Option<u32> {
        if self.next_ad_at <= 0 || self.next_ad_at <= now {
            return None;
        }
        Some(((self.next_ad_at - now + 999) / 1000).min(u32::MAX as i64) as u32)
    }

    /// Whole seconds left of the running ad, rounded up.
    pub fn seconds_left_running(&self, now: i64) -> Option<u32> {
        self.running(now)
            .then(|| ((self.running_until - now + 999) / 1000).min(u32::MAX as i64) as u32)
    }
}

/// `75` -> `1:15`, `3725` -> `1:02:05`.
pub fn clock(seconds: u32) -> String {
    let (h, m, s) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// Goes off once per ad, when the ad is `lead_s` or less away.
#[derive(Debug, Default, Clone)]
pub struct AdAlarm {
    fired_for: i64,
}

impl AdAlarm {
    pub fn check(&mut self, s: &AdSchedule, now: i64, lead_s: u32) -> bool {
        let Some(left) = s.seconds_to_next(now) else {
            return false;
        };
        if lead_s == 0 || s.running(now) || left > lead_s || same_ad(self.fired_for, s.next_ad_at) {
            return false;
        }
        self.fired_for = s.next_ad_at;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn sched(next_in_s: i64) -> AdSchedule {
        AdSchedule {
            known: true,
            next_ad_at: NOW + next_in_s * 1000,
            length_s: 90,
            ..AdSchedule::default()
        }
    }

    #[test]
    fn countdown_math() {
        let s = sched(272);
        assert_eq!(s.seconds_to_next(NOW), Some(272));
        assert_eq!(s.seconds_to_next(NOW + 500), Some(272), "rounds up");
        assert_eq!(s.seconds_to_next(NOW + 272_000), None, "due now");
        assert_eq!(AdSchedule::default().seconds_to_next(NOW), None);
        let running = AdSchedule {
            running_until: NOW + 72_000,
            ..sched(900)
        };
        assert!(running.running(NOW));
        assert_eq!(running.seconds_left_running(NOW + 1), Some(72));
        assert_eq!(running.seconds_left_running(NOW + 72_000), None);
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(272), "4:32");
        assert_eq!(clock(3725), "1:02:05");
    }

    #[test]
    fn warns_once_per_ad() {
        let mut a = AdAlarm::default();
        assert!(!a.check(&sched(61), NOW, 60), "too early");
        assert!(a.check(&sched(60), NOW, 60));
        for t in 1..60 {
            assert!(
                !a.check(&sched(60), NOW + t * 1000, 60),
                "no repeat at {t}s"
            );
        }
        // A fresh reading that wobbles a few seconds is the same ad.
        assert!(!a.check(&sched(48), NOW, 60));
        // Snoozed by five minutes: a new ad, warned again when it gets close.
        let snoozed = sched(360);
        assert!(!a.check(&snoozed, NOW, 60));
        assert!(a.check(&snoozed, NOW + 300_000, 60));
    }

    #[test]
    fn no_warning_when_off_running_or_unscheduled() {
        let mut a = AdAlarm::default();
        assert!(!a.check(&sched(30), NOW, 0), "turned off");
        assert!(!a.check(&AdSchedule::default(), NOW, 60));
        let running = AdSchedule {
            running_until: NOW + 10_000,
            ..sched(30)
        };
        assert!(!a.check(&running, NOW, 60));
        assert!(!a.check(&sched(-5), NOW, 60), "already due");
    }
}
