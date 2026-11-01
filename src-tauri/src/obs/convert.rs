//! Small pure helpers: unit conversions, bitrate maths, request payloads.

use crate::model::automation::Toggle;
use serde_json::{Value, json};

/// OBS alignment flags: left = 1, top = 4.
const TOP_LEFT: u8 = 5;

/// dB value used for silence (and the bottom of every fader and meter).
pub const SILENCE_DB: f64 = -100.0;
/// Loudest fader position OBS allows.
pub const MAX_VOLUME_DB: f64 = 26.0;

/// Linear multiplier (0..1, may go above 1 when clipping) to dB.
pub fn mul_to_db(mul: f64) -> f64 {
    if mul.is_nan() || mul <= 0.0 {
        return SILENCE_DB;
    }
    let db = 20.0 * mul.log10();
    if db.is_finite() {
        db.max(SILENCE_DB)
    } else {
        MAX_VOLUME_DB
    }
}

pub fn db_to_mul(db: f64) -> f64 {
    if db.is_nan() || db <= SILENCE_DB {
        return 0.0;
    }
    10f64.powf(db / 20.0)
}

/// Keeps a fader value inside what OBS accepts.
pub fn clamp_volume_db(db: f64) -> f64 {
    if db.is_nan() {
        return SILENCE_DB;
    }
    db.clamp(SILENCE_DB, MAX_VOLUME_DB)
}

