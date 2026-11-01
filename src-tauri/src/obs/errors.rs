//! Turns obs-websocket failures into messages a streamer can act on.

use super::convert::is_local_host;
use super::proto::{ConnectFailure, ReqError, code};
use crate::error::AppError;

const SETTINGS_PATH: &str = "Tools → WebSocket Server Settings";

pub fn not_connected() -> AppError {
    AppError::User("OBS isn't connected.".into())
}

/// Error from a request on an open connection.
pub fn request(e: ReqError) -> AppError {
    match e {
        ReqError::Api { code, comment } => AppError::Obs(api_message(code, comment)),
        ReqError::Disconnected => not_connected(),
        ReqError::Timeout => AppError::Obs("didn't respond in time.".into()),
    }
}

fn api_message(status: u16, comment: Option<String>) -> String {
    let fixed = match status {
        code::NOT_READY => "is still starting up. Try again in a moment.",
        code::STUDIO_MODE_ACTIVE => "turn off Studio Mode first.",
        code::STUDIO_MODE_NOT_ACTIVE => "turn on Studio Mode first.",
        code::OUTPUT_DISABLED => "that output is turned off in OBS settings.",
        code::INVALID_INPUT_KIND => "that kind of source isn't available in this OBS.",
        _ => "",
    };
    if !fixed.is_empty() {
        return fixed.into();
    }
    match comment {
        Some(c) if !c.trim().is_empty() => c,
        _ => format!("the request failed (code {status})."),
    }
}

/// `obs_running`: whether an OBS process was found on this computer (None = unknown).
pub fn connect_message(
    failure: ConnectFailure,
    host: &str,
    port: u16,
    had_password: bool,
    obs_running: Option<bool>,
    detail: &str,
) -> String {
    let local = is_local_host(host);
    match failure {
        ConnectFailure::Refused if local => match obs_running {
            Some(false) => "OBS isn't running. Start OBS, then connect again.".into(),
            Some(true) => format!(
                "OBS is running but didn't accept the connection on port {port}. In OBS, open \
                 {SETTINGS_PATH}, tick \"Enable WebSocket server\" and check the port matches."
            ),
            None => format!(
                "Couldn't reach OBS on port {port}. Make sure OBS is running, then open \
                 {SETTINGS_PATH}, tick \"Enable WebSocket server\" and check the port matches."
            ),
        },
        ConnectFailure::Refused | ConnectFailure::Unreachable | ConnectFailure::TimedOut => {
            format!(
                "Couldn't reach OBS at {host}:{port}. Make sure OBS is running on that computer \
                 and the WebSocket server is on ({SETTINGS_PATH})."
            )
        }
        ConnectFailure::BadPassword if had_password => format!(
            "OBS didn't accept the password. Copy it from OBS: {SETTINGS_PATH} → Show Connect Info."
        ),
        ConnectFailure::BadPassword => {
            format!("OBS needs a password. Copy it from OBS: {SETTINGS_PATH} → Show Connect Info.")
        }
        ConnectFailure::NotObs => format!(
            "Something answered on port {port}, but it isn't OBS 28 or newer. Check the port in \
             OBS: {SETTINGS_PATH}."
        ),
        ConnectFailure::Unsupported => {
            "This version of OBS isn't supported. Update OBS to version 28 or newer.".into()
        }
        ConnectFailure::BadAddress => format!("\"{host}\" isn't a valid address."),
        ConnectFailure::Other => format!("Couldn't connect to OBS: {detail}"),
    }
}

/// Looks for a running OBS on this computer. None when it can't tell.
pub fn obs_process_running() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        let dir = std::fs::read_dir("/proc").ok()?;
        for entry in dir.flatten() {
            let name = entry.file_name();
            if !name.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            // Fields after the name in brackets; the first is the state (Z = zombie).
            let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else {
                continue;
            };
            let state = stat[close + 1..].split_whitespace().next();
            if &stat[open + 1..close] == "obs" && !matches!(state, Some("Z" | "X")) {
                return Some(true);
            }
        }
        Some(false)
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("pgrep")
            .args(["-x", "OBS"])
            .stdout(std::process::Stdio::null())
            .status()
            .ok()?;
        Some(status.success())
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq obs64.exe", "/NH"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        Some(
            String::from_utf8_lossy(&out.stdout)
                .to_ascii_lowercase()
                .contains("obs64.exe"),
        )
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_errors_are_readable() {
        let e = request(ReqError::Api {
            code: code::RESOURCE_NOT_FOUND,
            comment: Some("No source was found by the name of `Cam`.".into()),
        });
        assert_eq!(
            e.to_string(),
            "OBS: No source was found by the name of `Cam`."
        );
        let e = request(ReqError::Api {
            code: code::STUDIO_MODE_NOT_ACTIVE,
            comment: None,
        });
        assert_eq!(e.to_string(), "OBS: turn on Studio Mode first.");
        let e = request(ReqError::Api {
            code: 205,
            comment: None,
        });
        assert!(e.to_string().contains("205"));
        assert_eq!(
            request(ReqError::Disconnected).to_string(),
            "OBS isn't connected."
        );
        assert!(request(ReqError::Timeout).to_string().contains("respond"));
    }

    #[test]
    fn connect_messages() {
        let m = |f, host, pw, running| connect_message(f, host, 4455, pw, running, "x");
        assert!(
            m(ConnectFailure::Refused, "127.0.0.1", false, Some(false)).contains("isn't running")
        );
        let running = m(ConnectFailure::Refused, "localhost", false, Some(true));
        assert!(running.contains("Tools → WebSocket Server Settings") && running.contains("4455"));
        assert!(
            m(ConnectFailure::Refused, "127.0.0.1", false, None)
                .contains("Enable WebSocket server")
        );
        assert!(
            m(ConnectFailure::Refused, "10.0.0.2", false, Some(false)).contains("10.0.0.2:4455")
        );
        assert!(
            m(ConnectFailure::BadPassword, "127.0.0.1", true, None)
                .contains("didn't accept the password")
        );
        assert!(
            m(ConnectFailure::BadPassword, "127.0.0.1", false, None).contains("needs a password")
        );
        assert!(m(ConnectFailure::NotObs, "127.0.0.1", false, None).contains("isn't OBS"));
        assert!(m(ConnectFailure::Other, "127.0.0.1", false, None).ends_with(": x"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn process_check_runs() {
        assert!(obs_process_running().is_some());
    }
}
