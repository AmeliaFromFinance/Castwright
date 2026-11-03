//! Ad schedule, snoozes and commercials against the mock Twitch server.

use super::*;
use crate::hub::{RecordingUi, Signal};
use crate::model::ads::AdSchedule;
use crate::store::db::Db;
use crate::vars::Vars;

const NEXT_AD: &str = "2030-01-01T00:04:32Z";
const NEXT_AD_MS: i64 = 1_893_456_272_000;

/// Replies for the ad endpoints, or None to fall through.
pub(super) fn reply_for(m: &mut Mock, rec: &Rec, path: &str) -> Option<Response> {
    let r = match (rec.method.as_str(), path) {
        ("GET", "/channels/ads") => reply(
            200,
            json!({"data": [{"next_ad_at": NEXT_AD, "last_ad_at": "2030-01-01T00:00:00Z",
                             "duration": 90, "preroll_free_time": 420,
                             "snooze_count": m.snoozes, "snooze_refresh_at": "2030-01-01T01:00:00Z"}]}),
        ),
        ("POST", "/channels/ads/schedule/snooze") if m.no_ads_scope => reply(
            401,
            json!({"error": "Unauthorized", "status": 401,
                   "message": "Missing scope: channel:manage:ads"}),
        ),
        ("POST", "/channels/ads/schedule/snooze") if m.snoozes == 0 => reply(
            429,
            json!({"error": "Too Many Requests", "status": 429, "message": "No snoozes left"}),
        ),
        ("POST", "/channels/ads/schedule/snooze") => {
            m.snoozes -= 1;
            reply(
                200,
                json!({"data": [{"snooze_count": m.snoozes,
                                 "snooze_refresh_at": "2030-01-01T01:00:00Z",
                                 "next_ad_at": "2030-01-01T00:09:32Z"}]}),
            )
        }
        ("POST", "/channels/commercial") => reply(
            200,
            json!({"data": [{"length": rec.json()["length"], "message": "", "retry_after": 480}]}),
        ),
        _ => return None,
    };
    Some(r)
}

struct Ads {
    svc: Arc<TwitchService>,
    hub: Arc<Hub>,
    ui: Arc<RecordingUi>,
    settings: Arc<SettingsStore>,
    _dir: tempfile::TempDir,
}

fn ads_setup(mock: &MockServer) -> Ads {
    let dir = tempfile::tempdir().unwrap();
    let settings = Arc::new(SettingsStore::open(dir.path().join("settings.json")));
    settings
        .update(|s| s.twitch.client_id = "cid".into())
        .unwrap();
    let secrets = Arc::new(Secrets::in_memory());
    broadcaster(&secrets);
    let ui = Arc::new(RecordingUi::default());
    let hub = Hub::new(
        ui.clone(),
        Arc::new(Vars::new()),
        Arc::new(Db::open_in_memory()),
    );
    let endpoints = TwitchEndpoints {
        id_base: mock.base.clone(),
        helix_base: format!("{}/helix", mock.base),
        eventsub_url: "ws://127.0.0.1:1".into(),
    };
    let svc = TwitchService::build(hub.clone(), secrets, settings.clone(), endpoints, fast());
    Ads {
        svc,
        hub,
        ui,
        settings,
        _dir: dir,
    }
}

fn sent(ui: &RecordingUi, name: &str) -> Vec<Value> {
    ui.0.lock()
        .unwrap()
        .iter()
        .filter(|(n, _)| n == name)
        .map(|(_, v)| v.clone())
        .collect()
}

