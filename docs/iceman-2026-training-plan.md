# Iceman Cometh 2026 — Training Plan & Seed Workouts

Status: draft · 2026-08-29
Companion doc: [`workout-bank-plan.md`](./workout-bank-plan.md) (the app changes)

This doc has two parts:

1. **The plan** — a race-specific block for Iceman Cometh.
2. **The seed workout library** — ~17 workouts in the `.fsw` format from the
   companion doc. These are the base set to fill the Workout Bank; every session in
   the plan references one by `id`.

---

## Part 0 — Assumptions (confirm these)

| Thing | Assumed | Note |
|---|---|---|
| Race | Iceman Cometh Challenge — Kalkaska → Traverse City, MI. ~30 mi / 48 km point-to-point, XC MTB | Two-track, snowmobile trail, singletrack, **sand**, punchy climbs (Make It Stick, Woodchip, Anita's Hill near the finish). Often cold/wet. |
| Race date | **Saturday, November 7, 2026** (first Saturday of November) | From today (Aug 29) that is **10 weeks**, not 11. If your date is Nov 14, insert one extra Build week (repeat Week 6). |
| Time available | 4–6 h/week, 3–4 sessions, most < 75 min, one longer weekend ride | Plan is built to the low end and flexes up. |
| Training setup | Balanced indoor/outdoor — structured work on the KICKR, long + skills rides on the MTB | Every indoor key session has an outdoor substitution (Part 4). |
| Priority | Iceman is the only A race, no tune-ups | One clean build to peak on race day. |
| FTP | **Unknown — set it in Week 1.** Plan targets are all **% of FTP.** | Worked watts below use FTP = 250 W as an example; substitute yours. |

**Race demand profile.** Iceman is ~1:15–2:30 of *sustained sweet-spot-to-threshold*
riding with **repeated 10–30 s surges** out of corners, through sand, and over short
steep pitches — plus a hard first 8–10 minutes to get position. The limiters it
punishes: aerobic power (FTP), muscular endurance / time-to-exhaustion at 88–95%,
the ability to recover *between* surges (anaerobic recharge), and bike handling in
sand and off-camber when fatigued. The plan is weighted toward those.

---

## Part 1 — Block structure (10 weeks)

| Wk | Dates | Phase | Focus | Target hrs |
|---|---|---|---|---|
| 1 | Aug 31 – Sep 6 | Prep | Baseline FTP test, set zones, easy aerobic, 1 skills ride | ~4 |
| 2 | Sep 7 – 13 | Base / ME | Sweet-spot muscular endurance, raise TTE | ~5 |
| 3 | Sep 14 – 20 | Base / ME | More sweet-spot volume + first surges | ~5.5 |
| 4 | Sep 21 – 27 | **Deload** | Volume −40%, intensity light. Optional re-test. | ~3 |
| 5 | Sep 28 – Oct 4 | Build | Threshold (2×20 / 3×10), over-unders | ~5.5 |
| 6 | Oct 5 – 11 | Build | Threshold + VO2 intro (5×3), race-effort long ride | ~6 |
| 7 | Oct 12 – 18 | Build / Peak | VO2 (4×4) + 40/20s, **Iceman sim ride #1**. Highest load. | ~6 |
| 8 | Oct 19 – 25 | **Deload + sharpen** | Volume −35%, intensity held: 30/15s, openers, skills | ~4 |
| 9 | Oct 26 – Nov 1 | Race-specific | **Iceman sim ride #2**, threshold-with-surges; taper starts Thu | ~4.5 |
| 10 | Nov 2 – 7 | Race week | Openers, pre-ride spin, **RACE Sat Nov 7** | ~2.5 + race |

Load shape: build 2 weeks → deload (Wk4) → build 3 weeks → deload (Wk8) → 1
race-specific week → race. Intensity rises across the block; **volume never gets
big** — with 4–6 h/week the lever is specificity, not hours.

### Weekly skeleton

| Day | Session |
|---|---|
| Mon | Rest / mobility |
| Tue | **Key 1** — structured indoor, the phase's primary intensity |
| Wed | Rest, *or* easy endurance 40–50 min if fresh |
| Thu | **Key 2** — structured indoor, secondary intensity (over-unders / VO2 / neuromuscular) |
| Fri | Rest |
| Sat | **Long ride** — outdoor MTB when possible: endurance + race-specific blocks + skills |
| Sun | Easy endurance 45–75 min *or* MTB skills, low stress (optional — drop on deload weeks) |

Move days around your life freely; keep **48 h between the two key sessions** and
don't stack a key session the day before the long ride.

---

## Part 2 — Week-by-week

Notation: `id` refers to a seed workout in Part 5. `@0.90` = 90% FTP.

### Week 1 — Prep (Aug 31 – Sep 6) · ~4 h
- **Tue** — `ftp-test-ramp` (or 20-min test). This sets every number in the plan.
- **Thu** — `endurance-60` @0.65, add 4×20 s fast-pedal (not power) to wake the legs.
- **Sat** — `skills-mtb-60`: MTB on Iceman-like terrain. Cornering, braking before
  the corner, riding sand (light hands, weight back, keep pedaling, look through).
- **Sun** — optional `recovery-30`.

### Week 2 — Base / ME (Sep 7 – 13) · ~5 h
- **Tue** — `sweet-spot-2x12` @0.90.
- **Thu** — `endurance-90` (3×8 min tempo lifts @0.80).
- **Sat** — MTB long ride 75–90 min easy–tempo, 3–4 short standing efforts up climbs.
- **Sun** — optional `endurance-60`.

### Week 3 — Base / ME (Sep 14 – 20) · ~5.5 h
- **Tue** — `sweet-spot-3x12` @0.90.
- **Thu** — `sweet-spot-3x15-surge` — sweet spot with 15 s surges (first race-specific
  session). If it's too much on top of Tuesday, do `over-unders-3x9` instead.
- **Sat** — MTB long ride 90 min, middle 40 min at steady tempo on two-track.
- **Sun** — optional `skills-mtb-60` (sand focus).

### Week 4 — Deload (Sep 21 – 27) · ~3 h
- **Tue** — `endurance-60` @0.65.
- **Thu** — `ftp-test-ramp` **(optional re-test)** or `vo2-5x3` cut to 3 reps as an
  opener.
- **Sat** — easy MTB 60–75 min, all skills, no intensity.
- Sun — rest.

### Week 5 — Build: Threshold 1 (Sep 28 – Oct 4) · ~5.5 h
- **Tue** — `threshold-2x20` @0.98 (or `threshold-3x10` if 2×20 is a reach).
- **Thu** — `over-unders-3x9` (2 min @0.90 / 1 min @1.05, ×3 per rep).
- **Sat** — MTB long ride 90–105 min: endurance with 2×15 min @ sweet spot on climbs.
- **Sun** — optional `endurance-60`.

### Week 6 — Build: Threshold 2 + VO2 intro (Oct 5 – 11) · ~6 h
- **Tue** — `threshold-3x10` @0.98, last rep as far above as you can hold.
- **Thu** — `vo2-5x3` @1.12.
- **Sat** — MTB long ride 105–120 min with 3×8 min at race effort (hard tempo +
  surges over every rise). This is a mini race-sim.
- **Sun** — optional easy 45–60 min.

### Week 7 — Peak load (Oct 12 – 18) · ~6 h
- **Tue** — `vo2-4x4` @1.10.
- **Thu** — `anaerobic-40-20` (3 sets × 9) @1.20 — surge repeatability.
- **Sat** — **`iceman-sim`** ride #1, outdoors on the MTB (~75 min). Full race
  warm-up, then the 3 threshold+surge blocks on two-track, the free-ride block in
  sand / tech.
- **Sun** — rest or 30 min spin. This is the biggest week — protect recovery.

### Week 8 — Deload + sharpen (Oct 19 – 25) · ~4 h
- **Tue** — `vo2-30-15` (3 sets × 13) @1.15 — sharp, short, not draining.
- **Thu** — `race-openers-25`.
- **Sat** — MTB 75 min easy with 5×30 s race-pace surges; mostly skills and line
  choice while fresh.
- Sun — rest.

### Week 9 — Race-specific (Oct 26 – Nov 1) · ~4.5 h
- **Tue** — `iceman-sim` ride #2 (indoors on the KICKR is fine here — hit the
  numbers). Or outdoors if weather + daylight allow.
