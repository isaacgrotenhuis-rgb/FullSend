import type { Repositories } from "@main/database/repositories";
import type { EventPlanService } from "@main/plans/EventPlanService";
import { localIsoDate, type WorkoutRecapService } from "@main/workout/WorkoutRecapService";
import type { EventPlanReport } from "@shared/ipc/contracts";

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localIsoDate(date.toISOString());
};

/**
 * Read-only look back at a plan: what was planned, what was ridden in its
 * window (first week through event day), and where FTP ended up. Rides carry
 * no link to a plan, so they're matched by date.
 */
export class PlanReportService {
  constructor(
    private readonly repositories: Repositories,
    private readonly eventPlanService: EventPlanService,
    private readonly workoutRecapService: WorkoutRecapService
  ) {}

  getPlanReport(planId: string): EventPlanReport {
    const summary = this.eventPlanService.getPlanSummary(planId);
    const rides = this.workoutRecapService.listCompletedSessionsBetween(summary.startDate, summary.eventDate);
    const ridesByDate = new Map<string, { count: number; seconds: number }>();
    for (const ride of rides) {
      const date = localIsoDate(ride.startedAt);
      const entry = ridesByDate.get(date) ?? { count: 0, seconds: 0 };
      entry.count += 1;
      entry.seconds += ride.durationSec;
      ridesByDate.set(date, entry);
    }

    const weeks = this.eventPlanService.getPlanWeeks(planId).map((week) => {
      let completedRides = 0;
      let rideSeconds = 0;
      for (let day = 0; day < 7; day += 1) {
        const entry = ridesByDate.get(addDays(week.startDate, day));
        if (entry) {
          completedRides += entry.count;
          rideSeconds += entry.seconds;
        }
      }
      return {
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        loadTag: week.loadTag,
        plannedRides: week.days.filter((day) => day.workoutId !== null).length,
        completedRides,
        rideSeconds
      };
    });

    // Latest valid test taken before the day after the event; it only counts
    // as the plan's result if it was taken during the plan.
    const lastTest = this.repositories.fitnessTests.getLatestValid(addDays(summary.eventDate, 1));
    const endFtp =
      lastTest && lastTest.ftp_watts !== null && localIsoDate(lastTest.taken_at) >= summary.startDate
        ? Math.round(lastTest.ftp_watts)
        : null;

    return { summary, endFtp, weeks, rides };
  }
}
