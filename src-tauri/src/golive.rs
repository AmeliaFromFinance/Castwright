//! The go-live check: quick tests for the usual reasons a stream starts broken.

use crate::core::Core;
use crate::error::AppResult;
use crate::hub::ui;
use crate::model::runtime::{ConnState, ServerInfo, TwitchStatus};
use crate::obs::BrowserSource;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use ts_rs::TS;

/// OBS gets this long to answer before its checks are left out.
const OBS_WAIT: Duration = Duration::from_secs(4);
/// Name prefix "Add to OBS" gives browser sources.
const SOURCE_PREFIX: &str = "Castwright · ";
const DISK_FAIL_MB: f64 = 1024.0;
const DISK_WARN_MB: f64 = 5.0 * 1024.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
}

/// What the button next to a check does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum CheckFix {
    ConnectObs,
    StartServer,
    ResumeAlerts,
    UnmuteAlerts,
    FixOverlayLink {
        input: String,
        overlay_id: String,
    },
    ReloadSource {
        input: String,
    },
    /// Handled by the app window: `settings:obs`, `settings:twitch`, `settings:server`,
    /// `overlays` or `activity`.
    Open {
        place: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Check {
    pub id: String,
    pub label: String,
    pub status: CheckStatus,
    pub detail: String,
    pub fix: Option<CheckFix>,
}

#[derive(Debug, Clone, Default)]
pub struct CheckInput {
    pub obs: ConnState,
    pub obs_version: String,
    pub obs_error: Option<String>,
    /// None when OBS isn't connected or didn't answer.
    pub browser_sources: Option<Vec<BrowserSource>>,
    pub disk_free_mb: Option<f64>,
    /// (id, name) of every overlay in the project.
    pub overlays: Vec<(String, String)>,
    pub server: ServerInfo,
    /// Open overlay pages per overlay id.
    pub open_pages: HashMap<String, usize>,
    pub twitch: TwitchStatus,
    pub required_scopes: Vec<String>,
    pub alerts_paused: bool,
    pub alerts_muted: bool,
}

fn check(id: &str, label: &str, status: CheckStatus, detail: impl Into<String>) -> Check {
    Check {
        id: id.into(),
        label: label.into(),
        status,
        detail: detail.into(),
        fix: None,
    }
}

impl Check {
    fn fix(mut self, fix: CheckFix) -> Self {
        self.fix = Some(fix);
        self
    }
}

fn open(place: &str) -> CheckFix {
    CheckFix::Open {
        place: place.into(),
    }
}

/// Overlay id, port and token from an overlay link. None for other addresses.
fn overlay_link(url: &str) -> Option<(String, u16, String)> {
    let u = url::Url::parse(url).ok()?;
    let mut path = u.path_segments()?;
    if path.next()? != "overlay" {
        return None;
    }
    let id = path.next().filter(|s| !s.is_empty())?.to_string();
    let token = u
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    Some((id, u.port_or_known_default()?, token))
}

fn overlay_checks(i: &CheckInput) -> Vec<Check> {
    let Some(sources) = &i.browser_sources else {
        return vec![check(
            "overlays",
            "Overlays in OBS",
            CheckStatus::Warn,
            "Connect OBS to check them.",
        )];
    };
    let mut out = Vec::new();
    for src in sources {
        let link = overlay_link(&src.url);
        let by_link = link
            .as_ref()
            .and_then(|(id, ..)| i.overlays.iter().find(|(oid, _)| oid == id));
        let by_name = src
            .name
            .strip_prefix(SOURCE_PREFIX)
            .and_then(|n| i.overlays.iter().find(|(_, name)| name == n));
        let id = format!("overlay:{}", src.name);
        let Some((overlay_id, overlay_name)) = by_link.or(by_name) else {
            let ours = link.as_ref().is_some_and(|(_, _, token)| !token.is_empty())
                || src.name.starts_with(SOURCE_PREFIX);
            if ours {
                out.push(check(
                    &id,
                    &src.name,
                    CheckStatus::Fail,
                    "Points at an overlay that no longer exists. Remove it in OBS.",
                ));
            }
            continue;
        };
        let label = format!("{overlay_name} in OBS");
        let link_ok = link.as_ref().is_some_and(|(lid, port, token)| {
            lid == overlay_id && *port == i.server.port && *token == i.server.token
        });
        let c = if !i.server.running {
            check(
                &id,
                &label,
                CheckStatus::Fail,
                "Can't load while the overlay server is off.",
            )
        } else if !link_ok {
            check(
                &id,
                &label,
                CheckStatus::Fail,
                format!("\"{}\" has an old link (port or secret changed).", src.name),
            )
            .fix(CheckFix::FixOverlayLink {
                input: src.name.clone(),
                overlay_id: overlay_id.clone(),
            })
        } else if i.open_pages.get(overlay_id).copied().unwrap_or(0) == 0 {
            check(
                &id,
                &label,
                CheckStatus::Warn,
                format!(
                    "\"{}\" isn't loaded. It may be hidden or in a scene OBS hasn't opened.",
                    src.name
                ),
            )
            .fix(CheckFix::ReloadSource {
                input: src.name.clone(),
            })
        } else {
            check(&id, &label, CheckStatus::Pass, "Loaded")
        };
        out.push(c);
    }
    if out.is_empty() {
        out.push(
            check(
                "overlays",
                "Overlays in OBS",
                CheckStatus::Warn,
                "No Castwright overlays found in OBS. Use Add to OBS on the Overlays page.",
            )
            .fix(open("overlays")),
        );
    }
    out
}

fn twitch_check(i: &CheckInput) -> Check {
    let tw = &i.twitch;
    let Some(account) = &tw.broadcaster else {
        return check("twitch", "Twitch", CheckStatus::Fail, "Not signed in.")
            .fix(open("settings:twitch"));
    };
    // An empty list means Twitch didn't say, so don't guess.
    let missing: Vec<&str> = if account.scopes.is_empty() {
        Vec::new()
    } else {
        i.required_scopes
            .iter()
            .filter(|s| !account.scopes.contains(s))
            .map(String::as_str)
            .collect()
    };
    let interact_only = missing
        .iter()
        .all(|s| crate::twitch::auth::INTERACT_SCOPES.contains(s));
    if !missing.is_empty() && !interact_only {
        return check(
            "twitch",
            "Twitch",
            CheckStatus::Fail,
            format!(
                "Missing permissions: {}. Sign out and in again.",
                missing.join(", ")
            ),
        )
        .fix(open("settings:twitch"));
    }
    if !missing.is_empty() {
        return check(
            "twitch",
            "Twitch",
            CheckStatus::Warn,
            "Signed in before channel points, polls and predictions were added. \
             Sign out and in again to use them.",
        )
        .fix(open("settings:twitch"));
    }
    if !tw.failed_subscriptions.is_empty() {
        return check(
            "twitch",
            "Twitch",
            CheckStatus::Warn,
            format!(
                "Twitch refused some events: {}. Sign out and in again.",
                tw.failed_subscriptions.join(", ")
            ),
        )
        .fix(open("settings:twitch"));
    }
    if tw.eventsub != ConnState::Connected {
        return check(
            "twitch",
            "Twitch",
            CheckStatus::Warn,
            "Signed in, but not receiving events right now.",
        )
        .fix(open("settings:twitch"));
    }
    check(
        "twitch",
        "Twitch",
        CheckStatus::Pass,
        format!("Signed in as {}", account.display_name),
    )
}

pub fn evaluate(i: &CheckInput) -> Vec<Check> {
    let mut out = Vec::new();

    out.push(match i.obs {
        ConnState::Connected => check(
            "obs",
            "OBS",
            CheckStatus::Pass,
            format!("Connected to OBS {}", i.obs_version),
        ),
        ConnState::Connecting => check("obs", "OBS", CheckStatus::Warn, "Connecting…"),
        _ => check(
            "obs",
            "OBS",
            CheckStatus::Fail,
            i.obs_error
                .clone()
                .unwrap_or_else(|| "Not connected.".into()),
        )
        .fix(CheckFix::ConnectObs),
    });

    out.extend(overlay_checks(i));

    out.push(match (&i.server.running, &i.server.error) {
        (true, None) => check(
            "server",
            "Overlay server",
            CheckStatus::Pass,
            format!("Running at {}", i.server.base_url),
        ),
        (true, Some(e)) => check("server", "Overlay server", CheckStatus::Warn, e.clone())
            .fix(CheckFix::StartServer),
        (false, e) => check(
            "server",
            "Overlay server",
            CheckStatus::Fail,
            e.clone().unwrap_or_else(|| "Stopped.".into()),
        )
        .fix(CheckFix::StartServer),
    });

    out.push(twitch_check(i));
    if i.twitch.broadcaster.is_some() {
        let s = &i.twitch.stream;
        out.push(if s.title.trim().is_empty() {
            check("title", "Stream title", CheckStatus::Fail, "No title set.").fix(open("activity"))
        } else {
            check("title", "Stream title", CheckStatus::Pass, s.title.trim())
        });
        out.push(if s.category.trim().is_empty() {
            check(
                "category",
                "Category",
                CheckStatus::Fail,
                "No category set.",
            )
            .fix(open("activity"))
        } else {
            check("category", "Category", CheckStatus::Pass, s.category.trim())
        });
    }

    out.push(if i.alerts_paused {
        check(
            "alerts_paused",
            "Alerts",
            CheckStatus::Fail,
            "Paused. New alerts wait in the queue.",
        )
        .fix(CheckFix::ResumeAlerts)
    } else {
        check("alerts_paused", "Alerts", CheckStatus::Pass, "Playing")
    });
    out.push(if i.alerts_muted {
        check(
            "alerts_muted",
            "Alert sound",
            CheckStatus::Warn,
            "Muted. Alerts play without sound.",
        )
        .fix(CheckFix::UnmuteAlerts)
    } else {
        check("alerts_muted", "Alert sound", CheckStatus::Pass, "On")
    });

    if let Some(mb) = i.disk_free_mb.filter(|mb| *mb > 0.0) {
        let gb = format!("{:.1} GB free", mb / 1024.0);
        let status = if mb < DISK_FAIL_MB {
            CheckStatus::Fail
        } else if mb < DISK_WARN_MB {
            CheckStatus::Warn
        } else {
            CheckStatus::Pass
        };
        out.push(check("disk", "Recording space", status, gb));
    }
    out
}

async fn obs_answer<T>(f: impl Future<Output = AppResult<T>>) -> Option<T> {
    tokio::time::timeout(OBS_WAIT, f).await.ok()?.ok()
}

pub async fn gather(core: &Core) -> CheckInput {
    let snap = core.obs.snapshot();
    let (browser_sources, disk_free_mb) = if snap.state == ConnState::Connected {
        tokio::join!(
            obs_answer(core.obs.browser_sources()),
            obs_answer(core.obs.disk_free_mb())
        )
    } else {
        (None, None)
    };
    let overlays = core.project.read(|p| {
        p.overlays
            .iter()
            .map(|o| (o.id.clone(), o.name.clone()))
            .collect::<Vec<_>>()
    });
    let open_pages = overlays
        .iter()
        .map(|(id, _)| (id.clone(), core.server.overlay_clients(id)))
        .collect();
    let queue = core.alerts.queue_state();
    CheckInput {
        obs: snap.state,
        obs_version: snap.obs_version,
        obs_error: snap.error,
        browser_sources,
        disk_free_mb,
        overlays,
        server: core.server.info(),
        open_pages,
        twitch: core.twitch.status(),
        required_scopes: crate::twitch::auth::BROADCASTER_SCOPES
            .iter()
            .map(|s| s.to_string())
            .collect(),
        alerts_paused: queue.paused,
        alerts_muted: queue.muted,
    }
}

pub async fn fix(core: &Core, fix: CheckFix) -> AppResult<()> {
    match fix {
        CheckFix::ConnectObs => core.obs.connect().await,
        CheckFix::StartServer => {
            let s = core.settings.get().server;
            let info = core.server.start(s.port, s.allow_lan).await;
            core.hub.emit_ui(ui::SERVER, &info);
            match info.error {
                Some(e) if !info.running => crate::error::user_err(e),
                _ => Ok(()),
            }
        }
        CheckFix::ResumeAlerts => {
            core.alerts.set_paused(false);
            Ok(())
        }
        CheckFix::UnmuteAlerts => core.alerts.set_muted(false),
        CheckFix::FixOverlayLink { input, overlay_id } => {
            let url = core.server.overlay_url(&overlay_id).ok_or_else(|| {
                crate::error::AppError::User("The overlay server isn't running.".into())
            })?;
            core.obs.set_browser_url(&input, &url).await
        }
        CheckFix::ReloadSource { input } => core.obs.reload_browser(&input).await,
        CheckFix::Open { .. } => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::runtime::{StreamInfo, TwitchAccount};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn url(id: &str, port: u16, token: &str) -> String {
        format!("http://127.0.0.1:{port}/overlay/{id}?token={token}")
    }

    fn src(name: &str, url: &str) -> BrowserSource {
        BrowserSource {
            name: name.into(),
            url: url.into(),
        }
    }

    /// Everything fine: OBS, one loaded overlay, Twitch, server, alerts.
    fn good() -> CheckInput {
        CheckInput {
            obs: ConnState::Connected,
            obs_version: "32.0.1".into(),
            browser_sources: Some(vec![
                src("Castwright · HUD", &url("hud", 7470, TOKEN)),
                src("Weather widget", "https://example.com/w"),
            ]),
            disk_free_mb: Some(200_000.0),
            overlays: vec![("hud".into(), "HUD".into())],
            server: ServerInfo {
                running: true,
                port: 7470,
                base_url: "http://127.0.0.1:7470".into(),
                token: TOKEN.into(),
                ..ServerInfo::default()
            },
            open_pages: HashMap::from([("hud".into(), 1)]),
            twitch: TwitchStatus {
                broadcaster: Some(TwitchAccount {
                    display_name: "Nova".into(),
                    scopes: vec!["bits:read".into(), "user:read:chat".into()],
                    ..TwitchAccount::default()
                }),
                eventsub: ConnState::Connected,
                stream: StreamInfo {
                    title: "Ranked".into(),
                    category: "Celeste".into(),
                    ..StreamInfo::default()
                },
                ..TwitchStatus::default()
            },
            required_scopes: vec!["bits:read".into(), "user:read:chat".into()],
            ..CheckInput::default()
        }
    }

    fn find<'a>(checks: &'a [Check], id: &str) -> &'a Check {
        checks
            .iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("no {id} in {checks:#?}"))
    }

    #[test]
    fn all_good_passes() {
        let checks = evaluate(&good());
        let ids: Vec<_> = checks.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "obs",
                "overlay:Castwright · HUD",
                "server",
                "twitch",
                "title",
                "category",
                "alerts_paused",
                "alerts_muted",
                "disk"
            ]
        );
        for c in &checks {
            assert_eq!(c.status, CheckStatus::Pass, "{c:?}");
            assert!(c.fix.is_none());
        }
        assert_eq!(
            find(&checks, "overlay:Castwright · HUD").label,
            "HUD in OBS"
        );
    }

    #[test]
    fn obs_offline_skips_overlay_and_disk_checks() {
        let mut i = good();
        i.obs = ConnState::Disconnected;
        i.obs_error = Some("Wrong password.".into());
        i.browser_sources = None;
        i.disk_free_mb = None;
        let checks = evaluate(&i);
        let obs = find(&checks, "obs");
        assert_eq!(obs.status, CheckStatus::Fail);
        assert_eq!(obs.detail, "Wrong password.");
        assert_eq!(obs.fix, Some(CheckFix::ConnectObs));
        assert_eq!(find(&checks, "overlays").status, CheckStatus::Warn);
        assert!(checks.iter().all(|c| c.id != "disk"));
    }

    #[test]
    fn overlay_links_and_loading() {
        let mut i = good();
        i.overlays.push(("chat".into(), "Chat".into()));
        i.browser_sources = Some(vec![
            src("Castwright · HUD", &url("hud", 7471, TOKEN)),
            src("My chat", &url("chat", 7470, TOKEN)),
            src("Old one", &url("gone", 7470, TOKEN)),
            src("Castwright · Chat", "about:blank"),
        ]);
        i.open_pages.clear();
        let checks = evaluate(&i);
        let hud = find(&checks, "overlay:Castwright · HUD");
        assert_eq!(hud.status, CheckStatus::Fail, "old port");
        assert_eq!(
            hud.fix,
            Some(CheckFix::FixOverlayLink {
                input: "Castwright · HUD".into(),
                overlay_id: "hud".into()
            })
        );
        let chat = find(&checks, "overlay:My chat");
        assert_eq!(chat.status, CheckStatus::Warn, "right link, not loaded");
        assert_eq!(
            chat.fix,
            Some(CheckFix::ReloadSource {
                input: "My chat".into()
            })
        );
        assert_eq!(find(&checks, "overlay:Old one").status, CheckStatus::Fail);
        let by_name = find(&checks, "overlay:Castwright · Chat");
        assert_eq!(
            by_name.status,
            CheckStatus::Fail,
            "found by name, wrong link"
        );
        assert!(matches!(by_name.fix, Some(CheckFix::FixOverlayLink { .. })));

        i.server.token = "new-secret".into();
        i.browser_sources = Some(vec![src("Castwright · HUD", &url("hud", 7470, TOKEN))]);
        assert_eq!(
            find(&evaluate(&i), "overlay:Castwright · HUD").status,
            CheckStatus::Fail,
            "old secret"
        );
    }

    #[test]
    fn no_overlays_in_obs_is_a_warning() {
        let mut i = good();
        i.browser_sources = Some(vec![src("Weather widget", "https://example.com/w")]);
        let c = evaluate(&i);
        let o = find(&c, "overlays");
        assert_eq!(o.status, CheckStatus::Warn);
        assert_eq!(o.fix, Some(open("overlays")));
    }

    #[test]
    fn server_problems() {
        let mut i = good();
        i.server.error = Some("Port 7470 was busy".into());
        assert_eq!(find(&evaluate(&i), "server").status, CheckStatus::Warn);
        i.server.running = false;
        let c = evaluate(&i);
        assert_eq!(find(&c, "server").status, CheckStatus::Fail);
        assert_eq!(find(&c, "server").fix, Some(CheckFix::StartServer));
        assert_eq!(
            find(&c, "overlay:Castwright · HUD").status,
            CheckStatus::Fail,
            "overlays can't load either"
        );
    }

    #[test]
    fn twitch_sign_in_scopes_and_stream_info() {
        let mut i = good();
        i.required_scopes.push("clips:edit".into());
        let t = evaluate(&i);
        assert_eq!(find(&t, "twitch").status, CheckStatus::Fail);
        assert!(find(&t, "twitch").detail.contains("clips:edit"));

        let mut i = good();
        i.required_scopes.push("channel:manage:polls".into());
        let t = find(&evaluate(&i), "twitch").clone();
        assert_eq!(t.status, CheckStatus::Warn, "older sign-ins keep working");
        assert!(t.detail.contains("Sign out and in again"));

        let mut i = good();
        i.twitch.eventsub = ConnState::Error;
        assert_eq!(find(&evaluate(&i), "twitch").status, CheckStatus::Warn);

        let mut i = good();
        i.twitch.stream.title = "  ".into();
        i.twitch.stream.category.clear();
        let c = evaluate(&i);
        assert_eq!(find(&c, "title").status, CheckStatus::Fail);
        assert_eq!(find(&c, "category").status, CheckStatus::Fail);
        assert_eq!(find(&c, "title").fix, Some(open("activity")));

        let mut i = good();
        i.twitch.broadcaster = None;
        let c = evaluate(&i);
        assert_eq!(find(&c, "twitch").status, CheckStatus::Fail);
        assert!(c.iter().all(|x| x.id != "title" && x.id != "category"));
    }

    #[test]
    fn alerts_and_disk() {
        let mut i = good();
        i.alerts_paused = true;
        i.alerts_muted = true;
        i.disk_free_mb = Some(3000.0);
        let c = evaluate(&i);
        assert_eq!(find(&c, "alerts_paused").fix, Some(CheckFix::ResumeAlerts));
        assert_eq!(find(&c, "alerts_paused").status, CheckStatus::Fail);
        assert_eq!(find(&c, "alerts_muted").fix, Some(CheckFix::UnmuteAlerts));
        assert_eq!(find(&c, "disk").status, CheckStatus::Warn);
        assert_eq!(find(&c, "disk").detail, "2.9 GB free");
        i.disk_free_mb = Some(500.0);
        assert_eq!(find(&evaluate(&i), "disk").status, CheckStatus::Fail);
    }

    #[test]
    fn overlay_link_parsing() {
        assert_eq!(
            overlay_link(&url("abc", 7470, "t")),
            Some(("abc".into(), 7470, "t".into()))
        );
        assert_eq!(
            overlay_link("http://localhost/overlay/x"),
            Some(("x".into(), 80, String::new()))
        );
        assert_eq!(overlay_link("https://example.com/overlay/"), None);
        assert_eq!(overlay_link("not a url"), None);
        assert_eq!(overlay_link("http://127.0.0.1:7470/assets/x"), None);
    }
}
