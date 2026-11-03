---
title: Settings and themes
description: Connections, the overlay server, themes and backups.
---

Open **Settings** from the gear at the bottom left, or press **Ctrl + ,** (**⌘ + ,** on Mac).

![Settings](../../../assets/screens/settings.png)

## General

- **Project name**: shown in backups.
- **Project folder**: where your overlays, alerts, actions and uploaded files are saved. Pick a synced folder (Dropbox, OneDrive) to keep a copy elsewhere. Changing it takes effect after a restart.
- **Run setup**: opens the [first-time setup](/guide/first-run/) again.

## OBS

Address, port and password for the OBS WebSocket server. **Test** checks them without saving. The password is kept in your system keychain, never in a plain file. See [Connect OBS](/guide/first-run/#3-connect-obs).

## Twitch

Sign your channel in or out, and optionally a **bot account**. Automation chat messages can be sent as the bot, so viewers see them under its name.

If Twitch refuses some event types (usually after new permissions were added), sign out and in again.

### Use your own Twitch app

Official builds come with a client ID, so you can skip this. If yours doesn't, or you prefer your own:

1. Go to [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) and click **Register Your Application**.
2. Name it anything, set **OAuth Redirect URL** to `http://localhost`, **Category** to *Broadcasting Suite* and **Client Type** to **Public**.
3. Copy the **Client ID** into Castwright and click **Save**.

Changing the client ID signs both accounts out.

## Overlay server

OBS loads overlays from a small web server inside Castwright, at `http://127.0.0.1:7470` by default.

| Setting | Notes |
| --- | --- |
| **Port** | Change it if another program uses 7470. If the port is busy at start-up, Castwright tries the next few. |
| **Allow other devices** | Lets a phone, tablet or second PC on your network open overlays and run actions. Links then use this computer's network address. Off by default. |
| **Link secret** | A random code in every overlay link so other programs can't read your overlays. **New secret** disconnects every open overlay and breaks existing links, so add the overlays to OBS again afterwards. |

## Go-live check

Settings for the [go-live check](/guide/go-live-check/).

| Setting | Default | |
| --- | --- | --- |
| **Open when the stream starts** | On | Runs the check when you go live and opens it only if something fails. |
| **Your list** | empty | Your own tick boxes, like "Mic on". Up to 30. Ticks clear when the stream ends. |

## Themes

Pick **Match system**, one of the built-in themes, or your own. Every built-in theme passes WCAG AA contrast.

To make your own, hover a theme and click its copy button, or click **New theme**:

- Pick an **accent colour** and how strong it is.
- **Surface tint** colours the backgrounds slightly.
- Set **corner radius**, **density** and **font**.
- **Fine-tune individual colours** if you want full control.

The **Readability** table checks every text and background pair as you go and flags anything below the minimum.

Share a theme with **Export** (copies JSON) and **Import** (paste JSON or pick a `.json` file).

Also here:

- **Window background** (Windows only): Mica, Acrylic or Solid. Auto uses Mica on Windows 11.
- **Interface size**: 50% to 250%. <kbd>Ctrl</kbd> + <kbd>+</kbd> and <kbd>Ctrl</kbd> + <kbd>-</kbd> change it from anywhere, <kbd>Ctrl</kbd> + <kbd>0</kbd> resets it. On large screens (like 2560 × 1440) Castwright starts at 125%.
- **Reduce motion**: turns off animations in the app. Overlays keep theirs.

## Backups and data

### Backups

Castwright backs up your project:

- when it starts
- once a day while it runs
- before a restore or import
- before an update converts your project to a new format

A backup holds your overlays, alerts, actions and saved variables. Uploaded files, event history, passwords and sign-ins aren't included. If nothing changed since the last backup, no new one is made.

The list shows each backup's date, reason, project name and size.

| Button | Does |
| --- | --- |
| **Back up now** | Makes a backup straight away. |
| **Restore** | Puts that backup back. Your current project is backed up first, so you can undo it. |
| **Export** (arrow) | Saves a copy anywhere, for example a USB stick or cloud folder. |
| **Delete** (bin) | Removes that backup. |
| **Restore from file…** | Loads a `.cwbackup` file, or a `project.json` from any project folder. |
| **Open folder** | Shows the backups folder. |

How many are kept:

- **Daily backups**: days to keep, one backup per day. Default 14.
- **Other backups**: ones made with **Back up now** or before a restore, import or upgrade. Default 5.

Backups made by older versions of Castwright still restore. They're converted the same way as an old project. If a restore fails, your project stays as it was and the error says why.

See [Files and data](/reference/files/#backups) for where they're stored.

### Data

- **Reset session counters** sets this stream's follow, sub, bit and raid totals to zero.
- **Clear history** deletes saved events.

## About

Version, where settings are stored and links to this guide. **Check for updates** asks GitHub for a newer release. Castwright also checks once a day and shows a link in the status bar when one is out.
