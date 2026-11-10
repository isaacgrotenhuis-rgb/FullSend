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

  it("reports the plan's event date from generate, getCurrent and adapt (with an override date)", () => {
    const generated = service.generatePlan(baseRequest());
    expect(generated.eventDate).toBe("2026-11-07");
    expect(service.getCurrentPlan()?.eventDate).toBe("2026-11-07");

    const adapted = service.adaptPlan({
      planId: generated.planId,
      reason: "Race moved",
      source: "user",
      overrides: { eventDate: "2026-11-21" }
    });
    expect(adapted.eventDate).toBe("2026-11-21");
    expect(service.getCurrentPlan()?.eventDate).toBe("2026-11-21");

    // An adapt without a date override keeps the adapted date.
    const readapted = service.adaptPlan({ planId: generated.planId, reason: "FTP bump", source: "user" });
    expect(readapted.eventDate).toBe("2026-11-21");
  });
});

describe("EventPlanService — archive lifecycle", () => {
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

  const activeCount = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM training_plans WHERE status = 'active'").get() as { n: number }).n;

  // summary_json as ErgWorkoutEngine.finalizeSession writes it: the ride's
  // length is `elapsedSec`.
  const addCompletedRide = (startedAt: string, elapsedSec: number): void => {
    repos.workoutSessions.create({
      id: `ride-${startedAt}`,
      workoutId: null,
      deviceId: null,
      startedAt,
      status: "completed",
      summaryJson: JSON.stringify({ endReason: "all-intervals-finished", elapsedSec, avgPowerWatts: 180 })
    });
  };

  it("generating a new plan archives the previous one and keeps exactly one active", () => {
    const first = service.generatePlan(baseRequest({ name: "Iceman" }));
    const second = service.generatePlan(baseRequest({ name: "Spring fondo", eventDate: "2027-04-10" }));

    expect(activeCount()).toBe(1);
    expect(service.getCurrentPlan()?.planId).toBe(second.planId);
    expect(service.listArchivedPlans().map((plan) => plan.planId)).toEqual([first.planId]);
    expect(service.listArchivedPlans()[0].archivedAt).not.toBeNull();
  });

  it("archiving the active plan leaves no current plan; restoring brings it back and archives the other", () => {
    const first = service.generatePlan(baseRequest({ name: "Iceman" }));
    service.archivePlan(first.planId);
    expect(service.getCurrentPlan()).toBeNull();

    const second = service.generatePlan(baseRequest({ name: "Spring fondo", eventDate: "2027-04-10" }));
    // Before the first plan's event, so it can still come back.
    service.restorePlan(first.planId, "2026-10-01");

    expect(activeCount()).toBe(1);
    expect(service.getCurrentPlan()?.planId).toBe(first.planId);
    expect(service.listArchivedPlans().map((plan) => plan.planId)).toEqual([second.planId]);
    expect(service.getPlanSummary(first.planId).archivedAt).toBeNull();
  });

  it("getCurrentPlan carries the event type and availability for prefilling the next plan", () => {
    service.generatePlan(baseRequest());
    const current = service.getCurrentPlan();
    expect(current?.eventType).toBe("xc-mtb");
    expect(current?.weeklyAvailability).toEqual(availability);
  });

  it("summarizes planned vs completed rides inside the plan's window only", () => {
    const plan = service.generatePlan(baseRequest());
    const startDate = plan.weeks[0].startDate;
    const plannedRides = plan.weeks.reduce(
      (sum, week) => sum + week.days.filter((day) => day.workoutId !== null).length,
      0
    );

    // Midday local times so the local-date match cannot slip across midnight.
    addCompletedRide(new Date(`${startDate}T12:00:00`).toISOString(), 3600);
    addCompletedRide(new Date("2026-11-07T12:00:00").toISOString(), 1800); // event day counts
    addCompletedRide(new Date("2026-11-08T12:00:00").toISOString(), 900); // after the event
    addCompletedRide(new Date("2026-01-01T12:00:00").toISOString(), 900); // before the plan

    const summary = service.getPlanSummary(plan.planId);
    expect(summary).toMatchObject({
      status: "active",
      startDate,
      eventDate: "2026-11-07",
      weekCount: 12,
      plannedRides,
      completedRides: 2,
      rideSeconds: 5400,
      startFtp: 250
    });
  });

  it("refuses to restore a plan whose event has passed, but allows it on event day", () => {
    const finished = service.generatePlan(baseRequest({ name: "Iceman", eventDate: "2026-11-07" }));
    service.generatePlan(baseRequest({ name: "Spring fondo", eventDate: "2027-04-10" }));

    expect(() => service.restorePlan(finished.planId, "2026-11-08")).toThrow(/already finished/);
    expect(service.getCurrentPlan()?.name).toBe("Spring fondo");

    service.restorePlan(finished.planId, "2026-11-07");
    expect(service.getCurrentPlan()?.planId).toBe(finished.planId);
  });

  it("throws for unknown plans", () => {
    expect(() => service.archivePlan("missing")).toThrow(/not found/);
    expect(() => service.restorePlan("missing", "2026-01-01")).toThrow(/not found/);
  });
});
