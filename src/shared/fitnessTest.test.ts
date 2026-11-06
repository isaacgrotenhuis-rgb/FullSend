import { describe, expect, it } from "vitest";
import {
  analyzeFitnessTest,
  bestRollingPower,
  computeHrCap,
  hrZonesFor,
  powerZonesFor,
  type FitnessTestInput,
  type FitnessTestSample
} from "@shared/fitnessTest";

/**
 * Synthetic rider: ERG holds each 1-min ramp step exactly until the rider fails
 * partway into the step at `failWatts`. HR follows power with a first-order lag
 * so the ramp shows the real "HR trails power" effect the cap allowance exists for.
 */
type RiderSpec = {
  rampStartWatts?: number;
  rampStepWatts?: number;
  /** Target of the step the rider fails in. */
  failWatts: number;
  /** Seconds survived in the failing step. */
  failAfterSec?: number;
  cappedWatts?: number;
  /** Seconds of capped effort ridden (default 1200). */
  cappedSec?: number;
  cappedHr?: number;
  /** Swing of the capped power around its mean, as a fraction (default 0.04). */
  cappedSwing?: number;
  withHr?: boolean;
  variant?: "full" | "quick";
};

const hrFor = (watts: number): number => Math.min(192, 70 + 0.38 * watts);

const buildSamples = (spec: RiderSpec): FitnessTestSample[] => {
  const {
    rampStartWatts = 150,
    rampStepWatts = 15,
    failWatts,
    failAfterSec = 20,
    cappedWatts = 250,
    cappedSec = 1200,
    cappedHr = 165,
    cappedSwing = 0.04,
    withHr = true,
    variant = "full"
  } = spec;
  const samples: FitnessTestSample[] = [];
  let hr = 95;
  const push = (phase: FitnessTestSample["phase"], watts: number, targetHr?: number) => {
    hr += ((targetHr ?? hrFor(watts)) - hr) / 30;
    samples.push({ phase, powerWatts: watts, heartRateBpm: withHr ? Math.round(hr) : null, cadenceRpm: 90 });
  };

  for (let s = 0; s < 600; s += 1) push("warmup", 150);
  for (let step = 0; ; step += 1) {
    const watts = rampStartWatts + step * rampStepWatts;
    const seconds = watts >= failWatts ? failAfterSec : 60;
    for (let s = 0; s < seconds; s += 1) push("ramp", watts);
    if (watts >= failWatts) break;
  }
  if (variant === "full") {
    for (let s = 0; s < 600; s += 1) push("recovery", 110);
    for (let s = 0; s < cappedSec; s += 1) {
      push("capped", Math.round(cappedWatts * (1 + cappedSwing * Math.sin(s / 7))), cappedHr);
    }
  }
  for (let s = 0; s < 300; s += 1) push("cooldown", 100);
  return samples;
};

const inputFor = (spec: RiderSpec, overrides: Partial<FitnessTestInput> = {}): FitnessTestInput => ({
  variant: spec.variant ?? "full",
  samples: buildSamples(spec),
  rampStepCount: 25,
  rampStepSec: 60,
  mapSeedWatts: 333,
  hrCapBpm: null,
  weightKg: 75,
  previous: null,
  ...overrides
});

const codes = (input: FitnessTestInput): string[] => analyzeFitnessTest(input).flags.map((flag) => flag.code);

describe("bestRollingPower", () => {
  it("finds the best 60 s mean, straddling steps", () => {
    const powers = [...Array(60).fill(300), ...Array(20).fill(330)];
    // Best window: the last 40 s at 300 W + 20 s at 330 W.
    expect(bestRollingPower(powers)).toBeCloseTo(310, 5);
  });

  it("tolerates a few dropouts but skips windows with too many", () => {
    const fewGaps = [...Array(57).fill(300), null, null, null];
    expect(bestRollingPower(fewGaps)).toBe(300);
    const manyGaps = [...Array(50).fill(300), ...Array(10).fill(null)];
    expect(bestRollingPower(manyGaps)).toBeNull();
  });

  it("needs at least a full window", () => {
    expect(bestRollingPower(Array(59).fill(300))).toBeNull();
  });
});

