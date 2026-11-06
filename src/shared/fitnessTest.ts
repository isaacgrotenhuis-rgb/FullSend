/**
 * Fitness test analysis: turns the 1 Hz samples from a ramp + HR-capped test
 * into MAP, FTP, threshold HR (cTHR) and a plain-language read on the rider.
 *
 * Pure and framework-free so it runs in the main process (scoring a saved
 * session), in tests, and — for computeHrCap — mid-ride, when the controller
 * needs the cap the moment the ramp ends. See docs/fitness-test-plan.md §2–3.
 *
 * Constants tagged [calibrate] are starting values to tune against real rides.
 */
import { ZONES, ZONE_KEYS, type Zone } from "@shared/zones";

export type FitnessTestVariant = "full" | "quick";
export type FitnessTestPhase = "warmup" | "ramp" | "recovery" | "capped" | "cooldown";

/** One ride-clock second of a test. Missing sensor readings are null. */
export type FitnessTestSample = {
  phase: FitnessTestPhase;
  powerWatts: number | null;
  heartRateBpm: number | null;
  cadenceRpm: number | null;
};

export type FitnessTestBaseline = {
  mapWatts: number | null;
  ftpWatts: number | null;
  thresholdHrBpm: number | null;
};

export type FitnessTestInput = {
  variant: FitnessTestVariant;
  /** In ride-clock order. Seconds spent paused are simply absent. */
  samples: FitnessTestSample[];
  /** How many ramp steps the workout generated (finishing them all means the seed was too low). */
  rampStepCount: number;
  rampStepSec: number;
  mapSeedWatts: number;
  /** The cap the rider was shown for the capped effort; null when it was never computed (no HR). */
  hrCapBpm: number | null;
  weightKg: number | null;
  /** The last valid test or the current profile, for trends. */
  previous: FitnessTestBaseline | null;
};

export type FitnessTestFlagSeverity = "blocking" | "warning" | "info";

export type FitnessTestFlagCode =
  | "no-ramp-data"
  | "too-few-ramp-steps"
  | "ramp-not-failed"
  | "ramp-power-gaps"
  | "no-heart-rate"
  | "capped-too-short"
  | "capped-hr-gaps"
  | "capped-hr-over-cap"
  | "capped-hr-under-cap"
  | "capped-power-unsteady"
  | "ftp-methods-disagree";

export type FitnessTestFlag = {
  code: FitnessTestFlagCode;
  severity: FitnessTestFlagSeverity;
  message: string;
};

export type RiderProfile = "anaerobic" | "balanced" | "aerobic";

export type PowerZoneRange = { key: Zone; label: string; minWatts: number; maxWatts: number | null };
export type HrZoneRange = { key: string; label: string; minBpm: number; maxBpm: number | null };

export type FitnessTestResult = {
  variant: FitnessTestVariant;
  valid: boolean;
  flags: FitnessTestFlag[];
  rampStepsCompleted: number;
  mapWatts: number | null;
  ftpRampWatts: number | null;
  ftpCappedWatts: number | null;
  /** The FTP to apply: capped when that effort was usable, otherwise the ramp estimate. */
  ftpWatts: number | null;
  ftpSource: "capped" | "ramp" | null;
  thresholdHrBpm: number | null;
  maxHrBpm: number | null;
  hrCapBpm: number | null;
  ftpWattsPerKg: number | null;
  mapWattsPerKg: number | null;
  vo2maxEst: number | null;
  /** FTP / MAP, only when FTP came from the capped effort (the ramp estimate is 0.75 by definition). */
  ftpToMapRatio: number | null;
  riderProfile: RiderProfile | null;
  powerZones: PowerZoneRange[];
  hrZones: HrZoneRange[] | null;
  changes: { mapWatts: number | null; ftpWatts: number | null; thresholdHrBpm: number | null } | null;
  insights: string[];
};

// --- Protocol constants -------------------------------------------------------

