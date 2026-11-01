---
title: Conditions
description: Condition groups, every operator and how values are compared.
sidebar:
  order: 3
---

Conditions decide whether something happens: which alert variation plays, whether an action runs, which branch an If step takes and whether an overlay layer shows.

## Where conditions are used

| Where | Checked against |
| --- | --- |
| Alert variations | The event. The first enabled variation whose conditions match is used. |
| Event triggers in automation | The event. |
| If step | Variables and event fields in the current run. See [templates](/reference/templates/#automation). |
| Layer "visible when" | [Variables](/reference/variables/) only. |

## Groups

A condition has three parts: a **field**, an **operator** and usually a **value**. Conditions sit in a group that matches in one of two ways:

| Match | Passes when |
| --- | --- |
| All of these | Every condition passes |
| Any of these | At least one condition passes |

An empty group always passes.

## Fields

The field is a key, written the same way as in [templates](/reference/templates/): `amount`, `user.login`, `data.reward_title`, `data.choices.0.title`, `session.subs`.

- A key that contains dots is matched whole first, so variables like `last.sub.name` work.
- A missing field and an empty (`null`) value are treated the same: missing.

## Operators

| In the app | Code | Passes when |
| --- | --- | --- |
| is | `eq` | The field equals the value |
| is not | `ne` | The field doesn't equal the value, or is missing |
| is more than | `gt` | Field > value (numbers only) |
| is at least | `gte` | Field ≥ value (numbers only) |
| is less than | `lt` | Field < value (numbers only) |
| is at most | `lte` | Field ≤ value (numbers only) |
| contains | `contains` | Text contains the value, or a list has an item equal to the value |
| doesn't contain | `not_contains` | The opposite of contains. Also passes when the field is missing. |
| starts with | `starts_with` | Text starts with the value |
| ends with | `ends_with` | Text ends with the value |
| has a value | `exists` | The field is there and not empty (`null`) |
| is empty | `not_exists` | The field is missing or `null` |
| is yes/true | `is_true` | The field counts as true (see below) |
| is no/false | `is_false` | The field doesn't count as true, including when it's missing |

The last four don't use a value.

## How values are compared

### Numbers and text

- **is / is not:** if both sides read as numbers, they're compared as numbers, so `3` equals `"3"` and `" 42 "`. Otherwise both are compared as text, ignoring capital letters.
- **More / less than:** both sides must read as numbers. If either doesn't (or the field is missing), the condition fails.
- **contains, starts with, ends with:** text comparisons that ignore capital letters. Numbers and true/false are compared as their text.
- True and false compare as the words `true` and `false`, so `is_gift` **is** `TRUE` passes for a gifted sub.

What reads as a number: digits with an optional sign, decimal point and exponent, like `12`, `-1.5`, `.5` or `1e3`. Spaces around it are ignored.

Not numbers: `1,000`, `0x10`, `inf`, `12abc` or empty text. Write `1000`, not `1,000`.

In the condition editor, a value that reads as a number is saved as a number. Anything else is saved as text.

### Lists

`contains` on a list (like chat `data.badges`) needs a whole item to match: `data.badges` **contains** `vip` passes, `vi` doesn't. Matching ignores capital letters.

### What counts as true

| Value | `is_true` |
| --- | --- |
| `true` | Yes |
| Any number except 0 | Yes |
| Text `true`, `yes` or `1` (any capitals, spaces ignored) | Yes |
| A list with at least one item | Yes |
| A group of values (object) | Yes |
| `false`, `0`, other text, empty list, missing | No |

### Empty text

Empty text (`""`) is a value. **has a value** passes for it and **is empty** fails. To test for empty text, use **is** with an empty value.

## Examples

| Goal | Field | Operator | Value |
| --- | --- | --- | --- |
| Only tier 3 subs | `tier` | is | `3` |
| Only Prime subs | `data.is_prime` | is yes/true | |
| Cheers of 1000 bits or more | `amount` | is at least | `1000` |
| Raids with more than 20 viewers | `amount` | is more than | `20` |
| Message mentions a word | `message` | contains | `hype` |
| One channel point reward | `data.reward_title` | is | `Hydrate` |
| Gifted resubs | `is_gift` | is yes/true | |
| Chatters with the VIP badge | `data.badges` | contains | `vip` |
| Moderators | `roles.moderator` | is yes/true | |
| Messages Castwright didn't send | `data.sent_by_castwright` | is no/false | |
| Show a layer only while live | `stream.live` | is yes/true | |
| Hide a layer on one scene | `obs.scene` | is not | `BRB` |

:::tip
`contains` matches parts of words: `hype` also matches `hyped`. Use **is** when the whole text must match.
:::

To match a range, use **All of these** with two conditions, for example `amount` **is at least** `100` and `amount` **is less than** `500`.
