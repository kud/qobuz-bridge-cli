<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/@kud/qobuz-bridge-cli?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Background daemon that bridges Qobuz into macOS Now Playing — Control Center tile, artwork, and working media buttons**

<a href="https://kud.io/projects/qobuz-bridge-cli">Website</a> · <a href="https://kud.io/projects/qobuz-bridge-cli/docs">Documentation</a>

</div>

## Features

- **Control Center tile** — Qobuz becomes a first-class macOS Now Playing citizen: track title, artist, album, and artwork appear in Control Center just like any native player.
- **Working media buttons** — next, previous, and play/pause from Control Center (or your keyboard's media keys) are routed back to Qobuz via a system-level event tap.
- **Rich artwork** — album art is pulled from Qobuz's CDN and pushed live to the Now Playing slot, updating as tracks change.
- **Auto-start on login** — a single `qobuz-bridge install` writes a launchd agent plist so the daemon starts automatically at login and restarts if it crashes.
- **No polling overhead** — metadata is read from Qobuz's local `player-0.json` state file on a 3-second interval; no extra network calls for position tracking.
- **Three-package composition** — thin orchestration layer that wires `@kud/qobuz`, `@kud/macos-nowplaying-bridge`, and `@kud/macos-media-keys` together with no duplicated logic.

## Install

```sh
npm install -g @kud/qobuz-bridge-cli
```

Requires macOS and Node.js ≥ 20. The Qobuz desktop app must be installed, and a Qobuz token must be present in the macOS Keychain (as set up by `@kud/qobuz`). The `install` command's daemon process needs Accessibility permission to intercept media keys.

## Usage

```console
$ qobuz-bridge
qobuz-bridge running — open Control Center. Ctrl-C to quit.
now playing → Intro — The xx

$ qobuz-bridge install
installed login item → ~/Library/LaunchAgents/io.kud.qobuz-bridge.plist
logs → ~/Library/Logs/qobuz-bridge.log

$ qobuz-bridge uninstall
removed login item → ~/Library/LaunchAgents/io.kud.qobuz-bridge.plist
```

| Command                  | Effect                                               |
| ------------------------ | ---------------------------------------------------- |
| `qobuz-bridge`           | Run the daemon in the foreground (Ctrl-C to quit)    |
| `qobuz-bridge install`   | Register a launchd login item; starts the daemon now |
| `qobuz-bridge uninstall` | Remove the login item (daemon stops at next reboot)  |

Logs from the background daemon are written to `~/Library/Logs/qobuz-bridge.log`.

> **Known limitation:** `player-0.json` exposes the playback position but not a discrete play/pause flag, so the bridge reports state as `"playing"` whenever a track is detected. Pause detection will improve once the underlying state file exposes it.

> **Known limitation:** in **System Settings → Login Items → "Allow in the Background"**, the daemon shows as **"Node.js Foundation"** rather than "Qobuz Bridge". macOS attributes background items by the code signature of the executable (here, the `node` binary) — there is no setting to override the name. This is cosmetic; the daemon works normally. Tracked in [#1](https://github.com/kud/qobuz-bridge-cli/issues/1).

## Development

```sh
git clone https://github.com/kud/qobuz-bridge-cli.git
cd qobuz-bridge-cli
npm install
npm run dev
```

| Script              | Purpose                      |
| ------------------- | ---------------------------- |
| `npm run build`     | Compile TypeScript with tsup |
| `npm run dev`       | Watch mode                   |
| `npm run typecheck` | Type-check without emitting  |
| `npm start`         | Run the compiled output      |

📚 **Full documentation → [qobuz-bridge-cli/docs](https://kud.io/projects/qobuz-bridge-cli/docs)**