- **Thu** — `threshold-3x10` cut to **2×10** @0.98 with 4×15 s surges in each rep.
  *Taper starts now.*
- **Sat** — MTB 70 min endurance with 3×3 min at race effort. Ride some of the
  actual course if you can get to Traverse City.
- Sun — rest.

### Week 10 — Race week (Nov 2 – 7)
| Day | Session |
|---|---|
| Mon | Rest |
| Tue | `race-openers-25` |
| Wed | Easy 40 min @0.60, 3×1 min building to threshold |
| Thu | Rest / travel |
| Fri | 30–40 min easy on the MTB: pre-ride the start and finish if possible, 3×1 min at race pace + 3×10 s sprints, then stop. Check tire pressure for expected conditions. |
| **Sat** | **ICEMAN COMETH — Nov 7** |
| Sun | Celebrate. Easy spin if you want it. |

---

## Part 3 — FTP test & zones

**Week 1 test — pick one:**
- **Ramp test** (`ftp-test-ramp`): warm up, then +20 W every minute from ~0.50×
  bodyweight-ish start until you can't hold cadence. FTP ≈ 75% of final 1-min power.
  Lower stress, good for a season opener.
- **20-minute test**: 15–20 min warm-up with 3×1 min fast, 5 min easy, then 20 min
  all-out even effort. FTP = 0.95 × average power.

