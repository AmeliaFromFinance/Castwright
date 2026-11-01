---
title: Files and data
description: Where Castwright keeps its data, the project folder layout, backups, secrets and the .cwoverlay format.
sidebar:
  order: 10
---

Castwright keeps everything on your computer, in two folders: the **settings folder** and the **project folder**.

## Where things are

| System | Settings folder | Default project folder |
| --- | --- | --- |
| Windows | `%APPDATA%\com.castwright.studio\` | `%APPDATA%\com.castwright.studio\Projects\Default\` |
| macOS | `~/Library/Application Support/com.castwright.studio/` | `~/Library/Application Support/com.castwright.studio/Projects/Default/` |
| Linux | `~/.config/com.castwright.studio/` | `~/.local/share/com.castwright.studio/Projects/Default/` |

On Linux, `XDG_CONFIG_HOME` and `XDG_DATA_HOME` change these if set.

**Settings → About** shows the settings folder. **Settings → General → Project folder** shows the project folder, with a button to open it.

## Settings folder

| File | Holds |
| --- | --- |
| `settings.json` | App settings: OBS address, Twitch Client ID, overlay server port and link secret, theme, project folder |
| `secrets.json` | Only when there's no system keychain. See [Secrets](#secrets). |

## Project folder

| File or folder | Holds |
| --- | --- |
| `project.json` | Overlays, alerts and actions |
| `variables.json` | Saved [variables](/reference/variables/) |
| `events.sqlite` | Event history and [custom widget](/reference/custom-widgets/#storage) storage. The `-wal` and `-shm` files next to it belong to it. |
| `assets/` | Images, video, sound and fonts you added |
| `snapshots/` | Automatic backups of `project.json` |
| `project.unreadable-<time>.json` | Only after a recovery. See [Recovery](#recovery). |

### When files are saved

| File | Saved |
| --- | --- |
| `project.json` | Half a second after you stop making changes, and on exit |
| `variables.json` | Within a second of a saved variable changing, and on exit |
| `settings.json` | Right away |

### Event history

- Keeps up to 50,000 events. Older ones are removed now and then.
- Chat isn't saved.
- **Settings → Backups and data → Clear history** deletes it.

### Assets

- Up to 512 MB per file.
- Odd characters in names become `-`. If the name is taken, `-2`, `-3` and so on is added.
- Layers and alerts refer to files as `assets/<name>`.

| Type | Extensions |
| --- | --- |
| Image | `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`, `apng` |
| Video | `webm`, `mp4`, `mov`, `m4v` |
| Audio | `mp3`, `ogg`, `wav`, `m4a`, `aac`, `flac`, `opus` |
| Font | `ttf`, `otf`, `woff`, `woff2` |
| Lottie animation | `json` |

### Using another project folder

**Settings → General → Project folder → Change…** picks a different folder. It takes effect the next time Castwright starts.

- Files aren't moved. Copy your current project folder first if you want to keep it.
- An empty folder gets a new starter project.
- If the folder can't be opened at startup, Castwright uses the default one.

## Backups

| Rule | Value |
| --- | --- |
| When | Before a save, if the last backup is 10 minutes old or more. The first save after each start always makes one. |
| How many | The newest 20. Older ones are deleted. |
| Where | `snapshots/project-<time>.json` |

A backup is a copy of `project.json` only. Variables, history and assets aren't included.

In **Settings → Backups and data**:

- **Back up now** makes one right away.
- **Restore** loads a backup. Your current project is backed up first, so you can undo it.

### Recovery

If `project.json` can't be read when Castwright starts:

1. The file is renamed to `project.unreadable-<time>.json` and kept.
2. The newest backup that can be read is restored.
3. If none can be read, a new starter project is made.

The log says which one happened.

:::caution
A project saved by a newer version of Castwright counts as unreadable in an older version, so an older version restores a backup instead. Your newer file is kept as `project.unreadable-<time>.json`.
:::

## Secrets

Twitch sign-ins and the OBS password are kept in the system keychain:

| System | Keychain |
| --- | --- |
| Windows | Credential Manager |
| macOS | Keychain |
| Linux | Secret Service (for example GNOME Keyring) |

Entries are saved under the service name `com.castwright.studio`.

If no keychain works, they go in `secrets.json` in the settings folder. On macOS and Linux only your user account can read that file. The log shows a warning, and **Settings → About** shows a note.

Castwright doesn't write passwords or sign-in tokens to `settings.json` or `project.json`. The overlay link secret is the exception: it's in `settings.json`.

## `.cwoverlay` files

Exporting an overlay makes one `.cwoverlay` file to share or move.

It's a zip file with:

| Entry | Holds |
| --- | --- |
| `overlay.json` | The overlay: size, layers, fonts |
| `assets/<name>` | Every project file the overlay mentions as `assets/<name>` |

### Importing

| Limit | Value |
| --- | --- |
| Files inside | 500 |
| One file | 256 MB |
| All files together | 512 MB |
| `overlay.json` | 16 MB |

- Files in `assets/` are copied into your project. Names already in use get `-2`, `-3` and so on, and the overlay is updated to match.
- Unsafe file names (with folders, or starting with a dot) are skipped.
- The overlay and its layers get new IDs, so it never replaces an existing overlay.
- [Custom widget](/reference/custom-widgets/) storage isn't included.
