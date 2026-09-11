import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { WorkoutRecapService } from "@main/workout/WorkoutRecapService";

describe("WorkoutRecapService", () => {
  let db: Database.Database;
  let repos: Repositories;
  let service: WorkoutRecapService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    service = new WorkoutRecapService(repos);
  });

  afterEach(() => {
    db.close();
  });

  const seedWorkout = (id: string): string => {
    repos.workouts.create({
      id,
      name: `Workout ${id}`,
      source: "test",
      intensityFactor: 0.8,
      durationSeconds: 3600,
      metadataJson: "{}"
    });
    repos.workoutIntervals.create({
      id: `${id}-i0`,
      workoutId: id,
      intervalIndex: 0,
      kind: "warmup",
      targetPowerWatts: 120,
      targetPowerWattsEnd: 180,
      targetResistancePercent: null,
      targetCadenceRpm: 90,
      durationSeconds: 600,
      notes: null
    });
    repos.workoutIntervals.create({
      id: `${id}-i1`,
      workoutId: id,
      intervalIndex: 1,
      kind: "work",
      targetPowerWatts: 240,
      targetPowerWattsEnd: null,
      targetResistancePercent: null,
      targetCadenceRpm: null,
      durationSeconds: 3000,
      notes: null
    });
    return id;
  };

  const seedSession = (opts: {
    id: string;
    startedAt: string;
    workoutId?: string | null;
    status?: string;
    summary?: Record<string, unknown> | string;
  }): void => {
    repos.workoutSessions.create({
      id: opts.id,
      workoutId: opts.workoutId ?? null,
      deviceId: null,
      startedAt: opts.startedAt,
      status: "running",
      summaryJson: "{}"
    });
    repos.workoutSessions.updateStatus({
      id: opts.id,
      status: opts.status ?? "completed",
      endedAt: opts.startedAt,
      summaryJson:
        typeof opts.summary === "string" ? opts.summary : JSON.stringify(opts.summary ?? {})
    });
  };

  const fullSummary = {
    endReason: "manual-stop",
    elapsedSec: 3600,
    currentIntervalIndex: 1,
    avgPowerWatts: 210,
    avgCadenceRpm: 88,
    avgHeartRateBpm: 150,
    avgSpeedKmh: 32.5,
    distanceMeters: 32500
  };

  const seedTelemetry = (
    sessionId: string,
    samples: Array<{ elapsedSec: number; power?: number | null; speed?: number | null; distance?: number | null }>
  ): void => {
    samples.forEach((sample, index) => {
      repos.workoutSessionTelemetry.append({
        id: `${sessionId}-t${index}`,
        sessionId,
        elapsedSeconds: sample.elapsedSec,
        blockType: "work",
        blockIndex: 0,
        targetPowerWatts: null,
        targetResistancePercent: null,
        targetCadenceRpm: null,
        actualPowerWatts: sample.power ?? null,
        actualCadenceRpm: null,
        actualHeartRateBpm: null,
        actualSpeedKmh: sample.speed ?? null,
        actualDistanceMeters: sample.distance ?? null,
        payloadJson: "{}"
      });
    });
  };

  describe("listCompletedSessions", () => {
    it("returns only completed sessions, newest first, honouring the limit", () => {
      seedSession({ id: "s-old", startedAt: "2026-01-01T10:00:00.000Z", summary: fullSummary });
      seedSession({ id: "s-new", startedAt: "2026-03-01T10:00:00.000Z", summary: fullSummary });
      seedSession({ id: "s-mid", startedAt: "2026-02-01T10:00:00.000Z", summary: fullSummary });
      seedSession({ id: "s-running", startedAt: "2026-04-01T10:00:00.000Z", status: "running" });
      seedSession({ id: "s-stopped", startedAt: "2026-05-01T10:00:00.000Z", status: "stopped" });

      const all = service.listCompletedSessions(10);
      expect(all.map((row) => row.sessionId)).toEqual(["s-new", "s-mid", "s-old"]);

      expect(service.listCompletedSessions(2).map((row) => row.sessionId)).toEqual(["s-new", "s-mid"]);
    });

    it("maps stats from summary_json and joins the workout name + planned intervals", () => {
      const workoutId = seedWorkout("w1");
      seedSession({ id: "s1", startedAt: "2026-03-01T10:00:00.000Z", workoutId, summary: fullSummary });

      const [row] = service.listCompletedSessions(10);
      expect(row).toMatchObject({
        sessionId: "s1",
        workoutId: "w1",
        workoutName: "Workout w1",
        durationSec: 3600,
        avgPowerWatts: 210,
        distanceMeters: 32500
      });
      expect(row.plannedIntervals).toHaveLength(2);
      expect(row.plannedIntervals[0]).toEqual({
        kind: "warmup",
        durationSec: 600,
        targetPowerWatts: 120,
        targetPowerWattsEnd: 180,
        targetResistancePercent: null,
        targetCadenceRpm: 90
      });
    });

    it("handles ad-hoc rides (no workout_id) and malformed summary_json without throwing", () => {
      seedSession({ id: "s-adhoc", startedAt: "2026-03-02T10:00:00.000Z", summary: "{ not json" });

      const [row] = service.listCompletedSessions(10);
      expect(row.workoutId).toBeNull();
      expect(row.workoutName).toBeNull();
      expect(row.plannedIntervals).toEqual([]);
      expect(row.durationSec).toBe(0);
      expect(row.avgPowerWatts).toBeNull();
      expect(row.distanceMeters).toBeNull();
    });

    it("falls back to a telemetry MAX for distance when summary_json predates the key", () => {
      seedSession({
        id: "s-legacy",
        startedAt: "2026-03-03T10:00:00.000Z",
        summary: { elapsedSec: 1200, avgPowerWatts: 180, avgCadenceRpm: 85, avgHeartRateBpm: 140 }
      });
      seedTelemetry("s-legacy", [
        { elapsedSec: 0, distance: 0 },
        { elapsedSec: 600, distance: 5000 },
        { elapsedSec: 1200, distance: 9400.6 }
      ]);

      const [row] = service.listCompletedSessions(10);
      expect(row.distanceMeters).toBe(9401);
    });
  });

  describe("getSessionRecap", () => {
    it("returns the summary, planned intervals in order, and the telemetry series", () => {
      const workoutId = seedWorkout("w2");
      seedSession({ id: "s2", startedAt: "2026-03-04T10:00:00.000Z", workoutId, summary: fullSummary });
      seedTelemetry("s2", [
        { elapsedSec: 2, power: 200 },
        { elapsedSec: 0, power: 100 },
        { elapsedSec: 1, power: 150 }
      ]);

      const recap = service.getSessionRecap("s2");
      expect(recap.summary).toEqual({
        sessionId: "s2",
        durationSec: 3600,
        avgPowerWatts: 210,
        avgCadenceRpm: 88,
        avgHeartRateBpm: 150,
        avgSpeedKmh: 32.5,
        distanceMeters: 32500
      });
      expect(recap.plannedIntervals.map((interval) => interval.kind)).toEqual(["warmup", "work"]);
      expect(recap.telemetry.map((sample) => sample.elapsedSec)).toEqual([0, 1, 2]);
    });

    it("recomputes avg speed / distance from telemetry for legacy rows", () => {
      seedSession({
        id: "s-legacy2",
        startedAt: "2026-03-05T10:00:00.000Z",
        summary: { elapsedSec: 60, avgPowerWatts: 150, avgCadenceRpm: 80, avgHeartRateBpm: 130 }
      });
      seedTelemetry("s-legacy2", [
        { elapsedSec: 0, speed: 20, distance: 0 },
        { elapsedSec: 30, speed: 30, distance: 300 }
      ]);

      const recap = service.getSessionRecap("s-legacy2");
      expect(recap.summary.avgSpeedKmh).toBe(25);
      expect(recap.summary.distanceMeters).toBe(300);
    });

    it("throws for an unknown or non-completed session", () => {
      seedSession({ id: "s-stopped", startedAt: "2026-03-06T10:00:00.000Z", status: "stopped" });
      expect(() => service.getSessionRecap("does-not-exist")).toThrow(/not found/);
      expect(() => service.getSessionRecap("s-stopped")).toThrow(/not found/);
    });
  });
});
