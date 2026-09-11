# Full Send

Full Send is a macOS-first standalone Electron desktop app for structured indoor
training on a Wahoo KICKR (or any FTMS smart trainer). It connects to the trainer
and sensors over Bluetooth LE, runs ERG workouts from a reusable workout bank,
generates and adapts an event-specific training plan, tracks progress, and posts
completed rides to Strava. It is fully independent of SportCoach.

## Features

### Ride

- Live ERG session driven by the in-process interval engine: warmup / work /
  recovery / cooldown blocks plus first-class ramps and repeat structures.
- In-ride dashboard with a target-power readout alongside live **power, heart
  rate, cadence, speed, and distance** tiles.
- Start, pause, resume, and stop controls; live **intensity** (% of target) and
  **ramp-duration** adjustments mid-session.
- Disconnect fail-safe: on trainer signal loss the session transitions to
  `degraded` and issues a safe ERG stop.
- Post-workout summary with average/peak metrics and power / heart-rate /
  speed / distance charts, then Save (optionally post to Strava) or Discard.
- Completed sessions record their full planned duration (no off-by-one at the
  finish line).

### Workout Bank

- Curated library of structured workouts in the portable, FTP-independent
  **`.fsw` (Full Send Workout)** JSON format — power as a fraction of FTP,
  typed segments (`warmup`, `steady`, `ramp`, `intervals`, `freeride`,
  `cooldown`), optional cadence and text cues, and selection metadata
  (`primaryZone`, `phases`, cached `durationSec` / `estIF` / `estTSS`).
- Ships with 18 seed workouts covering recovery → neuromuscular zones.
- Browse, filter, preview (compile to concrete intervals at your current FTP),
  create, edit, and archive workouts.
- Start any bank workout ad hoc, without a plan.

### Training plan

- Generate an event-specific plan (the bundled target is **Iceman Cometh 2026**)
  from event type, date, weekly hours, and day availability. The generator
  selects workouts from the bank by zone / phase / duration instead of
  hand-rolling interval arrays.
- Adapt an existing plan from a free-text prompt plus intensity / volume bias;
  every generation and adaptation is versioned and audited.
- Add or swap a bank workout on any plan day and record what you "actually did".

### Progress dashboard

- Home page surfaces weekly planned-vs-actual load, an FTP trend, and plan
  compliance.

### Strava

- Browser OAuth (out-of-band code entry); tokens are encrypted at rest with the
  OS keychain via Electron `safeStorage` and never leave the main process.
- Completed sessions are mapped to a Strava activity-creation payload and posted;
  only high-level outcomes are logged to `strava_sync_events`.

### Bluetooth LE

- Scan / connect / disconnect lifecycle over `@abandonware/noble`, with device
  **roles** (`power`, `heart_rate`, `cadence`) so a trainer and a separate HR
  strap can be connected together.
- FTMS characteristic discovery (Fitness Machine Control Point, Indoor Bike Data,
  Fitness Machine Status, Supported Power Range) and a heart-rate profile.
- Lifecycle transitions are persisted to `ble_state_transitions` for auditing.

## Stack

- **Electron 32 + electron-vite + React 19 + TypeScript** — secure desktop
  runtime with a modern web UI.
- **Zod** — runtime validation of every IPC request and response, and the source
  of the shared TypeScript contract types.
- **better-sqlite3** — local persistent storage with synchronous transactions in
  the main process.
- **@abandonware/noble** — BLE transport (scan / connect / disconnect, GATT).
- **Vitest** — unit tests for the main-process services.
- **electron-builder** — macOS packaging (arm64 dmg + zip).

## Architecture

- `src/main` — privileged process: window lifecycle, BLE service, database,
  workout engine, workout bank, plan services, dashboard, Strava, IPC handlers.
- `src/preload` — isolated bridge exposing a single minimal, typed
  `window.kickr` API (`KickrDesktopApi`).
- `src/renderer` — React UI (`Home`, `Plan`, `Bank`, `Ride`, `Profile`); no
  direct Node.js or Electron privileged access.
- `src/shared` — IPC channel names, Zod schemas, shared API types, the `.fsw`
  schema, and training-zone definitions.

### Security boundaries

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- The renderer calls only validated `ipcRenderer.invoke` channels exposed by
  preload; every payload is validated with Zod on the way in and out.
- BLE, persistence, and OAuth tokens stay in main; the renderer never receives
  raw privileged handles or raw tokens.

## Data model

SQLite schema and repositories cover:

| Domain | Tables |
|---|---|
| Devices / BLE | `devices`, `ble_state_transitions` |
| Workouts | `workouts`, `workout_intervals`, `workout_bank` |
| Sessions | `workout_sessions`, `workout_session_events`, `workout_session_telemetry` |
| Plans | `training_plans`, `plan_weeks`, `plan_week_workouts`, `plan_week_assignments`, `plan_versions`, `plan_audit_entries` |
| Progress | `goals`, `metrics_snapshots` |
| Strava | `strava_tokens`, `strava_sync_events` |

