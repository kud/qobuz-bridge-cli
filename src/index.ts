import { connect, createKeychainStore, createQobuzClient } from "@kud/qobuz"
import { sendMediaKey } from "@kud/macos-media-keys"
import { createNowPlayingBridge } from "@kud/macos-nowplaying-bridge"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { install, uninstall } from "./launchd.js"

const PLAYER_STATE_PATH = join(
  homedir(),
  "Library/Application Support/Qobuz/player-0.json",
)
const POLL_INTERVAL_MS = 3000

// The whole @kud/qobuz suite (CLI, bridge, …) shares one Keychain entry — the
// default service "qobuz" — so logging in through any of them connects them all.
const store = createKeychainStore()

const NOT_CONNECTED = "Not connected to Qobuz. Run  qobuz-bridge login  first."

const isAuthError = (error: unknown): boolean =>
  (error as { kind?: string } | null)?.kind === "auth"

// @kud/qobuz resolves the track but not playback position; read it straight
// from the player state file (player.position.value is milliseconds).
const readElapsedSeconds = async (): Promise<number> => {
  try {
    const state = JSON.parse(await readFile(PLAYER_STATE_PATH, "utf8"))
    const player = state?.player?.data ?? state?.player ?? {}
    return (player?.position?.value ?? 0) / 1000
  } catch {
    return 0
  }
}

const logError = (error: unknown) => console.error(String(error))

// Read a secret without echoing it — the token is sensitive and shouldn't linger
// on screen or in scrollback. Node's readline has no masking, so print the label
// ourselves and then mute the line writer for the answer the user types.
const promptHidden = (label: string): Promise<string> =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    process.stdout.write(label)
    ;(rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {}
    rl.question("", (answer) => {
      rl.close()
      process.stdout.write("\n")
      resolve(answer.trim())
    })
  })

// The bridge stores its Qobuz token here, in the store shared with the rest of the
// suite. connect() does the real work — fetch the app id, validate, persist — so
// this command only has to source the token, which Qobuz exposes nowhere but the
// browser's own network requests. Accepts the token as an argument for scripting,
// otherwise prompts for it hidden so it stays out of shell history.
const login = async () => {
  const provided = process.argv[3]
  console.log(
    "Log in at https://play.qobuz.com/login, then open DevTools → Network,",
  )
  console.log("click any request to www.qobuz.com/api.json, and copy its")
  console.log("X-User-Auth-Token request header.\n")
  const token = provided ?? (await promptHidden("X-User-Auth-Token: "))
  if (!token) {
    console.error("No token provided.")
    process.exit(1)
  }
  try {
    await connect({ token, store })
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log('✓ connected — token stored in the Keychain (service "qobuz").')
  console.log("Next: qobuz-bridge install")
}

const run = async () => {
  if (process.platform !== "darwin") {
    throw new Error("@kud/qobuz-bridge only works on macOS")
  }

  // A missing token surfaces here for the launchd daemon too, so keep it a clear
  // one-liner in the log rather than an unhandled stack trace.
  const client = await createQobuzClient({ store }).catch((error: unknown) => {
    if (isAuthError(error)) {
      console.error(NOT_CONNECTED)
      process.exit(1)
    }
    throw error
  })
  const bridge = await createNowPlayingBridge()

  // Control Center buttons → Qobuz, via the system media keys its event tap catches.
  bridge.on("next", () => void sendMediaKey("next").catch(logError))
  bridge.on("previous", () => void sendMediaKey("previous").catch(logError))
  for (const event of ["play", "pause", "toggle"] as const) {
    bridge.on(event, () => void sendMediaKey("play").catch(logError))
  }

  let lastTrackId: number | undefined
  const tick = async () => {
    const track = await client.nowPlaying().catch(() => undefined)
    if (!track || track.id === lastTrackId) return
    lastTrackId = track.id
    bridge.update({
      title: track.title,
      artist: track.artist?.name,
      album: track.album?.title,
      artworkUrl: track.album?.image?.large ?? track.album?.image?.small,
      duration: track.duration,
      elapsed: await readElapsedSeconds(),
      rate: 1,
      state: "playing",
    })
    console.log(`now playing → ${track.title} — ${track.artist?.name ?? "?"}`)
  }

  const shutdown = () => {
    bridge.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  await tick()
  setInterval(() => void tick(), POLL_INTERVAL_MS)
  console.log("qobuz-bridge running — open Control Center. Ctrl-C to quit.")
}

const main = async () => {
  const command = process.argv[2]
  if (command === "login") return login()
  if (command === "install") {
    // Loading the launchd agent starts the daemon immediately (RunAtLoad), and it
    // would crash-loop on missing credentials. Refuse up front with a fix instead.
    if (!(await store.load())) {
      console.error(NOT_CONNECTED)
      process.exit(1)
    }
    return install()
  }
  if (command === "uninstall") return uninstall()
  return run()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