/** FTP ≈ this × MAP for a 1-min-step ramp. */
export const RAMP_FTP_FACTOR = 0.75;
/** Rolling window for MAP. */
const MAP_WINDOW_SEC = 60;
/** A MAP window may miss this many readings and still count. */
const MAP_WINDOW_MAX_GAPS = 5;
const MIN_RAMP_STEPS = 5;
/** HR lags power in a 1-min ramp; the cap sits this far above the HR seen at FTP. [calibrate] */
const HR_CAP_LAG_ALLOWANCE_BPM = 5;
/** ...but never above this share of the ramp's max HR. [calibrate] */
const HR_CAP_MAX_FRACTION = 0.95;
const HR_SMOOTHING_SEC = 15;
/** Capped effort: seconds ignored while HR settles, and the scored window's end. */
export const CAPPED_SETTLE_SEC = 300;
export const CAPPED_DURATION_SEC = 1200;
/** Leaving the capped effort before this many seconds leaves too little to score. */
const CAPPED_MIN_SEC = 900;
const MAX_POWER_GAP_FRACTION = 0.1;
const MIN_HR_COVERAGE = 0.8;
const HR_OVER_CAP_BPM = 5; // [calibrate]
const HR_UNDER_CAP_BPM = 8; // [calibrate]
const MAX_POWER_CV = 0.15; // [calibrate]
const FTP_DISAGREEMENT = 0.12;
/** FTP/MAP cut-offs between rider profiles. [calibrate] */
const ANAEROBIC_BELOW = 0.72;
const AEROBIC_ABOVE = 0.8;

/**
 * Friel's cycling LTHR zones, as fractions of threshold HR. Upper bounds; the
 * last zone is open-ended.
 */
const HR_ZONES: Array<{ key: string; label: string; maxFraction: number | null }> = [
  { key: "z1", label: "Recovery", maxFraction: 0.81 },
  { key: "z2", label: "Aerobic", maxFraction: 0.89 },
  { key: "z3", label: "Tempo", maxFraction: 0.93 },
  { key: "z4", label: "Sub-threshold", maxFraction: 0.99 },
  { key: "z5a", label: "Super-threshold", maxFraction: 1.02 },
  { key: "z5b", label: "Aerobic capacity", maxFraction: 1.06 },
  { key: "z5c", label: "Anaerobic capacity", maxFraction: null }
];

// --- Helpers ------------------------------------------------------------------

const mean = (values: number[]): number | null =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const present = (values: Array<number | null>): number[] => values.filter((value): value is number => value !== null);

const round = (value: number | null): number | null => (value === null ? null : Math.round(value));
const round1 = (value: number | null): number | null => (value === null ? null : Math.round(value * 10) / 10);
const round2 = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

const phaseSamples = (samples: FitnessTestSample[], phase: FitnessTestPhase): FitnessTestSample[] =>
  samples.filter((sample) => sample.phase === phase);

/** Best rolling-window mean of measured power, skipping windows with too many dropouts. */
export const bestRollingPower = (
  powers: Array<number | null>,
  windowSec = MAP_WINDOW_SEC,
  maxGaps = MAP_WINDOW_MAX_GAPS
): number | null => {
  if (powers.length < windowSec) return null;
  let sum = 0;
  let count = 0;
  let best: number | null = null;
  for (let index = 0; index < powers.length; index += 1) {
    const incoming = powers[index];
    if (incoming !== null) {
      sum += incoming;
      count += 1;
    }
    if (index >= windowSec) {
      const outgoing = powers[index - windowSec];
      if (outgoing !== null) {
        sum -= outgoing;
        count -= 1;
      }
    }
    if (index >= windowSec - 1 && windowSec - count <= maxGaps && count > 0) {
      const average = sum / count;
      if (best === null || average > best) best = average;
    }
  }
  return best;
};

/** Trailing moving average of HR at each second (null where no reading in the window). */
const smoothHr = (hrs: Array<number | null>, windowSec = HR_SMOOTHING_SEC): Array<number | null> =>
  hrs.map((_, index) => mean(present(hrs.slice(Math.max(0, index - windowSec + 1), index + 1))));

/**
 * The HR ceiling for the capped effort, computed from the ramp alone. Uses the
 * smoothed HR at the end of the first ramp step whose measured power reached
 * the ramp FTP estimate (0.75 × MAP), plus an allowance for HR lag, capped
 * below the ramp's max HR. Null when the ramp has no usable HR or power.
 */
