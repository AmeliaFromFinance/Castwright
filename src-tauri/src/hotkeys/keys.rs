//! Parsing and checking key combos like `Ctrl+Shift+F1`.

use crate::model::settings::{HotkeyAction, HotkeyBinding, HotkeySettings};
use crate::paths::Os;
use std::fmt;

const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const SUPER: u8 = 8;
const MODS: [(u8, &str); 4] = [
    (CTRL, "Ctrl"),
    (ALT, "Alt"),
    (SHIFT, "Shift"),
    (SUPER, "Super"),
];

/// Keys allowed with no modifier, because they don't type anything.
const STANDALONE: &[&str] = &[
    "Pause",
    "ScrollLock",
    "MediaPlayPause",
    "MediaStop",
    "MediaTrackNext",
    "MediaTrackPrevious",
    "VolumeUp",
    "VolumeDown",
    "VolumeMute",
];

const NAMED: &[&str] = &[
    "Space",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Up",
    "Down",
    "Left",
    "Right",
    "Escape",
    "Minus",
    "Equal",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Semicolon",
    "Quote",
    "Comma",
    "Period",
    "Slash",
    "Backquote",
    "PrintScreen",
    "NumAdd",
    "NumSubtract",
    "NumMultiply",
    "NumDivide",
    "NumDecimal",
    "NumEnter",
];

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Combo {
    mods: u8,
    key: String,
}

impl fmt::Display for Combo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (bit, name) in MODS {
            if self.mods & bit != 0 {
                write!(f, "{name}+")?;
            }
        }
        f.write_str(&self.key)
    }
}

fn modifier(token: &str) -> Option<u8> {
    Some(match token {
        "ctrl" | "control" => CTRL,
        "alt" | "option" => ALT,
        "shift" => SHIFT,
        "super" | "cmd" | "command" | "win" | "meta" => SUPER,
        _ => return None,
    })
}

/// Canonical name of a main key, accepting a few common spellings.
fn key_name(token: &str) -> Option<String> {
    let lower = token.to_ascii_lowercase();
    let t = lower
        .strip_prefix("key")
        .filter(|r| r.len() == 1)
        .or_else(|| lower.strip_prefix("digit"))
        .unwrap_or(&lower);
    let mut chars = t.chars();
    if let (Some(c), None) = (chars.next(), chars.clone().next())
        && c.is_ascii_alphanumeric()
    {
        return Some(c.to_ascii_uppercase().to_string());
    }
    if let Some(n) = t.strip_prefix('f').and_then(|n| n.parse::<u8>().ok())
        && (1..=24).contains(&n)
        && !t.starts_with("f0")
    {
        return Some(format!("F{n}"));
    }
    if let Some(n) = t
        .strip_prefix("numpad")
        .or_else(|| t.strip_prefix("num"))
        .filter(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
    {
        return Some(format!("Num{n}"));
    }
    let alias = match t {
        "esc" => "escape",
        "return" => "enter",
        "del" => "delete",
        "arrowup" => "up",
        "arrowdown" => "down",
        "arrowleft" => "left",
        "arrowright" => "right",
        "numpadadd" => "numadd",
        "numpadsubtract" => "numsubtract",
        "numpadmultiply" => "nummultiply",
        "numpaddivide" => "numdivide",
        "numpaddecimal" => "numdecimal",
        "numpadenter" => "numenter",
        "audiovolumeup" => "volumeup",
        "audiovolumedown" => "volumedown",
        "audiovolumemute" => "volumemute",
        other => other,
    };
    NAMED
        .iter()
        .chain(STANDALONE)
        .find(|k| k.eq_ignore_ascii_case(alias))
        .map(|k| k.to_string())
}

/// Parse and check a combo. Errors are written for the person setting it.
pub fn parse(text: &str) -> Result<Combo, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Press a key combination.".into());
    }
    let mut mods = 0u8;
    let mut key: Option<String> = None;
    for raw in text.split('+') {
        let token = raw.trim();
        if token.is_empty() {
            return Err(format!("\"{text}\" isn't a valid combination."));
        }
        if let Some(m) = modifier(&token.to_ascii_lowercase()) {
            if key.is_some() {
                return Err(format!(
                    "Put modifiers like Ctrl before the key in \"{text}\"."
                ));
            }
            mods |= m;
            continue;
        }
        if key.is_some() {
            return Err("Use one key plus modifiers, like Ctrl+Shift+R.".into());
        }
        key =
            Some(key_name(token).ok_or_else(|| format!("\"{token}\" can't be used as a hotkey."))?);
    }
    let Some(key) = key else {
        return Err("Add a key that isn't Ctrl, Alt, Shift or Super.".into());
    };
    let alone_ok = STANDALONE.contains(&key.as_str()) || is_function_key(&key);
    if !alone_ok && mods & (CTRL | ALT | SUPER) == 0 {
        return Err("Add Ctrl, Alt or Super so normal typing keeps working.".into());
    }
    Ok(Combo { mods, key })
}

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('F')
        .is_some_and(|n| n.parse::<u8>().is_ok_and(|n| (1..=24).contains(&n)))
}

