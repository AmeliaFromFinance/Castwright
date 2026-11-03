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

### Auto-update signing

Installed copies update from `latest.json` on the newest release. Each update file is signed, and the app only installs files that match the public key in `src-tauri/tauri.conf.json`.

1. Make a key pair once: `npx tauri signer generate -w ~/.tauri/castwright.key`. Put the public key in `plugins.updater.pubkey`.
2. Add the private key (the file's contents) as a repository secret named `TAURI_SIGNING_PRIVATE_KEY`. If you set a password, add it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Release as usual. The workflow signs the installers and uploads `latest.json`. The publish step checks that it lists every platform.

Without the secret, releases still build, just without update files or `latest.json`. The run shows a notice, and installed copies won't update themselves to that release.

Keep the private key safe. If it's lost, existing installs can't verify new updates and everyone has to install the next version by hand.

