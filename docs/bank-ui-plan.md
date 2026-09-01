# Workout Bank UI + plan-day swap — implementation plan

Issue: [FullSend#25](https://github.com/isaacgrotenhuis-rgb/FullSend/issues/25)
Status: draft for confirmation · 2026-08-31

This supersedes the UI slice in `workout-bank-plan.md` §9 with the direction agreed in
the issue thread:

- **No workout editing.** The bank is read-only content. The only mutation is at the
  **plan-day** level.
- On any day (Home current week + Plan page, every week) the user can **add** a bank
  workout or **swap** the prescribed one for a bank workout.
- The prescribed ("planned") workout is never destroyed — when swapped it stays
  visible in a **greyed-out** state next to the workout the user added / did.
- A day can hold **multiple** workouts.
- Keep the standalone **"Bank"** nav entry (browse + filter + *Start now* ad-hoc).
- Bank browser/detail is a **vertically scrollable modal** styled like the existing
  `WorkoutPreviewDialog`. Keep it a manageable size.

Already done, not re-touched: `WorkoutTimelineChart` renders sloped ramp blocks as of
`5dcd96a`.

---

## 1. Data model

The plan the UI renders comes from a **versioned snapshot** (`plan_versions.snapshot_json`,
read by `EventPlanService.getCurrentPlan()`). User day-edits must *not* live in that
snapshot — `adapt` regenerates it. They live in a separate override layer that is
merged in at read time and survives regeneration.

### New table — `plan_day_workouts`

```sql
CREATE TABLE IF NOT EXISTS plan_day_workouts (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  week_index     INTEGER NOT NULL,
  day_index      INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
  workout_id     TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  bank_workout_id TEXT,                 -- provenance; null if not from the bank
  mode           TEXT NOT NULL,         -- 'add' | 'swap'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_day_workouts_lookup
  ON plan_day_workouts(plan_id, week_index, day_index);
```

- Keyed by `plan_id + week_index + day_index` (stable across snapshot regen).
- `mode = 'swap'` → the prescribed workout for that day renders greyed / struck.
  `mode = 'add'` → prescribed workout renders normally, extra workout listed under it.
- The compiled `workouts` row is created via the existing
  `WorkoutBankService.compileAndPersist()` (stamps `bank_workout_id`, `compiled_at_ftp`,
  denormalized preview metadata — same path `startAdhoc` uses).
- Removing an entry deletes the row and its compiled `workouts` row.

### "Actually did" tracking — in scope (PR 2)

Add three nullable columns to `workout_sessions`:

```sql
ALTER TABLE workout_sessions ADD COLUMN plan_id        TEXT;
ALTER TABLE workout_sessions ADD COLUMN plan_week_index INTEGER;
ALTER TABLE workout_sessions ADD COLUMN plan_day_index  INTEGER;
```

Set at `ErgWorkoutEngine.start()` when the session is launched from a plan-day context
(the renderer passes `{ planId, weekIndex, dayIndex }` alongside the existing
`metadata`). Everything else about session save / Strava sync / dashboard / ride
history is **unchanged** — these are just an optional back-pointer.

`getCurrentPlan()` merge attaches, per day, `completed[]` = sessions for that
`(plan_id, plan_week_index, plan_day_index)` with a terminal `status`, each carrying
`{ sessionId, workoutId, workoutName, startedAt, status }`. Date matching is *not*
used — the explicit pointer disambiguates repeats of the same compiled workout.

A completed session with no plan pointer still shows in ride history as it does today;
it just won't attach to a plan day.

### Contract change — `eventPlanDaySchema`

```ts
const planDayEntrySchema = z.object({
  id: z.string(),                       // plan_day_workouts.id
  workoutId: z.string(),
  workoutName: z.string(),
  sessionType: sessionTypeSchema.nullable(),
  durationMin: z.number().int().min(0),
  targetIF: z.number().nullable(),
  bankWorkoutId: z.string().nullable()
});

const planDayCompletedSchema = z.object({
  sessionId: z.string(),
  workoutId: z.string().nullable(),
  workoutName: z.string().nullable(),
  startedAt: z.string(),
  status: z.string()
});

const eventPlanDaySchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  // prescribed by the generator (was the flat fields on this object)
  planned: z.object({
    workoutId: z.string().nullable(),
    workoutName: z.string().nullable(),
    sessionType: sessionTypeSchema.nullable(),
    durationMin: z.number().int().min(0),
    targetIF: z.number().nullable()
  }),
  plannedReplaced: z.boolean(),         // a 'swap' entry exists
  entries: z.array(planDayEntrySchema), // user-added, ordered
  completed: z.array(planDayCompletedSchema) // terminal sessions back-pointed here
});
```

Consumers to migrate off the old flat shape: `App.tsx`, `pages/HomePage.tsx`,
`pages/PlanPage.tsx`, `EventPlanService` snapshot builders, any dashboard read.
No back-compat shim — one clean migration.

---

## 2. IPC additions

### `workoutBank.compile` — preview compile (no persist)

```
req  { id: string, ftp: number }
res  { intervals: WorkoutInterval[], durationSec: number, estIF: number|null, estTSS: number|null }
```
Thin wrapper over the existing `WorkoutBankService.compileForFtp()`. Feeds the modal's
timeline chart + stat tiles.

### `eventPlan.addDayWorkout`

```
req  { planId, weekIndex, dayIndex, bankWorkoutId, ftp, mode: 'add' | 'swap' }
res  updated EventPlanDay
```
Compiles + persists the bank workout, inserts a `plan_day_workouts` row. No new plan
version (this is an override layer, not a plan edit — matches "planned stays greyed").

### `eventPlan.removeDayWorkout`

```
req  { id }        // plan_day_workouts.id
res  updated EventPlanDay
```

Preload (`src/preload/index.ts`) + `registerIpcHandlers.ts` wiring for all three.

---

## 3. Renderer

### `WorkoutBankBrowser` modal — `src/renderer/src/pages/WorkoutBankBrowser.tsx`

- Backdrop + `.dialog` shell from `WorkoutPreviewDialog`; body `max-height: 80vh;
  overflow-y: auto`. Width `min(720px, 100%)`.
- **List mode**: filter chips — zone (8 `FSW_PRIMARY_ZONES`), duration band
  (`< 45m`, `45–75m`, `75–120m`, `> 120m`), tag (union of tags from results).
  Scrollable rows: name · zone label · duration · est. TSS. Data:
  `window.kickr.workoutBank.list(filter)`.
- **Detail mode** (row click): stat tiles (duration / avg power / IF / TSS / blocks)
  + `WorkoutTimelineChart` fed by `workoutBank.compile({ id, ftp })` + segment list
  from `detail.document.segments` + description. Back returns to list.
- Footer action is caller-supplied:
  - from Bank nav page → **Start now** (`workoutBank.startAdhoc`, needs connected trainer)
  - from a plan day → **Add to {day}** / **Swap {day}** (`eventPlan.addDayWorkout`)

### `BankPage` — `src/renderer/src/pages/BankPage.tsx` + nav

- `Page` union in `App.tsx` gains `"bank"`; `Nav.tsx` gains a "Bank" text link next to
  "Plan".
- Page renders the same filterable list; selecting opens `WorkoutBankBrowser` in detail
  mode with the **Start now** action.

### Day cells — Home + Plan

- Render `planned` (greyed + struck when `plannedReplaced`) then `entries[]` beneath,
  each opening the existing `WorkoutPreviewDialog`. `completed[]` sessions render with
  a "done" marker (and can link to ride history).
- A `+` affordance on every day opens `WorkoutBankBrowser` in add/swap mode
  (swap offered only when `planned.workoutId` is set). Each `entries[]` row gets a
  remove control → `eventPlan.removeDayWorkout`.
- Starting a plan-day workout goes through the normal `workout.startSession` path with
  `{ planId, weekIndex, dayIndex }` added, so the session lands in ride history *and*
  back-points to the day.
- `App.tsx` threads `currentFtp` and `bleState.connectedDeviceId` through.

### Helper

`durationBand(durationSec)` — small pure fn, colocated with the modal (not `zones.ts`).

---

## 4. Suggested PR split

| PR | Contents | Risk |
|---|---|---|
| **1** | `workoutBank.compile` IPC · `WorkoutBankBrowser` modal · `BankPage` + nav entry · *Start now* ad-hoc. No plan changes. | Low — additive; covers issue #25's literal list |
| **2** | `plan_day_workouts` table + migration · `workout_sessions` plan back-pointer columns · `eventPlanDaySchema` reshape + read-merge (`planned` / `entries` / `completed`) · `addDayWorkout` / `removeDayWorkout` IPC + plan-day context on `startSession` · Home/Plan day UI (planned-grey vs added vs done, multi-per-day). | Medium — contract touches every day consumer |

---

## 5. Decisions (locked 2026-08-31)

1. **Contract reshape** — migrate every day consumer to `planned` / `entries` /
   `completed`. No back-compat shim.
2. **Two PRs** as split above.
3. **"Actually did" tracking — in scope now**, via `workout_sessions` plan
   back-pointer columns + `completed[]` in the merge (PR 2).
4. **No plan version / audit entry** for day add/swap — it is an override layer. But
   completed sessions from added/swapped workouts still appear in ride history
   unchanged (they go through the normal session-save path; the plan pointer is
   additive).
