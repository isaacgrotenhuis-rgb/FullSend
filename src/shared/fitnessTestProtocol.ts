/**
 * Builds the fitness test workout in watts (docs/fitness-test-plan.md §2).
 *
 * Unlike bank workouts it isn't an FTP-fraction `.fsw` document run through
 * compile(): a brand-new rider may have no FTP, and the ramp is scaled from
 * MAP. Pure, so the renderer can show the same plan in the briefing that the
 * main process starts.
 */
import type { WorkoutInterval } from "@shared/ipc/contracts";
import type { FitnessTestPhase, FitnessTestVariant } from "@shared/fitnessTest";

export type FitnessTestPhaseRange = {
  phase: FitnessTestPhase;
  /** Workout position (seconds) where the phase starts, inclusive. */
  startSec: number;
  /** ...and ends, exclusive. */
  endSec: number;
};

export type FitnessTestPlan = {
  variant: FitnessTestVariant;
  name: string;
  intervals: WorkoutInterval[];
  phases: FitnessTestPhaseRange[];
  mapSeedWatts: number;
  mapSeedSource: "map" | "ftp" | "weight" | "default";
  rampStartWatts: number;
  rampStepWatts: number;
  rampStepSec: number;
  rampStepCount: number;
  totalSec: number;
};

export type FitnessTestSeedProfile = {
  mapWatts: number | null;
  ftpWatts: number | null;
  weightKg: number | null;
};

export const RAMP_STEP_SEC = 60;
const DEFAULT_MAP_SEED_WATTS = 250;
const MAP_PER_KG_GUESS = 3.3;
const RAMP_START_FRACTION = 0.45; // [calibrate]
const RAMP_STEP_FRACTION = 0.045; // [calibrate]
const MIN_RAMP_STEP_WATTS = 10;
/** Steps are generated up to this × MAP_seed; finishing them all invalidates the test. */
const RAMP_CEILING_FRACTION = 1.6;
const RECOVERY_SEC = 600;
export const CAPPED_SEC = 1200;
const COOLDOWN_SEC = 600;
const RIDE_CADENCE = 90;

/** Placeholder the ride page swaps for the live HR cap once the ramp has set it. */
export const HR_CAP_TOKEN = "{hrCap}";

const round5 = (watts: number): number => Math.max(5, Math.round(watts / 5) * 5);

export const mapSeedFor = (
  profile: FitnessTestSeedProfile
): { watts: number; source: FitnessTestPlan["mapSeedSource"] } => {
  if (profile.mapWatts) return { watts: profile.mapWatts, source: "map" };
  if (profile.ftpWatts) return { watts: Math.round(profile.ftpWatts / 0.75), source: "ftp" };
  if (profile.weightKg) return { watts: Math.round(profile.weightKg * MAP_PER_KG_GUESS), source: "weight" };
  return { watts: DEFAULT_MAP_SEED_WATTS, source: "default" };
};

const erg = (
  kind: WorkoutInterval["kind"],
  durationSec: number,
  watts: number,
  extras: Partial<WorkoutInterval> = {}
): WorkoutInterval => ({
  kind,
  durationSec,
  targetPowerWatts: Math.round(watts),
  targetResistancePercent: null,
  targetCadenceRpm: RIDE_CADENCE,
  ...extras
});

