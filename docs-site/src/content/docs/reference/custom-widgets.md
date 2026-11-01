---
title: Custom widgets
description: Custom code layers in overlays, their StreamElements-compatible API, fields and storage.
sidebar:
  order: 7
---

A custom code layer runs your own HTML, CSS and JavaScript inside an overlay. It supports the main parts of the StreamElements custom widget API, so many existing widgets work with little or no change.

## Where your code runs

Each custom layer is its own small web page (an iframe) inside the overlay, in OBS and in the editor preview.

| Part | Goes into |
| --- | --- |
| CSS | A `<style>` tag in the page head |
| HTML | The page body |
| JavaScript | A `<script>` tag at the end of the body, so your HTML exists when it runs |

- The page fills the layer and has a transparent background, no margins and no scrollbars.
- The page is sandboxed: scripts run, but it can't reach the overlay around it, open popups or submit forms.
- Browser storage such as `localStorage` and cookies isn't available. Use [`SE_API.store`](#storage) instead.
- Requests to other websites only work when that site allows it (CORS).
- Files from your project (`assets/...`) can't be loaded from widget code. Use full web addresses.
- Editing the code or fields reloads the widget.

## Fields

Fields are settings for a widget, written as JSON in the StreamElements "Fields" format:

```json
{
  "accent": { "type": "colorpicker", "label": "Accent", "value": "#9147ff" },
  "heading": { "type": "text", "label": "Heading", "value": "Latest follower" }
}
```

Castwright reads each field's `value` as its default. Values you change for the layer are saved separately and win over the defaults.

Field values reach your widget in two ways:

| How | Example |
| --- | --- |
| Placed into HTML, CSS and JS before the page loads | `{{accent}}` or `{accent}` |
| `fieldData` in `onWidgetLoad` | `obj.detail.fieldData.accent` |

Placement rules:

- Values go in exactly as written, with no HTML escaping, so a field can hold markup.
- Numbers and true/false become text, empty values become nothing, and lists or objects become JSON.
- Names that aren't fields are left alone.

:::caution
`{name}` is replaced anywhere, including JavaScript. With a field called `color`, `const {color} = obj` and `` `${color}` `` both get the value pasted in. Avoid giving fields the same names as your script variables.
:::

## Events

Listen for these on `window`, as in StreamElements. The data is in `obj.detail`.

### `onWidgetLoad`

Sent once the widget page has loaded.