export const computeHrCap = (
  rampSamples: Array<Pick<FitnessTestSample, "powerWatts" | "heartRateBpm">>,
  rampStepSec: number
): number | null => {
  const map = bestRollingPower(rampSamples.map((sample) => sample.powerWatts));
  const hrs = rampSamples.map((sample) => sample.heartRateBpm);
  const hrValues = present(hrs);
  if (map === null || hrValues.length === 0) return null;
  const ftpRamp = RAMP_FTP_FACTOR * map;
  const smoothed = smoothHr(hrs);
  const maxHr = Math.max(...present(smoothed));

  for (let stepStart = 0; stepStart < rampSamples.length; stepStart += rampStepSec) {
    const step = rampSamples.slice(stepStart, stepStart + rampStepSec);
    const stepPower = mean(present(step.map((sample) => sample.powerWatts)));
    if (stepPower !== null && stepPower >= ftpRamp) {
      const stepEnd = Math.min(rampSamples.length, stepStart + rampStepSec) - 1;
      const hrAtFtp = smoothed[stepEnd];
      if (hrAtFtp === null) return null;
      return Math.round(Math.min(hrAtFtp + HR_CAP_LAG_ALLOWANCE_BPM, HR_CAP_MAX_FRACTION * maxHr));
    }
  }
  return null;
};

export const powerZonesFor = (ftpWatts: number): PowerZoneRange[] =>
  ZONE_KEYS.map((key, index) => ({
    key,
    label: ZONES[key].label,
    // Each band starts where the previous one ends, so the ranges tile with no gaps.
    minWatts: index === 0 ? 0 : Math.round(ZONES[ZONE_KEYS[index - 1]].max * ftpWatts) + 1,
    maxWatts: index === ZONE_KEYS.length - 1 ? null : Math.round(ZONES[key].max * ftpWatts)
  }));

export const hrZonesFor = (thresholdHrBpm: number): HrZoneRange[] =>
  HR_ZONES.map((zone, index) => ({
    key: zone.key,
    label: zone.label,
    minBpm: index === 0 ? 0 : Math.round((HR_ZONES[index - 1].maxFraction ?? 0) * thresholdHrBpm) + 1,
    maxBpm: zone.maxFraction === null ? null : Math.round(zone.maxFraction * thresholdHrBpm)
  }));

/** ACSM leg-ergometry estimate of VO₂max (mL/kg/min) from MAP. */
export const estimateVo2max = (mapWatts: number, weightKg: number): number => (10.8 * mapWatts) / weightKg + 7;

export const riderProfileFor = (ftpToMapRatio: number): RiderProfile =>
  ftpToMapRatio < ANAEROBIC_BELOW ? "anaerobic" : ftpToMapRatio > AEROBIC_ABOVE ? "aerobic" : "balanced";

const percentChange = (now: number, before: number): number => Math.round(((now - before) / before) * 100);

// --- Analysis -----------------------------------------------------------------

