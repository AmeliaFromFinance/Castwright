---
title: Troubleshooting
description: Fixes for the most common problems.
---

Start with **Activity → Log**. Most problems show up there with a plain explanation.

## OBS won't connect

- Is OBS open, and version **28 or newer**? (**Help → About** in OBS.)
- In OBS, **Tools → WebSocket Server Settings**: is **Enable WebSocket server** ticked?
- Does the port match? OBS uses `4455` by default.
- Copy the password again with **Show Connect Info**. It changes if you click **Generate Password**.
- OBS on another PC: use that PC's IP address, and allow port 4455 through its firewall.

## An overlay is blank in OBS

- Castwright has to be **running**. OBS loads overlays from it.
- Copy the link again from **Overlays**, or use **Add to OBS**. Links stop working after **New secret** or a port change.
- In the Browser Source properties, set **Width** and **Height** to the overlay size (usually 1920 × 1080).
- Right-click the source → **Refresh** (or **Properties → Refresh cache of current page**).

## Alerts play but there's no sound

Overlay sound goes through OBS, not your speakers.

- In the Browser Source properties, tick **Control audio via OBS**. The source then appears in the OBS mixer.
- Check it isn't muted. To hear it yourself, set **Audio monitoring** to **Monitor and output**.

## Follows, subs or cheers don't show up

- Check **Settings → Twitch** shows your channel as signed in.
- Some events only exist for **Affiliates and Partners**: subs, bits, channel points, hype trains, polls and predictions.
- If Settings lists event types Twitch refused, sign out and in again to grant the missing permissions.
- Use **Alerts → Test** to check the alert itself works.

## A chat command doesn't answer

- Is the action **enabled**, and does the command name match (without `!`)?
- Check the trigger's **permission** and **cooldown**.
- Messages from your bot account and from Castwright itself are ignored, so commands can't trigger each other in a loop.

## Window effects don't appear

Window effects are Windows only. Mica needs Windows 11, Acrylic works on Windows 10 and 11. macOS and Linux use a solid background.

## Sign-ins aren't remembered on Linux

Castwright stores sign-ins in your system keyring. Install and unlock GNOME Keyring or KWallet. Without one, they're kept in a private file in the settings folder.

## I broke my project. How do I go back?

1. Open **Settings → Backups and data**.
2. Find a backup from before the problem. The date and reason columns help.
3. Click **Restore** and confirm.

Your current project is backed up first, so if you picked the wrong one, restore the newest **Before restore** backup.

Uploaded files aren't in backups. If you deleted one, add it again.

## Start fresh

Close Castwright and delete its settings folder (shown in **Settings → About**). Your project folder isn't touched.

## Still stuck?

[Open an issue](https://github.com/AmeliaFromFinance/castwright/issues) with what you tried and the log from **Activity → Log → Copy**.
