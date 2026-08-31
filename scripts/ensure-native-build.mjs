#!/usr/bin/env node
// better-sqlite3 and @abandonware/noble are native modules — they need to be
// compiled separately for Electron's bundled Node.js (used by `npm run dev` /
// `npm run build`) versus your regular Node.js (used by `npm test`). Switching
// which one you last ran breaks the other with a NODE_MODULE_VERSION error.
//
// This script rebuilds only when the target actually changed since the last
// rebuild, so `predev`/`prebuild`/`pretest` can call it every time without
// slowing things down.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = process.argv[2];
const force = process.argv.includes("--force");

if (target !== "electron" && target !== "node") {
  console.error("Usage: ensure-native-build.mjs <electron|node> [--force]");
  process.exit(1);
}

const markerPath = path.join(process.cwd(), "node_modules", ".native-build-target");
const currentTarget = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : null;

if (!force && currentTarget === target) {
  process.exit(0);
}

console.log(`[native-build] switching better-sqlite3 / noble build target: ${currentTarget ?? "(unknown)"} -> ${target}`);

const command =
  target === "electron"
    ? "npx electron-rebuild -f -w better-sqlite3 -w @abandonware/noble"
    : "npm rebuild better-sqlite3 @abandonware/noble";

execSync(command, { stdio: "inherit" });
writeFileSync(markerPath, target);
