//! Where app data lives. Normally the OS app folders; in portable mode a `data`
//! folder next to the app. Every path the app writes to is resolved here.

use std::path::{Path, PathBuf};
use tauri::utils::config::{AppDirectoriesOverride, AppDirectoryOverrides};

/// Marker file that turns on portable mode.
pub const MARKER: &str = "portable";
pub const DATA: &str = "data";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Linux,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::MacOs
        } else {
            Os::Linux
        }
    }
}

/// The folder the user sees the app in. An AppImage runs from a temporary mount,
/// so its own location counts. On macOS it's the folder holding the `.app`.
pub fn app_folder(exe: &Path, appimage: Option<&Path>, os: Os) -> Option<PathBuf> {
    if os == Os::Linux
        && let Some(image) = appimage.filter(|p| !p.as_os_str().is_empty())
    {
        return image.parent().map(Path::to_path_buf);
    }
    let dir = exe.parent()?;
    if os == Os::MacOs {
        let contents = dir.parent();
        let bundle = contents.and_then(Path::parent);
        let is_bundle = dir.file_name().is_some_and(|n| n == "MacOS")
            && contents
                .and_then(Path::file_name)
                .is_some_and(|n| n == "Contents")
            && bundle
                .and_then(Path::extension)
                .is_some_and(|e| e.eq_ignore_ascii_case("app"));
        if is_bundle {
            return bundle.and_then(Path::parent).map(Path::to_path_buf);
        }
    }
    Some(dir.to_path_buf())
}

/// Portable when a `portable` file or a `data` folder sits next to the app.
pub fn is_portable(folder: &Path) -> bool {
    folder.join(MARKER).is_file() || folder.join(DATA).is_dir()
}

/// App folders inside one portable data folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableDirs {
    pub config: PathBuf,
    pub data: PathBuf,
    pub webview: PathBuf,
    pub cache: PathBuf,
    pub log: PathBuf,
}

impl PortableDirs {
    pub fn new(root: &Path) -> Self {
        PortableDirs {
            config: root.to_path_buf(),
            data: root.to_path_buf(),
            webview: root.join("webview"),
            cache: root.join("cache"),
            log: root.join("logs"),
        }
    }

    fn into_override(self) -> AppDirectoriesOverride {
        AppDirectoriesOverride::Directories(AppDirectoryOverrides {
            config: Some(self.config),
            data: Some(self.data),
            local_data: Some(self.webview),
            cache: Some(self.cache),
            log: Some(self.log),
        })
    }
}

/// What was found at startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    /// Folder holding the app, if it could be found.
    pub app_folder: Option<PathBuf>,
    /// Set in portable mode: the `data` folder.
    pub portable: Option<PathBuf>,
}

impl Layout {
    pub fn detect() -> Layout {
        let exe = std::env::current_exe().ok();
        let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
        Layout::from_parts(exe.as_deref(), appimage.as_deref(), Os::current())
    }

    pub fn from_parts(exe: Option<&Path>, appimage: Option<&Path>, os: Os) -> Layout {
        let app_folder = exe.and_then(|e| app_folder(e, appimage, os));
        let portable = app_folder
            .as_deref()
            .filter(|f| is_portable(f))
            .map(|f| f.join(DATA));
        Layout {
            app_folder,
            portable,
        }
    }

    /// Point Tauri's app folders (and with them the window-state file and the
    /// webview data on Windows and Linux) at the portable data folder.
    pub fn apply(&self, config: &mut tauri::Config) {
        if let Some(root) = &self.portable {
            config.app.app_directories_override = Some(PortableDirs::new(root).into_override());
        }
    }

    /// Why "Make portable" can't run here, if it can't.
    pub fn portable_blocked(&self) -> Option<String> {
        if self.portable.is_some() {
            return Some("Castwright is already portable.".into());
        }
        let Some(folder) = &self.app_folder else {
            return Some("Couldn't find the folder Castwright runs from.".into());
        };
        if folder.join(DATA).exists() {
            return Some(format!(
                "There's already something called \"{DATA}\" in {}.",
                folder.display()
            ));
        }
        writable(folder).err()
    }
}

/// Check that files can be created in `dir`.
pub fn writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(format!(".castwright-write-test-{}", crate::util::new_id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Ok(())
        }
        Err(_) => Err(format!(
            "Castwright can't write to {}. Move it to a folder you own, like a USB drive or your Documents folder.",
            dir.display()
        )),
    }
}

