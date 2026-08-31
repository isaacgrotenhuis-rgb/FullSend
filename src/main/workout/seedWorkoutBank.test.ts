import { describe, expect, it } from "vitest";

import { deriveFswMetrics, parseFswDocument } from "@shared/fsw";
import { SEED_WORKOUTS } from "@main/workout/seedWorkoutBank";

function collectPowerFractions(seed: (typeof SEED_WORKOUTS)[number]): number[] {
  const values: number[] = [];
  for (const segment of seed.segments) {
    if (segment.type === "warmup" || segment.type === "cooldown" || segment.type === "ramp") {
      values.push(segment.powerLow, segment.powerHigh);
    }
    if (segment.type === "steady") {
      values.push(segment.power);
      if (segment.surges) values.push(segment.surges.power);
    }
    if (segment.type === "intervals") {
      if (segment.onPower !== undefined) values.push(segment.onPower);
      values.push(segment.offPower);
      if (segment.onPattern) {
        for (const step of segment.onPattern) values.push(step.power);
      }
      if (segment.surges) values.push(segment.surges.power);
    }
  }
  return values;
}

describe("SEED_WORKOUTS", () => {
  it("contains the full Iceman 2026 seed library (18 workouts)", () => {
    expect(SEED_WORKOUTS).toHaveLength(18);
  });

  it("has unique workout ids", () => {
    const ids = SEED_WORKOUTS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SEED_WORKOUTS.map((seed) => [seed.id, seed] as const))(
    "%s is a valid .fsw document",
    (_id, seed) => {
      expect(() => parseFswDocument(seed)).not.toThrow();
    }
  );

  it.each(SEED_WORKOUTS.map((seed) => [seed.id, seed] as const))(
    "%s has at least one segment",
    (_id, seed) => {
      expect(seed.segments.length).toBeGreaterThanOrEqual(1);
    }
  );

  it.each(SEED_WORKOUTS.map((seed) => [seed.id, seed] as const))(
    "%s power fractions are within 0.3–3.0",
    (_id, seed) => {
      for (const value of collectPowerFractions(seed)) {
        expect(value).toBeGreaterThanOrEqual(0.3);
        expect(value).toBeLessThanOrEqual(3.0);
      }
    }
  );

  it.each(SEED_WORKOUTS.map((seed) => [seed.id, seed] as const))(
    "%s derived duration matches the stated durationSec",
    (_id, seed) => {
      expect(seed.durationSec).toBeDefined();
      expect(deriveFswMetrics(seed).durationSec).toBe(seed.durationSec);
    }
  );
});
