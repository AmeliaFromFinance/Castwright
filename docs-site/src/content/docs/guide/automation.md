---
title: Automation
description: Chat commands, timers and reactions to events, built from simple steps.
---

An **action** is a list of steps that runs when one of its triggers fires. Use actions for chat commands, timed messages, raid welcomes, counters, scene switches and much more.

![Automation](../../../assets/screens/automation.png)

## The page

- **Left**: your actions, in folding sections (Chat commands, Stream events, Timers, Buttons and Stream Deck, plus your own groups). Search opens the sections that match.
- **Middle**: the selected action as a **flow**: its triggers at the top, then each step in order. An **If** step splits into **Then** and **Otherwise** lanes side by side.
- **Right**: the run log and every variable. Fold either one, or drag the divider between them.

Drag the dividers to resize any column. **Flow / List** at the top switches to a compact list of steps if you prefer it.

## Working in the flow

- Click a step to edit it in the panel that opens beside the flow.
- Hover between two steps and click **+** to insert one there, or use the bar at the bottom of the flow.
- Drag a step to move it, including into or out of an If lane.
- **Test** runs the action now. Each step shows a tick or the error it hit.
- Zoom with the buttons in the corner, or <kbd>Ctrl</kbd> + scroll over the flow.

| Keys | Does |
| --- | --- |
| Arrow keys | Move between steps |
| <kbd>Enter</kbd> / <kbd>Esc</kbd> | Open or close the step panel |
| <kbd>Delete</kbd> | Remove the step |
| <kbd>Ctrl</kbd> + <kbd>D</kbd> | Duplicate it |
| <kbd>Ctrl</kbd> + <kbd>X</kbd> / <kbd>C</kbd> / <kbd>V</kbd> | Cut, copy, paste after the selected step |
| <kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Move it up or down |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Undo and redo |

## Start an action

Click **New action** and pick a template (chat command, timer message, raid welcome, deaths counter) or start blank. Every change saves on its own.

| Setting | What it does |
| --- | --- |
| **Group** | Sorts actions in the list, for example "Chat commands". |
| **Cooldown** | Shortest time between two runs. 0 means no limit. |
| **Enabled** | Off stops all triggers. **Test** still works. |

## Triggers

An action can have several triggers. Any of them starts it.

| Trigger | Fires when |
| --- | --- |
| **Chat command** | Someone types the command, like `!so @name`. Set other names it answers to, **who can use it** and a **per-viewer cooldown** (moderators and you skip it). |
| **Twitch event** | A follow, sub, raid, redemption and so on happens, optionally only when [conditions](/reference/conditions/) match. |
| **Timer** | Every few minutes. Can be limited to while you're live and to when chat has been active. Runs at most every 10 seconds. |
| **Stream goes live** / **Stream ends** | Your stream starts or stops. |
| **Scene changes** | OBS switches to a scene (or any scene). |
| **Button or Stream Deck** | Only runs when you click **Test** or call its [run link](/guide/stream-deck/). |

Messages from your bot and from Castwright itself never trigger actions, so actions can't set each other off in a loop. Test events from the Alerts page don't run actions either; use **Test** to try one.

## Steps

Steps run from top to bottom. Add one from the flow and pick from:

| Group | Steps |
| --- | --- |
| **Chat** | Send chat message (as you or the bot, optionally as a reply), announcement |
| **Twitch** | Shoutout, create clip, stream marker, run ad, set title and category, time out user |
| **OBS** | Switch scene, show/hide source, mute/unmute, recording, save replay |
| **Overlays & alerts** | Show/hide overlay layer, play a custom alert, play sound |
| **Variables** | Set variable, add to variable |
| **Logic** | If, wait, run another action, stop |
| **Advanced** | Web request, run a [script](/reference/scripting/), write to the log |

Text fields accept live values in `{{double braces}}`. In web request addresses, add `| url` to keep chat input from breaking the link, like `{{input | url}}`. The chips under each field show what's available, such as `name`, `arg1` (the first word after a command) and `input` (everything after it). See [templates](/reference/templates/).

**If** steps run their **Then** steps only when the conditions match, and **Otherwise** steps when they don't. They can be nested.

Every step and option is described in the [automation steps reference](/reference/automation-steps/).

## Examples

**`!so` shoutout**: trigger *Chat command* `so`, who can use it *Moderators and the streamer*; step *Shoutout* with `{{arg1}}`.

**Deaths counter**: trigger *Chat command* `death`; steps *Add to variable* `counter.deaths` by 1, then *Send chat message* `Deaths: {{counter.deaths}}`. Show it on stream with a **Counter** layer.

**Raid welcome**: trigger *Twitch event* `Raid` when `amount is at least 10`; steps *Switch scene* to "Raid", *Wait* 15 seconds, *Switch scene* back.

## Run log and variables

The right side shows each run with its result and any errors, plus every [variable](/reference/variables/). Edit a value inline, delete it, or add one. The pin keeps a variable after Castwright restarts.