/// Peak dB per channel from OBS meter data (`[magnitude, peak, input peak]` per channel).
pub fn meter_peaks(levels: &Value) -> Vec<f64> {
    levels
        .as_array()
        .map(|chs| {
            chs.iter()
                .map(|ch| round1(mul_to_db(ch[1].as_f64().unwrap_or(0.0))))
                .collect()
        })
        .unwrap_or_default()
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

pub fn percent(part: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (part as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
}

/// Works out the stream bitrate from OBS's running total of bytes sent.
#[derive(Debug, Default, Clone)]
pub struct KbpsMeter {
    last: Option<(u64, u64)>,
    kbps: f64,
}

impl KbpsMeter {
    /// `bytes` is the output's total so far, `at_ms` any monotonic clock in ms.
    pub fn update(&mut self, bytes: u64, at_ms: u64) -> f64 {
        match self.last {
            Some((last_bytes, last_ms)) if bytes >= last_bytes && at_ms > last_ms => {
                let secs = (at_ms - last_ms) as f64 / 1000.0;
                self.kbps = (bytes - last_bytes) as f64 * 8.0 / 1000.0 / secs;
            }
            // Same instant: keep the last value.
            Some((last_bytes, last_ms)) if bytes >= last_bytes && at_ms == last_ms => {}
            // First sample, counter reset (stream restarted) or clock went backwards.
            _ => self.kbps = 0.0,
        }
        self.last = Some((bytes, at_ms));
        self.kbps.round()
    }

    pub fn reset(&mut self) {
        *self = KbpsMeter::default();
    }
}

/// What a toggle action should set, given the current state.
pub fn resolve_toggle(state: Toggle, current: bool) -> bool {
    match state {
        Toggle::On => true,
        Toggle::Off => false,
        Toggle::Toggle => !current,
    }
}

/// Settings for a browser source showing an overlay. Audio goes through OBS's mixer and
/// the page keeps running while hidden, so alerts aren't cut off.
pub fn browser_settings(url: &str, width: u32, height: u32) -> Value {
    json!({
        "is_local_file": false,
        "url": url,
        "width": width.max(1),
        "height": height.max(1),
        "reroute_audio": true,
        "shutdown": false,
    })
}

/// Transform that stretches an item over the whole canvas.
pub fn fill_canvas(base_width: u32, base_height: u32) -> Value {
    json!({
        "positionX": 0.0,
        "positionY": 0.0,
        "rotation": 0.0,
        "scaleX": 1.0,
        "scaleY": 1.0,
        "alignment": TOP_LEFT,
        "boundsType": "OBS_BOUNDS_STRETCH",
        "boundsAlignment": TOP_LEFT,
        "boundsWidth": base_width.max(1),
        "boundsHeight": base_height.max(1),
    })
}

/// OBS accepts screenshot sizes from 8 to 4096 pixels.
pub fn screenshot_size(width: u32, base_width: u32, base_height: u32) -> (u32, u32) {
    let w = width.clamp(8, 4096);
    let (bw, bh) = if base_width == 0 || base_height == 0 {
        (16, 9)
    } else {
        (base_width, base_height)
    };
    let h = (f64::from(w) * f64::from(bh) / f64::from(bw)).round() as u32;
    (w, h.clamp(8, 4096))
}

/// OBS numbers scenes and items from the bottom of its list; this gives the on-screen
/// order (top first).
pub fn top_first<T>(mut items: Vec<(usize, T)>) -> Vec<T> {
    items.sort_by_key(|i| std::cmp::Reverse(i.0));
    items.into_iter().map(|(_, t)| t).collect()
}

pub fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "" | "localhost" | "127.0.0.1" | "::1" | "[::1]"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_db_round_trip() {
        assert_eq!(mul_to_db(1.0), 0.0);
        assert!((mul_to_db(0.5) - -6.0206).abs() < 0.001);
        assert!((db_to_mul(-6.0206) - 0.5).abs() < 0.0001);
        for db in [-60.0, -20.0, -3.5, 0.0, 6.0] {
            assert!((mul_to_db(db_to_mul(db)) - db).abs() < 1e-9);
        }
    }

    #[test]
    fn silence_is_minus_100() {
        assert_eq!(mul_to_db(0.0), SILENCE_DB);
        assert_eq!(mul_to_db(-1.0), SILENCE_DB);
        assert_eq!(mul_to_db(f64::NAN), SILENCE_DB);
        assert_eq!(mul_to_db(1e-12), SILENCE_DB, "very quiet is clamped");
        assert_eq!(mul_to_db(f64::INFINITY), MAX_VOLUME_DB);
        assert_eq!(db_to_mul(SILENCE_DB), 0.0);
        assert_eq!(db_to_mul(-500.0), 0.0);
        assert_eq!(db_to_mul(f64::NAN), 0.0);
    }

    #[test]
    fn volume_clamp() {
        assert_eq!(clamp_volume_db(-300.0), SILENCE_DB);
        assert_eq!(clamp_volume_db(40.0), MAX_VOLUME_DB);
        assert_eq!(clamp_volume_db(f64::NAN), SILENCE_DB);
        assert_eq!(clamp_volume_db(-12.5), -12.5);
    }

    #[test]
    fn meter_uses_peak_channel() {
        let peaks = meter_peaks(&json!([[0.1, 1.0, 0.9], [0.0, 0.0, 0.0], [0.2, 0.5, 0.5]]));
        assert_eq!(peaks, vec![0.0, SILENCE_DB, -6.0]);
        assert!(meter_peaks(&json!([])).is_empty());
        assert!(meter_peaks(&Value::Null).is_empty());
        assert_eq!(meter_peaks(&json!([[null, null, null]])), vec![SILENCE_DB]);
    }

    #[test]
    fn kbps_from_byte_counter() {
        let mut m = KbpsMeter::default();
        assert_eq!(
            m.update(1_000, 0),
            0.0,
            "first sample has nothing to compare"
        );
        // 250 000 bytes in 2 s = 1000 kbps
        assert_eq!(m.update(251_000, 2_000), 1000.0);
        assert_eq!(m.update(251_000, 2_000), 1000.0, "same instant keeps value");
        assert_eq!(m.update(251_000, 4_000), 0.0, "nothing sent");
        assert_eq!(m.update(126_000, 6_000), 0.0, "counter reset");
        assert_eq!(m.update(376_000, 8_000), 1000.0, "continues after reset");
        assert_eq!(m.update(400_000, 7_000), 0.0, "clock went backwards");
        m.reset();
        assert_eq!(m.update(5_000_000, 10_000), 0.0);
    }

    #[test]
    fn percentages() {
        assert_eq!(percent(0, 0), 0.0);
        assert_eq!(percent(5, 100), 5.0);
        assert_eq!(percent(200, 100), 100.0);
    }

    #[test]
    fn toggles() {
        assert!(resolve_toggle(Toggle::On, false));
        assert!(resolve_toggle(Toggle::On, true));
        assert!(!resolve_toggle(Toggle::Off, true));
        assert!(!resolve_toggle(Toggle::Off, false));
        assert!(resolve_toggle(Toggle::Toggle, false));
        assert!(!resolve_toggle(Toggle::Toggle, true));
    }

    #[test]
    fn browser_source_settings() {
        let v = browser_settings("http://127.0.0.1:7470/o/abc", 1920, 1080);
        assert_eq!(
            v,
            json!({
                "is_local_file": false,
                "url": "http://127.0.0.1:7470/o/abc",
                "width": 1920,
                "height": 1080,
                "reroute_audio": true,
                "shutdown": false,
            })
        );
        assert_eq!(browser_settings("x", 0, 0)["width"], 1);
    }

    #[test]
    fn fill_transform_json() {
        let v = fill_canvas(1920, 1080);
        assert_eq!(v["positionX"], 0.0);
        assert_eq!(v["positionY"], 0.0);
        assert_eq!(v["scaleX"], 1.0);
        assert_eq!(v["alignment"], 5);
        assert_eq!(v["boundsType"], "OBS_BOUNDS_STRETCH");
        assert_eq!(v["boundsWidth"], 1920);
        assert_eq!(v["boundsHeight"], 1080);
    }

    #[test]
    fn screenshot_keeps_aspect() {
        assert_eq!(screenshot_size(640, 1920, 1080), (640, 360));
        assert_eq!(screenshot_size(300, 1080, 1920), (300, 533));
        assert_eq!(screenshot_size(0, 1920, 1080), (8, 8));
        assert_eq!(screenshot_size(10_000, 1920, 1080), (4096, 2304));
        assert_eq!(
            screenshot_size(320, 0, 0),
            (320, 180),
            "unknown canvas = 16:9"
        );
    }

    #[test]
    fn order_is_top_first() {
        assert_eq!(
            top_first(vec![(0, "c"), (2, "a"), (1, "b")]),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn local_hosts() {
        assert!(is_local_host("127.0.0.1"));
        assert!(is_local_host(" LocalHost "));
        assert!(!is_local_host("192.168.1.20"));
    }
}
