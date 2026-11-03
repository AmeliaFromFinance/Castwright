---
title: Go-live check
description: A quick check of OBS, overlays, Twitch and alerts before or right after you go live.
---

The go-live check looks for the usual things that break a stream. It takes a few seconds.

Open it from **Go-live check** in the status bar (under **More** when the window is narrow), or search for it in the command palette (<kbd>Ctrl</kbd> + <kbd>K</kbd>).

## What it checks

| Check | Passes when |
| --- | --- |
| **OBS** | Castwright is connected to OBS. |
| **Overlays in OBS** | Each Castwright overlay in OBS uses the current link (port and secret) and is loaded. |
| **Overlay server** | The server is running on the port set in Settings. |
| **Twitch** | Your channel is signed in with every permission Castwright needs, and events are coming in. A sign-in from before channel points, polls and predictions only warns. |
| **Stream title** and **Category** | Both are set on Twitch. |
| **Alerts** | The alert queue isn't paused. |
| **Alert sound** | Alert sound isn't muted. |
| **Recording space** | The disk OBS records to has at least 5 GB free. Only shown while OBS is connected. |

Each result is a pass, a warning or a problem. Problems are listed first.

## Fixes

Most problems have a button next to them:

| Button | What it does |
| --- | --- |
| **Connect** | Connects to OBS. |
| **Fix link** | Updates the Browser Source in OBS to the current overlay link. |
| **Reload** | Reloads the Browser Source, like **Refresh cache of current page** in OBS. |
| **Restart** | Restarts the overlay server on the port from Settings. |
| **Resume** / **Unmute** | Resumes or unmutes alerts. |
| **Open** | Takes you to the right place, like Twitch settings or stream info on the Activity page. |

The check runs again after each fix.

:::note
An overlay counts as "loaded" when its page is open somewhere, usually in OBS. OBS doesn't load sources in scenes it hasn't shown yet, so a warning there can be fine.
:::

## Your list

Add your own tick boxes for things Castwright can't check, like "Mic on" or "Phone on silent". Edit the list in **Settings → Go-live check**, or with **Edit list** in the check.

Ticks stay while the stream runs and clear when it ends.

## When you go live

When the stream starts, Castwright runs the check on its own. It opens only if something fails. Turn this off in **Settings → Go-live check → Open when the stream starts**.
