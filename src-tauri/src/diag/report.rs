//! Bug reports: one zip with what's needed to understand a problem, secrets removed.
//! Nothing is uploaded; the person attaches it to an issue themselves.

use super::crash::CrashInfo;
use super::redact::Redactor;
use crate::model::project::Project;
use crate::store::project::AssetInfo;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Write;
use ts_rs::TS;

pub struct ReportFile {
    pub name: String,
    pub what: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct ReportFileInfo {
    pub name: String,
    pub what: String,
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct BugReportPreview {
    pub files: Vec<ReportFileInfo>,
    pub has_crash: bool,
    /// Suggested name for the zip.
    pub file_name: String,
}

pub struct ReportInput {
    pub created_at: i64,
    pub app: Value,
    pub settings: Value,
    pub log: Vec<String>,
    pub health: Value,
    /// Facts only the app window knows, like emote providers.
    pub window: Value,
    pub stats: Value,
    /// Only added when the person asks for it.
    pub project: Option<Value>,
    pub crash: Option<CrashInfo>,
}

pub fn file_name(created_at: i64) -> String {
    let day = crate::commands::format_rfc3339(created_at);
    format!(
        "castwright-bug-report-{}-{}.zip",
        env!("CARGO_PKG_VERSION"),
        &day[..10]
    )
}

fn pretty(v: &Value) -> Vec<u8> {
    let mut out = serde_json::to_vec_pretty(v).unwrap_or_default();
    out.push(b'\n');
    out
}

fn readme(i: &ReportInput) -> String {
    format!(
        "Castwright bug report\n\
         Made {} with version {}.\n\n\
         Sign-ins, passwords, tokens, webhook links and email addresses were removed.\n\
         Your home folder is shown as ~.\n\
         Nothing was uploaded. To share it, attach this file to a GitHub issue.\n",
        crate::commands::format_rfc3339(i.created_at),
        env!("CARGO_PKG_VERSION"),
    )
}

/// Everything that goes into the zip, already redacted.
pub fn files(i: &ReportInput, r: &Redactor) -> Vec<ReportFile> {
    let file = |name: &str, what: &str, bytes: Vec<u8>| ReportFile {
        name: name.into(),
        what: what.into(),
        bytes,
    };
    let mut health = r.json(&i.health);
    if let Value::Object(map) = &mut health {
        map.insert("window".into(), r.json(&i.window));
    }
    let mut log: String = i.log.iter().map(|l| r.text(l) + "\n").collect();
    if log.is_empty() {
        log.push_str("(empty)\n");
    }
    let mut out = vec![
        file("README.txt", "What this is", readme(i).into_bytes()),
        file("app.json", "Version and system", pretty(&r.json(&i.app))),
        file("health.json", "Health check", pretty(&health)),
        file(
            "settings.json",
            "Settings without secrets",
            pretty(&r.json(&i.settings)),
        ),
        file("log.txt", "Recent log", log.into_bytes()),
        file(
            "project-stats.json",
            "Counts of overlays, layers and actions",
            pretty(&r.json(&i.stats)),
        ),
    ];
    if let Some(p) = &i.project {
        out.push(file(
            "project.json",
            "Your project, without secrets",
            pretty(&r.json(p)),
        ));
    }
    if let Some(c) = &i.crash {
        let v = serde_json::to_value(c).unwrap_or_default();
        out.push(file("crash.json", "Last crash", pretty(&r.json(&v))));
    }
    out
}

pub fn info(files: &[ReportFile]) -> Vec<ReportFileInfo> {
    files
        .iter()
        .map(|f| ReportFileInfo {
            name: f.name.clone(),
            what: f.what.clone(),
            bytes: f.bytes.len() as u64,
        })
        .collect()
}

pub fn zip(files: &[ReportFile]) -> std::io::Result<Vec<u8>> {
    let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for f in files {
        z.start_file(f.name.as_str(), opts)
            .map_err(std::io::Error::other)?;
        z.write_all(&f.bytes)?;
    }
    Ok(z.finish().map_err(std::io::Error::other)?.into_inner())
}

/// How big the project is, without any of its content.
pub fn project_stats(p: &Project, assets: &[AssetInfo]) -> Value {
    fn tally<'a>(names: impl Iterator<Item = &'a str>) -> BTreeMap<String, usize> {
        let mut m = BTreeMap::new();
        for n in names {
            *m.entry(n.to_string()).or_insert(0) += 1;
        }
        m
    }
    let layer_kinds: Vec<String> = p
        .overlays
        .iter()
        .flat_map(|o| &o.layers)
        .map(|l| {
            serde_json::to_value(&l.kind)
                .ok()
                .and_then(|v| v.get("type").and_then(Value::as_str).map(String::from))
                .unwrap_or_else(|| "unknown".into())
        })
        .collect();
    let node_kinds: Vec<String> = p
        .actions
        .iter()
        .flat_map(|a| &a.graph.nodes)
        .map(|n| {
            // `trigger: command`, `step: http_request` and so on.
            let v = serde_json::to_value(&n.kind).unwrap_or_default();
            let kind = v["type"].as_str().unwrap_or("unknown");
            match v[kind]["type"].as_str() {
                Some(inner) => format!("{kind}: {inner}"),
                None => kind.to_string(),
            }
        })
        .collect();
    json!({
        "format": p.format,
        "overlays": p.overlays.len(),
        "layers": layer_kinds.len(),
        "layers_by_type": tally(layer_kinds.iter().map(String::as_str)),
        "largest_overlay_layers": p.overlays.iter().map(|o| o.layers.len()).max().unwrap_or(0),
        "actions": p.actions.len(),
        "actions_enabled": p.actions.iter().filter(|a| a.enabled).count(),
        "action_nodes": node_kinds.len(),
        "action_nodes_by_type": tally(node_kinds.iter().map(String::as_str)),
        "alert_types_enabled": p.alerts.types.iter().filter(|t| t.enabled).count(),
        "alert_variations": p.alerts.types.iter().map(|t| t.variations.len()).sum::<usize>(),
        "assets": assets.len(),
        "asset_bytes": assets.iter().map(|a| a.bytes).sum::<u64>(),
        "assets_by_kind": tally(assets.iter().map(|a| a.kind.as_str())),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Read;

    pub(crate) fn unzip(bytes: &[u8]) -> Vec<(String, String)> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        (0..z.len())
            .map(|i| {
                let mut e = z.by_index(i).unwrap();
                let mut s = String::new();
                e.read_to_string(&mut s).unwrap();
                (e.name().to_string(), s)
            })
            .collect()
    }

    fn input() -> ReportInput {
        ReportInput {
            created_at: 1_762_160_400_000,
            app: json!({ "version": "x", "config_dir": "/home/jane/.config/castwright" }),
            settings: json!({ "server": { "token": "abc" } }),
            log: vec!["INFO started".into()],
            health: json!({ "level": "ok" }),
            window: json!({ "emotes": [] }),
            stats: project_stats(&Project::starter(), &[]),
            project: None,
            crash: None,
        }
    }

    #[test]
    fn zip_has_the_expected_files() {
        let r = Redactor::new(Vec::new());
        let files = files(&input(), &r);
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "README.txt",
                "app.json",
                "health.json",
                "settings.json",
                "log.txt",
                "project-stats.json"
            ]
        );
        let entries = unzip(&zip(&files).unwrap());
        assert_eq!(entries.len(), files.len());
        for ((name, text), f) in entries.iter().zip(&files) {
            assert_eq!(name, &f.name);
            assert_eq!(text.as_bytes(), f.bytes.as_slice());
        }
        let health: Value = serde_json::from_str(&entries[2].1).unwrap();
        assert_eq!(health["window"], json!({ "emotes": [] }));
        assert_eq!(entries[4].1, "INFO started\n");
        assert!(entries[0].1.contains("Nothing was uploaded"));
    }

