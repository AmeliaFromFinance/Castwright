---
title: Scripting
description: The Run script step, its functions, limits and examples.
sidebar:
  order: 6
---

The **Run script** step runs a small program written in [Rhai](https://rhai.rs/book/), a simple scripting language that looks like JavaScript or Rust. Use it when the regular [steps](/reference/automation-steps/) aren't enough: random picks, maths, caps and so on.

## What a script can do

| Function | What it does |
| --- | --- |
| `get(name)` | Reads a variable or a run value. Returns `()` (nothing) when it doesn't exist. |
| `set(name, value)` | Sets a session-only variable |
| `save(name, value)` | Sets a saved variable |
| `log(text)` | Writes a line to the log on the Activity page |
| `chat(text)` | Sends a chat message. Empty text is skipped. |
| `random(min, max)` | A whole number from `min` to `max`, both included. Returns `min` when `max` isn't bigger. |
| `now_ms()` | The current time as a Unix timestamp in milliseconds |

Scripts can't read files, use the network or run other programs. `eval` is turned off.

## `args`

`args` holds everything the run knows: variables, event fields and command arguments. It's read-only.

```js
args.name        // who triggered it
args.amount      // bits, viewers and so on
args.arg1        // first word after a chat command
args.input       // everything after a chat command
args["last.sub.name"]  // names with dots need square brackets
```

A missing value is `()`. Event fields are listed on the [Events](/reference/events/) page, and command arguments on the [Templates](/reference/templates/#automation) page.

:::note
Event amounts are decimal numbers in scripts: 500 bits is `500.0`. Use `args.amount.to_int()` for a whole number. Variables holding whole numbers stay whole.
:::

## When changes happen

Variables, chat messages and log lines take effect after the script finishes:

- If the script succeeds, everything it set, sent and logged is applied, in order.
- If it fails or is stopped, nothing is applied.

Values set with `set()` or `save()` can be read back with `get()` in the same script, and later steps in the action see them.

Chat messages are sent from the bot account when one is signed in, otherwise from yours.

## Limits

| Limit | Value |
| --- | --- |
| Run time | 2 seconds |
| Operations | 500,000 |
| Function calls inside each other | 32 deep |
| Text length | 64 KB |
| List items | 10,000 |
| Map entries | 10,000 |

A script that goes over a limit is stopped and the step fails with a message in the log.

## Examples

### Dice roll

Command `!roll`. With `!roll 20`, rolls a 20-sided die. Default is 6.

```js
let sides = 6;
if args.arg1 != () {
    let n = parse_int(args.arg1);
    if n > 1 && n <= 1000 { sides = n; }
}
chat(`${args.name} rolled a ${random(1, sides)} (d${sides})`);
```

`parse_int` fails on text that isn't a number, which fails the step. That's fine here: nothing is sent.

### Counter with a cap

Counts hugs, but no more than 100 per stream.

```js
let hugs = get("counter.hugs");
if hugs == () { hugs = 0; }

if hugs >= 100 {
    chat("The hug jar is full for today.");
} else {
    hugs += 1;
    save("counter.hugs", hugs);
    chat(`${args.name} gave a hug. Total: ${hugs}`);
}
```

To start over each stream, add an action with a **Stream goes live** trigger and a "Set variable" step that sets `counter.hugs` to `0`.

### Quote picker

```js
let quotes = [
    "I meant to do that.",
    "Chat, that was lag.",
    "One more try, then bed."
];
chat(quotes[random(0, quotes.len() - 1)]);
```

### Start a timer

Saves the current time for a Timer layer to count from. See [variables](/reference/variables/#using-variables-in-overlays).

```js
save("timer.break", now_ms());
```

## Learning Rhai

The [Rhai book](https://rhai.rs/book/) covers the language. Useful parts:

- `let x = 5;` makes a variable, `if` / `else` and `for` work as you'd expect.
- Text in backticks fills in `${...}`: `` `Hi ${args.name}` ``.
- Lists use `[a, b, c]`, and `list.len()` gives their length.
- Comments start with `//`.
