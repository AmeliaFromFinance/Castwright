---
title: Automation triggers and steps
description: Every trigger and step type, their options, defaults and limits, and how runs behave.
sidebar:
  order: 5
---

An action is a set of trigger and step nodes joined by lines. A run starts at the trigger that fired and follows the lines. This page lists every trigger and step. For a walkthrough, see the [automation guide](/guide/automation/).

## Action settings

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | On | Off stops all triggers. You can still run it by hand. |
| Group | `General` | Folder name in the action list |
| Cooldown | 0 (none) | Seconds before the action can run again, for everyone |
| Triggers | None | What starts it. An action can have several. |
| Steps | None | What it does, joined by lines |

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
| Channel point redemption | `redemption` | Reward (empty means any reward) |
| Poll starts | `poll_begin` | None |
| Poll ends | `poll_end` | None |
| Prediction starts | `prediction_begin` | None |
| Prediction ends | `prediction_end` | None |

An alert variation can also run an action when its alert starts playing. That run gets the event fields, like an Event trigger.

One event starts an action at most once, even when several of its triggers match.

### Event

Fires for every event of the chosen [kind](/reference/events/#event-kinds) whose fields match the conditions. Test events don't run actions; the log notes the skip. Messages Castwright or the bot account sent never fire chat triggers.

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

### Channel points, polls and predictions

**Channel point redemption** fires for redemptions of the picked reward, or of any reward when none is picked. The reward is matched by id, and by title too, so actions shared from another channel still find theirs. Rewards made on Twitch work as well.

**Poll ends** doesn't fire again when a finished poll is hidden (`archived`). **Prediction ends** fires when it's resolved or canceled.

These triggers add short values for templates and conditions. The same values are there when an Event trigger fires for these kinds.

| Trigger | Values |
| --- | --- |
| Redemption | `user`, `reward`, `reward_id`, `redemption_id`, `cost`, `input` |
| Poll | `poll.title`, `poll.choices`, `poll.status`, `poll.winner` (empty on a tie or before the end), `poll.winner_votes`, `poll.total_votes` |
| Prediction | `prediction.title`, `prediction.outcomes`, `prediction.status`, `prediction.winner`, `prediction.total_points`, `prediction.total_users` |

### Manual

Run from the app, a Stream Deck button or the [local HTTP API](/reference/http-api/). Any action can be run this way, with or without a Manual trigger. Manual runs ignore the Enabled switch and the cooldown. Where they start is explained under [Where a run starts](#where-a-run-starts).

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
| Delete message | `delete_message` | Message id (T, empty) | Empty deletes the chat message that started the action, so it works with chat and command triggers. |
| Set chat mode | `set_chat_mode` | Mode, state (`on`), value (0) | Modes: `shield`, `slow`, `followers`, `subscribers`, `emotes`, `unique`. Value is seconds for `slow` (3 to 120, 0 means 30) and minutes for `followers` (0 means any follower). `toggle` flips the current state. |

### Channel points, polls and predictions

Twitch only gives these to Affiliates and Partners. See the [guide](/guide/interact/).

| Step | Type | Options (default) | Notes |
| --- | --- | --- | --- |
| Complete or refund redemption | `finish_redemption` | Refund (off) | Works on the redemption that started the run. Fails when no redemption started it. Only rewards made in Castwright. |
| Enable or pause reward | `set_reward_state` | Reward, state (`pause`) | States: `enable`, `disable`, `pause`, `resume`. Only rewards made in Castwright. |
| Change reward cost | `set_reward_cost` | Reward, cost (T) | The cost must come out as a whole number, 1 or more. |
| Start poll | `start_poll` | Question (T), choices (T), length (120 s), points per extra vote (0) | 2 to 5 choices, up to 25 characters each. Question up to 60 characters. Length 15 s to 30 min. Empty choices are left out. Fails while another poll runs. |
| End poll | `end_poll` | None | Ends the running poll and shows the result. Fails when none runs. |
| Start prediction | `start_prediction` | Question (T), outcomes (T), window (120 s) | 2 to 10 outcomes, up to 25 characters each. Question up to 45 characters. Window 30 s to 30 min. |
| Lock or resolve prediction | `end_prediction` | Action (`lock`), winner (T) | Actions: `lock`, `resolve`, `cancel`. For `resolve`, the winner is an outcome title (capitals don't matter) or its number from 1. Cancel refunds everyone. |

A reward is found by id, or by its title when the id isn't found.

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
| Show/hide overlay layer | `set_layer_visible` | Overlay, layer, state (`on`) | Changes the layer's visibility switch and saves it in the project. A [scene rule](/guide/overlay-editor/#scenes) can still hide it. |
| Play alert | `play_alert` | Title (T), message (T, empty), image (empty), sound (empty), duration in ms (6000) | Joins the alert queue. Duration is kept between 500 and 120,000 ms. |
| Pause alerts | `pause_alerts` | State (`on`) | `on` pauses the queue, `off` resumes it. The alert on screen still finishes. |
| Skip alert | `skip_alert` | None | Ends the alert on screen. Does nothing when no alert is playing. |
| Play sound | `play_sound` | Sound (T), volume (70) | Volume 0 to 100. Plays where alerts play: each open overlay with a visible Alerts layer. Keep one such overlay per scene so it plays once. |

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
| If | `if` | Conditions | Picks which lines to follow. See [If](#if). |
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

Checks its conditions against the run's current values: variables, event fields, command arguments and anything earlier steps set. Then it follows its **Then** lines when they match, or its **Otherwise** lines when they don't. **Always** lines are followed either way.

### Run action

Runs another action inside the current run, starting where a manual run would. They share the same values, so variables set before are visible inside.

- The other action's Enabled switch and cooldown are ignored.
- Nesting goes up to 6 levels. Deeper calls fail with "Actions call each other too deeply."
- A Stop inside the other action ends the whole run.

## How runs behave

### Where a run starts

| Started by | Starts at |
| --- | --- |
| A trigger (command, event, timer, scene, live/offline) | That trigger's node. Other triggers of the action aren't involved. |
| Test, Stream Deck, HTTP API, an alert, a Run action step | The Button or Stream Deck trigger. Without one, all triggers at once, and a step several triggers lead to runs once. Without any triggers, the steps no line leads to. |

### How a run moves

- From each node the run follows every line leaving it, one at a time. Everything after one line finishes before the next line is followed (depth first).
- Lines are taken in order of where they lead: the highest node first, then left to right. Move nodes to change the order.
- When several lines lead into one node, it runs each time it's reached. Nothing waits for the others.
- Lines can loop back. A run stops after 500 steps with "Stopped after 500 steps" in the log, so a loop can't run forever.
- **Stop** ends the whole run, including any lines not yet followed.
- Nodes no trigger leads to never run. The flow marks them **Not connected**.

### Values in a run

A run starts with a copy of all variables, then adds the event fields and command arguments on top. Steps that set variables update both the real variable and the run's copy. Changes made by other actions during the run aren't seen.

### Errors

A failing step doesn't stop the run. The error goes to the log as `<action name>: <step name>: <message>`, and the run carries on along its lines. The run is marked as failed, and the node shows the error after **Test**.

Twitch steps fail when you aren't signed in to Twitch. OBS steps fail when OBS isn't connected.

### Loop protection

| Protection | Limit |
| --- | --- |
| Burst limit | Each action runs at most 20 times in any 10 seconds. Extra runs are skipped with a warning in the log. |
| Own messages | Chat commands and chat triggers ignore messages Castwright or the bot account sent. |
| Bot account | Chat commands ignore every message from the signed-in bot account. |
| Nesting | Run action goes 6 levels deep at most. |
| Steps per run | 500 at most, counting every time a node runs. |

The burst limit applies to manual runs too.
