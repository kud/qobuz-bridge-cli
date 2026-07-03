import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)

const LABEL = "io.kud.qobuz-bridge"
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`)
const logPath = join(homedir(), "Library", "Logs", "qobuz-bridge.log")
const scriptPath = fileURLToPath(new URL("./index.js", import.meta.url))

// launchd does not expand ~ or consult the login shell's PATH, so the node path
// must be absolute. Prefer mise's shim, which resolves the active node at runtime
// and survives runtime upgrades; process.execPath pins to a version-specific mise
// install that breaks the moment mise prunes it.
const miseNodeShim = join(homedir(), ".local", "share", "mise", "shims", "node")
const nodePath = existsSync(miseNodeShim) ? miseNodeShim : process.execPath

const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`

export const install = async () => {
  await mkdir(dirname(plistPath), { recursive: true })
  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(plistPath, plist())
  await exec("launchctl", ["unload", plistPath]).catch(() => {})
  await exec("launchctl", ["load", plistPath])
  console.log(`installed login item → ${plistPath}`)
  console.log(`logs → ${logPath}`)
}

export const uninstall = async () => {
  await exec("launchctl", ["unload", plistPath]).catch(() => {})
  await rm(plistPath, { force: true })
  console.log(`removed login item → ${plistPath}`)
}
