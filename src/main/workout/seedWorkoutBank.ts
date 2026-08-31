/**
 * Seed workout library for the Workout Bank.
 *
 * Every workout defined as a JSON block in `docs/iceman-2026-training-plan.md`
 * Part 5 is transcribed here as a typed `FswDocument`. Cached `estIF` / `estTSS`
 * are intentionally omitted — the bank service derives them via
 * `deriveFswMetrics`. `durationSec` is kept as stated in the doc; segment
 * durations were reconciled so `deriveFswMetrics(seed).durationSec` matches it
 * (see `seedWorkoutBank.test.ts` and the PR description for the specific edits).
 *
 * `seedWorkoutBankIfEmpty` (bottom of file) is the first-run loader that inserts
 * these into the bank table.
 */
import type { FswDocument } from "@shared/fsw";
import type { WorkoutBankService } from "@main/workout/WorkoutBankService";

export const SEED_WORKOUTS: FswDocument[] = [
  // ── Testing ────────────────────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "ftp-test-ramp",
    name: "FTP Ramp Test",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["test"],
    phases: ["base", "build"],
    durationSec: 2400,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.4, powerHigh: 0.55 },
      {
        type: "ramp",
        durationSec: 1500,
        powerLow: 0.4,
        powerHigh: 1.6,
        textEvents: [{ atSec: 0, message: "Hold cadence 85–95. Stop when you can't." }]
      },
      { type: "cooldown", durationSec: 300, powerLow: 0.5, powerHigh: 0.4 }
    ]
  },

  // ── Recovery / Endurance ───────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "recovery-30",
    name: "Recovery Spin 30",
    discipline: "cycling",
    primaryZone: "recovery",
    tags: ["recovery"],
    phases: ["base", "build", "peak", "taper"],
    durationSec: 1800,
    segments: [{ type: "steady", durationSec: 1800, power: 0.5, cadence: 90 }]
  },
  {
    schemaVersion: 1,
    id: "endurance-60",
    name: "Endurance 60",
    discipline: "cycling",
    primaryZone: "endurance",
    tags: ["endurance", "aerobic"],
    phases: ["base", "build", "taper"],
    durationSec: 3600,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.65 },
      { type: "steady", durationSec: 2520, power: 0.65, cadence: 88 },
      { type: "cooldown", durationSec: 480, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "endurance-90",
    name: "Endurance 90 w/ Tempo Lifts",
    discipline: "cycling",
    primaryZone: "endurance",
    tags: ["endurance", "tempo"],
    phases: ["base", "build"],
    durationSec: 5400,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.65 },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 480,
        onPower: 0.8,
        onCadence: 85,
        offDurationSec: 900,
        offPower: 0.63,
        // Doc's stated durationSec (5400) counts the recovery after the final lift.
        trailingRecovery: true
      },
      { type: "cooldown", durationSec: 660, powerLow: 0.62, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "skills-mtb-60",
    name: "MTB Skills & Terrain 60",
    discipline: "cycling",
    primaryZone: "endurance",
    tags: ["mtb", "skills", "outdoor"],
    phases: ["base", "build", "peak", "taper"],
    durationSec: 3600,
    segments: [
      {
        type: "freeride",
        durationSec: 3600,
        textEvents: [
          { atSec: 0, message: "Cornering: brake before, off brakes through, drive out." },
          { atSec: 1200, message: "Sand: light front, weight back, keep pedaling, look ahead." },
          {
            atSec: 2400,
            message: "Fatigued line choice — practice re-passing after a bottleneck."
          }
        ]
      }
    ]
  },

  // ── Sweet Spot ─────────────────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "sweet-spot-2x12",
    name: "Sweet Spot 2×12",
    discipline: "cycling",
    primaryZone: "sweet-spot",
    tags: ["muscular-endurance"],
    phases: ["base", "build"],
    durationSec: 2760,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.78 },
      {
        type: "intervals",
        repeat: 2,
        onDurationSec: 720,
        onPower: 0.9,
        onCadence: 90,
        offDurationSec: 300,
        offPower: 0.55
      },
      { type: "cooldown", durationSec: 420, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "sweet-spot-3x12",
    name: "Sweet Spot 3×12",
    discipline: "cycling",
    primaryZone: "sweet-spot",
    tags: ["muscular-endurance"],
    phases: ["base", "build"],
    durationSec: 3960,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.78 },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 720,
        onPower: 0.9,
        onCadence: 90,
        offDurationSec: 300,
        offPower: 0.55
      },
      // Cooldown lengthened 420 → 600 to reconcile with the doc's stated 3960s.
      { type: "cooldown", durationSec: 600, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "sweet-spot-3x15-surge",
    name: "Sweet Spot 3×15 w/ Surges",
    discipline: "cycling",
    primaryZone: "sweet-spot",
    tags: ["muscular-endurance", "race-specific", "surges", "xc-mtb"],
    phases: ["build", "peak"],
    durationSec: 4500,
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.78 },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 900,
        onPower: 0.9,
        onCadence: 90,
        offDurationSec: 300,
        offPower: 0.55,
        surges: { everySec: 150, durationSec: 15, power: 1.5 }
      },
      { type: "steady", durationSec: 300, power: 0.6 },
      { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },

  // ── Threshold ──────────────────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "threshold-3x10",
    name: "Threshold 3×10",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["threshold", "ftp"],
    phases: ["build"],
    durationSec: 3480,
    segments: [
      { type: "warmup", durationSec: 720, powerLow: 0.5, powerHigh: 0.8 },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 600,
        onPower: 0.98,
        onCadence: 88,
        offDurationSec: 300,
        offPower: 0.55
      },
      { type: "cooldown", durationSec: 360, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "threshold-2x20",
    name: "Threshold 2×20",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["threshold", "ftp", "tte"],
    phases: ["build"],
    durationSec: 3960,
    segments: [
      { type: "warmup", durationSec: 900, powerLow: 0.5, powerHigh: 0.82 },
      {
        type: "intervals",
        repeat: 2,
        onDurationSec: 1200,
        onPower: 0.98,
        onCadence: 88,
        offDurationSec: 360,
        offPower: 0.55
      },
      { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "over-unders-3x9",
    name: "Over-Unders 3×9",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["threshold", "over-under", "race-specific"],
    phases: ["build", "peak"],
    durationSec: 3420,
    segments: [
      { type: "warmup", durationSec: 720, powerLow: 0.5, powerHigh: 0.82 },
      {
        type: "intervals",
        repeat: 3,
        onPattern: [
          { durationSec: 120, power: 0.9 },
          { durationSec: 60, power: 1.05 },
          { durationSec: 120, power: 0.9 },
          { durationSec: 60, power: 1.05 },
          { durationSec: 120, power: 0.9 },
          { durationSec: 60, power: 1.05 }
        ],
        offDurationSec: 300,
        offPower: 0.55
      },
      // Cooldown lengthened 300 → 480 to reconcile with the doc's stated 3420s.
      { type: "cooldown", durationSec: 480, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },

  // ── VO2max ─────────────────────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "vo2-5x3",
    name: "VO2 5×3",
    discipline: "cycling",
    primaryZone: "vo2",
    tags: ["vo2max"],
    phases: ["build"],
    durationSec: 3180,
    segments: [
      // Warmup lengthened 720 → 900 to reconcile with the doc's stated 3180s.
      { type: "warmup", durationSec: 900, powerLow: 0.5, powerHigh: 0.85 },
      {
        type: "intervals",
        repeat: 5,
        onDurationSec: 180,
        onPower: 1.12,
        onCadence: 95,
        offDurationSec: 180,
        offPower: 0.5,
        trailingRecovery: true
      },
      // Cooldown lengthened 300 → 480 to reconcile with the doc's stated 3180s.
      { type: "cooldown", durationSec: 480, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "vo2-4x4",
    name: "VO2 4×4",
    discipline: "cycling",
    primaryZone: "vo2",
    tags: ["vo2max"],
    phases: ["build", "peak"],
    durationSec: 3300,
    segments: [
      { type: "warmup", durationSec: 900, powerLow: 0.5, powerHigh: 0.85 },
      {
        type: "intervals",
        repeat: 4,
        onDurationSec: 240,
        onPower: 1.1,
        onCadence: 92,
        offDurationSec: 240,
        offPower: 0.5,
        trailingRecovery: true
      },
      // Cooldown lengthened 300 → 480 to reconcile with the doc's stated 3300s.
      { type: "cooldown", durationSec: 480, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "vo2-30-15",
    name: "VO2 30/15 — 3×13",
    discipline: "cycling",
    primaryZone: "vo2",
    tags: ["vo2max", "micro-intervals"],
    phases: ["build", "peak", "taper"],
    durationSec: 3225,
    segments: [
      { type: "warmup", durationSec: 720, powerLow: 0.5, powerHigh: 0.8 },
      {
        type: "intervals",
        repeat: 13,
        onDurationSec: 30,
        onPower: 1.15,
        offDurationSec: 15,
        offPower: 0.5
      },
      { type: "steady", durationSec: 180, power: 0.5 },
      {
        type: "intervals",
        repeat: 13,
        onDurationSec: 30,
        onPower: 1.15,
        offDurationSec: 15,
        offPower: 0.5
      },
      { type: "steady", durationSec: 180, power: 0.5 },
      {
        type: "intervals",
        repeat: 13,
        onDurationSec: 30,
        onPower: 1.15,
        offDurationSec: 15,
        offPower: 0.5
      },
      // Cooldown lengthened 300 → 435 to reconcile with the doc's stated 3225s.
      { type: "cooldown", durationSec: 435, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },

  // ── Anaerobic / Neuromuscular ──────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "anaerobic-40-20",
    name: "Anaerobic 40/20 — 3×9",
    discipline: "cycling",
    primaryZone: "anaerobic",
    tags: ["anaerobic-capacity", "repeated-surge", "race-specific", "xc-mtb"],
    phases: ["peak"],
    durationSec: 3540,
    segments: [
      { type: "warmup", durationSec: 720, powerLow: 0.5, powerHigh: 0.8 },
      {
        type: "intervals",
        repeat: 9,
        onDurationSec: 40,
        onPower: 1.2,
        offDurationSec: 20,
        offPower: 0.55
      },
      // Between-set recovery lengthened 300 → 450 (×2) to reconcile with the doc's stated 3540s.
      { type: "steady", durationSec: 450, power: 0.55 },
      {
        type: "intervals",
        repeat: 9,
        onDurationSec: 40,
        onPower: 1.2,
        offDurationSec: 20,
        offPower: 0.55
      },
      { type: "steady", durationSec: 450, power: 0.55 },
      {
        type: "intervals",
        repeat: 9,
        onDurationSec: 40,
        onPower: 1.2,
        offDurationSec: 20,
        offPower: 0.55
      },
      { type: "cooldown", durationSec: 360, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "neuro-8x15",
    name: "Neuromuscular 8×15 s Sprints",
    discipline: "cycling",
    primaryZone: "neuromuscular",
    tags: ["sprint", "neuromuscular"],
    phases: ["peak", "taper"],
    durationSec: 3300,
    segments: [
      {
        type: "warmup",
        durationSec: 900,
        powerLow: 0.5,
        powerHigh: 0.7,
        textEvents: [{ atSec: 600, message: "3×10 s primers here, full recovery between" }]
      },
      {
        type: "intervals",
        repeat: 8,
        onDurationSec: 15,
        onPower: 1.7,
        onCadence: 105,
        offDurationSec: 225,
        offPower: 0.5,
        trailingRecovery: true
      },
      // Cooldown lengthened 360 → 480 to reconcile with the doc's stated 3300s.
      { type: "cooldown", durationSec: 480, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },

  // ── Race-specific ──────────────────────────────────────────────────────────
  {
    schemaVersion: 1,
    id: "iceman-sim",
    name: "Iceman Simulation",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["race-specific", "xc-mtb", "surges", "simulation"],
    phases: ["peak"],
    durationSec: 4500,
    segments: [
      {
        type: "warmup",
        durationSec: 720,
        powerLow: 0.55,
        powerHigh: 0.8,
        textEvents: [{ atSec: 480, message: "3×20 s surges to open, like the race start" }]
      },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 600,
        onPower: 0.92,
        onCadence: 88,
        offDurationSec: 240,
        offPower: 0.6,
        surges: { everySec: 120, durationSec: 20, power: 1.6 }
      },
      {
        type: "freeride",
        durationSec: 900,
        textEvents: [{ atSec: 0, message: "Sand / cornering / line choice under fatigue" }]
      },
      { type: "steady", durationSec: 300, power: 0.6 },
      // Cooldown lengthened 240 → 300 to reconcile with the doc's stated 4500s.
      { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
    ]
  },
  {
    schemaVersion: 1,
    id: "race-openers-25",
    name: "Race Openers 25",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["openers", "taper", "pre-race"],
    phases: ["taper"],
    durationSec: 1500,
    segments: [
      { type: "warmup", durationSec: 480, powerLow: 0.5, powerHigh: 0.7 },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 60,
        onPower: 1.0,
        offDurationSec: 120,
        offPower: 0.55
      },
      {
        type: "intervals",
        repeat: 3,
        onDurationSec: 10,
        onPower: 1.6,
        offDurationSec: 110,
        offPower: 0.5
      },
      { type: "steady", durationSec: 180, power: 0.55 },
      // Cooldown lengthened 120 → 170 to reconcile with the doc's stated 1500s.
      { type: "cooldown", durationSec: 170, powerLow: 0.55, powerHigh: 0.45 }
    ]
  }
];

/**
 * First-run seeding: insert the starter documents if the bank table is empty.
 * Safe to call on every startup (same pattern as `applySchema`).
 */
export const seedWorkoutBankIfEmpty = (bankService: WorkoutBankService): void => {
  if (SEED_WORKOUTS.length === 0 || !bankService.isEmpty()) {
    return;
  }
  for (const document of SEED_WORKOUTS) {
    try {
      bankService.createBankWorkout(document, "seed");
    } catch (error) {
      console.error(`[seedWorkoutBank] failed to seed "${document.id}":`, error);
    }
  }
};
