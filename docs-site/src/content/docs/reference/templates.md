---
title: Templates
description: The {{ key | filter }} syntax used in alert text, automation steps and overlay text.
sidebar:
  order: 2
---

Templates put live values into text. Write a key between double curly braces and Castwright swaps it for the value.

```text
{{name}} cheered {{amount | number}} bits
```

## Syntax

| Write | Result |
| --- | --- |
| `{{name}}` | The value of `name`. Spaces inside the braces are fine: `{{ name }}`. |
| `{{user.login}}` | A value inside another value, using dots. |
| `{{data.choices.0.title}}` | An item in a list, by position (starting at 0). |
| `{{last.sub.name}}` | A [variable](/reference/variables/). Keys that contain dots are matched whole first. |
| `{{name \| upper}}` | A value passed through a filter. |
| `{{name \| default:"someone" \| upper}}` | Filters run left to right. |

### How values show up

| Value | Shown as |
| --- | --- |
| Missing key or empty (`null`) | Nothing |
| Text | The text |
| Whole number | `3` (never `3.0`) |
| Decimal number | `12.5` |
| True or false | `true` or `false` |
| List | Items joined with a comma and space: `a, b, c` |
| Group of values (an object, such as `user`) | Nothing. Pick a key inside it, like `user.login`. |

A missing key is never an error. It just shows nothing, so use `default` when that would look odd.

## Filters

| Filter | What it does | Example | Result |
| --- | --- | --- | --- |
| `upper` | Capital letters | `{{name \| upper}}` | `NOVA_KAT` |
| `lower` | Small letters | `{{name \| lower}}` | `nova_kat` |
| `number` | Adds thousands separators, at most 2 decimals | `{{amount \| number}}` with 1234567.891 | `1,234,567.89` |
| `round` | Rounds to a whole number, halves round up | `{{amount \| round}}` with 12.5 | `13` |
| `default:"text"` | Uses the text when the value is missing or empty | `{{message \| default:"No message"}}` | `No message` |
| `url` | Makes the value safe inside a web address | `?q={{input \| url}}` | `?q=hello%20there` |

Details:

- `number` and `round` only change numbers, including numbers stored as text like `"1500"`. Other text is left as it is.
- `round` rounds halves up, so `-2.5` becomes `-2`.
- `default` works without quotes too (`default:someone`). Use quotes when the text contains `|`.
- After `default`, a number in the fallback text counts as a number: `{{missing | default:"1500" | number}}` gives `1,500`.
- Unknown filters are ignored.

## Literal braces

There is no escape character. Text that can't be a template is left alone:

- `{{` with no closing `}}` stays as typed.
- Empty braces, `{{}}` or `{{ }}`, stay as typed.
- Single braces, like `{name}`, are plain text.

## Keys you can use

What's available depends on where the template is.

### Alerts

The alert title and message can use the fields of the event that caused the alert. See [Events](/reference/events/) for the full list.

| Key | Example value |
| --- | --- |
| `name` | `Nova_Kat` (or `Anonymous`) |
| `kind` | `cheer` |
| `amount`, `tier`, `months`, `currency` | `500`, `3`, `14`, `USD` |
| `message` | What the viewer typed, after link hiding and blocked words |
| `recipient_name` | The person who received a gifted sub |
| `user.login`, `user.display_name` | `nova_kat`, `Nova_Kat` |
| `data.<key>` | Kind-specific values, like `data.reward_title` or `data.level` |

Alert text and alert conditions can also use every [variable](/reference/variables/), for example `{{session.subs}}`. Variables are updated before the alert is built, so the count includes this sub. When a variable and an event field share a name, the event field wins.

### Automation

Step text can use:

- every [variable](/reference/variables/), as it was when the run started, plus changes made by earlier steps in the same run
- the event fields above, when an event, chat command or alert started the action
- these extra keys, depending on the trigger:

| Key | Set by | Example for `!so @Nova_Kat extra` |
| --- | --- | --- |
| `command` | Chat command | `so` (the word used, in small letters, which may be an alias) |
| `input` | Chat command | `@Nova_Kat extra` (everything after the command) |
| `arg_count` | Chat command | `2` |
| `arg1`, `arg2`, ... | Chat command | `Nova_Kat`, `extra` (one per word, with a leading `@` removed) |
| `scene` | Scene changed | The new OBS scene name |

When a variable and an event field share a name, the event field wins.

Not every step option takes a template. [Automation steps](/reference/automation-steps/) lists which ones do.

### Overlays

| Where | Keys |
| --- | --- |
| Text layer text | Every variable |
| Goal layer title | Every variable |
| Counter layer format | Every variable, plus `value` (the counter's variable). Empty format means `{{value}}`. |
| Event list item format | The event fields, plus `label` (for example `cheered 500 bits`) and `amount_text`. Empty format means `{{name}} · {{label}}`. |

Overlay text updates as soon as a variable changes.

## Examples

```text
{{name}} is raiding with {{amount | number}} viewers
Thanks {{name | default:"friend"}}
Sub goal: {{session.subs | default:"0"}} / 50
Live for {{stream.uptime_text | default:"0m"}}
{{arg1}} has been hugged {{counter.hugs}} times
```