describe("analyzeFitnessTest — rider profiles", () => {
  // Fails 20 s into the 345 W step: best minute = 40 s @ 330 + 20 s @ 345 = 335 W.
  const ramp = { failWatts: 345 };

  it("reads a balanced rider", () => {
    const result = analyzeFitnessTest(inputFor({ ...ramp, cappedWatts: 262 }));
    expect(result.valid).toBe(true);
    expect(result.mapWatts).toBe(335);
    expect(result.ftpRampWatts).toBe(251);
    expect(result.ftpSource).toBe("capped");
    expect(result.ftpWatts).toBe(262);
    expect(result.thresholdHrBpm).toBe(165);
    expect(result.ftpToMapRatio).toBe(0.78);
    expect(result.riderProfile).toBe("balanced");
    expect(result.rampStepsCompleted).toBe(13);
    expect(result.flags).toEqual([]);
  });

  it("reads a punchy rider whose ramp estimate overstates FTP", () => {
    const result = analyzeFitnessTest(inputFor({ ...ramp, cappedWatts: 228 }));
    expect(result.ftpWatts).toBe(228);
    expect(result.riderProfile).toBe("anaerobic");
    expect(result.insights[0]).toMatch(/punchy, anaerobic/);
  });

  it("reads a diesel rider and notes the methods disagree", () => {
    const result = analyzeFitnessTest(inputFor({ ...ramp, cappedWatts: 288 }));
    expect(result.riderProfile).toBe("aerobic");
    expect(result.valid).toBe(true);
    expect(result.flags).toEqual([expect.objectContaining({ code: "ftp-methods-disagree", severity: "info" })]);
  });

  it("derives W/kg, VO₂max and zones", () => {
    const result = analyzeFitnessTest(inputFor({ ...ramp, cappedWatts: 262 }));
    expect(result.ftpWattsPerKg).toBe(3.49);
    expect(result.mapWattsPerKg).toBe(4.47);
    expect(result.vo2maxEst).toBeCloseTo((10.8 * 335) / 75 + 7, 1);
    expect(result.powerZones.find((zone) => zone.key === "threshold")).toMatchObject({ minWatts: 245, maxWatts: 275 });
    expect(result.hrZones?.[0]).toMatchObject({ key: "z1", minBpm: 0, maxBpm: 134 });
  });

  it("leaves W/kg and VO₂max out without a weight", () => {
    const result = analyzeFitnessTest(inputFor({ ...ramp }, { weightKg: null }));
    expect(result.ftpWattsPerKg).toBeNull();
    expect(result.vo2maxEst).toBeNull();
  });
});

describe("analyzeFitnessTest — validity", () => {
  it("blocks when fewer than 5 ramp steps were completed", () => {
    const input = inputFor({ failWatts: 210 }); // steps 150..195 done = 4
    expect(codes(input)).toContain("too-few-ramp-steps");
    expect(analyzeFitnessTest(input).valid).toBe(false);
    expect(analyzeFitnessTest(input).insights).toEqual([]);
  });

  it("blocks when the rider finished every ramp step", () => {
    const input = inputFor({ failWatts: 345, failAfterSec: 60 }, { rampStepCount: 14 });
    expect(codes(input)).toContain("ramp-not-failed");
    expect(analyzeFitnessTest(input).valid).toBe(false);
  });

  it("blocks when there is no ramp power at all", () => {
    const input = inputFor({ failWatts: 345 });
    input.samples = input.samples.map((sample) => (sample.phase === "ramp" ? { ...sample, powerWatts: null } : sample));
    expect(codes(input)).toContain("no-ramp-data");
    expect(analyzeFitnessTest(input).mapWatts).toBeNull();
  });

  it("warns about ramp power dropouts", () => {
    const input = inputFor({ failWatts: 345 });
    let rampIndex = 0;
    input.samples = input.samples.map((sample) =>
      sample.phase === "ramp" && rampIndex++ % 7 === 0 ? { ...sample, powerWatts: null } : sample
    );
    expect(codes(input)).toContain("ramp-power-gaps");
  });

  it("falls back to the ramp estimate without a heart-rate strap", () => {
    const result = analyzeFitnessTest(inputFor({ failWatts: 345, withHr: false }));
    expect(result.valid).toBe(true);
    expect(result.ftpSource).toBe("ramp");
    expect(result.ftpWatts).toBe(251);
    expect(result.thresholdHrBpm).toBeNull();
    expect(result.hrZones).toBeNull();
    expect(result.riderProfile).toBeNull();
    expect(result.flags.map((flag) => flag.code)).toEqual(["no-heart-rate"]);
  });

  it("falls back to the ramp estimate when the rider left the capped effort before minute 15", () => {
    const result = analyzeFitnessTest(inputFor({ failWatts: 345, cappedSec: 600 }));
    expect(result.ftpSource).toBe("ramp");
    expect(result.flags.map((flag) => flag.code)).toEqual(["capped-too-short"]);
  });

  it("still scores a capped effort cut short after minute 15", () => {
    const result = analyzeFitnessTest(inputFor({ failWatts: 345, cappedSec: 960, cappedWatts: 262 }));
    expect(result.ftpSource).toBe("capped");
    expect(result.ftpWatts).toBe(262);
  });

  it("falls back when HR drops out in the capped effort", () => {
    const input = inputFor({ failWatts: 345 });
    let cappedIndex = 0;
    input.samples = input.samples.map((sample) =>
      sample.phase === "capped" && cappedIndex++ % 2 === 0 ? { ...sample, heartRateBpm: null } : sample
    );
    const result = analyzeFitnessTest(input);
    expect(result.ftpSource).toBe("ramp");
    expect(codes(input)).toContain("capped-hr-gaps");
  });

  it("warns when HR ran well over or under the cap", () => {
    expect(codes(inputFor({ failWatts: 345, cappedHr: 178 }, { hrCapBpm: 165 }))).toContain("capped-hr-over-cap");
    expect(codes(inputFor({ failWatts: 345, cappedHr: 150 }, { hrCapBpm: 165 }))).toContain("capped-hr-under-cap");
    expect(codes(inputFor({ failWatts: 345, cappedHr: 166 }, { hrCapBpm: 165 }))).not.toContain("capped-hr-over-cap");
  });

  it("warns about an unsteady capped effort", () => {
    expect(codes(inputFor({ failWatts: 345, cappedSwing: 0.3 }))).toContain("capped-power-unsteady");
  });

  it("quick variant: ramp only, nudges toward the full test", () => {
    const result = analyzeFitnessTest(inputFor({ failWatts: 345, variant: "quick" }));
    expect(result.valid).toBe(true);
    expect(result.ftpSource).toBe("ramp");
    expect(result.flags).toEqual([]);
    expect(result.insights[0]).toMatch(/Take the full test/);
  });
});

