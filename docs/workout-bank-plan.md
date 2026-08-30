# Workout Bank — Implementation Plan

Status: draft for discussion · 2026-08-29
Companion doc: [`iceman-2026-training-plan.md`](./iceman-2026-training-plan.md) (the starter workouts to seed the bank)
Prior research: *Event-Specific Training Gaps* (Training Methodology Review, 2026-08-22)

---

## 1. Goal

Replace the current throwaway-workout model with a **reusable Workout Bank**: a small,
curated library of structured workouts described in a portable, FTP-independent format
modeled on the SYSTM `.swi` / Zwift `.zwo` family. The event-plan generator stops
hand-rolling interval arrays and instead **selects workouts from the bank** by zone,
phase, and duration.

Scope for this pass (agreed): full vertical slice — data model + bank service + seed
set + engine executes segments natively + generator consumes the bank. Real
third-party file import (`.zwo` / `.erg` / `.swi`) is explicitly deferred.

### Why the current model blocks this

| Today | Problem |
|---|---|
| `EventPlanService.templateIntervals()` synthesizes a fresh `workouts` row + unrolled `workout_intervals` for **every plan day** (`W1 Tue threshold`) | Nothing is reusable, inspectable, or editable as a library; 11 weeks = ~40 one-off rows |
| Interval targets are **absolute watts**, baked in from FTP at generation time | A workout can't be re-used at a new FTP; no notion of "90% FTP" survives |
| `workout_intervals` is a flat, fully-unrolled list; `kind ∈ {warmup, work, recovery, cooldown}` | No repeat structure, no ramps, no free-ride, no cadence target (column exists, unused) |
| `ErgWorkoutEngine` executes flat constant-power blocks only (ramp exists only as a *transition* smoother between blocks) | Can't render ramps or race-simulation surges even if the generator asked for them |
| `sessionTypeSchema = endurance \| tempo \| threshold \| vo2 \| recovery` | No sweet-spot, anaerobic-capacity, or neuromuscular zones (all flagged in the research doc) |

---

## 2. Design principles (from the `.swi` / `.zwo` family)

The `.swi` format itself is proprietary and undocumented; the well-documented `.zwo`
format is the practical reference and SYSTM/`.mrc`/`.erg` share its shape. The parts
worth copying:

1. **Relative targets.** Power as a fraction of FTP (`0.90`), never watts. Absolute
   watts are resolved by the app at run time from the athlete's current FTP —
   consistent with how `targetIF` is already used as a multiplier in
   `EventPlanService`.
2. **Typed segments, not unrolled blocks.** `warmup`, `steady`, `ramp`, `intervals`
   (a repeat block), `freeride`, `cooldown`. A `4×4 VO2` workout is one `intervals`
   segment with `repeat: 4`, not eight rows.
3. **Ramps are first-class.** `warmup` / `cooldown` / `ramp` carry `powerLow` +
   `powerHigh` and the engine interpolates.
4. **Rich metadata for selection.** name, description, author, discipline, tags,
   `primaryZone`, which training `phases` it suits, plus cached `durationSec` /
   `estIF` / `estTSS`. This is what lets the generator query the bank.
5. **Optional cadence + text cues** per segment (`cadence`, `textEvents`).
6. **Self-contained + serializable.** One workout = one JSON document that can be
   exported, version-controlled, and (later) imported.

---

## 3. Target data model

### 3.1 The workout document (`.fsw` — Full Send Workout, JSON)

Stored as a single JSON blob per bank workout. Not decomposed into rows — it is a
document, edited and validated as a whole.

