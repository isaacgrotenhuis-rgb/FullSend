import type { Repositories } from "@main/database/repositories";
import type { DashboardMetrics } from "@shared/ipc/contracts";

type CompletedWorkoutRow = {
  id: string;
  workout_id: string | null;
  started_at: string;
  status: string;
  duration_seconds: number | null;
  intensity_factor: number | null;
};

type PlannedWorkoutRow = {
  plan_week_id: string;
  day_index: number;
  workout_id: string;
  start_date: string;
  duration_seconds: number;
  intensity_factor: number | null;
};

type FtpRow = {
  captured_at: string;
  ftp_watts: number | null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toIsoDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const startOfWeekSunday = (isoDate: string): string => {
  const parsed = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00.000Z`);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return toIsoDate(parsed);
};

const addDays = (isoDate: string, days: number): string => {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
};

const computeLoad = (durationSeconds: number | null, intensityFactor: number | null): number => {
  if (!durationSeconds || durationSeconds <= 0) {
    return 0;
  }
  const ifValue = intensityFactor ?? 0.65;
  const hours = durationSeconds / 3600;
  return Number((hours * ifValue * ifValue * 100).toFixed(1));
};

const round = (value: number): number => Number(value.toFixed(1));

export class ProgressDashboardService {
  constructor(private readonly repositories: Repositories) {}

  getMetrics(weeksBack: number): DashboardMetrics {
    const normalizedWeeksBack = clamp(weeksBack, 4, 26);
    const today = new Date();
    const currentWeekStart = startOfWeekSunday(toIsoDate(today));
    const firstWeek = addDays(currentWeekStart, -7 * (normalizedWeeksBack - 1));

    const plannedRows = this.repositories.planWeekWorkouts.listPlannedWithWorkoutLoad() as PlannedWorkoutRow[];
    const completedRows = this.repositories.workoutSessions.listCompletedWithWorkoutLoad() as CompletedWorkoutRow[];
    const ftpRows = this.repositories.metricsSnapshots.listFtpTrend(24) as FtpRow[];

    const weekBuckets = new Map<string, { plannedLoad: number; actualLoad: number; plannedCount: number; completedCount: number }>();
    for (let i = 0; i < normalizedWeeksBack; i += 1) {
      const weekStart = addDays(firstWeek, i * 7);
      weekBuckets.set(weekStart, { plannedLoad: 0, actualLoad: 0, plannedCount: 0, completedCount: 0 });
    }

    const plannedWorkoutIds = new Set<string>();
    for (const row of plannedRows) {
      if (!weekBuckets.has(row.start_date)) {
        continue;
      }
      const bucket = weekBuckets.get(row.start_date);
      if (!bucket) {
        continue;
      }
      bucket.plannedLoad += computeLoad(row.duration_seconds, row.intensity_factor);
      bucket.plannedCount += 1;
      plannedWorkoutIds.add(row.workout_id);
    }

    let completedWorkoutsCount = 0;
    let completedPlannedCount = 0;
    for (const row of completedRows) {
      const weekStart = startOfWeekSunday(row.started_at);
      if (!weekBuckets.has(weekStart)) {
        continue;
      }
      const bucket = weekBuckets.get(weekStart);
      if (!bucket) {
        continue;
      }
      bucket.actualLoad += computeLoad(row.duration_seconds, row.intensity_factor);
      bucket.completedCount += 1;
      completedWorkoutsCount += 1;
      if (row.workout_id && plannedWorkoutIds.has(row.workout_id)) {
        completedPlannedCount += 1;
      }
    }

    const weeklyLoad = Array.from(weekBuckets.entries()).map(([weekStart, bucket]) => ({
      weekStart,
      plannedLoad: round(bucket.plannedLoad),
      actualLoad: round(bucket.actualLoad),
      variance: round(bucket.actualLoad - bucket.plannedLoad)
    }));

    const plannedWorkoutsCount = weeklyLoad.reduce((sum, item) => {
      const bucket = weekBuckets.get(item.weekStart);
      return sum + (bucket?.plannedCount ?? 0);
    }, 0);

    const planCompliancePercent =
      plannedWorkoutsCount > 0 ? round((completedPlannedCount / plannedWorkoutsCount) * 100) : null;

    const totalPlannedLoad = weeklyLoad.reduce((sum, week) => sum + week.plannedLoad, 0);
    const totalActualLoad = weeklyLoad.reduce((sum, week) => sum + week.actualLoad, 0);
    const plannedVsActualLoadVariancePercent =
      totalPlannedLoad > 0 ? round(((totalActualLoad - totalPlannedLoad) / totalPlannedLoad) * 100) : null;

    const ftpTrend = ftpRows
      .slice()
      .reverse()
      .map((row) => ({
        capturedAt: row.captured_at,
        ftpWatts: row.ftp_watts
      }));
    const ftpStart = ftpTrend[0]?.ftpWatts ?? null;
    const ftpEnd = ftpTrend[ftpTrend.length - 1]?.ftpWatts ?? null;
    const ftpDelta = ftpStart !== null && ftpEnd !== null ? ftpEnd - ftpStart : null;

    const trendSummary = [
      ftpDelta === null ? "FTP trend unavailable" : `FTP ${ftpDelta >= 0 ? "up" : "down"} ${Math.abs(ftpDelta)}W`,
      planCompliancePercent === null ? "compliance unavailable" : `compliance ${planCompliancePercent}%`,
      plannedVsActualLoadVariancePercent === null
        ? "load variance unavailable"
        : `load variance ${plannedVsActualLoadVariancePercent}%`
    ].join(" | ");

    return {
      generatedAt: new Date().toISOString(),
      ftpTrend,
      completedWorkoutsCount,
      planCompliancePercent,
      weeklyLoad,
      plannedVsActualLoadVariancePercent,
      trendSummary
    };
  }
}
