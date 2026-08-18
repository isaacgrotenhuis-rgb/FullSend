# KICKR Desktop (Standalone Foundation)

macOS-first standalone Electron desktop foundation for KICKR training workflows, independent of SportCoach.

## Stack and OSS choices

- **Electron + electron-vite + React + TypeScript** for a secure desktop runtime with a modern web UI.
- **Zod** for runtime validation of IPC inputs/outputs and typed contracts.
- **better-sqlite3** for local persistent storage with predictable synchronous transactions in the main process.
- **@abandonware/noble** for BLE transport scaffolding (scan/connect/disconnect lifecycle).

## Architecture

- `src/main`: privileged process (window lifecycle, BLE service, database initialization, IPC handlers).
- `src/preload`: isolated bridge exposing a minimal, typed `window.kickr` API.
- `src/renderer`: React UI, no direct Node.js or Electron privileged access.
- `src/shared`: IPC channel names, validation schemas, and shared TypeScript API types.

### Security boundaries

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer calls only validated `ipcRenderer.invoke` channels exposed by preload.
- Main process validates request payloads and response payloads with Zod.
- BLE and persistence stay in main; renderer never receives raw privileged handles.

## Persistence scaffolding

SQLite schema and repository stubs are included for:

- `devices`
- `workouts`
- `workout_intervals`
- `workout_sessions`
- `workout_session_events`
- `workout_session_telemetry`
- `training_plans`
- `plan_weeks`
- `goals`
- `metrics_snapshots`
- `strava_sync_events`

## BLE scaffolding scope

Implemented now:

- Service boundary in main process (`BleService` + `BleAdapter`)
- Lifecycle state model (`idle`/`scanning`/`connecting`/`connected`/`disconnected`/`error`)
- Secure IPC surface for scan/list/connect/disconnect/state/capabilities
- FTMS/ERG characteristic discovery abstraction (`discoverFtms`) with profile mapping for:
  - Fitness Machine Control Point
  - Indoor Bike Data
  - Fitness Machine Status
  - Supported Power Range
- BLE transition persistence (`ble_state_transitions`) for lifecycle change auditing.

## Phase 4 ERG workout engine

Implemented now (main process):

- Deterministic interval scheduler for `warmup` / `work` / `recovery` / `cooldown` blocks.
- Session engine lifecycle with explicit controls: start, pause, resume, stop.
- Secure typed IPC for workout controls and live session state stream.
- ERG control loop wiring that pushes interval targets through BLE control abstractions.
- Disconnect fail-safe that transitions session to `degraded` and attempts safe ERG stop.
- Persistence for:
  - session row status in `workout_sessions`
  - lifecycle events in `workout_session_events`
  - live telemetry snapshots in `workout_session_telemetry`

Out of scope in this phase:

- Strava sync workflows
- Training-plan generation

## Strava OAuth token handling strategy

- Keep OAuth tokens in local SQLite only, never in renderer memory longer than needed.
- Encrypt token payloads at rest using OS keychain-backed material (planned next step).
- Store access token expiry and refresh token metadata for proactive refresh in main process.
- Log only high-level sync outcomes in `strava_sync_events`; never log raw tokens.
- Expose only sanitized sync status/events to renderer through typed IPC.

## Scripts

- `npm run dev` - start Electron + renderer in development.
- `npm run build` - production build for main/preload/renderer.
- `npm run typecheck` - TypeScript checks for node + web targets.

## macOS BLE setup and smoke checks

1. On first BLE scan attempt, macOS should prompt for Bluetooth permission for the app process; allow it.
2. Ensure Bluetooth is enabled in macOS settings and the trainer is awake/broadcasting.
3. Run `npm run dev`, click **Scan**, then **Refresh list** if needed.
4. Confirm discovered device entries appear, then click **Connect** for the target trainer.
5. Click **Discover FTMS** and verify the FTMS profile JSON includes discovered characteristics.

If scan results are empty, re-check permission state under System Settings → Privacy & Security → Bluetooth and restart the app.
