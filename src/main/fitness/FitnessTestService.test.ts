import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { ProfileService } from "@main/profile/ProfileService";
import { FitnessTestService } from "@main/fitness/FitnessTestService";
import { buildFitnessTest, phaseRange, type FitnessTestPlan } from "@shared/fitnessTestProtocol";

describe("FitnessTestService", () => {
  let db: Database.Database;
  let repos: Repositories;
  let profile: ProfileService;
  let service: FitnessTestService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    profile = new ProfileService(repos);
    service = new FitnessTestService(repos, profile);
    profile.updateProfile({ ftpWatts: 240, weightKg: 75 });
  });

  afterEach(() => {
    db.close();
  });

  type RideSpec = {
    variant?: "full" | "quick";
    /** Ramp target the rider fails in (fails 20 s into it). */
    failWatts?: number;
    cappedWatts?: number;
    cappedHr?: number;
    withHr?: boolean;
    status?: string;
    startedAt?: string;
    downgraded?: boolean;
  };

  /**
   * Writes a finished test session the way the engine + controller would: a
   * started event with the plan, one telemetry row per ride second carrying the
   * workout position (the ramp-end jump shows up as a position jump), and the
   * ramp-ended event with the HR cap.
   */
  const recordRide = (spec: RideSpec = {}): { sessionId: string; plan: FitnessTestPlan } => {
    const {
      variant = "full",
      failWatts = 345,
      cappedWatts = 262,
      cappedHr = 165,
      withHr = true,
      status = "completed",
      startedAt = "2026-11-05T10:00:00Z",
      downgraded = false
    } = spec;
    const plan = buildFitnessTest({ mapWatts: 333, ftpWatts: null, weightKg: null }, variant);
    const sessionId = randomUUID();
    repos.workoutSessions.create({ id: sessionId, workoutId: null, deviceId: null, startedAt, status, summaryJson: "{}" });
    const event = (eventType: string, payload: object) =>
      repos.workoutSessionEvents.append({ id: randomUUID(), sessionId, eventType, payloadJson: JSON.stringify(payload) });
    event("fitness-test-started", {
      variant,
      phases: plan.phases,
      mapSeedWatts: plan.mapSeedWatts,
      rampStepWatts: plan.rampStepWatts,
      rampStepSec: plan.rampStepSec,
      rampStepCount: plan.rampStepCount
    });

    let clock = 0;
    const write = (positionSec: number, watts: number, hr: number) =>
      repos.workoutSessionTelemetry.append({
        id: randomUUID(),
        sessionId,
        elapsedSeconds: clock++,
        positionSec,
        blockType: "work",
        blockIndex: 0,
        targetPowerWatts: null,
        targetResistancePercent: null,
        actualPowerWatts: watts,
        actualCadenceRpm: 90,
        actualHeartRateBpm: withHr ? hr : null,
        actualSpeedKmh: null,
        actualDistanceMeters: null,
        payloadJson: "{}"
      });

    const ramp = phaseRange(plan.phases, "ramp")!;
    for (let p = 0; p < ramp.startSec; p += 1) write(p, 150, 120);
    let position = ramp.startSec;
    for (let step = 0; ; step += 1) {
      const watts = plan.rampStartWatts + step * plan.rampStepWatts;
      const seconds = watts >= failWatts ? 20 : 60;
      for (let s = 0; s < seconds; s += 1) write(position++, watts, Math.round(Math.min(190, 60 + 0.38 * watts)));
      if (watts >= failWatts) break;
    }
    event("fitness-test-ramp-ended", { reason: "failure", hrCapBpm: withHr ? 168 : null });
    if (downgraded) event("fitness-test-downgraded", { reason: "No heart rate" });

    if (variant === "full" && !downgraded) {
      const recovery = phaseRange(plan.phases, "recovery")!;
      for (let p = recovery.startSec; p < recovery.endSec; p += 1) write(p, 110, 120);
      const capped = phaseRange(plan.phases, "capped")!;
      for (let p = capped.startSec; p < capped.endSec; p += 1) write(p, cappedWatts, cappedHr);
    }
    const cooldown = phaseRange(plan.phases, "cooldown")!;
    for (let p = cooldown.startSec; p < cooldown.startSec + 120; p += 1) write(p, 100, 110);
    return { sessionId, plan };
  };

  it("scores a full test from telemetry positions and events, once", () => {
    const { sessionId } = recordRide();
    const record = service.getOrScore(sessionId);
    expect(record.result).toMatchObject({
      variant: "full",
      valid: true,
      mapWatts: 335,
      ftpSource: "capped",
      ftpWatts: 262,
      thresholdHrBpm: 165,
      hrCapBpm: 168,
      riderProfile: "balanced"
    });
    // Baseline was the profile's FTP (no earlier test).
    expect(record.result.changes).toEqual({ mapWatts: null, ftpWatts: 22, thresholdHrBpm: null });
    expect(record.appliedAt).toBeNull();

    // Cached: a second request returns the same row rather than re-scoring.
    expect(service.getOrScore(sessionId).id).toBe(record.id);
    expect(service.list()).toHaveLength(1);
  });

  it("counts a ride second written twice only once", () => {
    const { sessionId, plan } = recordRide();
    const ramp = phaseRange(plan.phases, "ramp")!;
    // Re-write every ramp second (as a retried tick would): counted twice, the
    // ramp would look twice as long and report ~26 steps instead of 13.
    const rampRows = repos.workoutSessionTelemetry
      .getPositionedSamples(sessionId)
      .filter((row) => (row.positionSec ?? 0) >= ramp.startSec && (row.positionSec ?? 0) < ramp.endSec);
    for (const row of rampRows) {
      repos.workoutSessionTelemetry.append({
        id: randomUUID(),
        sessionId,
        elapsedSeconds: row.elapsedSec,
        positionSec: row.positionSec,
        blockType: "work",
        blockIndex: 0,
        targetPowerWatts: null,
        targetResistancePercent: null,
        actualPowerWatts: row.actualPowerWatts,
        actualCadenceRpm: row.actualCadenceRpm,
        actualHeartRateBpm: row.actualHeartRateBpm,
        actualSpeedKmh: null,
        actualDistanceMeters: null,
        payloadJson: "{}"
      });
    }
    const { result } = service.getOrScore(sessionId);
    expect(result.rampStepsCompleted).toBe(13);
    expect(result.mapWatts).toBe(335);
  });

  it("scores a downgraded test as the quick (ramp-only) result", () => {
    const { sessionId } = recordRide({ withHr: false, downgraded: true });
    const { result } = service.getOrScore(sessionId);
    expect(result).toMatchObject({ variant: "quick", ftpSource: "ramp", ftpWatts: 251, thresholdHrBpm: null, valid: true });
  });

  it("refuses to score a ride that's still going, or isn't a test", () => {
    const { sessionId } = recordRide({ status: "running" });
    expect(() => service.getOrScore(sessionId)).toThrow(/still running/);

    const plain = randomUUID();
    repos.workoutSessions.create({ id: plain, workoutId: null, deviceId: null, startedAt: "x", status: "completed", summaryJson: "{}" });
    expect(() => service.getOrScore(plain)).toThrow(/isn't a fitness test/);
  });

  it("applies the chosen metrics, snapshots them, and marks the test applied", () => {
    const { sessionId } = recordRide();
    const record = service.getOrScore(sessionId);
    const { profile: updated, record: applied } = service.apply({
      testId: record.id,
      apply: { ftp: true, map: true, thresholdHr: false, maxHr: true }
    });
    expect(updated).toMatchObject({ ftpWatts: 262, mapWatts: 335, thresholdHrBpm: null, maxHrBpm: 190 });
    expect(applied.appliedAt).not.toBeNull();
    const snapshot = repos.metricsSnapshots.list()[0] as { ftp_watts: number; vo2max: number; metadata_json: string };
    expect(snapshot.ftp_watts).toBe(262);
    expect(snapshot.vo2max).toBe(record.result.vo2maxEst);
    expect(JSON.parse(snapshot.metadata_json)).toMatchObject({ source: "fitness-test", fitnessTestId: record.id });
  });

  it("never lowers max HR", () => {
    profile.updateProfile({ maxHrBpm: 198 });
    const { sessionId } = recordRide();
    const record = service.getOrScore(sessionId);
    const { profile: updated } = service.apply({
      testId: record.id,
      apply: { ftp: true, map: false, thresholdHr: false, maxHr: true }
    });
    expect(updated.maxHrBpm).toBe(198);
  });

  it("won't apply an invalid test", () => {
    const { sessionId } = recordRide({ failWatts: 195 }); // only 3 ramp steps
    const record = service.getOrScore(sessionId);
    expect(record.result.valid).toBe(false);
    expect(() =>
      service.apply({ testId: record.id, apply: { ftp: true, map: true, thresholdHr: true, maxHr: true } })
    ).toThrow(/valid result/);
    expect(profile.getProfile().ftpWatts).toBe(240);
  });

  it("compares a new test against the last valid one", () => {
    const first = recordRide({ startedAt: "2026-10-01T10:00:00Z", cappedWatts: 250 });
    service.getOrScore(first.sessionId);
    const second = recordRide({ startedAt: "2026-11-05T10:00:00Z", cappedWatts: 262 });
    const { result } = service.getOrScore(second.sessionId);
    expect(result.changes).toEqual({ mapWatts: 0, ftpWatts: 12, thresholdHrBpm: 0 });
    expect(service.list().map((test) => test.takenAt)).toEqual(["2026-11-05T10:00:00Z", "2026-10-01T10:00:00Z"]);
  });
});
