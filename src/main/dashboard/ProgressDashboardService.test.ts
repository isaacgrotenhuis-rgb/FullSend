import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { createPlanAdaptationService } from "@main/plans/PlanAdaptationService";
import { EventPlanService } from "@main/plans/EventPlanService";
import { WorkoutBankService } from "@main/workout/WorkoutBankService";
import { ProgressDashboardService } from "@main/dashboard/ProgressDashboardService";
import type { GenerateEventPlanRequest } from "@shared/ipc/contracts";

const isoInDays = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const request = (overrides: Partial<GenerateEventPlanRequest>): GenerateEventPlanRequest => ({
  eventType: "road-race",
  eventDate: isoInDays(7),
  planLengthWeeks: 8,
  currentFtp: 250,
  weeklyAvailability: Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    canTrain: dayIndex !== 1,
    maxDurationMin: 120
  })),
  reason: "test",
  source: "user",
  ...overrides
});

describe("ProgressDashboardService — planned load across archived plans", () => {
  let db: Database.Database;
  let repos: Repositories;
  let plans: EventPlanService;
  let dashboard: ProgressDashboardService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
    plans = new EventPlanService(repos, createPlanAdaptationService(), new WorkoutBankService(repos));
    dashboard = new ProgressDashboardService(repos);
  });

  afterEach(() => {
    db.close();
  });

  it("does not double-count weeks where the next plan overlaps the archived one", () => {
    const first = plans.generatePlan(request({ name: "First" }));
    // Plans created in the same second would tie on created_at.
    db.prepare("UPDATE training_plans SET created_at = datetime('now', '-30 days') WHERE id = ?").run(first.planId);
    const before = dashboard.getMetrics(12).weeklyLoad;
    expect(before.some((week) => week.plannedLoad > 0)).toBe(true);

    // The next plan's first weeks reach back into weeks the first plan covered.
    const second = plans.generatePlan(request({ name: "Second", eventDate: isoInDays(56), planLengthWeeks: 12 }));
    expect(second.weeks[0].startDate < isoInDays(-7)).toBe(true);

    expect(dashboard.getMetrics(12).weeklyLoad).toEqual(before);
  });
});
