---
title: Install
description: Download Castwright for Windows, macOS or Linux.
---

Castwright is free. It runs on Windows 10 and 11, macOS 11 or newer, and most Linux desktops.

You also need **[OBS Studio](https://obsproject.com) 28 or newer**. OBS handles your camera, game capture and the actual stream; Castwright controls it and adds overlays, alerts, chat and automation.

## Download

Get the latest version from the [releases page](https://github.com/AmeliaFromFinance/castwright/releases/latest).

| System | File to download |
| --- | --- |
| Windows | `Castwright_x.y.z_x64-setup.exe` (or the `.msi` for managed PCs) |
| macOS | `Castwright_x.y.z_aarch64.dmg` (Apple Silicon: M1 and newer) or `Castwright_x.y.z_x64.dmg` (Intel) |
| Linux | `.AppImage` (any distro), `.deb` (Ubuntu, Debian, Mint) or `.rpm` (Fedora, openSUSE) |

## Windows

1. Run the `-setup.exe`.
2. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the installer isn't code-signed yet.
3. Castwright installs for your user only, no admin rights needed.

Castwright uses the WebView2 runtime, which comes with Windows 11 and up-to-date Windows 10. The installer adds it if it's missing.

## macOS

1. Open the `.dmg` and drag **Castwright** into **Applications**.
2. The first time, **right-click** Castwright in Applications and choose **Open**, then **Open** again. macOS asks this once because the app isn't notarised yet.

If macOS says the app **"is damaged and can't be opened"**, run this once in Terminal:

```sh
xattr -dr com.apple.quarantine /Applications/Castwright.app
```

## Linux

**AppImage**

```sh
chmod +x Castwright_*.AppImage
./Castwright_*.AppImage
```

**Debian / Ubuntu**

```sh
sudo apt install ./Castwright_*_amd64.deb
```

**Fedora**

```sh
sudo dnf install ./Castwright-*.x86_64.rpm
```

Castwright needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-0`), which current distros already have. Saved sign-ins go into your keyring (GNOME Keyring or KWallet). Without a keyring they're stored in a private file instead.

## Portable

You can run Castwright from a USB drive or any folder, with all its data kept next to it.

1. Put the app in a folder you can write to:
   - Windows: copy `Castwright.exe` from your install folder (for example `%LOCALAPPDATA%\Castwright\`).
   - macOS: copy `Castwright.app`.
   - Linux: use the `.AppImage`.
2. Make an empty file called `portable`, or a folder called `data`, next to it.
3. Start Castwright. **Settings → About** now shows **Portable mode**.

To bring your current setup along, use **Settings → About → Make portable…** instead of step 2.

Sign-ins are stored unencrypted in `data/secrets.json` in portable mode, so keep the drive safe. More in [Files and data](/reference/files/#portable-mode).

## Updating

Castwright updates itself. When a new version is out, the status bar shows **Version x.y.z is out** (or **Update** when space is tight).

1. Click it to read what's new.
2. Click **Download and install**. A bar shows the download.
3. Click **Restart to update**.

- **While you're live** the button says **Restart after stream**. Castwright waits, then asks again when the stream ends. It never restarts mid-stream unless you click **Restart now…** and confirm.
- **Every download is checked** against Castwright's signature first. If the check fails, nothing is installed and you get a **Download from GitHub** button instead.
- **Install updates automatically** in [Settings → About](/guide/settings/#about) downloads in the background and installs when Castwright closes.

Your overlays, alerts and settings are kept.

### Which copies update themselves

| Installed from | Updates itself |
| --- | --- |
| Windows `-setup.exe` | Yes. A portable copy updates in its own folder. |
| Windows `.msi` | Yes. Portable copies made from it: download by hand. |
| macOS `.dmg` | Yes. The app is replaced where it is. |
| Linux `.AppImage` | Yes. The AppImage file is replaced, portable or not. |
| Linux `.deb` / `.rpm` | When the release has a signed package for it. Asks for your password. |

When a copy can't update itself, the update window shows **Download from GitHub** instead.

## Next

[First-time setup](/guide/first-run/) walks you through connecting Twitch and OBS.
