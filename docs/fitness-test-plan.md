# Fitness Test (MAP + FTP + cTHR) & Workout Seeking — Plan

Status: proposed · Owner: Isaac · Date: 2026-11-05

## 1. Goals

1. A guided **Fitness Test** workout that measures **MAP**, **FTP** and **cTHR**
   (threshold heart rate), modelled on the *structure* of Wahoo's Half Monty:
   a ramp to failure followed by a 20-minute heart-rate-capped effort.
2. In-ride **instructions**: a pre-ride briefing plus timed cues during the ride.
3. A **results + fitness analysis** screen after the ride, with an explicit
   "Apply to profile" step (never a silent overwrite).
4. **Seeking**: the rider can drag the workout progress bar to jump to another
   part of *any* workout. For the test, the expected flow is: stop pedaling →
   the ride auto-pauses → drag to the next phase → start pedaling → it resumes.
5. A **Quick Ramp** variant (ramp only, no HR strap needed) as a fallback.

Non-goals for v1: closed-loop ERG that drives power from HR, a Critical Power
test, lab-grade VO₂max.

> Wahoo doesn't publish the Half Monty formulas. Everything below is our own
> protocol built on established methods (1-min-step MAP ramp, Friel-style
> threshold HR from a steady effort). Constants marked **[calibrate]** are
> starting values to tune with real rides.

## 2. Protocol

| # | Phase | Duration | Trainer mode | Target |
|---|---|---|---|---|
| 1 | Warm-up | 10 min | ERG | 40→60% MAP_seed, plus 2 × 30 s openers at 80% MAP_seed |
| 2 | **Ramp** | until failure (generated to 160% MAP_seed) | ERG | 1-min steps (see below) |
| 3 | Recovery | 10 min | ERG | 35% MAP (measured) |
| 4 | **Capped effort** | 20 min | Free ride (resistance/slope) | Rider sets power; HR ≤ cap |
| 5 | Cool-down | 10 min | ERG | 30% MAP |

**Quick Ramp** = phases 1, 2 and 5 only (~30 min).

### Ramp generation

`MAP_seed`, in priority order:
1. `profile.mapWatts`
2. `profile.ftpWatts / 0.75`
3. `profile.weightKg × 3.3`
4. 250 W

- Start = `round5(0.45 × MAP_seed)`
- Step = `max(10, round5(0.045 × MAP_seed))` per minute **[calibrate]**
- Example: MAP_seed 333 W → start 150 W, +15 W/min, reaching MAP_seed in about
  12 min.
- Steps are generated up to 160% of MAP_seed. Finishing every step marks the
  test invalid ("the seed was too low, re-test"), the same rule Wahoo uses.
  Completing fewer than 5 steps is also invalid.

Because ramp watts depend on the profile, the test is **generated in watts**
(`buildFitnessTest(profile, variant)` → `WorkoutInterval[]` plus phase
metadata). It is not an FTP-fraction `.fsw` document, and it bypasses
`compile()`, so it works for a brand-new user with no FTP.

### Ramp end detection

The ramp ends at the first of:

- **Failure**: cadence below 55 rpm **or** power below 80% of target, held for
  5 s **[calibrate]**.
- **Rider gives up**: they stop pedaling. The ride auto-pauses (§5.2) and they
  drag to Recovery, or press **"End ramp"**.
- All steps finished (marked invalid, see above).

On failure the engine shows a 5-second "Ramp complete — moving to recovery"
countdown with a **Keep going** button, then seeks to Recovery automatically.
Manual seeking is the fallback when detection misses.

### HR cap for the capped effort

Computed once, the moment the ramp ends:

- `ftpRamp = 0.75 × MAP`
- `hrAtFtp` = 15-s-smoothed HR at the end of the first ramp step whose target
  is ≥ `ftpRamp`
- `hrCap = min(hrAtFtp + 5, 0.95 × rampMaxHr)` **[calibrate]**. The +5 bpm
  allows for HR lagging power during a 1-minute ramp.

If no HR data was captured, the test **downgrades to Quick Ramp**: phase 4 is
skipped and the rider is told why.

### Capped-effort guidance

