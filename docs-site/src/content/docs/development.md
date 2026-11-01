---
title: Build from source
description: Run Castwright from source and contribute.
---

## You need

- [Node.js](https://nodejs.org) 22
- [Rust](https://rustup.rs) 1.90 or newer
- The [Tauri system packages](https://v2.tauri.app/start/prerequisites/) for your OS. On Debian or Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev libdbus-1-dev build-essential
```

## Run it

```sh
git clone https://github.com/AmeliaFromFinance/castwright
cd castwright
npm ci
npm run tauri dev
```

Set `CASTWRIGHT_TWITCH_CLIENT_ID` when building to include a Twitch client ID, or enter one in Settings.

`npm run dev` alone runs the interface in a browser with a demo backend: fake OBS, Twitch and events, handy for UI work. Add `?demo=static` to the URL to stop the simulated activity.

## Checks

```sh
npm run check      # types and Svelte warnings
npm test           # unit tests
npm run e2e        # browser tests
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

Rust types used by the interface are generated into `src/lib/bindings` by `npm run bindings`. Commit them with your change.

## Layout

| Folder | What's there |
| --- | --- |
| `src-tauri/src` | Rust backend: OBS client, Twitch, alerts, automation, overlay server, storage |
| `src/lib/pages` | App screens |
| `src/lib/overlay` | The overlay renderer, shared by OBS and the editor |
| `src/lib/api` | Typed commands and the demo backend |
| `docs-site` | This site |

## Release

Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then either push a tag like `v0.2.0` or run the **Release** workflow from the Actions tab with that version. It builds installers for all three systems and publishes the release.

Set a repository variable named `CASTWRIGHT_TWITCH_CLIENT_ID` to build a Twitch client ID into the installers.