export const analyzeFitnessTest = (input: FitnessTestInput): FitnessTestResult => {
  const flags: FitnessTestFlag[] = [];
  const flag = (code: FitnessTestFlagCode, severity: FitnessTestFlagSeverity, message: string) =>
    flags.push({ code, severity, message });

  // Ramp → MAP, ramp FTP, HR cap.
  const ramp = phaseSamples(input.samples, "ramp");
  const rampPowers = ramp.map((sample) => sample.powerWatts);
  const rampStepsCompleted = Math.floor(ramp.length / input.rampStepSec);
  const mapRaw = bestRollingPower(rampPowers);
  const mapWatts = round(mapRaw);
  const ftpRampWatts = mapRaw === null ? null : Math.round(RAMP_FTP_FACTOR * mapRaw);

  if (mapRaw === null) {
    flag("no-ramp-data", "blocking", "There isn't a full minute of ramp power to measure, so no result could be calculated.");
  } else if (rampStepsCompleted < MIN_RAMP_STEPS) {
    flag(
      "too-few-ramp-steps",
      "blocking",
      `Only ${rampStepsCompleted} ramp step${rampStepsCompleted === 1 ? "" : "s"} completed — at least ${MIN_RAMP_STEPS} are needed for a reliable MAP.`
    );
  }
  if (input.rampStepCount > 0 && rampStepsCompleted >= input.rampStepCount) {
    flag(
      "ramp-not-failed",
      "blocking",
      "You finished every ramp step, so your true MAP is higher than this test could measure. Re-test — the next ramp will start higher."
    );
  }
  const rampGaps = rampPowers.filter((power) => power === null).length;
  if (ramp.length > 0 && rampGaps / ramp.length > MAX_POWER_GAP_FRACTION) {
    flag("ramp-power-gaps", "warning", "The trainer dropped power readings during the ramp, so MAP may read low.");
  }

  const allHr = present(input.samples.map((sample) => sample.heartRateBpm));
  const maxHrBpm = allHr.length > 0 ? round(Math.max(...present(smoothHr(input.samples.map((s) => s.heartRateBpm), 5)))) : null;
  const hrCapBpm = input.hrCapBpm ?? computeHrCap(ramp, input.rampStepSec);

  // Capped effort → FTP and cTHR.
  let ftpCappedWatts: number | null = null;
  let thresholdHrBpm: number | null = null;
  if (input.variant === "full") {
    const capped = phaseSamples(input.samples, "capped");
    if (allHr.length === 0 || hrCapBpm === null) {
      flag("no-heart-rate", "warning", "No heart rate was recorded, so FTP comes from the ramp estimate and threshold HR couldn't be measured.");
    } else if (capped.length < CAPPED_MIN_SEC) {
      flag(
        "capped-too-short",
        "warning",
        "The capped effort ended before minute 15, so FTP comes from the ramp estimate instead."
      );
    } else {
      const scored = capped.slice(CAPPED_SETTLE_SEC, CAPPED_DURATION_SEC);
      const powers = present(scored.map((sample) => sample.powerWatts));
      const hrs = present(scored.map((sample) => sample.heartRateBpm));
      const avgPower = mean(powers);
      const avgHr = mean(hrs);
      if (hrs.length / scored.length < MIN_HR_COVERAGE || avgHr === null) {
        flag(
          "capped-hr-gaps",
          "warning",
          "Heart rate dropped out during the capped effort, so FTP comes from the ramp estimate instead."
        );
      } else if (avgPower !== null) {
        ftpCappedWatts = Math.round(avgPower);
        thresholdHrBpm = Math.round(avgHr);
        if (avgHr > hrCapBpm + HR_OVER_CAP_BPM) {
          flag("capped-hr-over-cap", "warning", "Your heart rate ran well above the cap, so FTP may read a little high.");
        } else if (avgHr < hrCapBpm - HR_UNDER_CAP_BPM) {
          flag("capped-hr-under-cap", "warning", "Your heart rate stayed well under the cap, so FTP may read a little low.");
        }
        const sd = Math.sqrt(mean(powers.map((power) => (power - avgPower) ** 2)) ?? 0);
        if (avgPower > 0 && sd / avgPower > MAX_POWER_CV) {
          flag("capped-power-unsteady", "warning", "Power was uneven during the capped effort; a steadier effort gives a more reliable FTP.");
        }
      }
    }
  }

  const ftpSource: FitnessTestResult["ftpSource"] =
    ftpCappedWatts !== null ? "capped" : ftpRampWatts !== null ? "ramp" : null;
  const ftpWatts = ftpSource === "capped" ? ftpCappedWatts : ftpRampWatts;
  if (ftpCappedWatts !== null && ftpRampWatts !== null) {
    const gap = Math.abs(ftpCappedWatts - ftpRampWatts) / ftpRampWatts;
    if (gap > FTP_DISAGREEMENT) {
      flag(
        "ftp-methods-disagree",
        "info",
        `Your capped-effort FTP is ${ftpCappedWatts > ftpRampWatts ? "higher" : "lower"} than a ramp-only test would estimate (${ftpRampWatts} W) — that's your rider profile showing, not an error.`
      );
    }
  }

  const ftpToMapRatio =
    ftpSource === "capped" && ftpWatts !== null && mapRaw !== null ? round2(ftpWatts / mapRaw) : null;
  const riderProfile = ftpToMapRatio !== null ? riderProfileFor(ftpToMapRatio) : null;
  const weightKg = input.weightKg !== null && input.weightKg > 0 ? input.weightKg : null;
  const ftpWattsPerKg = ftpWatts !== null && weightKg !== null ? round2(ftpWatts / weightKg) : null;
  const mapWattsPerKg = mapRaw !== null && weightKg !== null ? round2(mapRaw / weightKg) : null;
  const vo2maxEst = mapRaw !== null && weightKg !== null ? round1(estimateVo2max(mapRaw, weightKg)) : null;

  const previous = input.previous;
  const changes = previous
    ? {
        mapWatts: mapWatts !== null && previous.mapWatts !== null ? mapWatts - previous.mapWatts : null,
        ftpWatts: ftpWatts !== null && previous.ftpWatts !== null ? ftpWatts - previous.ftpWatts : null,
        thresholdHrBpm:
          thresholdHrBpm !== null && previous.thresholdHrBpm !== null ? thresholdHrBpm - previous.thresholdHrBpm : null
      }
    : null;

  const valid = !flags.some((entry) => entry.severity === "blocking");

  const result: FitnessTestResult = {
    variant: input.variant,
    valid,
    flags,
    rampStepsCompleted,
    mapWatts,
    ftpRampWatts,
    ftpCappedWatts,
    ftpWatts,
    ftpSource,
    thresholdHrBpm,
    maxHrBpm,
    hrCapBpm,
    ftpWattsPerKg,
    mapWattsPerKg,
    vo2maxEst,
    ftpToMapRatio,
    riderProfile,
    powerZones: ftpWatts !== null ? powerZonesFor(ftpWatts) : [],
    hrZones: thresholdHrBpm !== null ? hrZonesFor(thresholdHrBpm) : null,
    changes,
    insights: []
  };
  result.insights = valid ? buildInsights(result, previous) : [];
  return result;
};

