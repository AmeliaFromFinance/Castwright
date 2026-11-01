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
| macOS | `Castwright_x.y.z_universal.dmg` (Intel and Apple Silicon) |
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

## Updating

Download the new version and install it over the old one. Your overlays, alerts and settings are kept.

## Next

[First-time setup](/guide/first-run/) walks you through connecting Twitch and OBS.
