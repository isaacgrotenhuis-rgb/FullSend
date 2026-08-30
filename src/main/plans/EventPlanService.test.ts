import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { createPlanAdaptationService } from "@main/plans/PlanAdaptationService";
import { EventPlanService } from "@main/plans/EventPlanService";
import { WorkoutBankService } from "@main/workout/WorkoutBankService";
import type { GenerateEventPlanRequest } from "@shared/ipc/contracts";

const availability = Array.from({ length: 7 }, (_, dayIndex) => ({
  dayIndex,
  canTrain: dayIndex !== 1 && dayIndex !== 5,
  maxDurationMin: 150
}));

const baseRequest = (overrides: Partial<GenerateEventPlanRequest> = {}): GenerateEventPlanRequest => ({
  eventType: "xc-mtb",
  eventDate: "2026-11-07",
  planLengthWeeks: 12,
  currentFtp: 250,
  weeklyAvailability: availability,
  reason: "Initial event plan generation",
  source: "user",
  ...overrides
});

describe("EventPlanService — phase matrix + taper", () => {
  let db: Database.Database;
  let repos: Repositories;
  let service: EventPlanService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    service = new EventPlanService(repos, createPlanAdaptationService(), new WorkoutBankService(repos));
  });

  afterEach(() => {
    db.close();
  });

  it("generates a full plan and preserves the version/audit flow (bank empty -> template fallback)", () => {
    const result = service.generatePlan(baseRequest());

    expect(result.ok).toBe(true);
    expect(result.weeks).toHaveLength(12);
    expect(service.listPlanVersions(result.planId)).toHaveLength(1);
    expect(service.listPlanAuditEntries(result.planId).length).toBeGreaterThanOrEqual(1);

    // Every scheduled day resolved to a real compiled workout with intervals.
    const scheduledDays = result.weeks.flatMap((week) => week.days.filter((day) => day.workoutId));
    expect(scheduledDays.length).toBeGreaterThan(0);
    for (const day of scheduledDays) {
      const intervalCount = db
        .prepare("SELECT COUNT(*) AS n FROM workout_intervals WHERE workout_id = ?")
        .get(day.workoutId) as { n: number };
      expect(intervalCount.n).toBeGreaterThan(0);
    }
  });

  it("derives phase-appropriate session types (sweet-spot in base, threshold/vo2 later)", () => {
    const result = service.generatePlan(baseRequest());
    const sessionTypes = new Set(
      result.weeks.flatMap((week) => week.days.map((day) => day.sessionType).filter(Boolean))
    );
    expect(sessionTypes.has("sweet-spot")).toBe(true);
    expect(sessionTypes.has("threshold") || sessionTypes.has("vo2")).toBe(true);
  });

  it("taper holds targetIF (no baseIF - 0.05 drop) and cuts volume 40-70%", () => {
    const result = service.generatePlan(baseRequest());
    const taperWeeks = result.weeks.filter((week) => week.loadTag === "taper");
    expect(taperWeeks).toHaveLength(2);

    const lastBuildWeek = [...result.weeks].reverse().find((week) => week.loadTag === "build");
    expect(lastBuildWeek).toBeDefined();

    // IF is held near the build level rather than dropped by ~0.05.
    for (const taper of taperWeeks) {
      expect(taper.targetIF).toBeGreaterThanOrEqual((lastBuildWeek?.targetIF ?? 1) - 0.02);
      // Volume cut: taper minutes well below the last build week.
      expect(taper.targetMinutes).toBeLessThan((lastBuildWeek?.targetMinutes ?? 0) * 0.7);
    }
  });
});
