//! Opening web links in the user's browser.
//!
//! Inside the Linux AppImage, programs we start inherit the AppImage's library
//! and plugin paths. A browser started that way loads our bundled libraries
//! instead of the system's and fails to start, so those entries are removed first.

use std::ffi::{OsStr, OsString};

use crate::error::{AppError, AppResult};

/// Set by the AppImage hooks and only meant for Castwright itself.
const APPIMAGE_ONLY: &[&str] = &[
    "GTK_THEME",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GST_REGISTRY_REUSE_PLUGIN_SCANNER",
];

/// Changes to the environment for programs started from the AppImage: `None`
/// removes a variable. Paths inside `appdir` are dropped from list variables.
pub fn host_env(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    appdir: &OsStr,
) -> Vec<(OsString, Option<OsString>)> {
    let dir = appdir.to_string_lossy();
    let dir = dir.trim_end_matches('/');
    let mut out = Vec::new();
    for (k, v) in vars {
        let key = k.to_string_lossy();
        if key == "APPDIR"
            || key == "APPIMAGE"
            || key == "ARGV0"
            || key == "OWD"
            || APPIMAGE_ONLY.contains(&key.as_ref())
        {
            out.push((k, None));
            continue;
        }
        let val = v.to_string_lossy();
        if dir.is_empty() || !val.contains(dir) {
            continue;
        }
        let kept: Vec<&str> = val
            .split(':')
            .filter(|p| !p.is_empty() && !p.starts_with(dir))
            .collect();
        out.push((
            k,
            if kept.is_empty() {
                None
            } else {
                Some(kept.join(":").into())
            },
        ));
    }
    out
}

/// Open an http(s) link in the default browser.
pub fn open_url(url: &str) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::User("Only web links can be opened.".into()));
    }
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR") {
        return open_from_appimage(url, &appdir);
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| AppError::User(format!("Couldn't open the link: {e}")))
}

#[cfg(target_os = "linux")]
fn open_from_appimage(url: &str, appdir: &OsStr) -> AppResult<()> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let env = host_env(std::env::vars_os(), appdir);
    let mut last = String::from("no launcher found");
    for (program, args) in [("xdg-open", &[][..]), ("gio", &["open"][..])] {
        let mut cmd = Command::new(program);
        cmd.args(args)
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        for (k, v) in &env {
            match v {
                Some(v) => cmd.env(k, v),
                None => cmd.env_remove(k),
            };
        }
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last = format!("{program}: {e}");
                continue;
            }
        };
        // A launcher that fails says so quickly; one still running has handed off.
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => return Ok(()),
                Ok(Some(s)) => {
                    last = format!("{program} exited with {s}");
                    break;
                }
                Ok(None) if start.elapsed() > Duration::from_secs(2) => {
                    std::thread::spawn(move || child.wait());
                    return Ok(());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(e) => {
                    last = format!("{program}: {e}");
                    break;
                }
            }
        }
    }
    tracing::warn!("couldn't open {url}: {last}");
    Err(AppError::User(format!("Couldn't open the link ({last}).")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(k, v)| (k.into(), v.into())).collect()
    }

    fn get<'a>(out: &'a [(OsString, Option<OsString>)], k: &str) -> Option<&'a Option<OsString>> {
        out.iter().find(|(key, _)| key == k).map(|(_, v)| v)
    }

    #[test]
    fn drops_appimage_paths_and_settings() {
        let out = host_env(
            env(&[
                (
                    "LD_LIBRARY_PATH",
                    "/tmp/.mount_x/usr/lib/:/tmp/.mount_x/usr/lib/x86_64-linux-gnu/:",
                ),
                ("PATH", "/tmp/.mount_x/usr/bin/:/usr/local/bin:/usr/bin"),
                (
                    "XDG_DATA_DIRS",
                    "/tmp/.mount_x/usr/share:/usr/share:/usr/local/share",
                ),
                (
                    "GST_PLUGIN_SYSTEM_PATH_1_0",
                    "/tmp/.mount_x/usr/lib/gstreamer-1.0",
                ),
                ("GTK_THEME", "Adwaita:dark"),
                ("APPDIR", "/tmp/.mount_x"),
                ("HOME", "/home/me"),
                ("WAYLAND_DISPLAY", "wayland-1"),
            ]),
            OsStr::new("/tmp/.mount_x/"),
        );
        assert_eq!(get(&out, "LD_LIBRARY_PATH"), Some(&None));
        assert_eq!(
            get(&out, "PATH"),
            Some(&Some("/usr/local/bin:/usr/bin".into()))
        );
        assert_eq!(
            get(&out, "XDG_DATA_DIRS"),
            Some(&Some("/usr/share:/usr/local/share".into()))
        );
        assert_eq!(get(&out, "GST_PLUGIN_SYSTEM_PATH_1_0"), Some(&None));
        assert_eq!(get(&out, "GTK_THEME"), Some(&None));
        assert_eq!(get(&out, "APPDIR"), Some(&None));
        assert_eq!(get(&out, "HOME"), None, "untouched");
        assert_eq!(get(&out, "WAYLAND_DISPLAY"), None, "untouched");
    }

    #[test]
    fn only_web_links() {
        assert!(open_url("file:///etc/passwd").is_err());
        assert!(open_url("javascript:alert(1)").is_err());
    }
}