## IPC surface

Typed channel groups (see `src/shared/ipc/contracts.ts`):

- `app` — health check.
- `ble` — scan, list, connect, disconnect, state, capabilities, FTMS discovery,
  state subscription.
- `workout` — start / pause / resume / stop / save / discard, set intensity,
  set ramp duration, session-state and telemetry streams.
- `workoutLibrary` — CRUD for editable workouts and intervals, plan-day
  assignment.
- `workoutBank` — list, get, compile, create, update, archive, start ad hoc.
- `eventPlan` — generate, adapt, delete, get current.
- `dashboard` — progress metrics.
- `strava` — connect, disconnect, sync, retry, status.

## Getting started

Requires Node.js 20+ and macOS with Bluetooth.

1. Install dependencies: `npm install`
2. Start in development: `npm run dev`
3. Release-readiness gate: `npm run typecheck && npm run build`

## Scripts

- `npm run dev` — start Electron + renderer in development.
- `npm run build` — production build for main / preload / renderer.
- `npm run typecheck` — TypeScript checks for the node and web targets.
- `npm test` — run the Vitest suite.
- `npm run pack:dir` — build and package an unpacked `.app` (no installer).
- `npm run dist` — build and package a macOS dmg + zip.
- `npm run dist:local` — `dist` with code-signing discovery disabled (unsigned
  local build).

### Native modules

`better-sqlite3` and `@abandonware/noble` are native and must be compiled
separately for Electron's bundled Node.js (`dev` / `build`) versus your system
Node.js (`test`). `scripts/ensure-native-build.mjs` runs automatically from the
`predev` / `prebuild` / `pretest` / `postinstall` hooks and rebuilds only when
the target actually changed, so switching between `npm run dev` and `npm test`
just works.

## Packaging

`electron-builder.yml` produces an arm64 macOS **dmg** and **zip** with hardened
runtime and Bluetooth usage descriptions. Native modules are unpacked from the
asar and rebuilt against the packaged Electron ABI. Signing/notarization is
wired but optional — use `npm run dist:local` for an unsigned build.

## Testing

`npm test` runs Vitest against the main-process services: BLE service and FTMS/HR
parsing, the ERG workout engine, the workout compiler, the workout library and
bank services, the seed set, and event-plan generation.

## macOS BLE setup

1. On the first scan, macOS prompts for Bluetooth permission for the app — allow
   it.
2. Make sure Bluetooth is on and the trainer is awake and broadcasting.
3. Run `npm run dev`, click **Scan**, then **Refresh list** if needed.
4. Click **Connect** on the target trainer, then **Discover FTMS** and confirm
   the profile JSON lists the discovered characteristics.

If scan results stay empty, re-check System Settings → Privacy & Security →
Bluetooth and restart the app.

## Strava setup

- Set `KICKR_STRAVA_CLIENT_ID` / `KICKR_STRAVA_CLIENT_SECRET` (and optionally
  `KICKR_STRAVA_REDIRECT_URI`, default out-of-band) in the environment.
- Connect from the Profile page: authorize in the browser and paste the returned
  code. Tokens are encrypted with `safeStorage` and stored only in local SQLite;
  the main process refreshes them proactively.
- Posting uses activity-creation payload mapping from completed sessions, not
  FIT/TCX file upload.

## iOS trainer simulator

`trainer-simulator-ios/` is a SwiftUI iPhone app that advertises itself as an
FTMS smart trainer so Full Send can be developed without real hardware. It runs
on a phone (not the same Mac) because macOS can't reliably discover a BLE
peripheral it is advertising to itself. Heart rate is not simulated — use a real
strap. See [`trainer-simulator-ios/README.md`](trainer-simulator-ios/README.md).

## Docs

- [`docs/workout-bank-plan.md`](docs/workout-bank-plan.md) — the `.fsw` format,
  data model, and bank/engine/generator design.
- [`docs/iceman-2026-training-plan.md`](docs/iceman-2026-training-plan.md) — the
  Iceman Cometh block structure and the seed workout library.
- [`docs/bank-ui-plan.md`](docs/bank-ui-plan.md) — the bank browse/preview UI
  plan.
- [`docs/design/fullsend`](docs/design/fullsend) — visual design references.

## Known limitations

- BLE auto-reconnect is intentionally conservative (bounded retries) and does not
  guarantee recovery on every adapter / firmware combination.
- On trainer disconnect mid-ride the session ends in `degraded` rather than
  pausing to wait for a reconnect.
- Strava auth uses manual out-of-band code entry; posting is activity-payload
  mapping, not file upload.
- Real third-party workout import (`.zwo` / `.erg` / `.swi`) is not implemented;
  the bank is `.fsw`-only.
- Packaging targets macOS arm64 only.
