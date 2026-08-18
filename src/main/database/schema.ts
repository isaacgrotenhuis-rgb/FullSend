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
};
