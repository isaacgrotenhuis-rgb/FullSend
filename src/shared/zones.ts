/**
 * Centralized FTP-fraction training zones (doc §3.3).
 *
 * `power` values throughout the `.fsw` workout format are fractions of FTP, never
 * absolute watts. These boundaries replace the magic numbers previously scattered
 * through `EventPlanService.templateIntervals`.
 */

export type ZoneDefinition = {
  readonly min: number;
  readonly max: number;
  readonly label: string;
};

export const ZONES = {
  recovery: { min: 0.0, max: 0.55, label: "Recovery" },
  endurance: { min: 0.56, max: 0.75, label: "Endurance" },
  tempo: { min: 0.76, max: 0.87, label: "Tempo" },
  "sweet-spot": { min: 0.88, max: 0.93, label: "Sweet Spot" },
  threshold: { min: 0.94, max: 1.05, label: "Threshold" },
  vo2: { min: 1.06, max: 1.2, label: "VO2max" },
  anaerobic: { min: 1.21, max: 1.5, label: "Anaerobic Capacity" },
  neuromuscular: { min: 1.51, max: 3.0, label: "Neuromuscular" }
} as const satisfies Record<string, ZoneDefinition>;

export type Zone = keyof typeof ZONES;

export const ZONE_KEYS = [
  "recovery",
  "endurance",
  "tempo",
  "sweet-spot",
  "threshold",
  "vo2",
  "anaerobic",
  "neuromuscular"
] as const satisfies readonly Zone[];

/** Representative (mid-band) FTP fraction for a zone. Handy for the plan generator. */
export const zoneMidFraction = (zone: Zone): number => {
  const def = ZONES[zone];
  return (def.min + def.max) / 2;
};

/** Classify an FTP fraction into the zone whose band contains it. */
export const zoneForFraction = (fraction: number): Zone => {
  for (const key of ZONE_KEYS) {
    if (fraction <= ZONES[key].max) {
      return key;
    }
  }
  return "neuromuscular";
};

export type PowerSample = {
  /** seconds spent at this power level */
  durationSec: number;
  /** power as a fraction of FTP */
  powerFraction: number;
};

/**
 * estIF — duration-weighted RMS of segment power fractions (doc §3.3).
 *
 * IF = sqrt( Σ(durationSec_i * fraction_i^2) / Σ(durationSec_i) )
 */
export const estIF = (samples: PowerSample[]): number => {
  const totalDuration = samples.reduce((sum, sample) => sum + sample.durationSec, 0);
  if (totalDuration <= 0) {
    return 0;
  }
  const weightedSquares = samples.reduce(
    (sum, sample) => sum + sample.durationSec * sample.powerFraction * sample.powerFraction,
    0
  );
  return Math.sqrt(weightedSquares / totalDuration);
};

/**
 * estTSS — training stress score (doc §3.3):
 *   TSS = durationSec / 3600 * IF^2 * 100
 */
export const estTSS = (durationSec: number, intensityFactor: number): number =>
  (durationSec / 3600) * intensityFactor * intensityFactor * 100;

/**
 * RMS power fraction across a linear ramp from `low` to `high`.
 * Mean of f(t)^2 for a linear f over [low, high] is (low^2 + low*high + high^2) / 3.
 */
export const rampRmsFraction = (low: number, high: number): number =>
  Math.sqrt((low * low + low * high + high * high) / 3);
