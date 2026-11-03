---
title: Keyboard shortcuts
description: Keyboard shortcuts in the Castwright app, and global hotkeys.
sidebar:
  order: 9
---

On macOS, use <kbd>Cmd</kbd> where this page says <kbd>Ctrl</kbd>.

## Anywhere in the app

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>K</kbd> | Search and run commands: open an overlay, test an alert, run an action, add a stream marker, create a clip, jump to a setting |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> | Overlays |
| <kbd>Ctrl</kbd> + <kbd>2</kbd> | Alerts |
| <kbd>Ctrl</kbd> + <kbd>3</kbd> | Automation |
| <kbd>Ctrl</kbd> + <kbd>4</kbd> | Activity |
| <kbd>Ctrl</kbd> + <kbd>5</kbd> | Interact: channel points, polls and predictions |
| <kbd>Ctrl</kbd> + <kbd>6</kbd> or <kbd>Ctrl</kbd> + <kbd>,</kbd> | Settings |
| <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>Ctrl</kbd> + <kbd>-</kbd> | Zoom in and out (saved as the interface size) |
| <kbd>Ctrl</kbd> + <kbd>0</kbd> | Reset zoom to 100% |
| <kbd>Ctrl</kbd> + <kbd>/</kbd> | Show the shortcut list |

## Chat

With a chat message focused on the Activity page. See [mod tools](/guide/activity/#mod-tools).

| Keys | Does |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move between messages |
| <kbd>Enter</kbd> | Open the message menu |
| <kbd>D</kbd> | Delete the message |
| <kbd>T</kbd> | Time out the sender for 10 minutes |
| <kbd>B</kbd> | Ban the sender (asks first) |

## Panels

| Action | Does |
| --- | --- |
| Drag a divider | Resizes the panels next to it |
| Double-click a divider | Resets its size |
| Focus a divider, then arrow keys | Resizes in steps (<kbd>Shift</kbd> for bigger steps) |
| Click a section title | Folds or unfolds it |

Panel sizes and folded sections are remembered on each computer.

## Forms and dialogs

| Keys | Does |
| --- | --- |
| <kbd>Enter</kbd> in the chat box | Sends the message |
| <kbd>Esc</kbd> | Closes the open dialog |
| Arrow keys | Move between the options of a button row, like Events, Chat and Log on the Activity page |

## Global hotkeys

Global hotkeys work while another app, like a game, has focus. None are set at first. Set them in **[Settings → Hotkeys](/guide/settings/#hotkeys)**.

| Can do | |
| --- | --- |
| Replay last alert | |
| Skip alert | |
| Pause or resume alerts | Toggles |
| Mute or unmute alerts | Toggles |
| Open the go-live check | Also brings the window to the front |
| Add stream marker | Only while live. You can add a note afterwards. |
| Create clip | Only while live. Shows the link when Twitch is done. |
| Run an action | Any automation action |

Key names in `settings.json`, in this order: `Ctrl`, `Alt`, `Shift`, `Super`, then one key.

| Keys | Names |
| --- | --- |
| Letters and digits | `A` to `Z`, `0` to `9` |
| Function keys | `F1` to `F24` |
| Number pad | `Num0` to `Num9`, `NumAdd`, `NumSubtract`, `NumMultiply`, `NumDivide`, `NumDecimal`, `NumEnter` |
| Arrows | `Up`, `Down`, `Left`, `Right` |
| Others | `Space`, `Enter`, `Tab`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `Escape`, `PrintScreen`, `Pause`, `ScrollLock` |
| Symbols | `Minus`, `Equal`, `BracketLeft`, `BracketRight`, `Backslash`, `Semicolon`, `Quote`, `Comma`, `Period`, `Slash`, `Backquote` |
| Media | `MediaPlayPause`, `MediaStop`, `MediaTrackNext`, `MediaTrackPrevious`, `VolumeUp`, `VolumeDown`, `VolumeMute` |

Letters follow your keyboard layout on Windows and Linux. On macOS they follow the key's position on a US keyboard.

Without <kbd>Ctrl</kbd>, <kbd>Alt</kbd> or <kbd>Super</kbd>, only function keys, media keys, `Pause` and `ScrollLock` are allowed.

On Wayland, global hotkeys may not work. See the [Linux note](/guide/settings/#hotkeys).

## Automation canvas

| Keys | Does |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>G</kbd> | Put the selected nodes and notes in a frame |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> | Ungroup: remove the frame, keep its nodes |
| <kbd>Shift</kbd> + double-click | Add a sticky note |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | Select every node, note and frame |

The rest are in the [automation guide](/guide/automation/#working-in-the-flow).

## Overlay editor

The overlay editor has its own shortcuts. They're listed in the [overlay editor guide](/guide/overlay-editor/).