/// Same text the app shows in the list.
pub fn action_label(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::ReplayLastAlert => "Replay last alert",
        HotkeyAction::SkipAlert => "Skip alert",
        HotkeyAction::ToggleAlertPause => "Pause or resume alerts",
        HotkeyAction::ToggleAlertMute => "Mute or unmute alerts",
        HotkeyAction::OpenGoLive => "Open the go-live check",
        HotkeyAction::AddMarker => "Add stream marker",
        HotkeyAction::CreateClip => "Create clip",
        HotkeyAction::RunAction { .. } => "Run an action",
        HotkeyAction::PlaySoundButton { .. } => "Play sound button",
    }
}

/// Tidy bindings before saving: canonical key names, one row per built-in
/// action, no empty action picks, and no combo used twice.
pub fn clean(mut s: HotkeySettings) -> Result<HotkeySettings, String> {
    let mut seen_actions = std::collections::HashSet::new();
    s.bindings.retain(|b| match &b.action {
        HotkeyAction::RunAction { action_id } => !action_id.trim().is_empty(),
        HotkeyAction::PlaySoundButton { sound_id } => !sound_id.trim().is_empty(),
        other => seen_actions.insert(other.clone()),
    });
    let mut used: std::collections::HashMap<Combo, &'static str> = Default::default();
    for b in &mut s.bindings {
        if b.keys.trim().is_empty() {
            b.keys.clear();
            continue;
        }
        let label = action_label(&b.action);
        let combo = parse(&b.keys).map_err(|e| format!("{label}: {e}"))?;
        b.keys = combo.to_string();
        if let Some(other) = used.insert(combo, label) {
            return Err(format!(
                "{} is set for both \"{other}\" and \"{label}\". Pick a different combination for one of them.",
                b.keys
            ));
        }
    }
    Ok(s)
}

/// Bindings to register: set, valid, and the list is switched on.
pub fn active(s: &HotkeySettings) -> Vec<(&HotkeyBinding, Combo)> {
    if !s.enabled {
        return Vec::new();
    }
    s.bindings
        .iter()
        .filter_map(|b| parse(&b.keys).ok().map(|c| (b, c)))
        .collect()
}