```jsonc
{
  "schemaVersion": 1,
  "id": "sst-3x15-surge",
  "name": "Sweet Spot 3×15 w/ surges",
  "description": "Race-specific muscular endurance. Sweet spot blocks with short
                  neuromuscular surges to rehearse Iceman's out-of-corner accelerations.",
  "author": "full-send",
  "discipline": "cycling",
  "primaryZone": "sweet-spot",          // see enum below
  "tags": ["xc-mtb", "muscular-endurance", "race-specific"],
  "phases": ["build", "peak"],          // base | build | peak | taper
  "durationSec": 4500,                  // cached, derived from segments
  "estIF": 0.85,                        // cached, derived
  "estTSS": 106,                        // cached, derived
  "segments": [
    { "type": "warmup",   "durationSec": 600, "powerLow": 0.50, "powerHigh": 0.78 },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 900,  "onPower": 0.90, "onCadence": 90,
      "offDurationSec": 300, "offPower": 0.55,
      "surges": { "everySec": 150, "durationSec": 15, "power": 1.5 } },
    { "type": "steady",   "durationSec": 300, "power": 0.60 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ],
  "textEvents": [
    { "atSec": 600, "message": "First block — settle into sweet spot, smooth pedal stroke" }
  ]
}
```

### 3.2 Segment types

| `type` | Fields | Compiles to |
|---|---|---|
| `warmup` | `durationSec`, `powerLow`, `powerHigh`, `cadence?` | one ramp interval (`kind: warmup`) |
| `cooldown` | `durationSec`, `powerLow`, `powerHigh`, `cadence?` | one ramp interval (`kind: cooldown`) |
| `steady` | `durationSec`, `power`, `cadence?` | one flat interval (`kind: work`) |
| `ramp` | `durationSec`, `powerLow`, `powerHigh`, `cadence?` | one ramp interval (`kind: work`) |
| `intervals` | `repeat`, `onDurationSec`, `onPower`, `offDurationSec`, `offPower`, `onCadence?`, `offCadence?`, `surges?`, `onPattern?` | `repeat` × (work + recovery) intervals |

`onPattern` (optional, on `intervals`): an array of `{ durationSec, power }` sub-steps
that make up one "on" rep, replacing the scalar `onDurationSec` / `onPower`. Covers
over-unders and any multi-level rep. `offDurationSec` / `offPower` still apply between
reps.
| `freeride` | `durationSec`, `cadence?` | one interval, `targetPowerWatts: null`, `targetResistancePercent: 0` (slope/resistance mode) |

`surges` (optional, on `intervals` and `steady`): `{ everySec, durationSec, power }` —
compiler slices the parent block and injects short high-power sub-intervals. This is
how race-simulation surges are expressed without a bespoke segment type.

### 3.3 Zones (new shared module `src/shared/zones.ts`)

Centralize the FTP-fraction boundaries the research doc asked for (currently
scattered as magic numbers in `templateIntervals`):

```ts
export const ZONES = {
  recovery:     { min: 0.00, max: 0.55, label: "Recovery" },
  endurance:    { min: 0.56, max: 0.75, label: "Endurance" },
  tempo:        { min: 0.76, max: 0.87, label: "Tempo" },
  "sweet-spot": { min: 0.88, max: 0.93, label: "Sweet Spot" },
  threshold:    { min: 0.94, max: 1.05, label: "Threshold" },
  vo2:          { min: 1.06, max: 1.20, label: "VO2max" },
  anaerobic:    { min: 1.21, max: 1.50, label: "Anaerobic Capacity" },
  neuromuscular:{ min: 1.51, max: 3.00, label: "Neuromuscular" },
} as const;
export type Zone = keyof typeof ZONES;
```

`estIF` = duration-weighted RMS of segment power fractions; `estTSS` =
`durationSec/3600 × estIF² × 100`. Both computed once on save and cached on the row.

### 3.4 Database changes (`src/main/database/schema.ts`)

New table (additive migration — append to the `migrations` array):

