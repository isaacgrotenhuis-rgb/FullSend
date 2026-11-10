import type { Repositories } from "@main/database/repositories";
import type {
  CompletedSessionSummary,
  SessionRecap,
  WorkoutInterval,
  WorkoutIntervalKind,
  WorkoutSessionSummary
} from "@shared/ipc/contracts";

type RecapRow = {
  id: string;
  workout_id: string | null;
  started_at: string;
  summary_json: string | null;
  workout_name: string | null;
  telemetry_distance_meters: number | null;
  telemetry_avg_speed_kmh: number | null;
};

type IntervalRow = {
  kind: WorkoutIntervalKind;
  target_power_watts: number | null;
  target_power_watts_end: number | null;
  target_resistance_percent: number | null;
  target_cadence_rpm: number | null;
  duration_seconds: number;
};

export type ParsedSummary = {
  elapsedSec: number;
  avgPowerWatts: number | null;
  avgCadenceRpm: number | null;
  avgHeartRateBpm: number | null;
  avgSpeedKmh: number | null;
  distanceMeters: number | null;
};

const EMPTY_SUMMARY: ParsedSummary = {
  elapsedSec: 0,
  avgPowerWatts: null,
  avgCadenceRpm: null,
  avgHeartRateBpm: null,
  avgSpeedKmh: null,
  distanceMeters: null
};

/** Local calendar date (YYYY-MM-DD) of a stored timestamp, the way plan weeks and event dates are expressed. */
export const localIsoDate = (timestamp: string): string => {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const roundOrNull = (value: number | null): number | null => (value === null ? null : Math.round(value));

// Match ErgWorkoutEngine.finalizeSession's one-decimal rounding for speed.
const roundSpeedOrNull = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 10) / 10;

/**
 * Read-only view over finished rides for the Home "recent activity" list and the
 * per-session recap modal. Reads repositories directly — it must never call into
 * ErgWorkoutEngine, whose accessors are gated on the session still being live.
 */
export class WorkoutRecapService {
  constructor(private readonly repositories: Repositories) {}

  listCompletedSessions(limit: number): CompletedSessionSummary[] {
    const rows = this.repositories.workoutSessions.listCompletedForRecap(limit) as RecapRow[];
    return rows.map((row) => this.toCompletedSummary(row));
  }

  /** Completed rides whose local start date falls in [startDate, endDate] (YYYY-MM-DD, inclusive), newest first. */
  listCompletedSessionsBetween(startDate: string, endDate: string): CompletedSessionSummary[] {
    const rows = this.repositories.workoutSessions.listAllCompletedForRecap() as RecapRow[];
    return rows
      .filter((row) => {
        const date = localIsoDate(row.started_at);
        return date >= startDate && date <= endDate;
      })
      .map((row) => this.toCompletedSummary(row));
  }

  private toCompletedSummary(row: RecapRow): CompletedSessionSummary {
    const summary = parseSessionSummary(row.summary_json);
    return {
      sessionId: row.id,
      workoutId: row.workout_id,
      workoutName: row.workout_name,
      startedAt: row.started_at,
      durationSec: summary.elapsedSec,
      avgPowerWatts: roundOrNull(summary.avgPowerWatts),
      distanceMeters: roundOrNull(summary.distanceMeters ?? row.telemetry_distance_meters),
      plannedIntervals: row.workout_id ? this.loadPlannedIntervals(row.workout_id) : []
    };
  }

  getSessionRecap(sessionId: string): SessionRecap {
    const row = this.repositories.workoutSessions.getCompletedForRecap(sessionId) as RecapRow | undefined;
    if (!row) {
      throw new Error(`Completed session not found: ${sessionId}`);
    }
    const parsed = parseSessionSummary(row.summary_json);
    const summary: WorkoutSessionSummary = {
      sessionId: row.id,
      durationSec: parsed.elapsedSec,
      avgPowerWatts: roundOrNull(parsed.avgPowerWatts),
      avgCadenceRpm: roundOrNull(parsed.avgCadenceRpm),
      avgHeartRateBpm: roundOrNull(parsed.avgHeartRateBpm),
      avgSpeedKmh: roundSpeedOrNull(parsed.avgSpeedKmh ?? row.telemetry_avg_speed_kmh),
      distanceMeters: roundOrNull(parsed.distanceMeters ?? row.telemetry_distance_meters)
    };
    return {
      summary,
      plannedIntervals: row.workout_id ? this.loadPlannedIntervals(row.workout_id) : [],
      telemetry: this.repositories.workoutSessionTelemetry.getSeries(sessionId)
    };
  }

  private loadPlannedIntervals(workoutId: string): WorkoutInterval[] {
    return (this.repositories.workoutIntervals.byWorkout(workoutId) as IntervalRow[]).map((row) => ({
      kind: row.kind,
      durationSec: row.duration_seconds,
      targetPowerWatts: row.target_power_watts,
      targetResistancePercent: row.target_resistance_percent,
      targetPowerWattsEnd: row.target_power_watts_end,
      targetCadenceRpm: row.target_cadence_rpm
    }));
  }
}

// Only status='completed' rows reach here, and those always pass through
// finalizeSession with the full key set — this still hardens against a
// partial/legacy blob rather than throwing inside an IPC handler.
export const parseSessionSummary = (summaryJson: string | null): ParsedSummary => {
  if (!summaryJson) {
    return EMPTY_SUMMARY;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(summaryJson);
  } catch {
    return EMPTY_SUMMARY;
  }
  if (!raw || typeof raw !== "object") {
    return EMPTY_SUMMARY;
  }
  const record = raw as Record<string, unknown>;
  return {
    elapsedSec: finiteOrNull(record.elapsedSec) ?? 0,
    avgPowerWatts: finiteOrNull(record.avgPowerWatts),
    avgCadenceRpm: finiteOrNull(record.avgCadenceRpm),
    avgHeartRateBpm: finiteOrNull(record.avgHeartRateBpm),
    avgSpeedKmh: finiteOrNull(record.avgSpeedKmh),
    distanceMeters: finiteOrNull(record.distanceMeters)
  };
};
