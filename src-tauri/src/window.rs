//! Native window effects: Mica and Acrylic on Windows. Everything else is solid.

use crate::model::settings::WindowEffect;

/// Apply `wanted` to the window and return what was actually applied.
pub fn apply_effect(
    window: &tauri::WebviewWindow,
    wanted: WindowEffect,
    dark: bool,
) -> WindowEffect {
    imp::apply(window, wanted, dark)
}

#[cfg(windows)]
mod imp {
    use super::WindowEffect;

    fn is_windows_11() -> bool {
        // Windows 11 reports build 22000 or later.
        let Ok(out) = std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .output()
        else {
            return false;
        };
        let text = String::from_utf8_lossy(&out.stdout);
        text.split(|c: char| !c.is_ascii_digit())
            .filter_map(|p| p.parse::<u32>().ok())
            .any(|n| (22000..100000).contains(&n))
    }

    pub fn apply(window: &tauri::WebviewWindow, wanted: WindowEffect, dark: bool) -> WindowEffect {
        let _ = window_vibrancy::clear_mica(window);
        let _ = window_vibrancy::clear_acrylic(window);
        let target = match wanted {
            WindowEffect::Auto if is_windows_11() => WindowEffect::Mica,
            WindowEffect::Auto => WindowEffect::Solid,
            other => other,
        };
        match target {
            WindowEffect::Mica => match window_vibrancy::apply_mica(window, Some(dark)) {
                Ok(()) => WindowEffect::Mica,
                Err(_) => WindowEffect::Solid,
            },
            WindowEffect::Acrylic => {
                let tint = if dark {
                    (16, 18, 24, 160)
                } else {
                    (243, 245, 249, 160)
                };
                match window_vibrancy::apply_acrylic(window, Some(tint)) {
                    Ok(()) => WindowEffect::Acrylic,
                    Err(_) => WindowEffect::Solid,
                }
            }
            _ => WindowEffect::Solid,
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::WindowEffect;

    pub fn apply(
        _window: &tauri::WebviewWindow,
        _wanted: WindowEffect,
        _dark: bool,
    ) -> WindowEffect {
        WindowEffect::Solid
    }
}
