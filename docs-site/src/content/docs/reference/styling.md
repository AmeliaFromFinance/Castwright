---
title: Custom CSS
description: Classes and variables you can style in each overlay layer.
sidebar:
  order: 8
---

Every layer has **Advanced → Custom CSS**. Rules there only affect that layer, so you can write short selectors without worrying about other layers.

The editor lists these selectors for the selected layer. Click one to insert a rule, or start typing `.cw-` for suggestions.

```css
/* Bigger names, no colon */
.cw-chat-name { font-size: 1.15em; }
.cw-chat-sep { display: none; }

/* Hide 7TV badges but keep Twitch ones */
.cw-badge-7tv { display: none; }

/* Softer corners on emotes */
.cw-emote { border-radius: 6px; }
```

`:scope` means the layer's own box. Styles from the editor are written first, so your rules win when they target the same thing. The chat name colour is set per message, so changing it needs `!important`.

## Text

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-text-layer` | The text block |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Shape

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-shape` | The drawn shape (SVG) |

## Image

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-image` | The image |
| `.cw-media` | The image or video |

## Video

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-video` | The video |
| `.cw-media` | The image or video |

## Alerts

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-alert-wrap` | Fills the layer and centres the card |
| `.cw-alert` | The alert card |
| `.cw-carded` | The card when it has a fill |
| `.cw-alert[data-kind="follow"]` | The card for one event kind |
| `.cw-layout-media_left` | Layout class on the card (media_above, media_left, media_behind, text_only) |
| `.cw-alert-media` | The image or video |
| `.cw-alert-text` | Title, accent bar and message |
| `.cw-alert-title` | The title |
| `.cw-alert-accent` | The accent bar |
| `.cw-alert-message` | The message |

| Variable | What it is |
| --- | --- |
| `--cw-accent` | Accent colour, on .cw-alert |
| `--cw-w` | Layer width inside its padding, on .cw-alert-wrap |
| `--cw-h` | Layer height inside its padding, on .cw-alert-wrap |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Chat

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-chat` | The message list |
| `.cw-top` | The list when newest is on top |
| `.cw-chat-line` | Each message card |
| `.cw-chat-line[data-user-id]` | Messages from one chatter (by Twitch user id) |
| `.cw-hl` | A highlighted message (any reason) |
| `.cw-hl-first` | Highlighted: first message from this chatter |
| `.cw-hl-mention` | Highlighted: mentions your name |
| `.cw-hl-keyword` | Highlighted: has a keyword |
| `.cw-hl-user` | Highlighted: from a listed user, a mod or a VIP |
| `.cw-hl-redeemed` | Highlighted with channel points ("Highlight my message") |
| `.cw-chat-line[data-highlight~="mention"]` | Same as the classes above; data-highlight lists every reason |
| `.cw-chat-badge` | Any badge |
| `.cw-badge-twitch` | A Twitch badge (moderator, subscriber…) |
| `.cw-badge-7tv` | A 7TV badge |
| `.cw-badge-role` | A built-in role icon, used when a badge image is missing |
| `.cw-chat-name` | The name |
| `.cw-paint` | A name with a 7TV paint |
| `.cw-chat-sep` | The colon after the name |
| `.cw-chat-msg` | The message text |
| `.cw-emote` | An emote |
| `.cw-emote-twitch` | A Twitch emote |
| `.cw-emote-7tv` | A 7TV emote |
| `.cw-emote-bttv` | A BetterTTV emote |
| `.cw-emote-ffz` | A FrankerFaceZ emote |
| `.cw-emote-stack` | An emote with zero-width emotes on top |
| `.cw-emote-zw` | A zero-width emote laid over the one before it |
| `.cw-mention` | An @mention |
| `.cw-cheer` | A cheer amount |
| `.cw-action` | A /me message |

| Variable | What it is |
| --- | --- |
| `--cw-name` | Name colour on each card (set when tint or a name stripe is on) |
| `--cw-tint` | Tint colour on each card |
| `--cw-lean` | 1 or -1 when cards lean in turn |
| `--cw-hl` | Highlight colour on a highlighted .cw-chat-line |

## Goal

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-goal` | The whole goal |
| `.cw-goal-head` | Title and numbers row |
| `.cw-goal-title` | The title |
| `.cw-goal-numbers` | Current and target numbers |
| `.cw-goal-track` | The bar background |
| `.cw-goal-fill` | The filled part of the bar |
| `.cw-goal-shine` | The shine that runs over the bar |
| `.cw-reached` | Added to .cw-goal once the target is reached |
| `.cw-celebrate` | Added to .cw-goal for a moment when it is reached |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Counter

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-counter` | The counter row |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Timer

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-timer` | The timer row |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Event list

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-event-row` | Each event card, in list and ticker |
| `.cw-list` | The list |
| `.cw-list-item` | A row in list mode |
| `.cw-ticker` | The ticker |
| `.cw-ticker-item` | An item in ticker mode |
| `.cw-ticker-sep` | The dot between ticker items |