Re-test optionally in Week 4 (deload) and use Week 7's `iceman-sim` numbers as a
field check. If Week 4 FTP is up >3%, bump all % targets are automatic (they're
relative) — just update the FTP number.

**Worked watts at FTP = 250 W** (substitute yours):

| % FTP | W | Used for |
|---|---|---|
| 0.50 | 125 | recovery, warm-up start |
| 0.60 | 150 | easy endurance, between-set recovery |
| 0.65 | 163 | endurance |
| 0.80 | 200 | tempo lifts |
| 0.90 | 225 | sweet spot |
| 0.98 | 245 | threshold |
| 1.05 | 263 | "over" in over-unders |
| 1.12 | 280 | VO2 (5×3) |
| 1.20 | 300 | anaerobic (40/20) |
| 1.60 | 400 | race surges |
| 1.70 | 425 | neuromuscular sprints |

---

## Part 4 — Outdoor substitutions

Do the structured work outdoors on the MTB whenever weather and daylight allow —
it's more specific. How to translate each key session:

| Indoor session | Outdoor MTB version |
|---|---|
| `sweet-spot-*` | Find a 8–15 min climb or sustained two-track drag. Ride the "on" blocks there at RPE "comfortably hard, could talk in short sentences." Roll back down as the recovery. |
| `threshold-2x20` / `3x10` | Same, at "hard, one-word answers only." A long false-flat or gravel road works if you don't have the climb length. |
| `over-unders-3x9` | On a climb with rollers: "under" on the steady grade, punch to "over" over each riser. |
| `vo2-4x4` / `5x3` | Steep climb, near-maximal but even. Full easy spin down between. |
| `anaerobic-40-20` / `vo2-30-15` | On flat-ish two-track so you can actually hit the recoveries. Great to do on rough surface for specificity. |
| `neuro-8x15` | Sprints out of a slow corner or up a short steep pitch, seated then standing. Long soft-pedal between. |
| `iceman-sim` | The point of it — do it outdoors: race warm-up, 3 hard tempo blocks with a surge over every rise, a dedicated block riding sand / choosing lines / cornering under fatigue, spin home. |

**Skills to drill every skills ride:** cornering (brake before, off the brakes
through, drive out), sand (light front, weight back, keep the power on, look far
ahead), riding in a group at speed, drinking/eating while moving, and re-passing
after a bottleneck (short surge then settle — exactly the race pattern).

---

## Part 5 — Seed workout library (`.fsw`)

Format defined in [`workout-bank-plan.md` §3](./workout-bank-plan.md). `power` values
are fractions of FTP. `intervals` segments use `onPattern` when one rep has internal
steps (over-unders); otherwise the simple `on*` / `off*` form. Durations in seconds.

These 17 are the starter bank. Grouped by zone.

### Testing

```jsonc
{ "schemaVersion": 1, "id": "ftp-test-ramp", "name": "FTP Ramp Test",
  "primaryZone": "threshold", "discipline": "cycling",
  "tags": ["test"], "phases": ["base","build"], "durationSec": 2400,
  "segments": [
    { "type": "warmup", "durationSec": 600, "powerLow": 0.40, "powerHigh": 0.55 },
    { "type": "ramp",   "durationSec": 1500, "powerLow": 0.40, "powerHigh": 1.60,
      "textEvents": [{ "atSec": 0, "message": "Hold cadence 85–95. Stop when you can't." }] },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.50, "powerHigh": 0.40 }
  ] }
```

### Recovery / Endurance

