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

  it("still schedules a peak phase on a short plan (8 weeks)", () => {
    const result = service.generatePlan(baseRequest({ planLengthWeeks: 8 }));
    const sessionTypes = new Set(
      result.weeks.flatMap((week) => week.days.map((day) => day.sessionType).filter(Boolean))
    );
    // "anaerobic" is only produced by the peak-phase secondary day; before the
    // derivePhase fix the peak window collapsed into the taper for short plans.
    expect(sessionTypes.has("anaerobic")).toBe(true);
  });

  it("keeps the final week sharp when plan length is divisible by 4", () => {
    const result = service.generatePlan(baseRequest({ planLengthWeeks: 8 }));
    const finalWeek = result.weeks[result.weeks.length - 1];
    expect(finalWeek.loadTag).toBe("taper");
    const finalWeekTypes = finalWeek.days.map((day) => day.sessionType).filter(Boolean);
    // Race week is a taper, not a 4-week recovery week: it still carries hard work.
    expect(finalWeekTypes.some((type) => type === "threshold" || type === "neuromuscular")).toBe(true);
    expect(finalWeekTypes.every((type) => type === "recovery" || type === "endurance")).toBe(false);
  });
});

describe("EventPlanService — plan-day add / swap override layer", () => {
  let db: Database.Database;
  let repos: Repositories;
  let service: EventPlanService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    const bank = new WorkoutBankService(repos);
    bank.createBankWorkout(
      {
        schemaVersion: 1,
        id: "vo2-4x4",
        name: "VO2 4×4",
        discipline: "cycling",
        primaryZone: "vo2",
        tags: ["vo2"],
        phases: ["build"],
        segments: [
          { type: "warmup", durationSec: 300, powerLow: 0.5, powerHigh: 0.8 },
          {
            type: "intervals",
            repeat: 4,
            onDurationSec: 240,
            onPower: 1.1,
            offDurationSec: 240,
            offPower: 0.5
          }
        ]
      },
      "seed"
    );
    service = new EventPlanService(repos, createPlanAdaptationService(), bank);
  });

  afterEach(() => {
    db.close();
  });

  it("adds a bank workout to a day as an entry without touching the snapshot's planned workout", () => {
    const plan = service.generatePlan(baseRequest({ planLengthWeeks: 8 }));
    const planned = plan.weeks[0].days[0];

    const after = service.addDayWorkout({
      planId: plan.planId,
      weekIndex: 0,
      dayIndex: 0,
      bankWorkoutId: "vo2-4x4",
      ftp: 250,
      mode: "add"
    });

    const day = after.weeks[0].days[0];
    expect(day.workoutId).toBe(planned.workoutId); // snapshot prescription unchanged
    expect(day.plannedReplaced).toBe(false);
    expect(day.entries).toHaveLength(1);
    expect(day.entries[0]).toMatchObject({ bankWorkoutId: "vo2-4x4", mode: "add", sessionType: "vo2" });
    // Still only one plan version — day edits are an override layer, not a plan edit.
    expect(service.listPlanVersions(plan.planId)).toHaveLength(1);
    // Survives a re-read.
    expect(service.getCurrentPlan()?.weeks[0].days[0].entries).toHaveLength(1);
  });

  it("marks the planned workout replaced on a swap, and removeDayWorkout reverts it", () => {
    const plan = service.generatePlan(baseRequest({ planLengthWeeks: 8 }));

    const added = service.addDayWorkout({
      planId: plan.planId,
      weekIndex: 1,
      dayIndex: 2,
      bankWorkoutId: "vo2-4x4",
      ftp: 250,
      mode: "swap"
    });
    expect(added.weeks[1].days[2].plannedReplaced).toBe(true);
    const entryId = added.weeks[1].days[2].entries[0].id;

    const reverted = service.removeDayWorkout({ id: entryId });
    expect(reverted.weeks[1].days[2].entries).toHaveLength(0);
    expect(reverted.weeks[1].days[2].plannedReplaced).toBe(false);
  });
});
