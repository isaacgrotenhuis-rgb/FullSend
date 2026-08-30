import { describe, expect, it } from "vitest";
import { fswDocumentSchema, type FswDocument } from "@shared/ipc/contracts";
import { compile } from "@main/workout/WorkoutCompiler";

const doc = (partial: Omit<Partial<FswDocument>, "segments"> & Pick<FswDocument, "segments">): FswDocument =>
  fswDocumentSchema.parse({
    schemaVersion: 1,
    id: partial.id ?? "test",
    name: partial.name ?? "Test",
    primaryZone: partial.primaryZone ?? "threshold",
    segments: partial.segments
  });

const totalDuration = (intervals: { durationSec: number }[]): number =>
  intervals.reduce((sum, interval) => sum + interval.durationSec, 0);

describe("WorkoutCompiler.compile", () => {
  it("resolves warmup/ramp/cooldown to single ramp intervals with start + end watts", () => {
    const document = doc({
      id: "ramp-test",
      segments: [
        { type: "warmup", durationSec: 600, powerLow: 0.4, powerHigh: 0.55 },
        { type: "ramp", durationSec: 1500, powerLow: 0.4, powerHigh: 1.6 },
        { type: "cooldown", durationSec: 300, powerLow: 0.5, powerHigh: 0.4 }
      ]
    });

    const intervals = compile(document, 250);

    expect(intervals).toEqual([
      {
        kind: "warmup",
        durationSec: 600,
        targetPowerWatts: 100,
        targetPowerWattsEnd: 138,
        targetResistancePercent: null,
        targetCadenceRpm: null
      },
      {
        kind: "work",
        durationSec: 1500,
        targetPowerWatts: 100,
        targetPowerWattsEnd: 400,
        targetResistancePercent: null,
        targetCadenceRpm: null
      },
      {
        kind: "cooldown",
        durationSec: 300,
        targetPowerWatts: 125,
        targetPowerWattsEnd: 100,
        targetResistancePercent: null,
        targetCadenceRpm: null
      }
    ]);
    expect(totalDuration(intervals)).toBe(2400);
  });

  it("unrolls a 4x4 intervals segment and drops the trailing recovery", () => {
    const document = doc({
      id: "vo2-4x4",
      segments: [
        { type: "warmup", durationSec: 300, powerLow: 0.5, powerHigh: 0.85 },
        {
          type: "intervals",
          repeat: 4,
          onDurationSec: 240,
          onPower: 1.1,
          onCadence: 92,
          offDurationSec: 240,
          offPower: 0.5
        },
        { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
      ]
    });

    const intervals = compile(document, 250);

    // warmup + (work,recovery)x3 + work + cooldown = 1 + 7 + 1
    expect(intervals).toHaveLength(9);
    expect(intervals.filter((i) => i.kind === "work" && i.targetPowerWatts === 275)).toHaveLength(4);
    expect(intervals.filter((i) => i.kind === "recovery")).toHaveLength(3);
    expect(intervals.at(-2)).toMatchObject({ kind: "work", targetPowerWatts: 275, targetCadenceRpm: 92 });
    expect(totalDuration(intervals)).toBe(300 + 4 * 240 + 3 * 240 + 300);
  });

  it("keeps the trailing recovery when trailingRecovery is true", () => {
    const document = doc({
      id: "trailing",
      segments: [
        {
          type: "intervals",
          repeat: 2,
          onDurationSec: 60,
          onPower: 1.0,
          offDurationSec: 60,
          offPower: 0.5,
          trailingRecovery: true
        }
      ]
    });

    const intervals = compile(document, 200);
    expect(intervals.map((i) => i.kind)).toEqual(["work", "recovery", "work", "recovery"]);
    expect(totalDuration(intervals)).toBe(240);
  });

  it("expands an over-under onPattern into sub-steps that replace the scalar on-step", () => {
    const document = doc({
      id: "over-unders",
      segments: [
        {
          type: "intervals",
          repeat: 2,
          onPattern: [
            { durationSec: 120, power: 0.9 },
            { durationSec: 60, power: 1.05 },
            { durationSec: 120, power: 0.9 }
          ],
          offDurationSec: 300,
          offPower: 0.55
        }
      ]
    });

    const intervals = compile(document, 250);

    // 2 reps * (3 pattern steps) + 1 recovery between = 7
    expect(intervals).toHaveLength(7);
    expect(intervals.slice(0, 3).map((i) => i.targetPowerWatts)).toEqual([225, 263, 225]);
    expect(intervals[3]).toMatchObject({ kind: "recovery", targetPowerWatts: 138 });
    expect(totalDuration(intervals)).toBe(2 * 300 + 300);
  });

  it("slices a surge block into base + surge sub-intervals, preserving total duration", () => {
    const document = doc({
      id: "surge",
      segments: [
        {
          type: "intervals",
          repeat: 1,
          onDurationSec: 600,
          onPower: 0.92,
          offDurationSec: 0,
          offPower: 0.6,
          surges: { everySec: 120, durationSec: 20, power: 1.6 }
        }
      ]
    });

    const intervals = compile(document, 250);

    // 5 windows of 120s => [base 100, surge 20] x 5
    expect(intervals).toHaveLength(10);
    expect(intervals.filter((i) => i.targetPowerWatts === 400)).toHaveLength(5);
    expect(intervals.filter((i) => i.targetPowerWatts === 230)).toHaveLength(5);
    expect(intervals.every((i) => i.kind === "work")).toBe(true);
    expect(totalDuration(intervals)).toBe(600);
  });

  it("compiles a freeride segment to null power in resistance mode", () => {
    const document = doc({
      id: "freeride",
      segments: [{ type: "freeride", durationSec: 900 }]
    });

    const intervals = compile(document, 250);
    expect(intervals).toEqual([
      {
        kind: "work",
        durationSec: 900,
        targetPowerWatts: null,
        targetPowerWattsEnd: null,
        targetResistancePercent: 0,
        targetCadenceRpm: null
      }
    ]);
  });

  it("rejects a non-positive ftp", () => {
    const document = doc({ id: "x", segments: [{ type: "steady", durationSec: 60, power: 0.6 }] });
    expect(() => compile(document, 0)).toThrow(/ftp/);
    expect(() => compile(document, -10)).toThrow(/ftp/);
  });

  it("keeps total duration equal to the sum of segment durations for a race-sim shape", () => {
    const document = doc({
      id: "iceman-sim",
      primaryZone: "threshold",
      segments: [
        { type: "warmup", durationSec: 720, powerLow: 0.55, powerHigh: 0.8 },
        {
          type: "intervals",
          repeat: 3,
          onDurationSec: 600,
          onPower: 0.92,
          offDurationSec: 240,
          offPower: 0.6,
          surges: { everySec: 120, durationSec: 20, power: 1.6 }
        },
        { type: "freeride", durationSec: 900 },
        { type: "steady", durationSec: 300, power: 0.6 },
        { type: "cooldown", durationSec: 240, powerLow: 0.6, powerHigh: 0.45 }
      ]
    });

    const intervals = compile(document, 260);
    // warmup 720 + 3*600 on + 2*240 off + freeride 900 + steady 300 + cooldown 240
    expect(totalDuration(intervals)).toBe(720 + 1800 + 480 + 900 + 300 + 240);
    expect(intervals.some((i) => i.targetPowerWatts === null && i.targetResistancePercent === 0)).toBe(true);
  });
});