const profileCopy: Record<RiderProfile, string> = {
  anaerobic:
    "a punchy, anaerobic profile — strong short efforts, with room to grow your aerobic engine. Longer threshold and sweet-spot work will lift FTP.",
  balanced: "a balanced profile — aerobic power and top-end are well matched.",
  aerobic:
    "an aerobic, diesel profile — you can hold a high share of your top-end for a long time. VO₂max intervals will raise MAP, and FTP should follow."
};

/** Three to five rule-based bullets; deliberately not an LLM. */
const buildInsights = (result: FitnessTestResult, previous: FitnessTestBaseline | null): string[] => {
  const insights: string[] = [];
  if (result.riderProfile !== null && result.ftpToMapRatio !== null) {
    insights.push(`Your FTP is ${Math.round(result.ftpToMapRatio * 100)}% of your MAP: ${profileCopy[result.riderProfile]}`);
  } else if (result.ftpSource === "ramp") {
    insights.push(
      result.variant === "quick"
        ? "FTP is estimated as 75% of your MAP. Take the full test (with a heart-rate strap) to measure it directly and see your rider profile."
        : "FTP is estimated as 75% of your MAP because the capped effort couldn't be scored."
    );
  }

  if (previous && result.mapWatts !== null && previous.mapWatts) {
    const mapChange = percentChange(result.mapWatts, previous.mapWatts);
    const ftpChange =
      result.ftpWatts !== null && previous.ftpWatts ? percentChange(result.ftpWatts, previous.ftpWatts) : null;
    if (ftpChange !== null) {
      const direction = (change: number) => (change > 0 ? `up ${change}%` : change < 0 ? `down ${-change}%` : "unchanged");
      let line = `Since your last test: MAP ${direction(mapChange)}, FTP ${direction(ftpChange)}.`;
      if (mapChange >= 3 && ftpChange <= 0) line += " Your top end is improving; more threshold work will carry it into FTP.";
      else if (ftpChange >= 3 && mapChange <= 0) line += " Your aerobic base is improving; VO₂max work can lift the ceiling next.";
      insights.push(line);
    }
  } else if (previous && result.ftpWatts !== null && previous.ftpWatts) {
    const ftpChange = percentChange(result.ftpWatts, previous.ftpWatts);
    insights.push(`FTP is ${ftpChange >= 0 ? `up ${ftpChange}%` : `down ${-ftpChange}%`} on what your profile had (${previous.ftpWatts} W).`);
  }

  if (result.ftpWattsPerKg !== null) {
    insights.push(
      `That's ${result.ftpWattsPerKg.toFixed(2)} W/kg at threshold and ${result.mapWattsPerKg?.toFixed(2)} W/kg at MAP.`
    );
  }
  if (result.vo2maxEst !== null) {
    insights.push(`Estimated VO₂max: about ${Math.round(result.vo2maxEst)} mL/kg/min (an estimate from MAP, not a lab measure).`);
  }
  if (result.thresholdHrBpm !== null) {
    insights.push(`Your threshold heart rate is ${result.thresholdHrBpm} bpm — your heart-rate zones are set from it.`);
  }
  return insights.slice(0, 5);
};