The trainer is in free-ride mode. A `targetPowerWatts: null` interval with
`targetResistancePercent` already falls through to slope mode in `applyTargets`.
The rider controls power with their gears. On screen:

- A large **HR vs cap** gauge with a band of `[cap − 3, cap]`, and a prompt:
  "Push a little harder" / "Hold it here" / "Ease off".
- For the first 3 minutes, a suggested starting power of `ftpRamp`.
- A running average of power across the scored window.

## 3. Calculations (pure, `src/shared/fitnessTest.ts`)

Input: telemetry rows tagged with phase, plus profile weight and test metadata.
Output: a `FitnessTestResult`.

| Metric | Definition |
|---|---|
| **MAP** | Best rolling 60-s average of *measured* power within the ramp phase |
| **FTP (ramp)** | 0.75 × MAP |
| **FTP (capped)** | Mean power from minute 5 to minute 20 of the capped effort. The first 5 min are dropped while HR settles. |
| **FTP (reported)** | FTP (capped) when that phase is valid, otherwise FTP (ramp) |
| **cTHR** | Mean HR from minute 5 to minute 20 of the capped effort |
| **Max HR (observed)** | Max of 5-s-smoothed HR across the ride |
| **W/kg** | FTP / weight, and MAP / weight |
| **VO₂max (est.)** | `10.8 × MAP / kg + 7` mL/kg/min (ACSM leg-ergometry formula). Labelled as an estimate. |
| **FTP/MAP ratio → rider profile** | < 0.72 *anaerobic / punchy* · 0.72–0.80 *balanced* · > 0.80 *aerobic / diesel* **[calibrate]** |
| **Zones** | Power zones from the new FTP (`src/shared/zones.ts`), HR zones from cTHR |
| **Trend** | Change in each metric since the previous valid test |

### Validity flags

Each flag is shown as a warning. Flags marked *blocking* disable "Apply" until
the rider acknowledges them.

- Fewer than 5 ramp steps completed (*blocking*)
- Every ramp step completed (*blocking*)
- Telemetry gaps: more than 10% of ramp seconds have no power reading
- HR missing or with dropouts in the capped effort → fall back to FTP (ramp)
- Capped effort: average HR more than 5 bpm above the cap (rider overcooked
  it), or more than 8 bpm below (rider was sandbagging)
- Capped-effort power coefficient of variation above 15% (unsteady effort)
- FTP (capped) and FTP (ramp) disagree by more than 12%. Not an error — the
  analysis copy explains what it suggests about the rider's profile.
- Rider seeked out of the capped effort before minute 15 → fall back to
  FTP (ramp)

### Analysis copy

Generate 3–5 plain-language bullets from rules, not an LLM. Examples:

- "Your FTP is 78% of your MAP — a balanced profile."
- "MAP up 4% since your last test; FTP flat → aerobic base is the limiter."
- "Your HR drifted above the cap in the last 5 min, so FTP may read slightly high."

## 4. Data model

### `user_profile` new columns (via `applySchema` `ALTER TABLE` guards)

- `map_watts INTEGER`
- `threshold_hr_bpm INTEGER` (cTHR)
- `max_hr_bpm INTEGER`

Extend `UserProfile`, `UpdateProfileRequest` and `ProfileService`. Add the
fields to the profile page so a rider can enter them by hand.

### New table `fitness_tests`

```
id TEXT PK, session_id TEXT REFERENCES workout_sessions(id),
variant TEXT ('full' | 'quick'), taken_at TEXT,
map_seed_watts INTEGER, map_watts INTEGER,
ftp_ramp_watts INTEGER, ftp_capped_watts INTEGER, ftp_watts INTEGER,
threshold_hr_bpm INTEGER, max_hr_bpm INTEGER, hr_cap_bpm INTEGER,
weight_kg REAL, vo2max_est REAL,
valid INTEGER, flags_json TEXT, result_json TEXT,
applied_at TEXT NULL, created_at, updated_at
```

`result_json` stores the full `FitnessTestResult`, so the analysis rules can
change later without losing old results. **Apply** writes the profile fields,
sets `applied_at`, writes a `metrics_snapshots` row (`ftp_watts`, `weight_kg`,
`vo2max`), and triggers a recompile of any workout whose `compiled_at_ftp`
differs from the new FTP.

