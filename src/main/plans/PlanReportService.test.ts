import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { createPlanAdaptationService } from "@main/plans/PlanAdaptationService";
import { EventPlanService } from "@main/plans/EventPlanService";
import { PlanReportService } from "@main/plans/PlanReportService";
import { WorkoutBankService } from "@main/workout/WorkoutBankService";
import { WorkoutRecapService } from "@main/workout/WorkoutRecapService";
import type { GenerateEventPlanRequest } from "@shared/ipc/contracts";

const request: GenerateEventPlanRequest = {
  name: "Iceman",
  eventType: "xc-mtb",
  eventDate: "2026-11-07",
  planLengthWeeks: 8,
  currentFtp: 230,
  weeklyAvailability: Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    canTrain: dayIndex !== 1,
    maxDurationMin: 120
  })),
  reason: "test",
  source: "user"
};

// Midday local time, so a ride's local date can't slip across midnight.
const middayOn = (isoDate: string): string => new Date(`${isoDate}T12:00:00`).toISOString();

describe("PlanReportService", () => {
  let db: Database.Database;
  let repos: Repositories;
  let plans: EventPlanService;
  let reports: PlanReportService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    plans = new EventPlanService(repos, createPlanAdaptationService(), new WorkoutBankService(repos));
    reports = new PlanReportService(repos, plans, new WorkoutRecapService(repos));
  });

  afterEach(() => {
    db.close();
  });

  const addRide = (id: string, isoDate: string, elapsedSec: number): void =>
    repos.workoutSessions.create({
      id,
      workoutId: null,
      deviceId: null,
      startedAt: middayOn(isoDate),
      status: "completed",
      summaryJson: JSON.stringify({ elapsedSec, avgPowerWatts: 175.4, distanceMeters: 20000 })
    });

  const addFitnessTest = (id: string, isoDate: string, ftpWatts: number): void => {
    repos.workoutSessions.create({
      id: `session-${id}`,
      workoutId: null,
      deviceId: null,
      startedAt: middayOn(isoDate),
      status: "aborted",
      summaryJson: "{}"
    });
    repos.fitnessTests.create({
      id,
      sessionId: `session-${id}`,
      variant: "full",
      takenAt: middayOn(isoDate),
      mapSeedWatts: null,
      mapWatts: null,
      ftpRampWatts: null,
      ftpCappedWatts: null,
      ftpWatts,
      thresholdHrBpm: null,
      maxHrBpm: null,
      hrCapBpm: null,
      weightKg: null,
      vo2maxEst: null,
      valid: true,
      flagsJson: "[]",
      resultJson: "{}"
    });
  };

  it("buckets the plan's rides into its weeks and lists them newest first", () => {
    const plan = plans.generatePlan(request);
    const [firstWeek, secondWeek] = plan.weeks;
    addRide("a", firstWeek.startDate, 3600);
    addRide("b", firstWeek.startDate, 1800);
    addRide("c", secondWeek.startDate, 2700);
    addRide("after", "2026-11-09", 900); // after the event: not part of the plan

    const report = reports.getPlanReport(plan.planId);

    expect(report.summary).toMatchObject({ completedRides: 3, rideSeconds: 8100, startFtp: 230 });
    expect(report.weeks).toHaveLength(8);
    expect(report.weeks[0]).toMatchObject({ startDate: firstWeek.startDate, completedRides: 2, rideSeconds: 5400 });
    expect(report.weeks[1]).toMatchObject({ completedRides: 1, rideSeconds: 2700 });
    expect(report.weeks[0].plannedRides).toBe(firstWeek.days.filter((day) => day.workoutId !== null).length);
    // Newest first; "a" and "b" share a start time, so only the set is fixed.
    expect(report.rides[0].sessionId).toBe("c");
    expect(report.rides.slice(1).map((ride) => ride.sessionId).sort()).toEqual(["a", "b"]);
    expect(report.rides[0]).toMatchObject({ durationSec: 2700, avgPowerWatts: 175, distanceMeters: 20000 });
  });

  it("reports the FTP from the last fitness test taken during the plan", () => {
    const plan = plans.generatePlan(request);
    addFitnessTest("before", "2026-01-10", 210); // before the plan started
    expect(reports.getPlanReport(plan.planId).endFtp).toBeNull();

    addFitnessTest("during", "2026-10-20", 252);
    addFitnessTest("after", "2026-11-20", 260); // after the event
    expect(reports.getPlanReport(plan.planId).endFtp).toBe(252);
  });
});