/// A note when global hotkeys likely won't work on this desktop.
pub fn session_note(
    os: Os,
    wayland_display: Option<&str>,
    session_type: Option<&str>,
    x_display: Option<&str>,
) -> Option<String> {
    if os != Os::Linux {
        return None;
    }
    let set = |v: Option<&str>| v.is_some_and(|v| !v.trim().is_empty());
    let wayland =
        set(wayland_display) || session_type.is_some_and(|t| t.eq_ignore_ascii_case("wayland"));
    if wayland {
        return Some(if set(x_display) {
            "You're on Wayland. Hotkeys may only work while an X11 app or game has focus, or not at all.".into()
        } else {
            "You're on Wayland without X11 support, so global hotkeys won't work.".into()
        });
    }
    if !set(x_display) {
        return Some("No X11 display found, so global hotkeys won't work.".into());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canon(s: &str) -> String {
        parse(s)
            .map(|c| c.to_string())
            .unwrap_or_else(|e| format!("ERR {e}"))
    }

    #[test]
    fn canonical_names() {
        assert_eq!(canon("ctrl+shift+r"), "Ctrl+Shift+R");
        assert_eq!(canon("Shift + Control + KeyR"), "Ctrl+Shift+R");
        assert_eq!(canon("cmd+alt+Digit1"), "Alt+Super+1");
        assert_eq!(canon("Win+Esc"), "Super+Escape");
        assert_eq!(canon("ctrl+ArrowUp"), "Ctrl+Up");
        assert_eq!(canon("alt+numpad5"), "Alt+Num5");
        assert_eq!(canon("ctrl+NumpadAdd"), "Ctrl+NumAdd");
        assert_eq!(canon("f13"), "F13");
        assert_eq!(canon("Shift+F5"), "Shift+F5");
        assert_eq!(canon("MediaPlayPause"), "MediaPlayPause");
        assert_eq!(canon("ctrl+pageup"), "Ctrl+PageUp");
    }

    #[test]
    fn rejects_bad_combos() {
        for bad in [
            "",
            "Ctrl+",
            "Ctrl+Shift",
            "R",
            "Shift+R",
            "Shift+Space",
            "Ctrl+A+B",
            "R+Ctrl",
            "Ctrl+Hyper",
            "F25",
            "F0",
            "Ctrl+F01",
        ] {
            assert!(parse(bad).is_err(), "{bad} should fail");
        }
    }

    #[test]
    fn canonical_names_parse_in_the_os_layer() {
        use std::str::FromStr;
        let mut all: Vec<String> = NAMED
            .iter()
            .chain(STANDALONE)
            .map(|k| format!("Ctrl+{k}"))
            .collect();
        all.extend((1..=24).map(|n| format!("Ctrl+Alt+Shift+Super+F{n}")));
        all.extend(('A'..='Z').chain('0'..='9').map(|c| format!("Alt+{c}")));
        all.extend((0..=9).map(|n| format!("Ctrl+Num{n}")));
        for c in all {
            let canonical = parse(&c).unwrap().to_string();
            assert!(
                tauri_plugin_global_shortcut::Shortcut::from_str(&canonical).is_ok(),
                "{canonical}"
            );
        }
    }

    fn bind(action: HotkeyAction, keys: &str) -> HotkeyBinding {
        HotkeyBinding {
            action,
            keys: keys.into(),
        }
    }

    #[test]
    fn clean_finds_conflicts() {
        let s = HotkeySettings {
            enabled: true,
            bindings: vec![
                bind(HotkeyAction::SkipAlert, "ctrl+shift+s"),
                bind(
                    HotkeyAction::RunAction {
                        action_id: "a".into(),
                    },
                    "Shift+Ctrl+S",
                ),
            ],
        };
        let err = clean(s).unwrap_err();
        assert!(err.contains("Ctrl+Shift+S"), "{err}");
        assert!(
            err.contains("Skip alert") && err.contains("Run an action"),
            "{err}"
        );
    }

    #[test]
    fn clean_tidies() {
        let s = HotkeySettings {
            enabled: false,
            bindings: vec![
                bind(HotkeyAction::SkipAlert, "ctrl+f1"),
                bind(HotkeyAction::SkipAlert, "ctrl+f2"),
                bind(
                    HotkeyAction::RunAction {
                        action_id: " ".into(),
                    },
                    "ctrl+f3",
                ),
                bind(
                    HotkeyAction::RunAction {
                        action_id: "x".into(),
                    },
                    "  ",
                ),
                bind(HotkeyAction::OpenGoLive, "alt+g"),
            ],
        };
        let s = clean(s).unwrap();
        let keys: Vec<_> = s.bindings.iter().map(|b| b.keys.as_str()).collect();
        assert_eq!(keys, ["Ctrl+F1", "", "Alt+G"]);
        assert!(!s.enabled);
    }

    #[test]
    fn clean_names_the_broken_row() {
        let s = HotkeySettings {
            enabled: true,
            bindings: vec![bind(HotkeyAction::ToggleAlertMute, "M")],
        };
        assert!(clean(s).unwrap_err().starts_with("Mute or unmute alerts:"));
    }

    #[test]
    fn active_respects_the_switch() {
        let mut s = HotkeySettings {
            enabled: true,
            bindings: vec![
                bind(HotkeyAction::SkipAlert, "Ctrl+F1"),
                bind(HotkeyAction::OpenGoLive, ""),
            ],
        };
        assert_eq!(active(&s).len(), 1);
        s.enabled = false;
        assert!(active(&s).is_empty());
    }

    #[test]
    fn wayland_notes() {
        assert_eq!(
            session_note(Os::Windows, Some("wayland-0"), None, None),
            None
        );
        assert_eq!(session_note(Os::Linux, None, Some("x11"), Some(":0")), None);
        assert!(
            session_note(Os::Linux, Some("wayland-0"), None, Some(":0"))
                .unwrap()
                .contains("may only work")
        );
        assert!(
            session_note(Os::Linux, None, Some("wayland"), None)
                .unwrap()
                .contains("won't work")
        );
        assert!(session_note(Os::Linux, Some(""), Some("tty"), None).is_some());
    }
}