```sql
CREATE TABLE IF NOT EXISTS workout_bank (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  primary_zone  TEXT NOT NULL,
  discipline    TEXT NOT NULL DEFAULT 'cycling',
  tags_json     TEXT NOT NULL DEFAULT '[]',
  phases_json   TEXT NOT NULL DEFAULT '[]',
  duration_seconds INTEGER NOT NULL,
  est_if        REAL,
  est_tss       REAL,
  document_json TEXT NOT NULL,          -- the full .fsw document
  source        TEXT NOT NULL DEFAULT 'seed',   -- seed | user | imported
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Add provenance to the existing compiled-workout table so sessions/telemetry/Strava
joins keep working unchanged:

```sql
ALTER TABLE workouts ADD COLUMN bank_workout_id TEXT REFERENCES workout_bank(id);
ALTER TABLE workouts ADD COLUMN compiled_at_ftp INTEGER;
```

`workout_intervals` gains ramp support:

```sql
ALTER TABLE workout_intervals ADD COLUMN target_power_watts_end REAL;  -- null = flat block
-- target_cadence_rpm already exists in the CREATE TABLE; wire it through
```

**No destructive changes.** `workouts` + `workout_intervals` remain the *compiled
runtime representation*. A bank workout is compiled into a `workouts` row (+ intervals)
when it is assigned to a plan day or started ad-hoc, stamped with `bank_workout_id`
and `compiled_at_ftp`.

---

## 4. The compiler

`WorkoutCompiler.compile(document: FswDocument, ftp: number): WorkoutInterval[]`

- resolve every `power` fraction → `Math.round(fraction * ftp)`
- `warmup` / `cooldown` / `ramp` → single interval with `targetPowerWatts` (start) +
  `targetPowerWattsEnd`
- `intervals` → unroll `repeat` × [work, recovery]; last rep drops the trailing
  recovery unless `trailingRecovery: true`
- `surges` → slice parent block, splice in `kind: work` sub-intervals at
  `neuromuscular` power
- `freeride` → `targetPowerWatts: null`, `targetResistancePercent: 0`
- map segment → existing `kind` enum for telemetry continuity
- assert `sum(durationSec)` matches the cached `durationSec`

Pure function, no DB. Unit-tested against the seed set (golden files).

---

## 5. Engine changes (`ErgWorkoutEngine` + `intervalScheduler`)

Phase 2 work — make the engine execute segments natively instead of only flat blocks.

1. **`WorkoutInterval` gains `targetPowerWattsEnd: number | null`** (contracts.ts).
   `null` → flat block (today's behavior, unchanged).
2. **`IntervalScheduler.locate()` returns interpolated target.** When
   `targetPowerWattsEnd` is set, the cursor reports
   `lerp(start, end, elapsedInIntervalSec / durationSec)`. This is distinct from the
   existing *ramp-between-blocks* transition smoother, which stays as-is for the
   first `rampDurationSec` of each block.
3. **Cadence passthrough.** `WorkoutLiveMetrics.targetCadenceRpm` added; surfaced in
   the ride UI, persisted in telemetry (`target_cadence_rpm` column already there).
   No control-point write — cadence is a display target only.
4. **Free-ride blocks.** `targetPowerWatts: null && targetResistancePercent === 0` →
   engine issues a slope/resistance-mode command instead of ERG power.
5. `ErgWorkoutEngine.tick()` intensity scaling already multiplies
   `cursor.interval.targetPowerWatts`; extend the same scaling to the interpolated
   end value.

Back-compat: a compiled workout with no ramp/free-ride segments produces exactly
today's flat interval array.

---

## 6. Services, IPC, contracts

### `src/main/workout/WorkoutBankService.ts` (new)

```
listBankWorkouts(filter?: { zone?; phase?; discipline?; tag?; maxDurationMin?; })
getBankWorkout(id)                       -> { document, derived }
createBankWorkout(document)              -> validates, derives, inserts
updateBankWorkout(id, document)
archiveBankWorkout(id)
selectForPlanDay({ zone, phase, targetDurationMin, discipline, excludeIds })
                                        -> best match (nearest duration, phase-eligible,
                                           not recently used), or null