    #[test]
    fn project_and_crash_are_optional() {
        let r = Redactor::new(Vec::new());
        let mut i = input();
        i.project = Some(json!({ "name": "Show" }));
        i.crash = Some(CrashInfo::new("boom".into(), "x.rs:1:1".into()));
        let names: Vec<_> = files(&i, &r).into_iter().map(|f| f.name).collect();
        assert!(names.contains(&"project.json".to_string()));
        assert!(names.contains(&"crash.json".to_string()));
    }

    #[test]
    fn stats_count_without_content() {
        let p = Project::starter();
        let assets = vec![AssetInfo {
            name: "logo.png".into(),
            path: "assets/logo.png".into(),
            bytes: 10,
            kind: "image".into(),
        }];
        let s = project_stats(&p, &assets);
        assert_eq!(s["overlays"], p.overlays.len());
        assert_eq!(
            s["layers"],
            p.overlays.iter().map(|o| o.layers.len()).sum::<usize>()
        );
        assert_eq!(s["actions"], p.actions.len());
        assert_eq!(s["assets_by_kind"]["image"], 1);
        let text = s.to_string();
        assert!(!text.contains(&p.overlays[0].name), "no names");
        assert!(!text.contains("logo.png"));
    }

    #[test]
    fn file_name_has_version_and_day() {
        assert_eq!(
            file_name(1_762_160_400_000),
            format!(
                "castwright-bug-report-{}-2025-11-03.zip",
                env!("CARGO_PKG_VERSION")
            )
        );
    }
}
