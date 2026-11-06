---
title: Files and data
description: Where Castwright keeps its data, the project folder layout, backups, secrets and the .cwoverlay and .cwactions formats.
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

In [portable mode](#portable-mode) everything is in one `data` folder next to the app instead.

## Settings folder

| File | Holds |
| --- | --- |
| `settings.json` | App settings: OBS address, Twitch Client ID, overlay server port and link secret, theme, project folder |
| `secrets.json` | Only when there's no system keychain, or in portable mode. See [Secrets](#secrets). |
| `.window-state.json` | Window size and position |

## Project folder

| File or folder | Holds |
| --- | --- |
| `project.json` | Overlays, alerts and actions |
| `variables.json` | Saved [variables](/reference/variables/) |
| `events.sqlite` | Event history and [custom widget](/reference/custom-widgets/#storage) storage. The `-wal` and `-shm` files next to it belong to it. |
| `assets/` | Images, video, sound and fonts you added |
| `templates/` | [Overlay templates](/guide/overlays/#your-own-templates) you saved, as `.cwoverlay` files |
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

- Any image, video or sound setting opens a window with your files: pictures and videos show a preview, sounds have a play button. Search by name, or use **Add files** to bring in several at once.
- To delete a file, hover it in that window and click the bin. Anything still using it shows it as missing.
- Up to 512 MB per file.
- Odd characters in names become `-`, and extensions become lowercase. Long names are shortened. If the name is taken, `-2`, `-3` and so on is added.
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

Backups are kept in a `backups` folder next to the default project folder:

| System | Backups folder |
| --- | --- |
| Windows | `%APPDATA%\com.castwright.studio\backups\` |
| macOS | `~/Library/Application Support/com.castwright.studio/backups/` |
| Linux | `~/.local/share/com.castwright.studio/backups/` |

| Rule | Value |
| --- | --- |
| When | On start, once a day, before a restore or import, and before an update converts the project |
| Skipped | When nothing changed since the last backup of the same project |
| How many | One start-up or daily backup per day for the last 14 days, plus the 5 newest others. Change both in **Settings → Backups and data**. |
| File name | `<date>_<time>Z_<reason>.cwbackup`, in UTC |

Each project folder has its own backups, even though they share one folder. Files that can't be read are never deleted automatically.

### `.cwbackup` files

A zip file with:

| Entry | Holds |
| --- | --- |
| `backup.json` | Date, reason, project name, format and app version |
| `project.json` | Overlays, alerts and actions |
| `variables.json` | Saved [variables](/reference/variables/) |

Not included: `settings.json`, secrets, event history, custom widget storage and `assets/`. Keep a copy of `assets/` yourself if you need it.

**Restore from file…** also accepts a plain `project.json`. It keeps your current variables.

### Recovery

If `project.json` can't be read when Castwright starts:

1. The file is renamed to `project.unreadable-<time>.json` and kept.
2. The newest backup of that project that can be read is restored.
3. If none can be read, a new starter project is made.

The log says which one happened.

:::caution
A project saved by a newer version of Castwright counts as unreadable in an older version, so an older version restores a backup instead. Your newer file is kept as `project.unreadable-<time>.json`.
:::

## Logs

Castwright writes its log to a `logs` folder in the data folder:

| System | Logs folder |
| --- | --- |
| Windows | `%APPDATA%\com.castwright.studio\logs\` |
| macOS | `~/Library/Application Support/com.castwright.studio/logs/` |
| Linux | `~/.local/share/com.castwright.studio/logs/` |
| Portable | `data/logs/` |

| File | Holds |
| --- | --- |
| `castwright.log` | The log of this run and earlier ones |
| `castwright.1.log`, `castwright.2.log` | Older log. When `castwright.log` reaches 1 MB it becomes `castwright.1.log`, and the oldest is deleted. |
| `crash.json` | Written when Castwright hits an error it can't recover from. If it's still there at the next start, Castwright offers a bug report. |
| `last-crash.json` | The last crash, once seen. Added to bug reports. |

These files may hold private details like overlay links, so don't share them as they are. A [bug report](/guide/health/#save-a-bug-report) removes secrets first.

## Secrets

Twitch sign-ins and the OBS password are kept in the system keychain:

| System | Keychain |
| --- | --- |
| Windows | Credential Manager |
| macOS | Keychain |
| Linux | Secret Service (for example GNOME Keyring) |

Entries are saved under the service name `com.castwright.studio`.

If no keychain works, they go in `secrets.json` in the settings folder. On macOS and Linux only your user account can read that file. The log shows a warning, and **Settings → About** shows a note.

In portable mode the keychain isn't used at all, so sign-ins travel with the app. They're in `data/secrets.json`, which isn't encrypted and says so at the top. Encrypting it wouldn't help much: the key would have to sit on the same drive, or you'd type a password every time Castwright starts.

Castwright doesn't write passwords or sign-in tokens to `settings.json` or `project.json`. The overlay link secret is the exception: it's in `settings.json`.

## Portable mode

Castwright is portable when either of these is next to the app when it starts:

- a file called `portable` (it can be empty)
- a folder called `data`

"Next to the app" means:

| System | Folder |
| --- | --- |
| Windows | The folder with `Castwright.exe` |
| macOS | The folder with `Castwright.app` |
| Linux AppImage | The folder with the `.AppImage` file |
| Linux, other | The folder with the `castwright` program |

All data then goes in `data`:

| In `data/` | Holds |
| --- | --- |
| `settings.json` | App settings and hotkeys |
| `secrets.json` | Passwords and sign-ins. Not encrypted. |
| `.window-state.json` | Window size and position |
| `Projects/Default/` | The default [project folder](#project-folder) |
| `backups/` | [Backups](#backups) |
| `webview/` | The app window's own storage, like panel sizes (Windows and Linux) |
| `logs/` | [Log files and the crash file](#logs) |
| `cache/` | Made if needed |

On macOS the app window's storage stays in the usual place, because macOS doesn't let apps move it.

A project folder set in **Settings → General** to somewhere outside `data` is still used. Point it inside `data` if it should travel too.

**Settings → About → Make portable…** sets this up for you. See [Settings → Portable mode](/guide/settings/#portable-mode).

To stop using portable mode, close Castwright and move or rename `data` (and delete `portable` if you made one).

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

- Files in `assets/` are copied into your project. If the project already has the same file under the same name, that one is used. Other names already in use get `-2`, `-3` and so on, and the overlay is updated to match.
- Unsafe file names (with folders, or starting with a dot) are skipped.
- The overlay and its layers get new IDs, so it never replaces an existing overlay.
- [Custom widget](/reference/custom-widgets/) storage isn't included.

## `.cwactions` files

[Exporting actions](/guide/automation/#share-actions) makes one `.cwactions` file. It's plain JSON:

| Field | Holds |
| --- | --- |
| `kind` | Always `castwright-actions` |
| `version` | File format version, now `1` |
| `app_version` | Castwright version that made it |
| `exported_at` | Time of export, in ms since 1970 |
| `actions` | The actions, as in `project.json` |
| `variables` | `name`, `default` and `secret` for each variable the actions use |
| `refs` | What the steps point at that isn't in the file |

Each entry in `refs` has a `kind` (`layer`, `action` or `asset`), the `id` and `name` it had in the project it came from, and for layers the `overlay_id` and `overlay_name`. On import these are linked to items in your project.

### Importing

- Files from a newer version of Castwright are refused. Update Castwright to import them.
- Files over 16 MB are refused.
- Actions get new IDs. **Replace** keeps the ID and name of the action it replaces, so steps and Stream Deck buttons that run it keep working.
- Steps that run another action from the same file are linked to its new copy.
- Every imported action is turned off.
- Variables that don't exist yet are created with their `default` and saved. Existing ones keep their value.
- `default` is always empty for `secret` variables, even if the file says otherwise.