compileAndPersist({ bankWorkoutId, ftp, name })  -> workoutId (row in `workouts`)
```

`WorkoutLibraryService` keeps its interval-level CRUD for editing *compiled* workouts;
the two services share `repositories`.

### IPC (`contracts.ts` `ipcChannels`, `registerIpcHandlers.ts`)

New `workoutBank` channel group: `list`, `get`, `create`, `update`, `archive`,
`startAdhoc` (compile + hand to `ErgWorkoutEngine`). Zod schemas: `fswDocumentSchema`
(discriminated union over `segment.type`), `bankWorkoutSummarySchema`,
`bankWorkoutFilterSchema`.

### Enum extensions (`contracts.ts`)

- `sessionTypeSchema` → add `"sweet-spot"`, `"anaerobic"`, `"neuromuscular"`
- `eventTypeSchema` → add `"xc-mtb"` (and `"marathon-mtb"` while we're here)
- `planLengthWeeksSchema` → relax from `union(8,12,16)` to
  `z.number().int().min(4).max(24)` (the Iceman plan is 11 weeks)

---

## 7. Generator integration (`EventPlanService`)

### 7.1 Phase-aware session matrix

Replace `sessionTypeForEvent()` (one type for the whole plan) with a lookup keyed by
`(phase, dayRole)`. Phase is derived from position in the plan:

| Phase | When | Key day zone | Secondary day zone | Long day |
|---|---|---|---|---|
| base | first ~⅓ | sweet-spot | tempo | endurance (progressive) |
| build | middle ~⅓ | threshold / vo2 (alternating) | sweet-spot | endurance + tempo blocks |
| peak | final ~¼ before taper | race-specific (event map) | anaerobic / neuromuscular | race-sim |
| taper | last 1–2 wk | threshold (reduced volume, intensity held) | neuromuscular openers | short endurance |

Event type maps to the **peak-phase** zone + tag set:

```
"xc-mtb"     -> zone: threshold,  tags: ["xc-mtb", "race-specific", "surges"]
"criterium"  -> zone: anaerobic,  tags: ["repeated-surge"]        # research doc fix
"time-trial" -> zone: threshold,  tags: ["sustained", "pacing"]
"gran-fondo" -> zone: tempo,      tags: ["long", "climbing"]      # + progressive long ride
"road-race"  -> zone: threshold,  tags: ["variable", "race-sim"]
```

### 7.2 `buildWeekDrafts()` → `selectForPlanDay()`

For each training day: compute `{ zone, phase, targetDurationMin }`, then
`bankService.selectForPlanDay(...)`. `plan_week_workouts` still stores a `workout_id`,
but that row is now **compiled from a bank workout** (`bank_workout_id` set) rather
than synthesized. `excludeIds` = bank workouts already used in the last 2 weeks for
that zone → automatic rotation, which kills the "same shape 12 times" problem.

### 7.3 Fallbacks & taper fix

- No bank match for `(zone, duration)` → fall back to a trimmed `templateIntervals()`
  (kept as a private last resort, not the primary path).
- **Taper fix from the research doc, done here:** volume cut 40–70%, `targetIF`
  **held** (drop the current `baseIF - 0.05`). Cheap, high-value, unambiguous.

### 7.4 Regeneration / adapt

`upsertPlanProjection()` already deletes and rebuilds plan weeks + their workouts on
every generate/adapt. Unchanged — it just calls the bank selector now. Compiled rows
are disposable; the bank is the durable artifact.

---

## 8. Seeding

`src/main/workout/seedWorkoutBank.ts` — an array of `.fsw` documents, inserted on
first run if `workout_bank` is empty (same pattern as `applySchema`). The starter set
(~16 workouts) is specified in
[`iceman-2026-training-plan.md` §Seed workout library](./iceman-2026-training-plan.md).
Covers: recovery, endurance ×2, sweet-spot ×3, threshold ×2, over-unders,
VO2 ×3 (4×4 / 5×3 / 30-15), anaerobic 40/20, neuromuscular sprints, an Iceman
race-sim, and race-week openers.

Keep it small on purpose. The bank grows by (a) users saving edited copies,
(b) later, file import.

---

## 9. UI (minimal)

- **New nav entry "Bank"** (`src/renderer/src/pages/BankPage.tsx`). List with filter
  chips (zone, duration band, tag); row shows name / zone / duration / est. TSS.
- **Detail view**: reuse `WorkoutTimelineChart` (it already renders an interval
  array) fed by the compiler output at the user's current FTP; show segment list +
  description + a "Start now" button (→ `workoutBank.startAdhoc`).
- **Plan day**: show the assigned bank workout's name (already does) + a "swap"
  affordance that opens the bank filtered to the same zone. Swap = reassign +
  recompile that one day.
- Editing: v1 = duplicate a bank workout into an editable compiled workout via the
  existing `WorkoutLibraryService` builder. A true segment editor is later.

---

## 10. Rollout phases

| Phase | Deliverable | Risk |
|---|---|---|
| **1** | `zones.ts`, `workout_bank` table + migration, `FswDocument` schema, `WorkoutCompiler` (+ golden tests), `WorkoutBankService`, seed set, `Bank` page (list + detail + start ad-hoc). Compiler targets **today's** flat-interval engine. | Low — purely additive |
| **2** | Engine native segments: `targetPowerWattsEnd` interpolation, cadence passthrough, free-ride mode. | Medium — touches the live ERG loop; gate behind flat-block equivalence tests |
| **3** | `EventPlanService` phase matrix + `selectForPlanDay`; taper fix; enum + plan-length changes; `xc-mtb` event type in the wizard. Keep `templateIntervals` as fallback only. | Medium — changes generated plans; snapshot/version system already covers rollback |
| **4** (deferred) | Import real `.zwo` / `.erg` / `.mrc` / `.swi` → `FswDocument`. | Isolated parser module |

Each phase ships independently and leaves the app working.

---

## 11. Open decisions

1. **Plan-day compiled rows vs. direct bank reference.** Proposed: keep compiling to
   `workouts` rows (provenance via `bank_workout_id`) so session/telemetry/Strava/
   dashboard joins are untouched. Alternative: repoint `plan_week_workouts.workout_id`
   at the bank and teach every consumer to compile on demand — cleaner model, wider
   blast radius. Recommendation: compiled rows now, revisit after Phase 3.
2. **FTP re-test prompts mid-plan.** The research doc raises this. Out of scope here;
   note that recompiling a plan after a new `metrics_snapshot` FTP is a one-liner once
   §7.4 is in place.
3. **`surges` as a segment field vs. its own segment type.** Field keeps the seed
   documents readable; a type is more composable. Going with the field.
4. **How opinionated should `selectForPlanDay` rotation be** — strict "no repeat
   within N weeks" vs. weighted-random. Start strict, loosen if the bank is too small
   to satisfy it (falls back to nearest-duration regardless).

---

## 12. File touch list

| File | Change |
|---|---|
| `src/shared/zones.ts` | **new** — zone boundaries, `estIF`/`estTSS` helpers |
| `src/shared/ipc/contracts.ts` | `FswDocument` + segment union schemas; `workoutBank` channels; extend `sessionTypeSchema`, `eventTypeSchema`, `planLengthWeeksSchema`; add `targetPowerWattsEnd`, `targetCadenceRpm` to `workoutIntervalSchema` + `workoutLiveMetricsSchema` |
| `src/main/database/schema.ts` | `workout_bank` table; `workouts` + `workout_intervals` `ALTER`s |
| `src/main/database/repositories.ts` | `WorkoutBankRepository`; extend `WorkoutIntervalsRepository` create/update for the two new columns |
| `src/main/workout/WorkoutCompiler.ts` | **new** — `.fsw` → `WorkoutInterval[]` |
| `src/main/workout/WorkoutCompiler.test.ts` | **new** — golden tests over the seed set |
| `src/main/workout/WorkoutBankService.ts` | **new** — bank CRUD + `selectForPlanDay` + `compileAndPersist` |
| `src/main/workout/seedWorkoutBank.ts` | **new** — seed documents + first-run insert |
| `src/main/workout/ErgWorkoutEngine.ts` | interpolate `targetPowerWattsEnd`; cadence in `WorkoutLiveMetrics`; free-ride mode (Phase 2) |
| `src/main/workout/intervalScheduler.ts` | `locate()` returns interpolated target when `targetPowerWattsEnd` set |
| `src/main/plans/EventPlanService.ts` | phase matrix; `selectForPlanDay` instead of `templateIntervals`; taper fix; `templateIntervals` → private fallback |
| `src/main/ipc/registerIpcHandlers.ts` | wire `workoutBank` handlers |
| `src/renderer/src/pages/BankPage.tsx` | **new** — list + detail + start ad-hoc |
| `src/renderer/src/pages/Nav.tsx`, `App.tsx` | route + nav entry; "swap" on plan day; `xc-mtb` in the wizard |
| `src/renderer/src/WorkoutTimelineChart.tsx` | accept a compiled interval array with ramp endpoints (draw sloped blocks) |