| Variable | What it is |
| --- | --- |
| `--cw-name` | Name colour on each card (set when tint or a name stripe is on) |
| `--cw-tint` | Tint colour on each card |
| `--cw-lean` | 1 or -1 when cards lean in turn |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Poll / prediction

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-poll` | The whole poll or prediction |
| `.cw-poll[data-type="prediction"]` | Only while it shows a prediction (poll for polls) |
| `.cw-open` | Added to .cw-poll while viewers can vote |
| `.cw-ended` | Added to .cw-poll while it shows the result |
| `.cw-poll-head` | The question row |
| `.cw-poll-title` | The question |
| `.cw-poll-choices` | The list of choices |
| `.cw-poll-choice` | Each choice card |
| `.cw-winner` | Added to the winning choice at the end |
| `.cw-loser` | Added to the other choices once there is a winner |
| `.cw-poll-row` | Name and numbers row of a choice |
| `.cw-poll-label` | The choice name |
| `.cw-poll-nums` | Count and percentage of a choice |
| `.cw-poll-count` | Votes or points for a choice |
| `.cw-poll-pct` | The percentage |
| `.cw-poll-track` | The bar background |
| `.cw-poll-fill` | The filled part of the bar |
| `.cw-poll-foot` | Time left and total row |
| `.cw-poll-timer` | Time left, or the result line |
| `.cw-poll-total` | Votes or points in total |

| Variable | What it is |
| --- | --- |
| `--cw-name` | Bar colour on each choice (set when tint or a name stripe is on) |
| `--cw-tint` | Tint colour on each card |
| `--cw-lean` | 1 or -1 when cards lean in turn |
| `--cw-pct` | The choice’s share, e.g. 42%, on .cw-poll-choice |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Credits

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-chat-badge` | Any badge |
| `.cw-badge-twitch` | A Twitch badge (moderator, subscriber…) |
| `.cw-badge-7tv` | A 7TV badge |
| `.cw-badge-role` | A built-in role icon, used when a badge image is missing |
| `.cw-paint` | A name with a 7TV paint |
| `.cw-credits` | The whole roll, clipped to the layer |
| `.cw-rolling` | Added to .cw-credits while it moves |
| `.cw-done` | Added to .cw-credits once it has stopped at the end |
| `.cw-paged` | Added to .cw-credits when reduced motion shows pages |
| `.cw-fade` | Added to .cw-credits when the edges fade |
| `.cw-waiting` | Added to .cw-credits while it waits for the Roll credits step (hidden) |
| `.cw-two` | Added to .cw-credits with two columns |
| `.cw-credits-roll` | Everything that moves |
| `.cw-credits-heading` | The heading |
| `.cw-credits-section` | Each section card |
| `.cw-credits-section[data-kind="followers"]` | One section (followers, subscribers, gifters, cheerers, raiders, moderators, vips, chatters) |
| `.cw-credits-title` | A section title |
| `.cw-credits-names` | The names in a section |
| `.cw-credits-row` | One name with its amount |
| `.cw-credits-name` | The name |
| `.cw-credits-amount` | Months, gifts, bits, viewers or messages |
| `.cw-credits-footer` | The footer |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Ad break

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-ad` | The whole heads-up |
| `.cw-ad-soon` | Added to .cw-ad before the ad |
| `.cw-ad-running` | Added to .cw-ad while the ad runs |
| `.cw-ad[data-phase="running"]` | Same as .cw-ad-running (soon before the ad) |
| `.cw-ad-card` | The card around the message |
| `.cw-ad-text` | The message |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Now playing

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-text` | A piece of styled text |
| `.cw-stroked` | Text with an outline |
| `.cw-np` | The whole layer |
| `.cw-np-compact` | Layout class on .cw-np (also .cw-np-card, .cw-np-vinyl) |
| `.cw-np-card` | Added to .cw-np in the card layout |
| `.cw-np-vinyl` | Added to .cw-np in the vinyl layout |
| `.cw-np-playing` | Added to .cw-np while the song plays |
| `.cw-np-paused` | Added to .cw-np while it is paused |
| `.cw-np-still` | Added to .cw-np when motion is reduced (the record stops spinning) |
| `.cw-np-item` | The card around the song |
| `.cw-np-body` | Cover and text row. Animates in when the song changes |
| `.cw-np-art` | The cover (the record in vinyl) |
| `.cw-np-text` | Title, artist, album and progress |
| `.cw-np-line` | One line of text, cut off with … when too long |
| `.cw-np-title` | The title (title · artist in compact) |
| `.cw-np-artist` | The artist |
| `.cw-np-album` | The album |
| `.cw-np-progress` | Bar and times |
| `.cw-np-bar` | The bar background |
| `.cw-np-fill` | The played part of the bar |
| `.cw-np-smooth` | Added to .cw-np-fill while it moves smoothly |
| `.cw-np-times` | Elapsed and length row |
| `.cw-np-elapsed` | Time played |
| `.cw-np-duration` | Length of the song |
| `.cw-np[data-state="paused"]` | Same as .cw-np-paused (playing while it plays) |

| Variable | What it is |
| --- | --- |
| `--cw-stroke-w` | Outline width, on .cw-stroked |
| `--cw-stroke-c` | Outline colour, on .cw-stroked |

## Custom widget

| Selector | What it is |
| --- | --- |
| `:scope` | This layer’s box |
| `.cw-custom` | The widget frame. Its own HTML has the widget’s CSS |
