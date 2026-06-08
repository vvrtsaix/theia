#!/usr/bin/env node
/**
 * Env cascade runner — Vite-style file precedence.
 *
 *   Load order (later wins):
 *     .env
 *     .env.local
 *     .env.{NODE_ENV}
 *     .env.{NODE_ENV}.local
 *
 *   NODE_ENV defaults to "development". Override per invocation:
 *     NODE_ENV=production node scripts/with-env.mjs <cmd> [args...]
 *
 * Missing files are skipped silently — only .env is required to be useful,
 * and even that is optional (helper still runs the command with bare
 * process.env).
 *
 * Why a script instead of `dotenv-cli -e ... -e ...` repeated per package
 * script: keeps NODE_ENV substitution and missing-file handling in one
 * place, and per-package scripts stay env-free (just run their binary).
 */

import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const mode = process.env.NODE_ENV ?? "development"
const files = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]

const env = { ...process.env }

for (const name of files) {
  const path = resolve(ROOT, name)
  if (!existsSync(path)) continue
  const text = readFileSync(path, "utf8")
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    // Strip surrounding quotes (single or double).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error("with-env: no command provided")
  process.exit(1)
}

const child = spawn(cmd, args, { stdio: "inherit", env, shell: process.platform === "win32" })
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