/// Resolve the folders the core uses from Tauri's (possibly overridden) app folders.
pub fn core_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    layout: &Layout,
) -> tauri::Result<crate::core::Paths> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir()?;
    Ok(crate::core::Paths {
        config_dir: app.path().app_config_dir()?,
        default_project_dir: data_dir.join("Projects").join("Default"),
        backup_dir: data_dir.join("backups"),
        data_dir,
        secrets_in_file: layout.portable.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(exe: &str, appimage: Option<&str>, os: Os) -> Option<PathBuf> {
        app_folder(Path::new(exe), appimage.map(Path::new), os)
    }

    #[test]
    fn windows_uses_the_exe_folder() {
        assert_eq!(
            folder("/D/Apps/Castwright/castwright.exe", None, Os::Windows),
            Some(PathBuf::from("/D/Apps/Castwright"))
        );
        // APPIMAGE means nothing outside Linux.
        assert_eq!(
            folder("/D/Apps/castwright.exe", Some("/x/a.AppImage"), Os::Windows),
            Some(PathBuf::from("/D/Apps"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_drive_paths() {
        assert_eq!(
            folder(r"E:\Castwright\castwright.exe", None, Os::Windows),
            Some(PathBuf::from(r"E:\Castwright"))
        );
    }

    #[test]
    fn appimage_uses_the_image_folder() {
        assert_eq!(
            folder(
                "/tmp/.mount_CastwrXYZ/usr/bin/castwright",
                Some("/home/me/Apps/Castwright.AppImage"),
                Os::Linux
            ),
            Some(PathBuf::from("/home/me/Apps"))
        );
        assert_eq!(
            folder("/opt/castwright/castwright", Some(""), Os::Linux),
            Some(PathBuf::from("/opt/castwright")),
            "an empty APPIMAGE is ignored"
        );
        assert_eq!(
            folder("/opt/castwright/castwright", None, Os::Linux),
            Some(PathBuf::from("/opt/castwright"))
        );
    }

    #[test]
    fn mac_uses_the_folder_holding_the_bundle() {
        assert_eq!(
            folder(
                "/Volumes/Stick/Castwright.app/Contents/MacOS/castwright",
                None,
                Os::MacOs
            ),
            Some(PathBuf::from("/Volumes/Stick"))
        );
        // A bare binary (e.g. a dev build) uses its own folder.
        assert_eq!(
            folder("/Users/me/dev/target/debug/castwright", None, Os::MacOs),
            Some(PathBuf::from("/Users/me/dev/target/debug"))
        );
        // Only a real bundle layout counts.
        assert_eq!(
            folder("/x/Contents/MacOS/castwright", None, Os::MacOs),
            Some(PathBuf::from("/x/Contents/MacOS"))
        );
    }

    #[test]
    fn detects_marker_file_or_data_folder() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("castwright");
        let layout = |d: &Path| Layout::from_parts(Some(&d.join("castwright")), None, Os::Linux);

        assert_eq!(layout(dir.path()).portable, None);
        assert!(layout(dir.path()).portable_blocked().is_none());

        std::fs::write(dir.path().join(MARKER), b"").unwrap();
        assert_eq!(layout(dir.path()).portable, Some(dir.path().join(DATA)));
        std::fs::remove_file(dir.path().join(MARKER)).unwrap();

        std::fs::create_dir(dir.path().join(DATA)).unwrap();
        let l = Layout::from_parts(Some(&exe), None, Os::Linux);
        assert_eq!(l.portable, Some(dir.path().join(DATA)));
        assert!(l.portable_blocked().is_some());
    }

    #[test]
    fn a_folder_named_portable_is_not_the_marker() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(MARKER)).unwrap();
        assert!(!is_portable(dir.path()));
    }

    #[test]
    fn data_file_blocks_make_portable() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(DATA), b"").unwrap();
        let l = Layout::from_parts(Some(&dir.path().join("castwright")), None, Os::Linux);
        assert_eq!(l.portable, None);
        assert!(l.portable_blocked().unwrap().contains("data"));
    }

    #[cfg(unix)]
    #[test]
    fn read_only_folder_blocks_make_portable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ro = dir.path().join("ro");
        std::fs::create_dir(&ro).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root can write anywhere, so only check when the folder really is read-only.
        if std::fs::File::create(ro.join("x")).is_err() {
            let l = Layout::from_parts(Some(&ro.join("castwright")), None, Os::Linux);
            assert!(l.portable_blocked().unwrap().contains("can't write"));
        }
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn portable_dirs_stay_inside_data() {
        let d = PortableDirs::new(Path::new("/stick/data"));
        for p in [&d.config, &d.data, &d.webview, &d.cache, &d.log] {
            assert!(p.starts_with("/stick/data"), "{}", p.display());
        }
        let mut config = tauri::Config::default();
        Layout {
            app_folder: Some("/stick".into()),
            portable: Some("/stick/data".into()),
        }
        .apply(&mut config);
        assert!(config.app.app_directories_override.is_some());

        let mut config = tauri::Config::default();
        Layout {
            app_folder: Some("/stick".into()),
            portable: None,
        }
        .apply(&mut config);
        assert!(config.app.app_directories_override.is_none());
    }
}
