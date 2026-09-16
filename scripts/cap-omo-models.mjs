#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const MAX_CONTEXT_WINDOW = 850_000
const paths = [join(homedir(), ".omo", "models.json"), join(homedir(), ".omo", "agent", "models.json")]

for (const path of paths) {
  if (!existsSync(path)) continue
  const config = JSON.parse(readFileSync(path, "utf8"))
  let changed = false
  for (const provider of Object.values(config.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (typeof model.contextWindow === "number" && model.contextWindow > MAX_CONTEXT_WINDOW) {
        model.contextWindow = MAX_CONTEXT_WINDOW
        changed = true
      }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`${path}: ${changed ? "updated" : "unchanged"}`)
}
