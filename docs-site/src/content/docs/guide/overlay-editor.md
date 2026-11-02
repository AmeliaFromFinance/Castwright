---
title: Overlay editor
description: Layers, properties, animations, visibility rules and shortcuts.
---

The editor shows your overlay exactly as OBS will, with live chat, events and variables.

![Overlay editor](../../../assets/screens/overlay-editor.png)

- **Left**: add layers, and the **Layers** list (front first).
- **Middle**: the canvas.
- **Right**: settings for the selected layer, or for the overlay when nothing is selected. Drag the dividers to make either side wider; sections fold with a click on their title.

## Layer types

| Layer | What it shows |
| --- | --- |
| **Text** | Fixed text or live values like `{{last.follow.name}}`. See [templates](/reference/templates/). |
| **Shape** | Rectangle, ellipse or line. Good for backgrounds and frames. |
| **Image** | A logo, frame or picture from your project files. |
| **Video** | A looping video or animation. |
| **Alerts** | Where alerts play. Design them on the [Alerts](/guide/alerts/) page. |
| **Chat** | Live chat with Twitch and 7TV badges, 7TV name paints and 7TV, BetterTTV and FrankerFaceZ emotes. Can hide commands and bots. |
| **Goal** | A progress bar towards a target, such as follows or bits this stream. |
| **Counter** | A number from a [variable](/reference/variables/), like a death counter. |
| **Timer** | Countdown, stopwatch, clock or stream uptime. |
| **Events** | Recent follows, subs, cheers and more, as a list or ticker. |
| **Widget** | Your own HTML, CSS and JavaScript. See [custom widgets](/reference/custom-widgets/). |

## Styles

Pick a ready-made look under **Style** (the layer's box) or **Cards** (each chat message or event row): Clean, Comic, Speech bubble, Sticker, Riot, Neon, Pixel, Glass, Paper, Outline, Terminal and Candy. Every preview is drawn with your real layer.

After picking one, change any part of it:

| Group | What you can change |
| --- | --- |
| **Shape** | Square, rounded, pill, speech bubble with a tail, slanted, cut corners or pixel steps. Corner size, padding and lean. |
| **Fill** | One colour, a gradient or none, opacity and blur behind. |
| **Pattern** | Halftone dots, stripes, grid or paper grain on top of the fill. |
| **Border and stripe** | Width, colour and line (solid, dashed, double or thick ink), plus a coloured stripe on one side. |
| **Shadow** | Soft, hard offset (comic), glow, layered or your own. |

**Cards** also has: lean in turn (every other message tilts the other way, like stickers), a wash of each chatter's name colour, card around the whole message or just the words, and the gap between cards.

## Moving and sizing

- Drag a layer to move it, and the handles to resize. Hold **Shift** to keep its shape.
- Layers snap to the canvas edges, its centre and other layers. Hold **Ctrl** (**⌘** on Mac) to place freely, or turn snapping off in the top bar.
- **Alt**-click picks the layer underneath.
- Type exact numbers under **Layout**: position, size, rotation and opacity. The align buttons line a layer up with the canvas.

## Layer settings

Each layer has these sections on the right:

| Section | What's in it |
| --- | --- |
| **Content** | What the layer shows: text and font, image, chat options, goal target and so on. |
| **Style** | Background, border, corners, padding, shadow and backdrop blur. |
| **Visibility** | **Only show when**: rules that hide the layer unless they match, for example `stream.live is true`. See [conditions](/reference/conditions/). |
| **Animation** | How the layer enters, leaves and moves while shown. Click the play button next to each to preview it. |
| **Advanced** | Custom CSS for the layer, and its ID for automation. The list under the CSS box shows which classes this layer has; click one to insert a rule. See [Custom CSS](/reference/styling/). |

Hide a layer with the eye in the Layers list. The **Show/hide overlay layer** automation step can show it at certain moments, like after a raid.

## Fonts

Pick from the font list or type any [Google Fonts](https://fonts.google.com) name. With no layer selected, **Extra fonts** loads more fonts for custom widgets.

## Testing

**Test** in the top bar:

- **Play an alert** of any type, using your real alert designs.
- Add a sample chat message or event.
- **Preview values**: try different variable values, for example to see a goal at 75%. These only affect the editor.

The play button in the top bar starts and stops layer animations on the canvas.

## Top bar

| Control | What it does |
| --- | --- |
| ↶ ↷ | Undo and redo |
| − 37% + | Zoom. Click the number for **Fit to window** and other sizes. |
| Magnet | Snapping on or off |
| Eye | Show hidden layers on the canvas |
| Frame | Safe area guide, to keep things away from the edges |
| ▶ | Play or pause animations |
| **Test** | Test alerts, chat and values |
| Link | Copy the OBS link |

## Shortcuts

| Keys | Action |
| --- | --- |
| Arrows | Nudge 1 px (**Shift**: 10 px) |
| **Ctrl + D** | Duplicate layer |
| **Ctrl + Z** | Undo |
| **Ctrl + Shift + Z** or **Ctrl + Y** | Redo |
| **Delete** / **Backspace** | Remove layer |
| **Esc** | Deselect |

On Mac, use **⌘** instead of **Ctrl**. Shortcuts don't fire while you're typing in a field.