export const buildFitnessTest = (
  profile: FitnessTestSeedProfile,
  variant: FitnessTestVariant
): FitnessTestPlan => {
  const seed = mapSeedFor(profile);
  const map = seed.watts;
  const rampStartWatts = round5(RAMP_START_FRACTION * map);
  const rampStepWatts = Math.max(MIN_RAMP_STEP_WATTS, round5(RAMP_STEP_FRACTION * map));
  const rampStepCount = Math.ceil((RAMP_CEILING_FRACTION * map - rampStartWatts) / rampStepWatts) + 1;

  const phases: FitnessTestPhaseRange[] = [];
  const intervals: WorkoutInterval[] = [];
  let cursor = 0;
  const addPhase = (phase: FitnessTestPhase, phaseIntervals: WorkoutInterval[]) => {
    const durationSec = phaseIntervals.reduce((sum, interval) => sum + interval.durationSec, 0);
    phases.push({ phase, startSec: cursor, endSec: cursor + durationSec });
    intervals.push(...phaseIntervals);
    cursor += durationSec;
  };

  // Warm-up (10 min): build 40→60% MAP, two 30 s openers at 80%, settle.
  addPhase("warmup", [
    erg("warmup", 240, 0.4 * map, {
      targetPowerWattsEnd: Math.round(0.6 * map),
      cues: [
        {
          atSec: 0,
          message:
            variant === "full"
              ? "Warm-up: 10 easy minutes. Then a ramp until you can't hold the power, a recovery, and a 20-minute effort capped by heart rate."
              : "Warm-up: 10 easy minutes, then a ramp that gets harder every minute until you can't hold the power."
        }
      ]
    }),
    erg("warmup", 60, 0.6 * map),
    erg("warmup", 30, 0.8 * map, { cues: [{ atSec: 0, message: "Opener: 30 seconds a bit harder to wake the legs up." }] }),
    erg("warmup", 60, 0.6 * map),
    erg("warmup", 30, 0.8 * map, { cues: [{ atSec: 0, message: "Last opener." }] }),
    erg("warmup", 180, 0.55 * map, {
      cues: [
        { atSec: 0, message: "Settle in. Spin easy, drink, and get comfortable — stay seated for the whole ramp." },
        { atSec: 150, message: "Ramp starts in 30 seconds." }
      ]
    })
  ]);

  // Ramp: 1-minute ERG steps until the rider fails.
  const rampIntervals: WorkoutInterval[] = [];
  for (let step = 0; step < rampStepCount; step += 1) {
    const watts = rampStartWatts + step * rampStepWatts;
    const cues: Array<{ atSec: number; message: string }> = [];
    if (step === 0) {
      cues.push({
        atSec: 0,
        message: `Ramp: +${rampStepWatts} W every minute. Hold 85–95 rpm and stay seated. Keep going until you truly can't turn the pedals.`
      });
    }
    // Encouragement once past the seed, where most riders are near the end.
    if (watts >= map && watts - rampStepWatts < map) {
      cues.push({ atSec: 0, message: "You're past your estimated MAP — every step from here counts." });
    }
    rampIntervals.push(erg("work", RAMP_STEP_SEC, watts, cues.length > 0 ? { cues } : {}));
  }
  addPhase("ramp", rampIntervals);

  if (variant === "full") {
    addPhase("recovery", [
      erg("recovery", RECOVERY_SEC, 0.35 * map, {
        targetCadenceRpm: null,
        cues: [
          { atSec: 0, message: "Recovery: 10 minutes easy. Spin, drink, and get your breath back." },
          {
            atSec: RECOVERY_SEC - 60,
            message: `Capped effort in 1 minute: ride as hard as you can while keeping your heart rate at or under ${HR_CAP_TOKEN} bpm.`
          }
        ]
      })
    ]);
    addPhase("capped", [
      {
        // Free ride: slope mode at 0%, the rider sets power with their gears.
        kind: "work",
        durationSec: CAPPED_SEC,
        targetPowerWatts: null,
        targetPowerWattsEnd: null,
        targetResistancePercent: 0,
        targetCadenceRpm: null,
        cues: [
          {
            atSec: 0,
            message: `Capped effort: you set the power with your gears. Ride as hard as you can while keeping your heart rate at or under ${HR_CAP_TOKEN} bpm.`
          },
          { atSec: 300, message: "5 minutes in — scoring starts now. Hold it steady." },
          { atSec: 900, message: "5 minutes to go. Stay just under the cap." }
        ]
      }
    ]);
  }

  addPhase("cooldown", [
    erg("cooldown", COOLDOWN_SEC, 0.3 * map, {
      targetCadenceRpm: null,
      cues: [{ atSec: 0, message: "Cool-down. Nice work — spin easy; your results are ready when you finish." }]
    })
  ]);

  return {
    variant,
    name: variant === "full" ? "Fitness Test" : "Quick Ramp Test",
    intervals,
    phases,
    mapSeedWatts: map,
    mapSeedSource: seed.source,
    rampStartWatts,
    rampStepWatts,
    rampStepSec: RAMP_STEP_SEC,
    rampStepCount,
    totalSec: cursor
  };
};

export const phaseAt = (phases: FitnessTestPhaseRange[], positionSec: number): FitnessTestPhaseRange | null =>
  phases.find((range) => positionSec >= range.startSec && positionSec < range.endSec) ?? null;

export const phaseRange = (phases: FitnessTestPhaseRange[], phase: FitnessTestPhase): FitnessTestPhaseRange | null =>
  phases.find((range) => range.phase === phase) ?? null;