#[tokio::test]
async fn reads_the_schedule_and_snoozes() {
    let mock = MockServer::start().await;
    mock.set(|m| m.snoozes = 2);
    let a = ads_setup(&mock);
    let mut signals = a.hub.subscribe_signals();

    let s = a.svc.fetch_ads().await.unwrap();
    assert_eq!(s.next_ad_at, NEXT_AD_MS);
    assert_eq!((s.length_s, s.preroll_free_s, s.snoozes), (90, 420, 2));
    let get = mock.requests("GET", "/helix/channels/ads").pop().unwrap();
    assert_eq!(get.query["broadcaster_id"], "1337");

    let s = a.svc.snooze_ad().await.unwrap();
    assert_eq!(s.snoozes, 1);
    assert_eq!(s.next_ad_at, NEXT_AD_MS + 300_000);
    let post = mock
        .requests("POST", "/helix/channels/ads/schedule/snooze")
        .pop()
        .unwrap();
    assert_eq!(post.query["broadcaster_id"], "1337");
    assert_eq!(post.auth, "Bearer access-b");
    assert_eq!(a.svc.ad_schedule(), s);
    assert_eq!(
        sent(&a.ui, crate::hub::ui::ADS).last(),
        Some(&serde_json::to_value(&s).unwrap())
    );
    assert_eq!(
        a.hub.vars.get("ads.next_at"),
        Some(json!(NEXT_AD_MS + 300_000))
    );
    assert_eq!(a.hub.vars.get("ads.snoozes"), Some(json!(1)));
    assert!(matches!(signals.try_recv(), Ok(Signal::AdSchedule(x)) if x == s));

    a.svc.snooze_ad().await.unwrap();
    let err = a.svc.snooze_ad().await.unwrap_err().to_string();
    assert!(err.contains("No snoozes left"), "{err}");

    mock.set(|m| m.no_ads_scope = true);
    let err = a.svc.snooze_ad().await.unwrap_err().to_string();
    assert!(err.contains("Sign out and in again"), "{err}");
}

#[tokio::test]
async fn runs_a_commercial_of_a_twitch_length() {
    let mock = MockServer::start().await;
    let a = ads_setup(&mock);
    a.svc.run_ad(65).await.unwrap();
    a.svc.run_ad(500).await.unwrap();
    let lengths: Vec<Value> = mock
        .requests("POST", "/helix/channels/commercial")
        .iter()
        .map(|r| r.json())
        .collect();
    assert_eq!(
        lengths,
        vec![
            json!({"broadcaster_id": "1337", "length": 60}),
            json!({"broadcaster_id": "1337", "length": 180})
        ]
    );
}

#[tokio::test]
async fn ad_break_begins_and_ends() {
    let mock = MockServer::start().await;
    let a = ads_setup(&mock);
    let mut signals = a.hub.subscribe_signals();
    let now = crate::util::now_ms();
    let mut e = crate::model::event::Event::new(EventKind::AdBreak);
    e.amount = Some(30.0);
    e.ts = now;
    a.svc.on_ad_begin(&e);
    let s = a.svc.ad_schedule();
    assert_eq!(s.running_until, now + 30_000);
    assert!(s.running(now));
    assert_eq!(a.hub.vars.get("ads.running"), Some(json!(true)));
    let got: Vec<Signal> = std::iter::from_fn(|| signals.try_recv().ok()).collect();
    assert!(got.contains(&Signal::AdBegin { length_s: 30 }), "{got:?}");

    a.svc.ads_tick(now + 29_000);
    assert!(a.svc.ad_schedule().running_until > 0, "still running");
    a.svc.ads_tick(now + 30_000);
    assert_eq!(a.svc.ad_schedule().running_until, 0);
    assert_eq!(a.hub.vars.get("ads.running"), Some(json!(false)));
    let got: Vec<Signal> = std::iter::from_fn(|| signals.try_recv().ok()).collect();
    assert!(got.contains(&Signal::AdEnd { length_s: 30 }), "{got:?}");
}

#[tokio::test]
async fn warns_once_before_each_ad() {
    let mock = MockServer::start().await;
    let a = ads_setup(&mock);
    let now = crate::util::now_ms();
    a.svc.set_ads(AdSchedule {
        known: true,
        next_ad_at: now + 90_000,
        length_s: 60,
        ..AdSchedule::default()
    });
    let warnings = || sent(&a.ui, crate::hub::ui::AD_WARNING).len();
    a.svc.ads_tick(now);
    assert_eq!(warnings(), 0, "default lead is one minute");
    for t in (30..=89).map(|s| now + s * 1000) {
        a.svc.ads_tick(t);
    }
    assert_eq!(warnings(), 1, "once, not every second");

    a.settings.update(|s| s.ads.warn = false).unwrap();
    a.svc.set_ads(AdSchedule {
        known: true,
        next_ad_at: now + 400_000,
        length_s: 60,
        ..AdSchedule::default()
    });
    a.svc.ads_tick(now + 350_000);
    assert_eq!(warnings(), 1, "turned off");

    a.settings
        .update(|s| {
            s.ads.warn = true;
            s.ads.warn_minutes = 5;
        })
        .unwrap();
    a.svc.ads_tick(now + 110_000);
    assert_eq!(warnings(), 2, "five minutes ahead");
    a.svc.ads_tick(now + 111_000);
    assert_eq!(warnings(), 2);
}
