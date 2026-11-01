---
title: Automation triggers and steps
description: Every trigger and step type, their options, defaults and limits, and how runs behave.
sidebar:
  order: 5
---

An action is a list of steps that runs when one of its triggers fires. This page lists every trigger and step. For a walkthrough, see the [automation guide](/guide/automation/).

## Action settings

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | On | Off stops all triggers. You can still run it by hand. |
| Group | `General` | Folder name in the action list |
| Cooldown | 0 (none) | Seconds before the action can run again, for everyone |
| Triggers | None | What starts it. An action can have several. |
| Steps | None | What it does, in order |

## Triggers

| Trigger | Type | Options |
| --- | --- | --- |
| Event | `event` | Event kind, plus optional [conditions](/reference/conditions/) |
| Chat command | `command` | Name, aliases, permission, per-viewer cooldown |
| Timer | `timer` | Interval, only when live, minimum chat lines |
| Stream goes live | `stream_online` | None |
| Stream ends | `stream_offline` | None |
| Scene changed | `scene_changed` | Scene name (empty means any scene) |
| Manual | `manual` | None |

An alert variation can also run an action when its alert starts playing. That run gets the event fields, like an Event trigger.

One event starts an action at most once, even when several of its triggers match.

### Event

Fires for every event of the chosen [kind](/reference/events/#event-kinds) whose fields match the conditions. Test events count too.

:::caution
Chat message triggers also fire for messages Castwright sent. If the action sends chat, add the condition `data.sent_by_castwright` **is no/false**, or it will trigger itself until the burst limit stops it.
:::

### Chat command

| Option | Default | Notes |
| --- | --- | --- |
| Name | | Without the `!`, for example `so` |
| Aliases | None | Other names for the same command, like `shoutout` |
| Permission | Everyone | Who can use it (see below) |
| Per-viewer cooldown | 0 | Seconds before the same viewer can use it again. Moderators and the broadcaster skip it. |

How a message matches:

- It must start with `!` followed by the name or an alias, then a space or the end of the message. `!sox` doesn't match `so`, and neither does `hey !so`.
- Capital letters don't matter: `!SO` works.
- Messages Castwright sent and messages from your signed-in bot account never run commands.

The command adds `command`, `input`, `arg_count` and `arg1`, `arg2`... for templates. See [templates](/reference/templates/#automation).

Permission levels, highest first. Each level includes everyone above it:

| Permission | Who can use it |
| --- | --- |
| Broadcaster | You |
| Moderator | Moderators and you |
| VIP | VIPs, moderators and you |
| Subscriber | Subscribers (and founders), VIPs, moderators and you |
| Everyone | Anyone |

### Timer

| Option | Default | Notes |
| --- | --- | --- |
| Interval | | Seconds between runs. Anything under 10 counts as 10. |
| Only when live | Off | Skip runs while you're offline |
| Minimum chat lines | 0 | Skip a run unless this many chat messages arrived since the last run |

The first run comes one interval after Castwright starts (or after the trigger is added). A skipped run waits a full interval before checking again.

### Scene changed

Fires when the scene on air in OBS changes. The name match ignores capital letters. The run gets the new scene name as `scene`.

### Manual

Run from the app, a Stream Deck button or the [local HTTP API](/reference/http-api/). Any action can be run this way, with or without a Manual trigger. Manual runs ignore the Enabled switch and the cooldown.

## Steps

Options marked "T" accept [templates](/reference/templates/).

### Chat and Twitch

| Step | Type | Options (default) | Notes |
| --- | --- | --- | --- |
| Send chat message | `chat_send` | Message (T), send as bot (off), reply (off) | Up to 500 characters; longer text is cut. Empty messages are skipped. Without a bot account it sends as you. Reply only works for chat commands. |
| Announcement | `chat_announce` | Message (T), color (`primary`) | Colors: `primary`, `blue`, `green`, `orange`, `purple`. Anything else becomes `primary`. Sent as you. |
| Shoutout | `shoutout` | User (T), message (T, empty) | Takes a login, `@` optional. The message, if any, is sent from the bot account when one is signed in. Twitch allows one shoutout every 2 minutes, and the same streamer once an hour. You can't shout out yourself. |
| Create clip | `create_clip` | None | Only while live. Saves the clip edit link to `last.clip.url`. |
| Stream marker | `create_marker` | Description (T, empty) | Only while live. Description up to 140 characters; longer is cut. |
| Run ad | `run_ad` | Length in seconds | Rounded to the nearest of 30, 60, 90, 120, 150 or 180. |
| Set stream info | `set_stream_info` | Title (T), category (T) | Empty leaves that part unchanged. Titles over 140 characters fail. The category is found by search: an exact name match, otherwise the first result. |
| Time out user | `timeout_user` | User (T), duration in seconds, reason (T, empty) | Duration 1 second to 14 days (1,209,600 s). Reason up to 500 characters. |

### OBS

| Step | Type | Options (default) | Notes |
| --- | --- | --- | --- |
| Switch scene | `switch_scene` | Scene (T) | |
| Show/hide source | `set_source_visible` | Scene (T, empty), source (T), state (`on`) | Empty scene means the scene on air. `on` shows, `off` hides. |
| Mute/unmute | `set_input_mute` | Input (T), state (`on`) | `on` mutes, `off` unmutes. |
| Recording | `recording` | State (`on`) | `on` starts, `off` stops. |
| Save replay | `save_replay` | None | Saves the OBS replay buffer. The replay buffer must be turned on and running in OBS. |

Every state option also takes `toggle`, which flips the current state.

### Overlays and alerts

| Step | Type | Options (default) | Notes |
| --- | --- | --- | --- |
| Show/hide overlay layer | `set_layer_visible` | Overlay, layer, state (`on`) | Changes the layer's visibility switch and saves it in the project. |
| Play alert | `play_alert` | Title (T), message (T, empty), image (empty), sound (empty), duration in ms (6000) | Joins the alert queue. Duration is kept between 500 and 120,000 ms. |
| Play sound | `play_sound` | Sound (T), volume (70) | Volume 0 to 100. Plays in each open overlay that has an Alerts layer. |

### Variables and data

| Step | Type | Options (default) | Notes |
| --- | --- | --- | --- |
| Set variable | `set_variable` | Name (T), value (T), save (off) | Values that read as numbers are stored as numbers. |
| Add to variable | `add_to_variable` | Name (T), amount, save (off) | Negative amounts subtract. Missing or text values count as 0. |
| Web request | `http_request` | Method (`GET`), URL (T), body (T, empty), save to (T, empty) | See [Web request](#web-request). |
| Run script | `run_script` | Code | See [Scripting](/reference/scripting/). |

[Variable names](/reference/variables/#names) are checked after the template is filled in. A bad name fails the step.

### Flow

| Step | Type | Options | Notes |
| --- | --- | --- | --- |
| Wait | `delay` | Milliseconds | Up to 10 minutes. Longer waits are cut to 10 minutes. |
| If | `if` | Conditions, then steps, else steps | See [If](#if). |
| Run action | `run_action` | Action | See [Run action](#run-action). |
| Stop | `stop` | None | Ends the whole run here. |
| Log | `log` | Message (T) | Writes a line to the log on the Activity page. |

### Web request

- Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Only `http://` and `https://` addresses.
- The body is sent for every method except `GET`. It's sent as `application/json` when it's valid JSON, otherwise as plain text.
- Gives up after 10 seconds.
- Any answer outside the 200 range fails the step.
- The response is read up to 64 KB. With **save to** set, the text goes into that variable (session-only).
- Requests identify as `Castwright/<version>`.

```text
POST https://example.com/hook
{"user": "{{name}}", "bits": {{amount}}}
```

### If

Checks its conditions against the run's current values: variables, event fields, command arguments and anything earlier steps set. Then it runs the **then** steps or the **else** steps. A Stop inside either branch ends the whole run.

### Run action

Runs another action's steps inside the current run. They share the same values, so variables set before are visible inside.

- The other action's triggers, Enabled switch and cooldown are ignored.
- Nesting goes up to 6 levels. Deeper calls fail with "Actions call each other too deeply."
- A Stop inside the other action ends the whole run.

## How runs behave

### Values in a run

A run starts with a copy of all variables, then adds the event fields and command arguments on top. Steps that set variables update both the real variable and the run's copy. Changes made by other actions during the run aren't seen.

### Errors

A failing step doesn't stop the run. The error goes to the log as `<action name>: <step name>: <message>`, and the next step runs. The run is marked as failed.

Twitch steps fail when you aren't signed in to Twitch. OBS steps fail when OBS isn't connected.

### Loop protection

| Protection | Limit |
| --- | --- |
| Burst limit | Each action runs at most 20 times in any 10 seconds. Extra runs are skipped with a warning in the log. |
| Own messages | Chat commands ignore messages Castwright sent, from any account. |
| Bot account | Chat commands ignore every message from the signed-in bot account. |
| Nesting | Run action goes 6 levels deep at most. |

The burst limit applies to manual runs too.