describe("analyzeFitnessTest — trends", () => {
  it("reports changes and a training hint", () => {
    const result = analyzeFitnessTest(
      inputFor({ failWatts: 345, cappedWatts: 262 }, { previous: { mapWatts: 320, ftpWatts: 262, thresholdHrBpm: 168 } })
    );
    expect(result.changes).toEqual({ mapWatts: 15, ftpWatts: 0, thresholdHrBpm: -3 });
    expect(result.insights).toContain(
      "Since your last test: MAP up 5%, FTP unchanged. Your top end is improving; more threshold work will carry it into FTP."
    );
    expect(result.insights.length).toBeLessThanOrEqual(5);
  });

  it("compares against a profile FTP when there's no previous MAP", () => {
    const result = analyzeFitnessTest(
      inputFor({ failWatts: 345, cappedWatts: 262 }, { previous: { mapWatts: null, ftpWatts: 250, thresholdHrBpm: null } })
    );
    expect(result.changes).toEqual({ mapWatts: null, ftpWatts: 12, thresholdHrBpm: null });
    expect(result.insights).toContain("FTP is up 5% on what your profile had (250 W).");
  });
});

describe("computeHrCap", () => {
  it("sits a little above the lagging HR seen when the ramp crossed 0.75 × MAP", () => {
    const ramp = buildSamples({ failWatts: 345 }).filter((sample) => sample.phase === "ramp");
    const cap = computeHrCap(ramp, 60);
    // 0.75 × 335 = 251 W → first step at or above is 255 W (step 7, ending at 479 s).
    const steadyHrAt255 = hrFor(255); // ~167 if HR had fully caught up
    expect(cap).not.toBeNull();
    expect(cap!).toBeLessThan(steadyHrAt255 + 5);
    expect(cap!).toBeGreaterThan(steadyHrAt255 - 15);
    const rampMax = Math.max(...ramp.map((sample) => sample.heartRateBpm ?? 0));
    expect(cap!).toBeLessThanOrEqual(Math.round(0.95 * rampMax) + 1);
  });

  it("is null without heart rate", () => {
    const ramp = buildSamples({ failWatts: 345, withHr: false }).filter((sample) => sample.phase === "ramp");
    expect(computeHrCap(ramp, 60)).toBeNull();
  });
});

describe("zones", () => {
  it("tiles power zones without gaps", () => {
    const zones = powerZonesFor(250);
    for (let index = 1; index < zones.length; index += 1) {
      expect(zones[index].minWatts).toBe((zones[index - 1].maxWatts ?? 0) + 1);
    }
    expect(zones.at(-1)?.maxWatts).toBeNull();
  });

  it("tiles HR zones without gaps", () => {
    const zones = hrZonesFor(170);
    for (let index = 1; index < zones.length; index += 1) {
      expect(zones[index].minBpm).toBe((zones[index - 1].maxBpm ?? 0) + 1);
    }
    expect(zones.find((zone) => zone.key === "z4")).toMatchObject({ minBpm: 159, maxBpm: 168 });
  });
});
