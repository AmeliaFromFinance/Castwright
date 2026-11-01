---
title: Local HTTP API
description: The built-in overlay server, its link secret, every route and how to run actions from other tools.
sidebar:
  order: 8
---

Castwright runs a small web server while the app is open. OBS loads overlays from it, and other tools (like a Stream Deck) can use it to run actions.

## Address and port

| Setting | Default |
| --- | --- |
| Address | `http://127.0.0.1:7470` |
| Port | `7470`. You can pick 1024 to 65535 in **Settings → Overlay server**. |
| Other devices | Off. Only this computer can connect. |

If the port is taken, Castwright tries the next 9 ports (7471 to 7479) and shows "Port 7470 was busy, using 7471 instead." If all 10 are taken, the server doesn't start.

:::caution
Overlay links include the port. If Castwright falls back to another port, links already in OBS stop working until you free the port or update the links.
:::

## Link secret

Every request except `/health` needs the link secret (a token). It's 32 random characters (0 to 9 and a to f), created on first start and kept between runs.

Send it either way:

| Method | Example |
| --- | --- |
| Query parameter | `?token=YOUR_SECRET` |
| Header | `X-Castwright-Token: YOUR_SECRET` |

Find it in **Settings → Overlay server → Link secret**. **New secret** makes a new one at once. Every overlay link and tool using the old one stops working.

A missing or wrong secret gets `403 Forbidden`.

Two more rules keep the secret useful even if a widget or web page sees it:

- **Other web pages are refused.** Requests a browser sends from a page that Castwright didn't serve (with a different `Origin`) get `403`. Tools like curl and Stream Deck plugins send no `Origin` and work as normal.
- **Asset links use a separate key.** Overlay pages load files with `?key=...`, which opens `/assets/` only. It changes whenever the secret does.

A new secret also disconnects every open overlay page within a few seconds.

## Routes

| Method | Path | What it does | Answers |
| --- | --- | --- | --- |
| `GET` | `/health` | Checks the server is up. No secret needed. | `200` `ok` |
| `GET` | `/overlay/{id}` | The overlay page, for an OBS Browser Source | `200` page, `404` if the overlay was deleted |
| `GET` | `/api/overlay/{id}` | The overlay's settings and layers as JSON | `200` JSON, `404` |
| `GET` | `/assets/{name}` | A file from the project `assets` folder. Accepts the secret or the asset key. Supports partial downloads (needed for video). | `200` or `206`, `404` |
| `POST` | `/api/actions/{id}/run` | Runs an action | `202` `ok`, `404` if there's no such action |
| `GET` | `/ws?overlay={id}` | WebSocket used by overlay pages | See [WebSocket](#websocket) |

Using the wrong method, for example `GET` on the run route, gets `405 Method Not Allowed`.

### Running an action

```bash
curl -X POST "http://127.0.0.1:7470/api/actions/ACTION_ID/run?token=YOUR_SECRET"
```

or with the header:

```bash
curl -X POST -H "X-Castwright-Token: YOUR_SECRET" \
  "http://127.0.0.1:7470/api/actions/ACTION_ID/run"
```

- No request body is needed.
- `202` means the run started. It doesn't wait for the steps or report their errors; check the log on the Activity page.
- The action runs even when it's turned off, and its cooldown is ignored. The [burst limit](/reference/automation-steps/#loop-protection) still applies.
- `ACTION_ID` is the action's `id` in `project.json`.

### Overlay JSON

```bash
curl "http://127.0.0.1:7470/api/overlay/OVERLAY_ID?token=YOUR_SECRET"
```

### Assets

```bash
curl -O "http://127.0.0.1:7470/assets/logo.png?token=YOUR_SECRET"
```

The name must be a plain file name in the `assets` folder. Names with slashes or starting with a dot get `404`.

## WebSocket

Overlay pages connect to `/ws?token=YOUR_SECRET&overlay=OVERLAY_ID` for live data. This is meant for Castwright's own overlay page and may change between versions.

| Direction | Messages |
| --- | --- |
| Castwright to page | `hello` (the overlay, variables, recent events, chat and widget storage), `overlay`, `vars`, `event`, `chat_delete`, `chat_clear_user`, `chat_clear`, `alert_play`, `alert_stop`, `play_sound`, `layer_visible`, `reload` |
| Page to Castwright | `store_set`, `store_delete`, `ping` (every 25 seconds) |

Every message is JSON with a `type` field. Without an `overlay` parameter the server answers `400`. For an unknown overlay it closes the connection. Messages from the page can be up to 512 KB.

## Other devices on your network

Turn on **Settings → Overlay server → Allow other devices** to use overlays or the API from a phone, tablet or second PC.

- The server then listens on all network connections, not just this computer.
- Use this computer's local IP address instead of `127.0.0.1`, for example `http://192.168.1.20:7470/...`.
- Your firewall may ask whether to allow Castwright.
- Anyone on the network who has the link secret can open overlays and run actions. Leave this off unless you need it.

## Stream Deck and other tools

Running an action needs a `POST` request.

- A plain "Website" or "Open URL" button sends a `GET` by opening a browser, so it can't run actions. It gets `405`.
- Use a Stream Deck plugin or tool that can send HTTP requests, set it to `POST`, and use the run URL above with your secret.

See the [Stream Deck guide](/guide/stream-deck/) for a step-by-step setup.