```jsonc
{ "schemaVersion": 1, "id": "recovery-30", "name": "Recovery Spin 30",
  "primaryZone": "recovery", "tags": ["recovery"], "phases": ["base","build","peak","taper"],
  "durationSec": 1800,
  "segments": [ { "type": "steady", "durationSec": 1800, "power": 0.50, "cadence": 90 } ] }
```

```jsonc
{ "schemaVersion": 1, "id": "endurance-60", "name": "Endurance 60",
  "primaryZone": "endurance", "tags": ["endurance","aerobic"], "phases": ["base","build","taper"],
  "durationSec": 3600,
  "segments": [
    { "type": "warmup",  "durationSec": 600,  "powerLow": 0.50, "powerHigh": 0.65 },
    { "type": "steady",  "durationSec": 2520, "power": 0.65, "cadence": 88 },
    { "type": "cooldown","durationSec": 480,  "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "endurance-90", "name": "Endurance 90 w/ Tempo Lifts",
  "primaryZone": "endurance", "tags": ["endurance","tempo"], "phases": ["base","build"],
  "durationSec": 5400,
  "segments": [
    { "type": "warmup", "durationSec": 600, "powerLow": 0.50, "powerHigh": 0.65 },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 480, "onPower": 0.80, "onCadence": 85,
      "offDurationSec": 900, "offPower": 0.63 },
    { "type": "cooldown", "durationSec": 660, "powerLow": 0.62, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "skills-mtb-60", "name": "MTB Skills & Terrain 60",
  "primaryZone": "endurance", "discipline": "cycling",
  "tags": ["mtb","skills","outdoor"], "phases": ["base","build","peak","taper"],
  "durationSec": 3600,
  "segments": [
    { "type": "freeride", "durationSec": 3600,
      "textEvents": [
        { "atSec": 0,    "message": "Cornering: brake before, off brakes through, drive out." },
        { "atSec": 1200, "message": "Sand: light front, weight back, keep pedaling, look ahead." },
        { "atSec": 2400, "message": "Fatigued line choice — practice re-passing after a bottleneck." }
      ] } ] }
```

### Sweet Spot