### Telemetry

Add a `position_sec REAL` column to `workout_session_telemetry` (see §5.1).
Add a `phase` key to the telemetry `payloadJson` for test sessions. The
existing `block_type` and `block_index` columns already locate the ramp
intervals.

## 5. Engine changes (`ErgWorkoutEngine`)

### 5.1 Separate the ride clock from the workout position — prerequisite for seeking

Today `elapsedSec` is wall-clock time minus pause time, and it does two jobs:
it is the ride duration (used for Strava `elapsed_time`, the recap and "X of Y
planned"), **and** it is the input to `scheduler.locate()`. Seeking breaks
that.

- Keep `elapsedSec` as the **ride clock**: monotonic, moving time only.
- Add `positionSec` as the **workout cursor**. It advances 1:1 with
  `elapsedSec` while running, and a seek rewrites it:
  `positionOffsetSec += target − currentPosition`.
- `locate(positionSec)` drives targets.
- "Completed" now means `positionSec ≥ total`.
- Progress UI and `completionPct` switch to `positionSec`.
- The `maxElapsedJumpSec` clamp continues to apply to the clock only.
- Add `positionSec` to `WorkoutSessionState` and `WorkoutLiveMetrics`.

### 5.2 Auto-pause / auto-resume

- **Auto-pause**: no cadence *and* no power reading (stale per
  `staleTelemetryMs`, or 0) for **10 s** **[calibrate]** → `pause()` with
  reason `auto`. Wahoo uses roughly 20 s; 10 s feels better on a trainer.
  Expose the delay as a setting.
- **Auto-resume**: cadence ≥ 30 rpm for 3 s, only when the pause was automatic
  (a manual pause still requires the Resume button).
- On by default for all workouts. This also fixes the clock running while a
  rider unclips mid-workout.

### 5.3 Seek API

- `seek(sessionId, positionSec)` → IPC `workout:seek`, plus an
  `api.workout.seek` binding in preload.
- Allowed while `running` or `paused`. The renderer only enables dragging while
  paused or while the scrub handle is held (§6.1).
- Clamp to `[0, total − 1]`. Persist a `seek` event `{ from, to, elapsedSec }`.
- After a seek, set `forceRampReset` so ERG soft-ramps from the current power
  using the existing `rampDurationSec` logic, and push the new target
  immediately if running.
- During a fitness test, **seeking backwards into the ramp is blocked** (it
  would corrupt MAP). Seeking forward is always allowed.

### 5.4 Fitness-test runtime

The engine stays generic. A small `FitnessTestController` (in
`src/main/workout/`) subscribes to engine ticks while a test session is active.
It:

- tracks the phase from `positionSec` and the phase boundaries
- runs ramp failure detection (§2) → emits a `ramp-ended` event → after the
  countdown, calls `engine.seek(recoveryStart)`
- computes `hrCap` when the ramp ends and pushes it into live state as
  `testState: { phase, hrCap, scoredAvgPowerWatts, ... }` (add to
  `WorkoutSessionState`)
- on downgrade (no HR), seeks to cool-down and marks the variant `quick`
- disables `setIntensity` for the session, since a multiplier would invalidate
  the result (return a clear error; the UI hides the control)

A manual stop of a test is not an abort: the session completes with reason
`test-ended-early`, and the analysis decides what can still be salvaged.

## 6. Renderer

### 6.1 Seekable progress bar (all workouts)

- Make `WorkoutProfileChart` on `RidePage` (around line 308) into a scrubber
  with `role="slider"`, a drag handle on the position line, and
  arrow/PageUp/PageDown keys that jump by a segment.
- **While running**: dragging shows a ghost position and a target preview. On
  release, confirm with "Jump to 32:10 — Recovery?" (one click) to avoid
  accidental drags.
- **While paused**: drag and drop with no confirm. This is the Wahoo flow.
- Snap to segment starts within ±10 s, and draw labelled markers for test
  phases (Ramp, Recovery, Capped effort, Cool-down).
- A **Skip to next segment** button as the non-drag alternative.
- Also show `positionSec / total` on the chart. The ride clock stays in the
  Time tile.

### 6.2 Instructions

- **Briefing dialog** before start. Content:
  - What the test measures
  - How long it takes
  - Rested, fueled, fan on
  - HR strap required (with a live connection check; the Quick Ramp offer is
    shown when no strap is connected)
  - Hold 85–95 rpm, stay seated
  - "Go until you truly can't turn the pedals, then stop pedaling — we'll take
    it from there"
  - The capped-effort rule
  - A "Start test" button
- **Timed cues**: add an optional `cue?: { atSec: number; message: string }[]`
  to `workoutIntervalSchema`. Render the active cue as a banner on `RidePage`
  for about 8 s. The test generator fills it with messages such as:
  - "Ramp starts in 30 s"
  - "Every step is one minute — stay seated"
  - "You're past your old MAP!"
  - "Recovery — spin easy, drink"
  - "Capped effort: ride as hard as you can while keeping HR under {cap}"
  - "5 min in, scoring starts now"
- **Bonus**: wire the existing `.fsw` `textEvents` into these cues in
  `compile()`. They're currently parsed but never shown.

### 6.3 Results

- On save, a test session opens a **Fitness Test Results** dialog instead of
  the normal recap (reuse the shadcn dialog shell from the end-of-ride redesign).
- Headline tiles: FTP, MAP and cTHR, each with the change from the previous
  value. Then W/kg, VO₂max (est.), rider-profile badge, validity warnings,
  analysis bullets, and a new-zones table.
- Chart: power and HR over the ride with phase bands, the MAP minute, the
  scored window, and the HR cap line (built on `RideMetricsChart`).
- Actions: **Apply to profile** (primary; choose which metrics: FTP, MAP and
  cTHR are all checked by default) and **Not now**. The result can be applied
  later from history.
- **Profile page**: a "Fitness" section with current MAP, FTP and cTHR, the
  last test date, a test-history list and trend sparkline, and a
  **Take a fitness test** button.
- **Entry points**: a Home card ("Take a fitness test", nudging if the last
  test was more than 6 weeks ago or there is no FTP), the Profile page, and
  the end of onboarding when FTP is unknown.

## 7. Delivery slices

1. **Seeking foundation** (useful on its own) — *implemented 2026-11-05; auto-pause
   arms only after the rider has pedaled since start/resume, so getting on the
   bike after pressing Start never pauses the ride*
   - clock/position split
   - `seek` IPC
   - auto-pause/resume
   - scrubber + skip button
   - Tests: position vs clock, seek clamps and events, auto-pause timing,
     completion by position, Strava elapsed time unaffected
2. **Profile + storage + analysis**
   - profile columns
   - `fitness_tests` table and repository
   - pure `analyzeFitnessTest()` with fixtures: synthetic punchy, balanced and
     diesel riders; no HR; too few steps; seeked out early
3. **Test workout + runtime** — *implemented 2026-11-05. The test's plan
   (phases, ramp numbers) is saved as a `fitness-test-started` session event
   and the HR cap as `fitness-test-ramp-ended`, so slice 4 scores from
   telemetry `position_sec` + events with no extra schema. Entry point for now
   is a Home card; the Profile and onboarding entry points are still slice 4.*
   - `buildFitnessTest()`
   - `FitnessTestController` (failure detection, HR cap, downgrade, intensity
     lock)
   - cue support
   - briefing dialog
   - capped-effort HR gauge
4. **Results + apply**
   - results dialog
   - apply flow + `metrics_snapshots` + recompile
   - Profile "Fitness" section, Home card, onboarding hook

Every slice runs `node scripts/ensure-native-build.mjs node` before running
vitest directly (native module ABI).

## 8. Open questions

1. Should ramp failure auto-advance after the countdown, or only *offer* to
   skip? (Proposed: auto-advance with a cancel button.)
2. Auto-pause delay: 10 s (proposed) or ~20 s like Wahoo? Should it be on by
   default for normal workouts too?
3. Should seeking while running in normal workouts be allowed (with confirm),
   or only while paused?
4. Should Apply also rescale an active training plan's targets, or just
   recompile `.fsw` workouts at the new FTP?
5. Calibration: compare FTP (capped) against FTP (ramp) and against the
   rider's best 20-min power across a few real tests before locking in the
   **[calibrate]** constants.
