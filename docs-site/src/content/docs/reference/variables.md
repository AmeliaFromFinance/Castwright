---
title: Variables
description: Named values that overlays, actions and scripts can read and change, including the built-in ones.
sidebar:
  order: 4
---

Variables are named values, like `counter.deaths` or `session.subs`. Actions change them, overlays show them, and conditions can check them.

## Names

- Letters, numbers, dots (`.`), dashes (`-`) and underscores (`_`)
- Up to 128 characters
- No dot at the start or end, and no two dots in a row
- Capital letters matter: `Deaths` and `deaths` are different variables

Dots are only part of the name. They're a handy way to group things, like `counter.deaths` and `counter.wins`.

## Values

A variable holds text, a number, or true/false. Whole numbers are stored without decimals, so they show as `3`, not `3.0`.

The "Set variable" step stores anything that reads as a number as a number. See [conditions](/reference/conditions/#numbers-and-text) for what counts.

## Saved or session-only

| Type | Kept after closing Castwright |
| --- | --- |
| Saved | Yes, in `variables.json` in the project folder |
| Session-only | No |

Steps that set variables have a **Save** option. Changes are written to disk within a second.

Names starting with `stream.`, `obs.`, `twitch.`, `ads.`, `music.`, `hype.`, `giveaway.` or `queue.` describe live state and are never saved, even with Save on.

## Built-in variables

Castwright keeps these up to date. Test events don't change them.

### Latest events

Saved. Updated when the event arrives.

| Variable | Set by | Value |
| --- | --- | --- |
| `last.follow.name` | Follow | Follower name |
| `last.sub.name` | Sub, resub, gift sub | Subscriber name. For gift subs, the recipient. |
| `last.sub.tier` | Sub, resub | `1`, `2` or `3` |
| `last.sub.months` | Sub, resub | Total months |
| `last.gift.name` | Gift sub, community gift | Gifter name |
| `last.gift.amount` | Gift sub, community gift | `1` for a gift sub, the number of subs for a community gift |
| `last.cheer.name` | Cheer | Cheerer name |
| `last.cheer.amount` | Cheer | Bits |
| `last.raid.name` | Raid | Raiding channel |
| `last.raid.viewers` | Raid | Viewers |
| `last.redemption.name` | Channel points | Viewer name |
| `last.redemption.reward` | Channel points | Reward title |
| `last.donation.name` | Charity donation | Donor name |
| `last.donation.amount` | Charity donation | Amount |
| `last.event.name` | Any kind that can alert | Name of whoever caused it |
| `last.event.kind` | Any kind that can alert | The [event kind](/reference/events/#event-kinds), like `raid` |
| `last.clip.url` | The "Create clip" step | Link to edit the new clip |

Anonymous gifters and cheerers show as `Anonymous`.

### Session counters

Saved. They count up during a stream.

| Variable | Counts |
| --- | --- |
| `session.follows` | Follows |
| `session.subs` | Subs, resubs and gifted subs |
| `session.gifts` | Gifted subs |
| `session.bits` | Bits cheered |
| `session.raids` | Raids |
| `session.donations` | Charity donation amounts added up |

A community gift of 5 subs adds 5 to `session.subs` and `session.gifts`, through the 5 single gift events that follow it.

The counters go back to 0:

- automatically when your stream goes live
- when you click **Settings → Backups and data → Session counters → Reset**

`last.*` values are kept when the counters reset.

### Stream

Session-only. Needs your Twitch account signed in.

| Variable | Value |
| --- | --- |
| `stream.live` | `true` while live |
| `stream.viewers` | Current viewer count, `0` when offline |
| `stream.title` | Stream title |
| `stream.category` | Category name |
| `stream.started_at` | When the stream started (Unix time in milliseconds), `0` when offline |
| `stream.uptime_text` | Time live, like `1h 23m` or `23m`. Empty when offline. |

Stream info is fetched from Twitch every 60 seconds and `stream.uptime_text` refreshes every 30 seconds. Going live, going offline and title or category changes update them right away.

### OBS

Session-only. Updated when they change.

| Variable | Value |
| --- | --- |
| `obs.connected` | `true` while connected to OBS |
| `obs.scene` | Name of the scene on air (the program scene) |
| `obs.streaming` | `true` while OBS is streaming |
| `obs.recording` | `true` while OBS is recording |

### Twitch account

Session-only. Checked every 5 seconds.

| Variable | Value |
| --- | --- |
| `twitch.login` | Your channel login, empty when signed out |
| `twitch.display_name` | Your channel display name |
| `twitch.user_id` | Your channel id, empty when signed out |
| `twitch.bot_login` | Your bot account login, empty without one |

### Music

Session-only. Set from [Settings → Music](/guide/music/).

| Variable | Value |
| --- | --- |
| `music.title` | Song title, empty when no song is known |
| `music.artist` | Artist, or several joined with commas |
| `music.album` | Album |
| `music.art_url` | Cover image link |
| `music.playing` | `true` while playing |
| `music.progress_ms` | Position in milliseconds |
| `music.duration_ms` | Length in milliseconds, `0` when unknown |

### Hype train

Session-only. Set from Twitch's hype train events. Nothing is set until the first train after Castwright starts.

| Variable | Value |
| --- | --- |
| `hype.active` | `true` while a hype train runs |
| `hype.id` | Twitch's id for the train |
| `hype.level` | Current level. After the end, the level reached. |
| `hype.progress` | Points toward the next level |
| `hype.goal` | Points the level needs |
| `hype.percent` | `progress` out of `goal`, `0` to `100` |
| `hype.total` | All points so far |
| `hype.started_at` | When it started (Unix time in milliseconds) |
| `hype.ends_at` | When it runs out (Unix time in milliseconds), `0` after the end |
| `hype.type` | `regular`, `golden_kappa` or `treasure` |
| `hype.shared` | `true` for a shared train with other channels |
| `hype.shared_with` | Channels on a shared train, joined with commas |
| `hype.top` | Top contributors as a list (name, type, total) |
| `hype.top_bits_name` | Top bits contributor |
| `hype.top_bits` | Their bits |
| `hype.top_sub_name` | Top sub contributor |
| `hype.top_subs` | Their sub points (Twitch counts 500 for a Tier 1 sub) |
| `hype.record_level` | Your highest level ever, when Twitch sends it |
| `hype.last_level` | Level the last train reached |
| `hype.ended_at` | When the last train ended (Unix time in milliseconds) |

Types and shared trains need Twitch's newer hype train events. Castwright asks for them and falls back to the older ones, which only know golden Kappa trains.

### Ads

Set while you're live, from Twitch's ad schedule.

| Name | Value |
| --- | --- |
| `ads.next_at` | When the next ad starts (Unix time in milliseconds), `0` when none is scheduled |
| `ads.length_s` | Length of the next ad in seconds |
| `ads.running` | `true` while an ad runs |
| `ads.ends_at` | When the running ad ends (Unix time in milliseconds), `0` when none runs |
| `ads.running_length_s` | Length of the running ad in seconds |
| `ads.snoozes` | Snoozes left |

### Giveaways

Session-only. Set from [Interact → Giveaways](/guide/giveaways-queue/).

| Variable | Value |
| --- | --- |
| `giveaway.title` | The prize, empty when no giveaway runs |
| `giveaway.status` | `open`, `closed` (entries stopped) or `idle` (none running) |
| `giveaway.open` | `true` while entries are open |
| `giveaway.entries` | People who entered |
| `giveaway.keyword` | The chat word to enter, like `!join` |
| `giveaway.winner` | The latest winner, empty before the draw |
| `giveaway.draw` | The last draw, for Giveaway layers: names to spin through and the winner |

### Viewer queue

Session-only. Set from [Interact → Queue](/guide/giveaways-queue/#viewer-queue).

| Variable | Value |
| --- | --- |
| `queue.size` | People waiting |
| `queue.open` | `true` while viewers can join |
| `queue.next` | Who's next in line, empty when nobody waits |
| `queue.playing` | Who's playing now, joined with commas |
| `queue.lineup` | The first 20 in line, for Viewer queue layers |
| `queue.party` | Who's playing now, for Viewer queue layers |

## Changing variables

| How | Details |
| --- | --- |
| "Set variable" step | Sets text or a number. Name and value can use [templates](/reference/templates/). |
| "Add to variable" step | Adds a number (use a negative number to subtract). Missing or non-number values count as 0. |
| "Web request" step | Saves the response text (session-only). |
| "Create clip" step | Sets `last.clip.url`. |
| "Run script" step | `set()` and `save()`. See [scripting](/reference/scripting/). |

## Using variables in overlays

| Layer setting | Uses |
| --- | --- |
| Text layer text | `{{variable}}` [templates](/reference/templates/) |
| Counter layer | One variable, shown through its format (`{{value}}`) |
| Goal layer | One variable as the current amount, for example `session.subs` |
| Timer layer, anchor | A variable holding a Unix time in milliseconds. A countdown runs for its length from that time (with length 0, the time is the end). A stopwatch counts up from it. |
| Timer layer, uptime mode | `stream.started_at` |
| Layer "visible when" | [Conditions](/reference/conditions/) on variables |

To start a timer from an action, save the current time with a script step:

```js
save("timer.break", now_ms());
```

## Where a variable is used

Click a variable on the Automation page to see what sets it and what reads it. See the [variable inspector](/guide/automation/#variable-inspector).

What counts as using a variable:

| Sets it | Reads it |
| --- | --- |
| "Set variable" and "Add to variable" steps | `{{templates}}` in step fields, alert titles and messages |
| "Web request" step, **Save response to** | Conditions in triggers, If steps, alert variations and layer "visible when" |
| "Create clip" step (`last.clip.url`) | Text, goal and credits layer texts |
| `set("name", ...)` and `save("name", ...)` in scripts | Counter, goal and timer layer variables |
| Castwright itself, for built-in variables | `get("name")` in scripts |
| | Ad break layers (`ads.*`), hype train layers (`hype.*`), Giveaway layers (`giveaway.*`), Viewer queue layers (`queue.*`) and timers in uptime mode (`stream.started_at`) |

Scripts only count when the name is written as plain text, like `get("counter.deaths")`. Custom widgets and the [local API](/reference/http-api/) aren't checked.

Templates in Discord posts and the "Copy for socials" text can't use variables, so they never count.

## Renaming

Rename a variable from its details. Every place that uses it changes too, and its value moves to the new name. A backup is made first, so you can undo it.

Built-in variables can't be renamed.

## Resetting and removing

- Session counters: see above.
- Any other variable: set it to `0` or empty text with a "Set variable" step.
- Saved values live in `variables.json` in the [project folder](/reference/files/). You can edit or delete entries there while Castwright is closed.
