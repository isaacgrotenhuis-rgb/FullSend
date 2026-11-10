import type { Database } from "better-sqlite3";
import type { BleRememberedDevice, BleRole } from "@shared/ipc/contracts";

type Row = Record<string, unknown>;

class BaseRepository {
  protected readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }
}

export class DevicesRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM devices ORDER BY updated_at DESC").all() as Row[];
  }

  upsert(input: { id: string; name: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO devices (id, name, last_seen_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at`
      )
      .run(input.id, input.name);
  }

  /** The device last connected per role, most recent first. */
  listRemembered(): BleRememberedDevice[] {
    const rows = this.db
      .prepare("SELECT role, device_id, name, auto_connect FROM remembered_devices ORDER BY last_connected_at DESC")
      .all() as Array<{ role: BleRole; device_id: string; name: string | null; auto_connect: number }>;
    return rows.map((row) => ({
      role: row.role,
      deviceId: row.device_id,
      name: row.name,
      autoConnect: row.auto_connect === 1
    }));
  }

  remember(input: BleRememberedDevice): void {
    this.db
      .prepare(
        `INSERT INTO remembered_devices (role, device_id, name, auto_connect, last_connected_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(role) DO UPDATE SET
           device_id = excluded.device_id,
           name = excluded.name,
           auto_connect = excluded.auto_connect,
           last_connected_at = excluded.last_connected_at`
      )
      .run(input.role, input.deviceId, input.name, input.autoConnect ? 1 : 0);
  }

  forget(role: BleRole): void {
    this.db.prepare("DELETE FROM remembered_devices WHERE role = ?").run(role);
  }

  setAutoConnect(role: BleRole, enabled: boolean): void {
    this.db.prepare("UPDATE remembered_devices SET auto_connect = ? WHERE role = ?").run(enabled ? 1 : 0, role);
  }
}

export class WorkoutsRepository extends BaseRepository {
  list(): Row[] {
    return this.db
      .prepare(
        "SELECT id, name, source, intensity_factor, duration_seconds, metadata_json, created_at, updated_at FROM workouts ORDER BY updated_at DESC"
      )
      .all() as Row[];
  }

  getById(workoutId: string): Row | undefined {
    return this.db
      .prepare(
        "SELECT id, name, source, intensity_factor, duration_seconds, metadata_json, created_at, updated_at FROM workouts WHERE id = ?"
      )
      .get(workoutId) as Row | undefined;
  }

  create(input: {
    id: string;
    name: string;
    source: string;
    intensityFactor: number | null;
    durationSeconds: number;
    metadataJson: string;
    bankWorkoutId?: string | null;
    compiledAtFtp?: number | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workouts (id, name, source, intensity_factor, duration_seconds, metadata_json, bank_workout_id, compiled_at_ftp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.source,
        input.intensityFactor,
        input.durationSeconds,
        input.metadataJson,
        input.bankWorkoutId ?? null,
        input.compiledAtFtp ?? null
      );
  }

  update(input: {
    id: string;
    name: string;
    intensityFactor: number | null;
    durationSeconds: number;
    metadataJson: string;
  }): void {
    this.db
      .prepare(
        `UPDATE workouts
         SET name = ?, intensity_factor = ?, duration_seconds = ?, metadata_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(input.name, input.intensityFactor, input.durationSeconds, input.metadataJson, input.id);
  }

  delete(workoutId: string): void {
    this.db.prepare("DELETE FROM workouts WHERE id = ?").run(workoutId);
  }
}

export class WorkoutIntervalsRepository extends BaseRepository {
  list(): Row[] {
    return this.db
      .prepare(
        `SELECT id, workout_id, interval_index, kind, target_power_watts, target_power_watts_end, target_resistance_percent,
                target_cadence_rpm, duration_seconds, notes, created_at, updated_at
         FROM workout_intervals ORDER BY workout_id ASC, interval_index ASC`
      )
      .all() as Row[];
  }

  getById(intervalId: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT id, workout_id, interval_index, kind, target_power_watts, target_power_watts_end, target_resistance_percent,
                target_cadence_rpm, duration_seconds, notes, created_at, updated_at
         FROM workout_intervals WHERE id = ?`
      )
      .get(intervalId) as Row | undefined;
  }

  byWorkout(workoutId: string): Row[] {
    return this.db
      .prepare(
        `SELECT id, workout_id, interval_index, kind, target_power_watts, target_power_watts_end, target_resistance_percent,
                target_cadence_rpm, duration_seconds, notes, created_at, updated_at
         FROM workout_intervals WHERE workout_id = ? ORDER BY interval_index ASC`
      )
      .all(workoutId) as Row[];
  }

  create(input: {
    id: string;
    workoutId: string;
    intervalIndex: number;
    kind: string;
    targetPowerWatts: number | null;
    targetPowerWattsEnd?: number | null;
    targetResistancePercent: number | null;
    targetCadenceRpm?: number | null;
    durationSeconds: number;
    notes: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workout_intervals
         (id, workout_id, interval_index, kind, target_power_watts, target_power_watts_end,
          target_resistance_percent, target_cadence_rpm, duration_seconds, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.workoutId,
        input.intervalIndex,
        input.kind,
        input.targetPowerWatts,
        input.targetPowerWattsEnd ?? null,
        input.targetResistancePercent,
        input.targetCadenceRpm ?? null,
        input.durationSeconds,
        input.notes
      );
  }

  update(input: {
    id: string;
    kind: string;
    targetPowerWatts: number | null;
    targetPowerWattsEnd?: number | null;
    targetResistancePercent: number | null;
    targetCadenceRpm?: number | null;
    durationSeconds: number;
    notes: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE workout_intervals
         SET kind = ?, target_power_watts = ?, target_power_watts_end = ?, target_resistance_percent = ?,
             target_cadence_rpm = ?, duration_seconds = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        input.kind,
        input.targetPowerWatts,
        input.targetPowerWattsEnd ?? null,
        input.targetResistancePercent,
        input.targetCadenceRpm ?? null,
        input.durationSeconds,
        input.notes,
        input.id
      );
  }

  updateIndex(intervalId: string, intervalIndex: number): void {
    this.db
      .prepare("UPDATE workout_intervals SET interval_index = ?, updated_at = datetime('now') WHERE id = ?")
      .run(intervalIndex, intervalId);
  }

  delete(intervalId: string): void {
    this.db.prepare("DELETE FROM workout_intervals WHERE id = ?").run(intervalId);
  }
}

export class WorkoutSessionsRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM workout_sessions ORDER BY started_at DESC").all() as Row[];
  }

  create(input: {
    id: string;
    workoutId: string | null;
    deviceId: string | null;
    startedAt: string;
    status: string;
    summaryJson: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO workout_sessions (id, workout_id, device_id, started_at, status, summary_json) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(input.id, input.workoutId, input.deviceId, input.startedAt, input.status, input.summaryJson);
  }

  updateStatus(input: {
    id: string;
    status: string;
    endedAt?: string | null;
    summaryJson?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE workout_sessions
         SET status = ?,
             ended_at = COALESCE(?, ended_at),
             summary_json = COALESCE(?, summary_json),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(input.status, input.endedAt ?? null, input.summaryJson ?? null, input.id);
  }

  listCompletedWithWorkoutLoad(): Row[] {
    return this.db
      .prepare(
        `SELECT ws.id, ws.workout_id, ws.started_at, ws.status, w.duration_seconds, w.intensity_factor
         FROM workout_sessions ws
         LEFT JOIN workouts w ON w.id = ws.workout_id
         WHERE ws.status = 'completed'
         ORDER BY ws.started_at DESC`
      )
      .all() as Row[];
  }

  listCompletedForStrava(): Row[] {
    return this.db
      .prepare(
        `SELECT ws.id, ws.workout_id, ws.started_at, ws.ended_at, ws.summary_json,
                w.name AS workout_name, w.duration_seconds, w.intensity_factor
         FROM workout_sessions ws
         LEFT JOIN workouts w ON w.id = ws.workout_id
         WHERE ws.status = 'completed'
         ORDER BY ws.started_at DESC`
      )
      .all() as Row[];
  }

  getCompletedForStrava(sessionId: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT ws.id, ws.workout_id, ws.started_at, ws.ended_at, ws.summary_json,
                w.name AS workout_name, w.duration_seconds, w.intensity_factor
         FROM workout_sessions ws
         LEFT JOIN workouts w ON w.id = ws.workout_id
         WHERE ws.status = 'completed' AND ws.id = ?`
      )
      .get(sessionId) as Row | undefined;
  }

  // Ride-history / recap reads. summary_json carries the averages (avgSpeedKmh /
  // distanceMeters added by ErgWorkoutEngine.finalizeSession); the joined telemetry
  // aggregate is the fallback for older completed rows written before those keys.
  private readonly recapSelect = `
    SELECT ws.id, ws.workout_id, ws.started_at, ws.summary_json,
           w.name AS workout_name,
           t.telemetry_distance_meters,
           t.telemetry_avg_speed_kmh
    FROM workout_sessions ws
    LEFT JOIN workouts w ON w.id = ws.workout_id
    LEFT JOIN (
      SELECT session_id,
             MAX(actual_distance_meters) AS telemetry_distance_meters,
             AVG(actual_speed_kmh) AS telemetry_avg_speed_kmh
      FROM workout_session_telemetry
      GROUP BY session_id
    ) t ON t.session_id = ws.id
    WHERE ws.status = 'completed'`;

  listCompletedForRecap(limit: number): Row[] {
    return this.db
      .prepare(`${this.recapSelect} ORDER BY ws.started_at DESC LIMIT ?`)
      .all(limit) as Row[];
  }

  listAllCompletedForRecap(): Row[] {
    return this.db.prepare(`${this.recapSelect} ORDER BY ws.started_at DESC`).all() as Row[];
  }

  getCompletedForRecap(sessionId: string): Row | undefined {
    return this.db.prepare(`${this.recapSelect} AND ws.id = ?`).get(sessionId) as Row | undefined;
  }

  getById(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM workout_sessions WHERE id = ?").get(id) as Row | undefined;
  }

  deleteById(id: string): void {
    this.db.prepare("DELETE FROM strava_sync_events WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM workout_sessions WHERE id = ?").run(id);
  }
}

export class WorkoutSessionEventsRepository extends BaseRepository {
  append(input: {
    id: string;
    sessionId: string;
    eventType: string;
    payloadJson: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO workout_session_events (id, session_id, event_type, payload_json) VALUES (?, ?, ?, ?)"
      )
      .run(input.id, input.sessionId, input.eventType, input.payloadJson);
  }

  /** A session's events in the order they were written. */
  listBySession(sessionId: string): Array<{ eventType: string; payloadJson: string }> {
    return this.db
      .prepare(
        "SELECT event_type AS eventType, payload_json AS payloadJson FROM workout_session_events WHERE session_id = ? ORDER BY rowid"
      )
      .all(sessionId) as Array<{ eventType: string; payloadJson: string }>;
  }
}

export class WorkoutSessionTelemetryRepository extends BaseRepository {
  append(input: {
    id: string;
    sessionId: string;
    elapsedSeconds: number;
    positionSec?: number | null;
    blockType: string;
    blockIndex: number;
    targetPowerWatts: number | null;
    targetResistancePercent: number | null;
    targetCadenceRpm?: number | null;
    actualPowerWatts: number | null;
    actualCadenceRpm: number | null;
    actualHeartRateBpm: number | null;
    actualSpeedKmh: number | null;
    actualDistanceMeters: number | null;
    payloadJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workout_session_telemetry
         (id, session_id, elapsed_seconds, position_sec, block_type, block_index, target_power_watts, target_resistance_percent, target_cadence_rpm, actual_power_watts, actual_cadence_rpm, actual_heart_rate_bpm, actual_speed_kmh, actual_distance_meters, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.sessionId,
        input.elapsedSeconds,
        input.positionSec ?? null,
        input.blockType,
        input.blockIndex,
        input.targetPowerWatts,
        input.targetResistancePercent,
        input.targetCadenceRpm ?? null,
        input.actualPowerWatts,
        input.actualCadenceRpm,
        input.actualHeartRateBpm,
        input.actualSpeedKmh,
        input.actualDistanceMeters,
        input.payloadJson
      );
  }

  getAverages(sessionId: string): {
    avgPowerWatts: number | null;
    avgCadenceRpm: number | null;
    avgHeartRateBpm: number | null;
    avgSpeedKmh: number | null;
    distanceMeters: number | null;
  } {
    return this.db
      .prepare(
        `SELECT AVG(actual_power_watts) AS avgPowerWatts,
                AVG(actual_cadence_rpm) AS avgCadenceRpm,
                AVG(actual_heart_rate_bpm) AS avgHeartRateBpm,
                AVG(actual_speed_kmh) AS avgSpeedKmh,
                MAX(actual_distance_meters) AS distanceMeters
         FROM workout_session_telemetry
         WHERE session_id = ?`
      )
      .get(sessionId) as {
      avgPowerWatts: number | null;
      avgCadenceRpm: number | null;
      avgHeartRateBpm: number | null;
      avgSpeedKmh: number | null;
      distanceMeters: number | null;
    };
  }

  /**
   * Per-second samples with the workout position, for fitness-test scoring. A
   * ride second can be written twice (e.g. the tick right after a resume); the
   * caller keeps the last row per second.
   */
  getPositionedSamples(sessionId: string): Array<{
    elapsedSec: number;
    positionSec: number | null;
    actualPowerWatts: number | null;
    actualCadenceRpm: number | null;
    actualHeartRateBpm: number | null;
  }> {
    return this.db
      .prepare(
        `SELECT elapsed_seconds AS elapsedSec,
                position_sec AS positionSec,
                actual_power_watts AS actualPowerWatts,
                actual_cadence_rpm AS actualCadenceRpm,
                actual_heart_rate_bpm AS actualHeartRateBpm
         FROM workout_session_telemetry
         WHERE session_id = ?
         ORDER BY elapsed_seconds ASC, rowid ASC`
      )
      .all(sessionId) as Array<{
      elapsedSec: number;
      positionSec: number | null;
      actualPowerWatts: number | null;
      actualCadenceRpm: number | null;
      actualHeartRateBpm: number | null;
    }>;
  }

  getSeries(sessionId: string): Array<{
    elapsedSec: number;
    actualPowerWatts: number | null;
    actualCadenceRpm: number | null;
    actualHeartRateBpm: number | null;
    actualSpeedKmh: number | null;
  }> {
    return this.db
      .prepare(
        `SELECT elapsed_seconds AS elapsedSec,
                actual_power_watts AS actualPowerWatts,
                actual_cadence_rpm AS actualCadenceRpm,
                actual_heart_rate_bpm AS actualHeartRateBpm,
                actual_speed_kmh AS actualSpeedKmh
         FROM workout_session_telemetry
         WHERE session_id = ?
         ORDER BY elapsed_seconds ASC`
      )
      .all(sessionId) as Array<{
      elapsedSec: number;
      actualPowerWatts: number | null;
      actualCadenceRpm: number | null;
      actualHeartRateBpm: number | null;
      actualSpeedKmh: number | null;
    }>;
  }
}

export class TrainingPlansRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM training_plans ORDER BY updated_at DESC").all() as Row[];
  }

  getById(planId: string): Row | undefined {
    return this.db
      .prepare(
        "SELECT id, name, source, notes, status, archived_at, created_at, updated_at FROM training_plans WHERE id = ?"
      )
      .get(planId) as Row | undefined;
  }

  create(input: { id: string; name: string; source: string; notes: string | null }): void {
    this.db
      .prepare("INSERT INTO training_plans (id, name, source, notes) VALUES (?, ?, ?, ?)")
      .run(input.id, input.name, input.source, input.notes);
  }

  update(input: { id: string; name: string; notes: string | null }): void {
    this.db
      .prepare(
        `UPDATE training_plans
         SET name = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(input.name, input.notes, input.id);
  }

  delete(planId: string): void {
    this.db.prepare("DELETE FROM training_plans WHERE id = ?").run(planId);
  }

  listByStatus(status: "active" | "archived"): Row[] {
    const order = status === "archived" ? "archived_at DESC, updated_at DESC" : "updated_at DESC";
    return this.db
      .prepare(`SELECT * FROM training_plans WHERE status = ? ORDER BY ${order}`)
      .all(status) as Row[];
  }

  /** Archiving leaves updated_at alone so it keeps meaning "last edited". */
  archive(planId: string): void {
    this.db
      .prepare("UPDATE training_plans SET status = 'archived', archived_at = datetime('now') WHERE id = ?")
      .run(planId);
  }

  archiveAllActiveExcept(planId: string | null): void {
    this.db
      .prepare(
        `UPDATE training_plans SET status = 'archived', archived_at = datetime('now')
         WHERE status = 'active' AND (? IS NULL OR id != ?)`
      )
      .run(planId, planId);
  }

  restore(planId: string): void {
    this.db
      .prepare(
        "UPDATE training_plans SET status = 'active', archived_at = NULL, updated_at = datetime('now') WHERE id = ?"
      )
      .run(planId);
  }
}

export class PlanWeeksRepository extends BaseRepository {
  list(): Row[] {
    return this.db
      .prepare("SELECT id, plan_id, week_index, start_date, notes, created_at, updated_at FROM plan_weeks")
      .all() as Row[];
  }

  byPlan(planId: string): Row[] {
    return this.db
      .prepare("SELECT * FROM plan_weeks WHERE plan_id = ? ORDER BY week_index ASC")
      .all(planId) as Row[];
  }

  create(input: {
    id: string;
    planId: string;
    weekIndex: number;
    startDate: string;
    notes: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO plan_weeks (id, plan_id, week_index, start_date, notes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.id, input.planId, input.weekIndex, input.startDate, input.notes);
  }

  deleteByPlan(planId: string): void {
    this.db.prepare("DELETE FROM plan_weeks WHERE plan_id = ?").run(planId);
  }
}

export class PlanWeekWorkoutsRepository extends BaseRepository {
  assignWorkout(input: { id: string; planWeekId: string; dayIndex: number; workoutId: string }): void {
    this.db
      .prepare(
        `INSERT INTO plan_week_workouts (id, plan_week_id, day_index, workout_id)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(plan_week_id, day_index)
         DO UPDATE SET workout_id = excluded.workout_id, updated_at = datetime('now')`
      )
      .run(input.id, input.planWeekId, input.dayIndex, input.workoutId);
  }

  unassignWorkout(input: { planWeekId: string; dayIndex: number }): void {
    this.db
      .prepare("DELETE FROM plan_week_workouts WHERE plan_week_id = ? AND day_index = ?")
      .run(input.planWeekId, input.dayIndex);
  }

  listAssignmentsForWeek(planWeekId: string): Row[] {
    return this.db
      .prepare(
        `SELECT pww.id, pww.plan_week_id, pww.day_index, pww.workout_id, w.name AS workout_name
         FROM plan_week_workouts pww
         JOIN workouts w ON w.id = pww.workout_id
         WHERE pww.plan_week_id = ?
         ORDER BY pww.day_index ASC`
      )
      .all(planWeekId) as Row[];
  }

  listPlannedWithWorkoutLoad(): Row[] {
    return this.db
      .prepare(
        `SELECT pww.plan_week_id, pww.day_index, pww.workout_id, pw.start_date,
                pw.plan_id, tp.created_at AS plan_created_at,
                w.duration_seconds, w.intensity_factor
         FROM plan_week_workouts pww
         JOIN plan_weeks pw ON pw.id = pww.plan_week_id
         JOIN training_plans tp ON tp.id = pw.plan_id
         JOIN workouts w ON w.id = pww.workout_id
         -- An archived plan still counts for the weeks it was in use, so past
         -- compliance holds, but not for weeks after it was put away (which a
         -- newer plan may now cover).
         WHERE tp.status = 'active' OR pw.start_date < date(tp.archived_at)
         ORDER BY pw.start_date ASC, pww.day_index ASC`
      )
      .all() as Row[];
  }
}

export class GoalsRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM goals ORDER BY updated_at DESC").all() as Row[];
  }
}

export class MetricsSnapshotsRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM metrics_snapshots ORDER BY captured_at DESC").all() as Row[];
  }

  create(input: {
    id: string;
    capturedAt: string;
    ftpWatts: number | null;
    weightKg: number | null;
    vo2max: number | null;
    metadataJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO metrics_snapshots (id, captured_at, ftp_watts, weight_kg, vo2max, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.id, input.capturedAt, input.ftpWatts, input.weightKg, input.vo2max, input.metadataJson);
  }

  listFtpTrend(limit: number): Row[] {
    return this.db
      .prepare(
        `SELECT captured_at, ftp_watts
         FROM metrics_snapshots
         ORDER BY captured_at DESC
         LIMIT ?`
      )
      .all(limit) as Row[];
  }
}

export type FitnessTestRow = {
  id: string;
  session_id: string;
  variant: string;
  taken_at: string;
  map_seed_watts: number | null;
  map_watts: number | null;
  ftp_ramp_watts: number | null;
  ftp_capped_watts: number | null;
  ftp_watts: number | null;
  threshold_hr_bpm: number | null;
  max_hr_bpm: number | null;
  hr_cap_bpm: number | null;
  weight_kg: number | null;
  vo2max_est: number | null;
  valid: number;
  flags_json: string;
  result_json: string;
  applied_at: string | null;
};

/**
 * One row per fitness-test session. The headline numbers get their own columns
 * for listing and trends; result_json keeps the whole analysis so the rules can
 * change later without losing what a rider was shown.
 */
export class FitnessTestsRepository extends BaseRepository {
  create(input: {
    id: string;
    sessionId: string;
    variant: string;
    takenAt: string;
    mapSeedWatts: number | null;
    mapWatts: number | null;
    ftpRampWatts: number | null;
    ftpCappedWatts: number | null;
    ftpWatts: number | null;
    thresholdHrBpm: number | null;
    maxHrBpm: number | null;
    hrCapBpm: number | null;
    weightKg: number | null;
    vo2maxEst: number | null;
    valid: boolean;
    flagsJson: string;
    resultJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO fitness_tests
         (id, session_id, variant, taken_at, map_seed_watts, map_watts, ftp_ramp_watts, ftp_capped_watts, ftp_watts,
          threshold_hr_bpm, max_hr_bpm, hr_cap_bpm, weight_kg, vo2max_est, valid, flags_json, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.sessionId,
        input.variant,
        input.takenAt,
        input.mapSeedWatts,
        input.mapWatts,
        input.ftpRampWatts,
        input.ftpCappedWatts,
        input.ftpWatts,
        input.thresholdHrBpm,
        input.maxHrBpm,
        input.hrCapBpm,
        input.weightKg,
        input.vo2maxEst,
        input.valid ? 1 : 0,
        input.flagsJson,
        input.resultJson
      );
  }

  getById(id: string): FitnessTestRow | undefined {
    return this.db.prepare("SELECT * FROM fitness_tests WHERE id = ?").get(id) as FitnessTestRow | undefined;
  }

  getBySessionId(sessionId: string): FitnessTestRow | undefined {
    return this.db.prepare("SELECT * FROM fitness_tests WHERE session_id = ?").get(sessionId) as FitnessTestRow | undefined;
  }

  /** Newest first. */
  list(limit: number): FitnessTestRow[] {
    return this.db
      .prepare("SELECT * FROM fitness_tests ORDER BY taken_at DESC, rowid DESC LIMIT ?")
      .all(limit) as FitnessTestRow[];
  }

  /** The most recent valid test taken before `beforeTakenAt` (or ever, when omitted): the baseline for trends. */
  getLatestValid(beforeTakenAt?: string): FitnessTestRow | undefined {
    return (
      beforeTakenAt
        ? this.db
            .prepare("SELECT * FROM fitness_tests WHERE valid = 1 AND taken_at < ? ORDER BY taken_at DESC, rowid DESC LIMIT 1")
            .get(beforeTakenAt)
        : this.db.prepare("SELECT * FROM fitness_tests WHERE valid = 1 ORDER BY taken_at DESC, rowid DESC LIMIT 1").get()
    ) as FitnessTestRow | undefined;
  }

  markApplied(id: string, appliedAt: string): void {
    this.db
      .prepare("UPDATE fitness_tests SET applied_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(appliedAt, id);
  }
}

export class StravaSyncEventsRepository extends BaseRepository {
  list(): Row[] {
    return this.db.prepare("SELECT * FROM strava_sync_events ORDER BY attempted_at DESC").all() as Row[];
  }

  create(input: {
    id: string;
    eventType: string;
    syncStatus: string;
    stravaActivityId: string | null;
    sessionId: string | null;
    payloadJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO strava_sync_events
         (id, event_type, sync_status, strava_activity_id, session_id, payload_json, attempted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        input.id,
        input.eventType,
        input.syncStatus,
        input.stravaActivityId,
        input.sessionId,
        input.payloadJson
      );
  }

  updateResult(input: {
    id: string;
    syncStatus: string;
    stravaActivityId: string | null;
    payloadJson: string;
  }): void {
    this.db
      .prepare(
        `UPDATE strava_sync_events
         SET sync_status = ?, strava_activity_id = ?, payload_json = ?, attempted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(input.syncStatus, input.stravaActivityId, input.payloadJson, input.id);
  }

  getById(eventId: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT id, event_type, sync_status, strava_activity_id, session_id, payload_json, attempted_at, created_at, updated_at
         FROM strava_sync_events WHERE id = ?`
      )
      .get(eventId) as Row | undefined;
  }

  listRecent(limit: number): Row[] {
    return this.db
      .prepare(
        `SELECT id, event_type, sync_status, strava_activity_id, session_id, payload_json, attempted_at, created_at, updated_at
         FROM strava_sync_events
         ORDER BY attempted_at DESC
         LIMIT ?`
      )
      .all(limit) as Row[];
  }

  listSuccessfulSessionIds(): Row[] {
    return this.db
      .prepare(
        `SELECT DISTINCT session_id
         FROM strava_sync_events
         WHERE event_type = 'upload' AND sync_status = 'success' AND session_id IS NOT NULL`
      )
      .all() as Row[];
  }

  countByStatus(syncStatus: string): number {
    const row = this.db
      .prepare("SELECT COUNT(1) AS count FROM strava_sync_events WHERE sync_status = ?")
      .get(syncStatus) as { count: number };
    return row.count;
  }
}

export class StravaTokensRepository extends BaseRepository {
  getToken(): Row | undefined {
    return this.db
      .prepare("SELECT id, encrypted_payload, created_at, updated_at FROM strava_tokens WHERE id = 'default'")
      .get() as Row | undefined;
  }

  upsertToken(encryptedPayload: string): void {
    this.db
      .prepare(
        `INSERT INTO strava_tokens (id, encrypted_payload, created_at, updated_at)
         VALUES ('default', ?, datetime('now'), datetime('now'))
         ON CONFLICT(id)
         DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = datetime('now')`
      )
      .run(encryptedPayload);
  }

  clearToken(): void {
    this.db.prepare("DELETE FROM strava_tokens WHERE id = 'default'").run();
  }
}

// Singleton row, same pattern as StravaTokensRepository: one profile per
// installed app, no multi-user concept anywhere else in the codebase either.
export class ProfileRepository extends BaseRepository {
  get(): Row | undefined {
    return this.db.prepare("SELECT * FROM user_profile WHERE id = 'default'").get() as Row | undefined;
  }

  // Partial by *omission*, not by value: onboarding writes these fields from
  // separate steps (FTP, then About-you), and ProfilePage later writes all
  // of them from one form where clearing an input is a real, intended edit.
  // Those need different behavior for the same call — a key left out of
  // `input` must keep its existing value, while a key present with `null`
  // must actually clear the column — so this only touches columns whose
  // field key is present on `input` (checked with `in`, not `??`, since
  // `undefined` and "omitted" must not be conflated with "explicitly null").
  upsert(input: {
    name?: string | null;
    email?: string | null;
    ftpWatts?: number | null;
    weightKg?: number | null;
    mapWatts?: number | null;
    thresholdHrBpm?: number | null;
    maxHrBpm?: number | null;
  }): void {
    const columnByField: Array<[keyof typeof input, string]> = [
      ["name", "name"],
      ["email", "email"],
      ["ftpWatts", "ftp_watts"],
      ["weightKg", "weight_kg"],
      ["mapWatts", "map_watts"],
      ["thresholdHrBpm", "threshold_hr_bpm"],
      ["maxHrBpm", "max_hr_bpm"]
    ];
    const provided = columnByField.filter(([field]) => field in input);

    if (!this.get()) {
      const values = new Map(provided.map(([field, column]) => [column, input[field] ?? null]));
      const columns = columnByField.map(([, column]) => column);
      this.db
        .prepare(
          `INSERT INTO user_profile (id, ${columns.join(", ")}, created_at, updated_at)
           VALUES ('default', ${columns.map(() => "?").join(", ")}, datetime('now'), datetime('now'))`
        )
        .run(...columns.map((column) => values.get(column) ?? null));
      return;
    }

    if (provided.length === 0) return;
    const setClause = provided.map(([, column]) => `${column} = ?`).join(", ");
    const values = provided.map(([field]) => input[field] ?? null);
    this.db
      .prepare(`UPDATE user_profile SET ${setClause}, updated_at = datetime('now') WHERE id = 'default'`)
      .run(...values);
  }

  completeOnboarding(): void {
    this.db
      .prepare(
        `INSERT INTO user_profile (id, onboarding_completed_at, created_at, updated_at)
         VALUES ('default', datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           onboarding_completed_at = datetime('now'),
           updated_at = datetime('now')`
      )
      .run();
  }
}

export class BleStateTransitionsRepository extends BaseRepository {
  recordTransition(input: {
    fromState: string;
    toState: string;
    reason: string;
    deviceId: string | null;
  }): void {
    this.db
      .prepare(
        "INSERT INTO ble_state_transitions (from_state, to_state, reason, device_id) VALUES (?, ?, ?, ?)"
      )
      .run(input.fromState, input.toState, input.reason, input.deviceId);
  }

  listRecent(limit = 50): Row[] {
    return this.db
      .prepare("SELECT * FROM ble_state_transitions ORDER BY id DESC LIMIT ?")
      .all(limit) as Row[];
  }
}

export class PlanVersionsRepository extends BaseRepository {
  listByPlan(planId: string): Row[] {
    return this.db
      .prepare(
        `SELECT id, plan_id, version_number, source, reason, input_json, snapshot_json, created_at
         FROM plan_versions
         WHERE plan_id = ?
         ORDER BY version_number DESC`
      )
      .all(planId) as Row[];
  }

  getById(versionId: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT id, plan_id, version_number, source, reason, input_json, snapshot_json, created_at
         FROM plan_versions
         WHERE id = ?`
      )
      .get(versionId) as Row | undefined;
  }

  getLatestByPlan(planId: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT id, plan_id, version_number, source, reason, input_json, snapshot_json, created_at
         FROM plan_versions
         WHERE plan_id = ?
         ORDER BY version_number DESC
         LIMIT 1`
      )
      .get(planId) as Row | undefined;
  }

  create(input: {
    id: string;
    planId: string;
    versionNumber: number;
    source: string;
    reason: string;
    inputJson: string;
    snapshotJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO plan_versions
         (id, plan_id, version_number, source, reason, input_json, snapshot_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.planId,
        input.versionNumber,
        input.source,
        input.reason,
        input.inputJson,
        input.snapshotJson
      );
  }
}

export class PlanAuditEntriesRepository extends BaseRepository {
  listByPlan(planId: string): Row[] {
    return this.db
      .prepare(
        `SELECT id, plan_id, plan_version_id, action_type, source, reason, metadata_json, created_at
         FROM plan_audit_entries
         WHERE plan_id = ?
         ORDER BY created_at DESC`
      )
      .all(planId) as Row[];
  }

  create(input: {
    id: string;
    planId: string;
    planVersionId: string | null;
    actionType: string;
    source: string;
    reason: string;
    metadataJson: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO plan_audit_entries
         (id, plan_id, plan_version_id, action_type, source, reason, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.planId,
        input.planVersionId,
        input.actionType,
        input.source,
        input.reason,
        input.metadataJson
      );
  }
}

export class WorkoutBankRepository extends BaseRepository {
  private readonly columns =
    "id, name, primary_zone, discipline, tags_json, phases_json, duration_seconds, est_if, est_tss, document_json, source, archived, created_at, updated_at";

  list(filter?: {
    zone?: string;
    tag?: string;
    phase?: string;
    discipline?: string;
    maxDurationSec?: number;
    includeArchived?: boolean;
  }): Row[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!filter?.includeArchived) {
      clauses.push("archived = 0");
    }
    if (filter?.zone) {
      clauses.push("primary_zone = ?");
      params.push(filter.zone);
    }
    if (filter?.discipline) {
      clauses.push("discipline = ?");
      params.push(filter.discipline);
    }
    if (filter?.maxDurationSec != null) {
      clauses.push("duration_seconds <= ?");
      params.push(filter.maxDurationSec);
    }
    if (filter?.tag) {
      // tags_json is a JSON array of strings; match the quoted token.
      clauses.push("tags_json LIKE ?");
      params.push(`%${JSON.stringify(filter.tag)}%`);
    }
    if (filter?.phase) {
      clauses.push("phases_json LIKE ?");
      params.push(`%${JSON.stringify(filter.phase)}%`);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT ${this.columns} FROM workout_bank${where} ORDER BY name ASC`)
      .all(...params) as Row[];
  }

  getById(id: string): Row | undefined {
    return this.db
      .prepare(`SELECT ${this.columns} FROM workout_bank WHERE id = ?`)
      .get(id) as Row | undefined;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(1) AS count FROM workout_bank").get() as { count: number };
    return row.count;
  }

  create(input: {
    id: string;
    name: string;
    primaryZone: string;
    discipline: string;
    tagsJson: string;
    phasesJson: string;
    durationSeconds: number;
    estIf: number | null;
    estTss: number | null;
    documentJson: string;
    source: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO workout_bank
         (id, name, primary_zone, discipline, tags_json, phases_json, duration_seconds, est_if, est_tss, document_json, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.primaryZone,
        input.discipline,
        input.tagsJson,
        input.phasesJson,
        input.durationSeconds,
        input.estIf,
        input.estTss,
        input.documentJson,
        input.source
      );
  }

  update(input: {
    id: string;
    name: string;
    primaryZone: string;
    discipline: string;
    tagsJson: string;
    phasesJson: string;
    durationSeconds: number;
    estIf: number | null;
    estTss: number | null;
    documentJson: string;
  }): void {
    this.db
      .prepare(
        `UPDATE workout_bank
         SET name = ?, primary_zone = ?, discipline = ?, tags_json = ?, phases_json = ?,
             duration_seconds = ?, est_if = ?, est_tss = ?, document_json = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        input.name,
        input.primaryZone,
        input.discipline,
        input.tagsJson,
        input.phasesJson,
        input.durationSeconds,
        input.estIf,
        input.estTss,
        input.documentJson,
        input.id
      );
  }

  setArchived(id: string, archived: boolean): void {
    this.db
      .prepare("UPDATE workout_bank SET archived = ?, updated_at = datetime('now') WHERE id = ?")
      .run(archived ? 1 : 0, id);
  }
}

export class Repositories {
  private readonly db: Database;
  public readonly devices: DevicesRepository;
  public readonly workouts: WorkoutsRepository;
  public readonly workoutIntervals: WorkoutIntervalsRepository;
  public readonly workoutSessions: WorkoutSessionsRepository;
  public readonly workoutSessionEvents: WorkoutSessionEventsRepository;
  public readonly workoutSessionTelemetry: WorkoutSessionTelemetryRepository;
  public readonly trainingPlans: TrainingPlansRepository;
  public readonly planWeeks: PlanWeeksRepository;
  public readonly planWeekWorkouts: PlanWeekWorkoutsRepository;
  public readonly goals: GoalsRepository;
  public readonly metricsSnapshots: MetricsSnapshotsRepository;
  public readonly stravaSyncEvents: StravaSyncEventsRepository;
  public readonly stravaTokens: StravaTokensRepository;
  public readonly profile: ProfileRepository;
  public readonly bleStateTransitions: BleStateTransitionsRepository;
  public readonly planVersions: PlanVersionsRepository;
  public readonly planAuditEntries: PlanAuditEntriesRepository;
  public readonly workoutBank: WorkoutBankRepository;
  public readonly fitnessTests: FitnessTestsRepository;

  constructor(db: Database) {
    this.db = db;
    this.devices = new DevicesRepository(db);
    this.workouts = new WorkoutsRepository(db);
    this.workoutIntervals = new WorkoutIntervalsRepository(db);
    this.workoutSessions = new WorkoutSessionsRepository(db);
    this.workoutSessionEvents = new WorkoutSessionEventsRepository(db);
    this.workoutSessionTelemetry = new WorkoutSessionTelemetryRepository(db);
    this.trainingPlans = new TrainingPlansRepository(db);
    this.planWeeks = new PlanWeeksRepository(db);
    this.planWeekWorkouts = new PlanWeekWorkoutsRepository(db);
    this.goals = new GoalsRepository(db);
    this.metricsSnapshots = new MetricsSnapshotsRepository(db);
    this.stravaSyncEvents = new StravaSyncEventsRepository(db);
    this.stravaTokens = new StravaTokensRepository(db);
    this.profile = new ProfileRepository(db);
    this.bleStateTransitions = new BleStateTransitionsRepository(db);
    this.planVersions = new PlanVersionsRepository(db);
    this.planAuditEntries = new PlanAuditEntriesRepository(db);
    this.workoutBank = new WorkoutBankRepository(db);
    this.fitnessTests = new FitnessTestsRepository(db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
