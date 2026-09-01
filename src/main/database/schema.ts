import type { Database } from "better-sqlite3";

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT,
    manufacturer TEXT,
    serial_number TEXT,
    last_seen_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    intensity_factor REAL,
    duration_seconds INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS workout_intervals (
    id TEXT PRIMARY KEY,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    interval_index INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'work',
    target_power_watts REAL,
    target_resistance_percent REAL,
    target_cadence_rpm REAL,
    duration_seconds INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS workout_sessions (
    id TEXT PRIMARY KEY,
    workout_id TEXT REFERENCES workouts(id),
    device_id TEXT REFERENCES devices(id),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS workout_session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS workout_session_telemetry (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    elapsed_seconds INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    block_index INTEGER NOT NULL,
    target_power_watts REAL,
    target_resistance_percent REAL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS training_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_weeks (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    week_index INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_week_workouts (
    id TEXT PRIMARY KEY,
    plan_week_id TEXT NOT NULL REFERENCES plan_weeks(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(plan_week_id, day_index)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_week_assignments (
    id TEXT PRIMARY KEY,
    plan_week_id TEXT NOT NULL REFERENCES plan_weeks(id) ON DELETE CASCADE,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(plan_week_id, workout_id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_versions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(plan_id, version_number)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_audit_entries (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    plan_version_id TEXT REFERENCES plan_versions(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    goal_type TEXT NOT NULL,
    target_value REAL,
    target_date TEXT,
    status TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id TEXT PRIMARY KEY,
    captured_at TEXT NOT NULL,
    ftp_watts REAL,
    weight_kg REAL,
    resting_hr INTEGER,
    vo2max REAL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS strava_sync_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    sync_status TEXT NOT NULL,
    strava_activity_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS strava_tokens (
    id TEXT PRIMARY KEY,
    encrypted_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS ble_state_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    device_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `
  ,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_intervals_workout_order
  ON workout_intervals(workout_id, interval_index);
  `,
  `
  CREATE TABLE IF NOT EXISTS workout_bank (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    primary_zone     TEXT NOT NULL,
    discipline       TEXT NOT NULL DEFAULT 'cycling',
    tags_json        TEXT NOT NULL DEFAULT '[]',
    phases_json      TEXT NOT NULL DEFAULT '[]',
    duration_seconds INTEGER NOT NULL,
    est_if           REAL,
    est_tss          REAL,
    document_json    TEXT NOT NULL,
    source           TEXT NOT NULL DEFAULT 'seed',
    archived         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_workout_bank_zone ON workout_bank(primary_zone, archived);
  `,
  `
  CREATE TABLE IF NOT EXISTS plan_day_workouts (
    id               TEXT PRIMARY KEY,
    plan_id          TEXT NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    week_index       INTEGER NOT NULL,
    day_index        INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
    workout_id       TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    bank_workout_id  TEXT,
    workout_name     TEXT NOT NULL,
    session_type     TEXT,
    duration_seconds INTEGER NOT NULL,
    intensity_factor REAL,
    mode             TEXT NOT NULL DEFAULT 'add',
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_plan_day_workouts_cell
  ON plan_day_workouts(plan_id, week_index, day_index);
  `
];

export const applySchema = (db: Database): void => {
  for (const migration of migrations) {
    db.exec(migration);
  }

  const intervalColumns = db
    .prepare("SELECT name FROM pragma_table_info('workout_intervals')")
    .all() as Array<{ name: string }>;
  const intervalColumnNames = new Set(intervalColumns.map((column) => column.name));
  if (!intervalColumnNames.has("kind")) {
    db.exec("ALTER TABLE workout_intervals ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';");
  }
  if (!intervalColumnNames.has("target_resistance_percent")) {
    db.exec("ALTER TABLE workout_intervals ADD COLUMN target_resistance_percent REAL;");
  }
  if (!intervalColumnNames.has("target_power_watts_end")) {
    db.exec("ALTER TABLE workout_intervals ADD COLUMN target_power_watts_end REAL;");
  }

  const workoutColumns = db
    .prepare("SELECT name FROM pragma_table_info('workouts')")
    .all() as Array<{ name: string }>;
  const workoutColumnNames = new Set(workoutColumns.map((column) => column.name));
  if (!workoutColumnNames.has("bank_workout_id")) {
    db.exec("ALTER TABLE workouts ADD COLUMN bank_workout_id TEXT REFERENCES workout_bank(id);");
  }
  if (!workoutColumnNames.has("compiled_at_ftp")) {
    db.exec("ALTER TABLE workouts ADD COLUMN compiled_at_ftp INTEGER;");
  }

  const telemetryColumnsForCadence = db
    .prepare("SELECT name FROM pragma_table_info('workout_session_telemetry')")
    .all() as Array<{ name: string }>;
  if (!new Set(telemetryColumnsForCadence.map((column) => column.name)).has("target_cadence_rpm")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN target_cadence_rpm REAL;");
  }

  const stravaSyncColumns = db
    .prepare("SELECT name FROM pragma_table_info('strava_sync_events')")
    .all() as Array<{ name: string }>;
  const stravaSyncColumnNames = new Set(stravaSyncColumns.map((column) => column.name));
  if (!stravaSyncColumnNames.has("session_id")) {
    db.exec("ALTER TABLE strava_sync_events ADD COLUMN session_id TEXT;");
  }

  const telemetryColumns = db
    .prepare("SELECT name FROM pragma_table_info('workout_session_telemetry')")
    .all() as Array<{ name: string }>;
  const telemetryColumnNames = new Set(telemetryColumns.map((column) => column.name));
  if (!telemetryColumnNames.has("actual_power_watts")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN actual_power_watts REAL;");
  }
  if (!telemetryColumnNames.has("actual_cadence_rpm")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN actual_cadence_rpm REAL;");
  }
  if (!telemetryColumnNames.has("actual_heart_rate_bpm")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN actual_heart_rate_bpm REAL;");
  }
  if (!telemetryColumnNames.has("actual_speed_kmh")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN actual_speed_kmh REAL;");
  }
  if (!telemetryColumnNames.has("actual_distance_meters")) {
    db.exec("ALTER TABLE workout_session_telemetry ADD COLUMN actual_distance_meters REAL;");
  }

  // Optional back-pointer from a session to the plan day it was launched from.
  // Ride history / Strava / dashboard ignore these; only the plan read-merge uses them.
  const sessionColumns = db
    .prepare("SELECT name FROM pragma_table_info('workout_sessions')")
    .all() as Array<{ name: string }>;
  const sessionColumnNames = new Set(sessionColumns.map((column) => column.name));
  if (!sessionColumnNames.has("plan_id")) {
    db.exec("ALTER TABLE workout_sessions ADD COLUMN plan_id TEXT;");
  }
  if (!sessionColumnNames.has("plan_week_index")) {
    db.exec("ALTER TABLE workout_sessions ADD COLUMN plan_week_index INTEGER;");
  }
  if (!sessionColumnNames.has("plan_day_index")) {
    db.exec("ALTER TABLE workout_sessions ADD COLUMN plan_day_index INTEGER;");
  }
};
