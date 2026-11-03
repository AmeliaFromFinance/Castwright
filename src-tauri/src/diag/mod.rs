//! Health panel, logs, crash files and bug reports.

pub mod crash;
pub mod health;
pub mod logbuf;
pub mod redact;
pub mod report;
pub mod sys;

use crate::core::Core;
use redact::{Redactor, is_secret_name};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Log files and the crash file live here.
pub fn logs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| p.components().count() > 1)
}

/// Knows every secret the app holds, so none of them can end up in a report.
pub fn redactor(core: &Core) -> Redactor {
    let token = core.settings.get().server.token;
    let mut known = vec![crate::server::asset_key(&token), token];
    for key in crate::store::secrets::keys::ALL {
        let Some(value) = core.secrets.get(key) else {
            continue;
        };
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&value) {
            known.extend(
                map.iter()
                    .filter(|(k, _)| is_secret_name(k))
                    .filter_map(|(_, v)| v.as_str().map(String::from)),
            );
        }
        known.push(value);
    }
    Redactor::new(known).with_home(home_dir().as_deref())
}

pub fn report_input(
    core: &Core,
    portable: bool,
    include_project: bool,
    window: Value,
) -> report::ReportInput {
    let project = core.project.get();
    let assets = core.project.assets();
    let health = health::snapshot(core, portable);
    let now = crate::util::now_ms();
    let app = json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "portable": portable,
        "secrets_in_file": core.secrets.using_file(),
        "started_at": crate::commands::format_rfc3339(core.started_at),
        "report_made_at": crate::commands::format_rfc3339(now),
        "config_dir": core.paths.config_dir,
        "data_dir": core.paths.data_dir,
        "project_dir": core.project_dir(),
        "backup_dir": core.backups.dir(),
        "logs_dir": logs_dir(&core.paths.data_dir),
    });
    report::ReportInput {
        created_at: now,
        app,
        settings: serde_json::to_value(core.settings.get()).unwrap_or_default(),
        log: logbuf::sink().lines(),
        health: serde_json::to_value(&health).unwrap_or_default(),
        window,
        stats: report::project_stats(&project, &assets),
        project: include_project.then(|| serde_json::to_value(&project).unwrap_or_default()),
        crash: crash::last(&logs_dir(&core.paths.data_dir)),
    }
}

/// The files of a bug report, secrets removed.
pub fn report_files(
    core: &Core,
    portable: bool,
    include_project: bool,
    window: Value,
) -> Vec<report::ReportFile> {
    let input = report_input(core, portable, include_project, window);
    report::files(&input, &redactor(core))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{Core, Paths};
    use crate::model::runtime::LogLevel;
    use std::sync::Arc;

    const ACCESS: &str = "k7x2m9q4w1e8r5t3y6u0i2o4p6a8sd";
    const REFRESH: &str = "rfr-9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a";
    const OBS_PASS: &str = "Horse Battery 42!";
    const CLIENT_ID: &str = "abcdefghij0123456789klmnopqrst";
    const WEBHOOK: &str = "https://discord.com/api/webhooks/1188776655/Zx_Yw-Vu9Ts8";
    const SLACK: &str = "https://hooks.slack.com/services/T01/B02/abc";
    const EMAIL: &str = "streamer.jane@example.com";
    const KEY: &str = "sk_live_51Hx9QpLmNoPqRsTuVwXyZ";

    #[tokio::test]
    async fn bug_report_holds_no_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        let stored = json!({
            "access_token": ACCESS,
            "refresh_token": REFRESH,
            "login": "jane",
            "user_id": "1234",
            "scopes": ["bits:read"]
        });
        std::fs::write(
            config.join("secrets.json"),
            json!({
                "twitch.broadcaster": stored.to_string(),
                "obs.password": OBS_PASS
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            config.join("settings.json"),
            json!({ "twitch": { "client_id": CLIENT_ID }, "obs": { "has_password": true } })
                .to_string(),
        )
        .unwrap();
        let project_dir = dir.path().join("project");
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(
            project_dir.join("project.json"),
            json!({
                "format": 1,
                "name": "Show",
                "actions": [{
                    "id": "a1",
                    "name": "Post to Discord",
                    "triggers": [{ "type": "command", "name": "clip" }],
                    "steps": [
                        { "type": "http_request", "url": WEBHOOK, "body": format!("{{\"content\":\"mail {EMAIL}\"}}") },
                        { "type": "http_request", "url": format!("{SLACK}?x=1"), "body": "" },
                        { "type": "http_request", "url": format!("https://api.example.com/v1?api_key={KEY}"), "body": "" }
                    ]
                }]
            })
            .to_string(),
        )
        .unwrap();
        let paths = Paths {
            config_dir: config,
            default_project_dir: project_dir,
            backup_dir: dir.path().join("backups"),
            data_dir: dir.path().to_path_buf(),
            secrets_in_file: true,
        };
        let core = Core::start(paths, Arc::new(crate::hub::NullUi))
            .await
            .unwrap();
        let token = core.settings.get().server.token;
        let asset_key = crate::server::asset_key(&token);
        let link = core.server.overlay_url("x").unwrap_or_default();
        for line in [
            format!("GET {link}"),
            format!("asset /assets/a.png?key={asset_key}"),
            format!("refreshing with {REFRESH}"),
            format!("Authorization: OAuth {ACCESS}"),
            format!("obs auth failed for password {OBS_PASS}"),
            format!("contact {EMAIL}"),
            format!("posting {WEBHOOK}"),
        ] {
            logbuf::sink().push(&line);
            core.hub.log(LogLevel::Warn, "test", line);
        }
        crash::write(
            &logs_dir(dir.path()),
            &crash::CrashInfo::new(format!("panicked with token {ACCESS}"), "x.rs:1:1".into()),
        )
        .unwrap();

        let window =
            json!({ "emotes": [{ "provider": "7tv", "error": format!("401 for {EMAIL}") }] });
        let files = report_files(&core, false, true, window);
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"project.json"));
        assert!(names.contains(&"crash.json"));
        let entries = report::tests::unzip(&report::zip(&files).unwrap());
        assert_eq!(entries.len(), files.len());

        let secrets = [
            token.as_str(),
            asset_key.as_str(),
            ACCESS,
            REFRESH,
            OBS_PASS,
            CLIENT_ID,
            WEBHOOK,
            "1188776655/Zx_Yw-Vu9Ts8",
            SLACK,
            "T01/B02",
            EMAIL,
            "streamer.jane",
            KEY,
        ];
        for (name, text) in &entries {
            for s in secrets {
                assert!(!text.contains(s), "{name} contains {s}:\n{text}");
            }
        }
        let all: String = entries.iter().map(|(_, t)| t.as_str()).collect();
        assert!(
            all.contains("Post to Discord"),
            "the project is still there"
        );
        assert!(
            all.contains("[removed"),
            "and shows where things were removed"
        );

        let without = report_files(&core, false, false, Value::Null);
        assert!(!without.iter().any(|f| f.name == "project.json"));
        core.shutdown().await;
    }
}