| Key | Value |
| --- | --- |
| `fieldData` | Field values |
| `channel.username` | Your Twitch login (`twitch.login`) |
| `channel.id`, `channel.providerId`, `channel.avatar`, `channel.apiToken` | Always empty |
| `session.data` | Session data, see [below](#session-data) |
| `session.settings` | `{ autoReset: false }` |
| `recents` | Up to 25 recent events, newest first, in StreamElements format |
| `currency` | Always `{ code: "USD", name: "U.S. Dollar", symbol: "$" }` |
| `overlay` | `{ isEditorMode, muted: false }`. `isEditorMode` is true in the editor preview. |
| `emulated` | Always `false` |

### `onEventReceived`

`obj.detail.listener` says what happened and `obj.detail.event` holds the data.

| Listener | Sent for |
| --- | --- |
| `follower-latest` | Follows |
| `subscriber-latest` | Subs, resubs, gift subs and community gifts |
| `cheer-latest` | Cheers |
| `raid-latest` | Raids |
| `tip-latest` | Charity donations |
| `message` | Chat messages |
| `delete-message` | A chat message was deleted: `{ msgId }` |
| `delete-messages` | A user's messages were cleared: `{ userId }`. Whole chat cleared: `{ all: true }` |
| `kvstore:update` | Your widget saved a value: `{ data: { key: "customWidget.<key>", value } }` |
| `castwright:event` | Every Castwright [event](/reference/events/), unchanged, including chat |
| `castwright:alert` | An alert started playing. `event` holds the alert (title, message, kind, the original event and so on). |

Events with a StreamElements listener arrive twice: first in StreamElements format, then as `castwright:event`. Kinds with no StreamElements match (redemptions, hype trains, polls and others) only arrive as `castwright:event`.

#### StreamElements event format

Every `*-latest` event has:

| Key | Value |
| --- | --- |
| `type` | `follower`, `subscriber`, `cheer`, `raid` or `tip` |
| `name`, `displayName` | Display name |
| `providerId` | Twitch user ID |
| `_id` | Event ID |
| `provider` | `twitch` |
| `createdAt` | Time, as an ISO date string |
| `amount` | The event amount (bits, raid viewers, donation) |
| `message` | Viewer message, or empty |
| `avatar`, `items` | Always empty |

Extra keys for subscriber events:

| Event | Extra keys |
| --- | --- |
| Sub or resub | `amount` = months, `tier` (`1000`, `2000`, `3000` or `prime`), `gifted: false` |
| Gift sub | `name` = recipient, `sender` = gifter, `amount` = months, `tier`, `gifted: true`, `isCommunityGift` |
| Community gift | `amount` = number of subs, `sender` = gifter, `tier`, `gifted: true`, `bulkGifted: true` |

Tips also have `currency`.

#### Chat `message` format

`event.data` holds `time`, `tags`, `nick` (login), `userId`, `displayName`, `displayColor`, `badges`, `channel` (empty), `text`, `isAction`, `emotes` and `msgId`. `event.renderedText` is the message as HTML with emote images, and the text escaped.

- `badges` only lists broadcaster, moderator, VIP and subscriber badges.
- Each emote has `type`, `name`, `id`, `gif`, `urls` (`1`, `2`, `4`), `start` and `end`.

### `onSessionUpdate`

Sent when session data changes. `obj.detail.session` holds the new [session data](#session-data).

### Session data

| Key | Value |
| --- | --- |
| `follower-latest`, `subscriber-latest`, `cheer-latest`, `raid-latest`, `tip-latest` | Latest event of that type. `{ name: "", amount: 0, message: "" }` when there's none. |
| `follower-recent`, `subscriber-recent`, `cheer-recent`, `raid-recent`, `tip-recent` | Up to 25 recent events of that type, newest first |
| `follower-session` | `{ count }` from `session.follows` |
| `subscriber-session` | `{ count }` from `session.subs` |
| `subscriber-gifted-session` | `{ count }` from `session.gifts` |
| `cheer-session` | `{ amount }` from `session.bits` |
| `raid-session` | `{ count }` from `session.raids` |
| `tip-session` | `{ amount }` from `session.donations` |

Latest and recent lists come from the last 50 events the overlay knows about. The totals come from the [session counters](/reference/variables/#session-counters).

## `SE_API`

| Method | Returns | Notes |
| --- | --- | --- |
| `SE_API.store.get(key)` | Promise of the value, or `null` | |
| `SE_API.store.set(key, value)` | Promise | Saves the value and sends `kvstore:update` to this widget |
| `SE_API.store.delete(key)` | Promise | |
| `SE_API.counters.get(name)` | Promise of `{ counter: name, value: 0 }` | Always 0. Use variables and `castwright:event` instead. |
| `SE_API.getOverlayStatus()` | `{ isEditorMode, muted: false }` | Returns the object directly, not a Promise |
| `SE_API.sanitize({ message })` | Promise of `{ result: { message }, skip: false }` | Returns the message unchanged |
| `SE_API.cheerFilter(text)` | Promise of the text | Removes cheer words like `Cheer100` |
| `SE_API.resumeQueue()` | Nothing | Does nothing |
| `SE_API.setField()` | Nothing | Does nothing |

## Storage

`SE_API.store` keeps small values between reloads and restarts.

| Limit | Value |
| --- | --- |
| Key length | 1 to 128 characters |
| Value size | 64 KB as JSON |
| Scope | One layer. Other layers can't see it. |

- Values are stored as JSON. Anything JSON can't hold becomes `null`.
- Values are saved in `events.sqlite` in the [project folder](/reference/files/).
- If the same overlay is open in two places, the other copy sees new values after it reconnects or reloads.
- Importing an overlay gives its layers new IDs, so stored values don't come along.

## Not supported

- `SE_API.counters`, `sanitize`, `setField` and `resumeQueue` are placeholders (see above).
- Avatars, channel ID and API token in `onWidgetLoad`.
- `isAction` in chat messages is always `false`.
- Currencies other than the fixed USD entry.
- Loading project files (`assets/...`) from widget code.

## Example widget

Shows the latest follower and counts `!hug` messages in chat. The count survives restarts.

**Fields**

```json
{
  "accent": { "type": "colorpicker", "label": "Accent", "value": "#9147ff" },
  "heading": { "type": "text", "label": "Heading", "value": "Latest follower" }
}
```

**HTML**

```html
<div class="card">
  <div class="label">{{heading}}</div>
  <div id="name">-</div>
  <div id="hugs"></div>
</div>
```

**CSS**

```css
.card {
  font: 600 28px/1.2 system-ui, sans-serif;
  color: #fff;
  padding: 16px;
  border-left: 6px solid {{accent}};
  background: rgba(0, 0, 0, 0.6);
}
.label {
  font-size: 16px;
  opacity: 0.7;
}
```

**JavaScript**

```js
let hugs = 0;

function show() {
  document.getElementById('hugs').textContent = 'Hugs: ' + hugs;
}

window.addEventListener('onWidgetLoad', async (obj) => {
  const latest = obj.detail.session.data['follower-latest'];
  document.getElementById('name').textContent = latest.name || '-';
  hugs = (await SE_API.store.get('hugs')) || 0;
  show();
});

window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail;
  if (listener === 'follower-latest') {
    document.getElementById('name').textContent = event.name;
  }
  if (listener === 'message' && event.data.text.trim().toLowerCase() === '!hug') {
    hugs += 1;
    SE_API.store.set('hugs', hugs);
    show();
  }
});
```

Use `textContent`, not `innerHTML`, for viewer names and messages so chat can't add its own HTML. For chat with emotes, `renderedText` is already escaped.
