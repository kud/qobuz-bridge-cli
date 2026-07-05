import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)

const LABEL = "io.kud.qobuz-bridge"
const APP_NAME = "Qobuz Bridge"
// A space in the executable name is deliberate (cf. "Google Chrome"): the Now
// Playing tile falls back to the executable name when it doesn't resolve the
// bundle's display name, so this keeps the tile pretty either way.
const EXECUTABLE = "Qobuz Bridge"

// The bridge is meaningless without Qobuz installed, so we borrow Qobuz's own
// icon from the local app at install time rather than vendoring its logo into
// this package — no trademarked asset ships, and it always matches the version.
const QOBUZ_ICON = "/Applications/Qobuz.app/Contents/Resources/icon.icns"

const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

// Ad-hoc signing (`-`) pins the Accessibility grant to the exact cdhash, so every
// rebuild re-prompts. If a stable self-signed code-signing identity named below
// exists in the keychain, sign with it instead: its designated requirement is the
// cert, not the cdhash, so the grant survives rebuilds. Falls back to ad-hoc when
// absent, keeping the default install dependency-free.
const SIGN_IDENTITY_NAME = "Qobuz Bridge Code Signing"

const resolveSigningIdentity = async (): Promise<string> => {
  try {
    // No `-v`: a self-signed cert is untrusted (CSSMERR_TP_NOT_TRUSTED) so `-v`
    // hides it, but codesign signs with it fine and TCC keys the grant on its
    // stable hash regardless of trust — which is the whole point.
    const { stdout } = await exec("security", [
      "find-identity",
      "-p",
      "codesigning",
    ])
    return stdout.includes(SIGN_IDENTITY_NAME) ? SIGN_IDENTITY_NAME : "-"
  } catch {
    return "-"
  }
}

const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`)
const logPath = join(homedir(), "Library", "Logs", "qobuz-bridge.log")

// Installed to /Applications so it sits with your real apps (writable by admins
// without sudo) — it's the app you grant Accessibility to once.
const appPath = join("/Applications", `${APP_NAME}.app`)
const macosDir = join(appPath, "Contents", "MacOS")
const resourcesDir = join(appPath, "Contents", "Resources")
const executablePath = join(macosDir, EXECUTABLE)
const infoPlistPath = join(appPath, "Contents", "Info.plist")
const configPath = join(resourcesDir, "config.json")

const launcherSource = fileURLToPath(
  new URL("../native/app-launcher.swift", import.meta.url),
)
const scriptPath = fileURLToPath(new URL("./index.js", import.meta.url))

// launchd does not expand ~ or consult the login shell's PATH, so the node path
// must be absolute. Prefer mise's shim, which resolves the active node at runtime
// and survives runtime upgrades; process.execPath pins to a version-specific mise
// install that breaks the moment mise prunes it.
const miseNodeShim = join(homedir(), ".local", "share", "mise", "shims", "node")
const nodePath = existsSync(miseNodeShim) ? miseNodeShim : process.execPath

const readVersion = async (): Promise<string> => {
  try {
    const pkg = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    )
    return JSON.parse(pkg).version ?? "1.0"
  } catch {
    return "1.0"
  }
}

const infoPlist = (
  version: string,
  hasIcon: boolean,
) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundleExecutable</key><string>${EXECUTABLE}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>${
    hasIcon ? "\n  <key>CFBundleIconFile</key><string>icon</string>" : ""
  }
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
`

const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${executablePath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`

// Assemble Qobuz Bridge.app: compile the launcher into it, bake the node/script
// paths into config.json, write Info.plist, then ad-hoc sign the whole bundle so
// its Accessibility grant survives node upgrades and rebuilds.
const buildApp = async () => {
  // Wipe any prior bundle first so a renamed executable or dropped resource
  // never lingers as a stale file inside the freshly signed app.
  await rm(appPath, { recursive: true, force: true })
  await mkdir(macosDir, { recursive: true })
  await mkdir(resourcesDir, { recursive: true })
  await exec("swiftc", ["-O", launcherSource, "-o", executablePath])
  await writeFile(
    configPath,
    JSON.stringify({ node: nodePath, script: scriptPath }, null, 2),
  )
  const hasIcon = existsSync(QOBUZ_ICON)
  if (hasIcon) await copyFile(QOBUZ_ICON, join(resourcesDir, "icon.icns"))
  await writeFile(infoPlistPath, infoPlist(await readVersion(), hasIcon))
  // Sign last: codesign hashes the executable AND resources, so the icon and
  // config must already be in place or the signature won't cover them.
  const identity = await resolveSigningIdentity()
  await exec("codesign", ["--force", "--sign", identity, appPath])
}

export const install = async () => {
  await mkdir(dirname(plistPath), { recursive: true })
  await mkdir(dirname(logPath), { recursive: true })
  await buildApp()
  // Register with LaunchServices so the Now Playing tile can resolve the
  // bundle's display name and icon rather than falling back to the process.
  await exec(LSREGISTER, ["-f", appPath]).catch(() => {})
  await writeFile(plistPath, plist())
  await exec("launchctl", ["unload", plistPath]).catch(() => {})
  await exec("launchctl", ["load", plistPath])
  console.log(`built app     → ${appPath}`)
  console.log(`login item    → ${plistPath}`)
  console.log(`logs          → ${logPath}`)
  console.log("")
  console.log(
    "One-time step: when macOS asks, grant “Qobuz Bridge” Accessibility",
  )
  console.log("access in System Settings → Privacy & Security → Accessibility.")
}

export const uninstall = async () => {
  await exec("launchctl", ["unload", plistPath]).catch(() => {})
  await rm(plistPath, { force: true })
  await rm(appPath, { recursive: true, force: true })
  console.log(`removed login item → ${plistPath}`)
  console.log(`removed app        → ${appPath}`)
  console.log(
    "You can revoke its entry in System Settings → Privacy & Security → Accessibility.",
  )
}
