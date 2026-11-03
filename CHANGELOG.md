# Changelog

What changed in each version of Castwright. The newest version is at the top.

## 0.10.0 (2026-11-03)

### New

- **Right-click menus in Automation.** Search every step and trigger from the canvas, and insert steps after a node or in the middle of a line. Press **A** or **/** to search at the pointer.
- **Edit several layers at once.** Shift or Ctrl+click, or drag a box, then change fonts, colours, styles or alignment for all of them.
- **Timer controls.** Start, pause, resume and reset timers from the layer settings, the right-click menu, automation or Stream Deck. Every overlay stays in sync.
- **List order.** Chat can show new messages at the top, event lists newest at the bottom, tickers and credits in either direction.
- **Default font.** Set one font in Settings → Appearance for all chat, alerts and layers that don't pick their own.

### Fixed

- Messages Twitch removes (deleted, timed out, banned or cleared) now disappear from chat everywhere. **Show removed messages** brings them back crossed out.
- Clicking **Logic → If** could leave the menu stuck and the page frozen.
- Clicking through styles no longer shrinks text. Presets keep your font size.
- Adding a video to an alert could crash the app.
- Links (Full changelog, Guide, Source code, Report a problem) now open in your browser.
- Navigation labels no longer spill out of the highlighted box.

## 0.9.0 (2026-11-03)

### New

- **Giveaways.** People enter with a chat keyword or a channel point reward. Set who can enter, give subs extra entries, draw winners, re-roll and set a time to claim. A **Giveaway** layer spins through names and lands on the winner.
- **Viewer queue.** `!join`, `!leave` and `!position`, sub priority, drag to reorder and **Next** for a whole party. A **Viewer queue** layer shows who's playing and who's next.
- **Hype train layer.** Level, progress, time left and top contributors, with a "Level up!" moment. Adds `hype.*` variables and hype train triggers.
- **Soundboard.** Sounds on stream, just for you or both, with cooldowns, pages, hotkeys, channel point rewards, `!sound` and Stream Deck links.
- Automation: giveaway and queue triggers and steps, and a **Play soundboard sound** step.

### Improved

- The status bar fits any window width. Less important items shorten, then move into a **More** menu. Pick which stats show in Settings → Appearance.

## 0.8.0 (2026-11-03)

### New

- **One-click updates.** Download and install from the update notice, then restart. While you're live it waits until the stream ends. Turn on **Install updates automatically** in Settings → About.
- **Stream markers and clips on a hotkey.** A toast lets you add a note to a marker or copy a clip link. Both are listed in the stream summary.
- **Now playing layer.** The current song from Spotify, a local player (Windows and Linux) or a text file, with cover art and a progress bar. Adds `music.*` variables and a **Song changes** trigger.
- **Chat filters and highlights.** Hide bots, commands, users or words. Highlight first-time chatters, mentions, keywords and chosen users, in the app and in overlay chat.
- **Variable inspector.** See where each variable is written and read, jump to it, catch typos and rename it across the project.

### Improved

- The Discord end post lists clips.
- The update window shows the release notes.

## 0.7.0 (2026-11-03)

### New

- **Ad break helper.** The status bar counts down to the next ad. Snooze it, run one now, and get a warning before it starts. Castwright never switches scenes for ads: subs and Turbo viewers keep watching.
- **Ad break layer.** A heads-up for viewers before an ad, and a thank-you during it.
- **Discord posts.** Post to Discord when you go live, and a summary when you end. Pick who gets pinged.
- **Credits layer.** An end-of-stream roll of followers, subs, gifters, cheerers, raiders and chatters. Start it with the **Roll credits** step.
- **Action templates.** Start a new action from 10 ready-made setups, like a raid shoutout or a death counter.
- **Health panel.** Overlays, OBS, Twitch and recent problems in one place. The heart in the status bar changes colour when something's wrong.
- **Bug reports.** Save a zip with logs and settings, secrets removed. Nothing is uploaded.
- Automation: ad triggers, **Snooze ad** and **Post to Discord** steps, and a **Chat message** trigger.

### Improved

- The Ending overlay template includes a credits roll.
- Log files are kept in the data folder.

## 0.6.0 (2026-11-03)

### New

- **Channel points.** Create and edit rewards, then complete or refund redemptions, one at a time or in bulk. On the new **Interact** page (Ctrl+5).
- **Polls and predictions.** Start, end, lock and resolve them, with a live **Poll / prediction** overlay layer.
- **Mod tools in chat.** Hover or right-click a message to delete it, time out or ban the sender, reply, copy it or send a shoutout. D, T and B work on a focused message.
- **Viewer cards.** Click a name to see account age, follow age, sub status, their messages this stream and your own mod note.
- **Chat modes** in the chat header: shield mode, slow mode, followers-only, subs-only, emote-only and unique chat.
- **Scene-aware layers.** Show a layer only in some OBS scenes, or hide it in some. Check any scene with **Preview as scene** in the editor.
- **Notes and frames** on the automation canvas. Ctrl+G groups nodes in a frame; frames can collapse.
- **What's new** window after an update. Open it again from Settings → About or the command palette.
- Automation: triggers for redemptions, polls and predictions, plus steps for rewards, polls, predictions, **Delete message** and **Set chat mode**.

### Improved

- Deleted chat messages stay in the chat panel, marked as deleted. They still disappear from overlays.
- Settings moved to Ctrl+6. Ctrl+, still opens it.

## 0.5.0 (2026-11-03)

### New

- **Global hotkeys** that work while another app has focus. Set them in Settings → Hotkeys.
- **Portable mode** for running Castwright from a USB drive.
- **Stream summary** when a stream ends: time live, viewers, follows, subs, bits, chat and raids. Past streams are listed in Activity → Sessions.
- Export a summary as an image, CSV or JSON, or copy a short text for socials.
- **Overlay templates.** Save an overlay as a template and start new ones from it.
- **Share actions** as `.cwactions` files.

### Fixed

- The hotkey recorder follows your keyboard layout for letters.

## 0.4.0 (2026-11-03)

### New

- **Live run trace.** Watch each node of an action light up as it runs, with the line it took.
- **Run history** for every action.
- **Alert controls** in the status bar: pause, mute and replay the last alert.
- **Go-live check** before you start streaming.
- **Automatic backups** of your project, with restore.

### Improved

- The flow canvas scrolls when you drag a node or line to its edge.

## 0.3.0 (2026-11-02)

### New

- **Free-form automation canvas.** Drag nodes anywhere and connect any side to any side.

### Improved

- Each node shows its own run result.
- Pasting from the clipboard works reliably.
- The old list view is gone. The canvas does everything it did.

### Fixed

- Mistakes in the automation steps reference.

## 0.2.0 (2026-11-02)

### New

- **7TV, BetterTTV and FrankerFaceZ** emotes, plus 7TV name paints and badges, in overlay chat and the app.
- Twitch badge images on chat messages.
- **Box styles** for layers, chat and alert cards: shapes, fills, patterns, borders, stripes and shadows. Start from a preset.
- **Zoom** with Ctrl + and Ctrl -. Large screens get a bigger interface.
- **Node flow editor** for automation, with undo and drag and drop.
- **Command palette** (Ctrl K) and a list of keyboard shortcuts (Ctrl /).
- A notice in the status bar when a newer version is out.

### Improved

- The Studio page is gone. Stream title and category moved to Activity.
- Panels can be resized and collapsed.

### Fixed

- A crash when clicking Run now on an action.

## 0.1.0 (2026-11-01)

### New

- First release.
- Overlays with a visual editor, served from your computer to OBS.
- Alerts with a queue, sounds and variations.
- Automation: actions with triggers, steps and small scripts.
- Twitch sign-in, live events and chat.
- OBS control: scenes, sources, audio, recording and streaming.
- Activity page with event history, chat and the app log.
- First-time setup, themes and a theme editor.