```jsonc
{ "schemaVersion": 1, "id": "sweet-spot-2x12", "name": "Sweet Spot 2×12",
  "primaryZone": "sweet-spot", "tags": ["muscular-endurance"], "phases": ["base","build"],
  "durationSec": 2760,
  "segments": [
    { "type": "warmup", "durationSec": 600, "powerLow": 0.50, "powerHigh": 0.78 },
    { "type": "intervals", "repeat": 2,
      "onDurationSec": 720, "onPower": 0.90, "onCadence": 90,
      "offDurationSec": 300, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 420, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "sweet-spot-3x12", "name": "Sweet Spot 3×12",
  "primaryZone": "sweet-spot", "tags": ["muscular-endurance"], "phases": ["base","build"],
  "durationSec": 3960,
  "segments": [
    { "type": "warmup", "durationSec": 600, "powerLow": 0.50, "powerHigh": 0.78 },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 720, "onPower": 0.90, "onCadence": 90,
      "offDurationSec": 300, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 420, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "sweet-spot-3x15-surge", "name": "Sweet Spot 3×15 w/ Surges",
  "primaryZone": "sweet-spot", "tags": ["muscular-endurance","race-specific","surges","xc-mtb"],
  "phases": ["build","peak"], "durationSec": 4500,
  "segments": [
    { "type": "warmup", "durationSec": 600, "powerLow": 0.50, "powerHigh": 0.78 },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 900, "onPower": 0.90, "onCadence": 90,
      "offDurationSec": 300, "offPower": 0.55,
      "surges": { "everySec": 150, "durationSec": 15, "power": 1.50 } },
    { "type": "steady", "durationSec": 300, "power": 0.60 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

### Threshold

```jsonc
{ "schemaVersion": 1, "id": "threshold-3x10", "name": "Threshold 3×10",
  "primaryZone": "threshold", "tags": ["threshold","ftp"], "phases": ["build"],
  "durationSec": 3480,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.50, "powerHigh": 0.80 },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 600, "onPower": 0.98, "onCadence": 88,
      "offDurationSec": 300, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 360, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "threshold-2x20", "name": "Threshold 2×20",
  "primaryZone": "threshold", "tags": ["threshold","ftp","tte"], "phases": ["build"],
  "durationSec": 3960,
  "segments": [
    { "type": "warmup", "durationSec": 900, "powerLow": 0.50, "powerHigh": 0.82 },
    { "type": "intervals", "repeat": 2,
      "onDurationSec": 1200, "onPower": 0.98, "onCadence": 88,
      "offDurationSec": 360, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "over-unders-3x9", "name": "Over-Unders 3×9",
  "primaryZone": "threshold", "tags": ["threshold","over-under","race-specific"],
  "phases": ["build","peak"], "durationSec": 3420,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.50, "powerHigh": 0.82 },
    { "type": "intervals", "repeat": 3,
      "onPattern": [
        { "durationSec": 120, "power": 0.90 }, { "durationSec": 60, "power": 1.05 },
        { "durationSec": 120, "power": 0.90 }, { "durationSec": 60, "power": 1.05 },
        { "durationSec": 120, "power": 0.90 }, { "durationSec": 60, "power": 1.05 }
      ],
      "offDurationSec": 300, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

### VO2max

```jsonc
{ "schemaVersion": 1, "id": "vo2-5x3", "name": "VO2 5×3",
  "primaryZone": "vo2", "tags": ["vo2max"], "phases": ["build"],
  "durationSec": 3180,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.50, "powerHigh": 0.85 },
    { "type": "intervals", "repeat": 5,
      "onDurationSec": 180, "onPower": 1.12, "onCadence": 95,
      "offDurationSec": 180, "offPower": 0.50 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "vo2-4x4", "name": "VO2 4×4",
  "primaryZone": "vo2", "tags": ["vo2max"], "phases": ["build","peak"],
  "durationSec": 3300,
  "segments": [
    { "type": "warmup", "durationSec": 900, "powerLow": 0.50, "powerHigh": 0.85 },
    { "type": "intervals", "repeat": 4,
      "onDurationSec": 240, "onPower": 1.10, "onCadence": 92,
      "offDurationSec": 240, "offPower": 0.50 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "vo2-30-15", "name": "VO2 30/15 — 3×13",
  "primaryZone": "vo2", "tags": ["vo2max","micro-intervals"], "phases": ["build","peak","taper"],
  "durationSec": 3225,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.50, "powerHigh": 0.80 },
    { "type": "intervals", "repeat": 13, "onDurationSec": 30, "onPower": 1.15,
      "offDurationSec": 15, "offPower": 0.50 },
    { "type": "steady", "durationSec": 180, "power": 0.50 },
    { "type": "intervals", "repeat": 13, "onDurationSec": 30, "onPower": 1.15,
      "offDurationSec": 15, "offPower": 0.50 },
    { "type": "steady", "durationSec": 180, "power": 0.50 },
    { "type": "intervals", "repeat": 13, "onDurationSec": 30, "onPower": 1.15,
      "offDurationSec": 15, "offPower": 0.50 },
    { "type": "cooldown", "durationSec": 300, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

### Anaerobic / Neuromuscular

```jsonc
{ "schemaVersion": 1, "id": "anaerobic-40-20", "name": "Anaerobic 40/20 — 3×9",
  "primaryZone": "anaerobic", "tags": ["anaerobic-capacity","repeated-surge","race-specific","xc-mtb"],
  "phases": ["peak"], "durationSec": 3540,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.50, "powerHigh": 0.80 },
    { "type": "intervals", "repeat": 9, "onDurationSec": 40, "onPower": 1.20,
      "offDurationSec": 20, "offPower": 0.55 },
    { "type": "steady", "durationSec": 300, "power": 0.55 },
    { "type": "intervals", "repeat": 9, "onDurationSec": 40, "onPower": 1.20,
      "offDurationSec": 20, "offPower": 0.55 },
    { "type": "steady", "durationSec": 300, "power": 0.55 },
    { "type": "intervals", "repeat": 9, "onDurationSec": 40, "onPower": 1.20,
      "offDurationSec": 20, "offPower": 0.55 },
    { "type": "cooldown", "durationSec": 360, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "neuro-8x15", "name": "Neuromuscular 8×15 s Sprints",
  "primaryZone": "neuromuscular", "tags": ["sprint","neuromuscular"], "phases": ["peak","taper"],
  "durationSec": 3300,
  "segments": [
    { "type": "warmup", "durationSec": 900, "powerLow": 0.50, "powerHigh": 0.70,
      "textEvents": [{ "atSec": 600, "message": "3×10 s primers here, full recovery between" }] },
    { "type": "intervals", "repeat": 8, "onDurationSec": 15, "onPower": 1.70, "onCadence": 105,
      "offDurationSec": 225, "offPower": 0.50 },
    { "type": "cooldown", "durationSec": 360, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

### Race-specific

```jsonc
{ "schemaVersion": 1, "id": "iceman-sim", "name": "Iceman Simulation",
  "primaryZone": "threshold", "tags": ["race-specific","xc-mtb","surges","simulation"],
  "phases": ["peak"], "durationSec": 4500,
  "segments": [
    { "type": "warmup", "durationSec": 720, "powerLow": 0.55, "powerHigh": 0.80,
      "textEvents": [{ "atSec": 480, "message": "3×20 s surges to open, like the race start" }] },
    { "type": "intervals", "repeat": 3,
      "onDurationSec": 600, "onPower": 0.92, "onCadence": 88,
      "offDurationSec": 240, "offPower": 0.60,
      "surges": { "everySec": 120, "durationSec": 20, "power": 1.60 } },
    { "type": "freeride", "durationSec": 900,
      "textEvents": [{ "atSec": 0, "message": "Sand / cornering / line choice under fatigue" }] },
    { "type": "steady", "durationSec": 300, "power": 0.60 },
    { "type": "cooldown", "durationSec": 240, "powerLow": 0.60, "powerHigh": 0.45 }
  ] }
```

```jsonc
{ "schemaVersion": 1, "id": "race-openers-25", "name": "Race Openers 25",
  "primaryZone": "threshold", "tags": ["openers","taper","pre-race"], "phases": ["taper"],
  "durationSec": 1500,
  "segments": [
    { "type": "warmup", "durationSec": 480, "powerLow": 0.50, "powerHigh": 0.70 },
    { "type": "intervals", "repeat": 3, "onDurationSec": 60, "onPower": 1.00,
      "offDurationSec": 120, "offPower": 0.55 },
    { "type": "intervals", "repeat": 3, "onDurationSec": 10, "onPower": 1.60,
      "offDurationSec": 110, "offPower": 0.50 },
    { "type": "steady", "durationSec": 180, "power": 0.55 },
    { "type": "cooldown", "durationSec": 120, "powerLow": 0.55, "powerHigh": 0.45 }
  ] }
```

> `onPattern` note: this field is an extension to the `intervals` segment from the
> companion doc — an array of `{ durationSec, power }` sub-steps that make up one
> "on" rep, replacing the scalar `onDurationSec` / `onPower`. It covers over-unders
> and any multi-level rep. Added to §3.2 of `workout-bank-plan.md`.

---

## Part 6 — Running the plan *before* the Workout Bank ships

Until [`workout-bank-plan.md`](./workout-bank-plan.md) Phase 3 lands, the app's
generator can't produce this plan (no `xc-mtb` event type, no sweet-spot/anaerobic
session types, 11-week length not allowed). Options:

1. **Manual + builder.** Follow this doc off the page. Recreate the key seed
   workouts in the existing workout builder (flat blocks — unroll the repeats by
   hand at your FTP) and start them ad-hoc from the library. Tedious but works today.
2. **Generate + edit.** Generate a 12-week `criterium` plan (its key day maps to
   VO2, closest to this block's intensity), then hand-edit weeks toward this
   structure. Rough.
3. **Build Phase 1 first** (bank model + seed + `Bank` page + ad-hoc start, no
   generator changes). Then these 17 workouts load from `seedWorkoutBank.ts` and you
   start each day's session from the Bank page, following the week-by-week table
   here manually. This is the smallest useful slice and the recommended path.

---

## Part 7 — Race day

- **Fuel:** 60–90 g carb/hour from the gun. Iceman is short enough that a bonk is a
  pacing/fueling error, not inevitable. Start eating in the first 20 min.
- **Warm-up:** it's cold and the start is hard. 15–20 min: easy, 3×1 min building to
  threshold, 3×10 s openers, finish 10 min before your wave. Keep a layer on until
  the last minute.
- **Pacing:** hard but controlled first 8–10 min to get position into the singletrack,
  then settle to a high sweet-spot you can hold, surge over the risers and out of
  corners, **recover on the descents and downhills — pedal light, breathe, eat.**
  Negative-split the back half if you can; the hills (Anita's) are near the end.
- **Tires/pressure:** set for the forecast — lower for sand and soft, not so low you
  burp on the frozen ruts. Pre-ride Friday to sanity-check.
- **Taper check:** legs should feel slightly twitchy and impatient by Thursday. That's
  correct. Don't add work to chase a feeling.
