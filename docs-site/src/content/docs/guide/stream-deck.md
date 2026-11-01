---
title: Stream Deck and hotkeys
description: Run automation actions from a Stream Deck, Companion, Touch Portal or a script.
---

Every automation action can be run over HTTP. Anything that can send a web request can trigger it: a Stream Deck plugin, Bitfocus Companion, Touch Portal, a hotkey tool or a script.

## Get the link

1. Open **Automation** and select the action.
2. Click **Add trigger → Button or Stream Deck**. The trigger shows the run link with a **Copy** button.

It looks like this:

```
http://127.0.0.1:7470/api/actions/ACTION_ID/run?token=YOUR_SECRET
```

The link must be sent as a **POST** request.

## Stream Deck

The built-in Website button opens a browser, which won't work. Install a plugin that sends HTTP requests, such as *API Ninja* by BarRaider, then set:

- **Method**: POST
- **URL**: the run link

## Bitfocus Companion

Use the **Generic HTTP** connection with a **POST** action and the run link as the URL.

## From a script

```sh
curl -X POST "http://127.0.0.1:7470/api/actions/ACTION_ID/run?token=YOUR_SECRET"
```

Instead of `?token=`, you can send the secret in an `X-Castwright-Token` header.

Requests from other web pages are refused, so a website you visit can't run your actions.

| Response | Meaning |
| --- | --- |
| `202` | The action started. |
| `403` | Missing or wrong secret. Copy the link again. |
| `404` | No action with that ID. |

## From another device

Turn on **Settings → Overlay server → Allow other devices**. Links then use your computer's network address (for example `192.168.1.20`) instead of `127.0.0.1`. Copy them again after turning it on.

:::caution
Anyone with the link can run the action. Keep it private, and use **New secret** if it leaks.
:::

See the [HTTP API reference](/reference/http-api/) for details.
