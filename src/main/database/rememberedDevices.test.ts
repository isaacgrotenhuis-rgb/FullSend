import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";

describe("remembered devices", () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("keeps one device per role and its auto-connect choice", () => {
    db = new Database(":memory:");
    applySchema(db);
    const { devices } = new Repositories(db);

    devices.remember({ role: "power", deviceId: "old", name: "Old trainer", autoConnect: true });
    devices.remember({ role: "power", deviceId: "new", name: "KICKR CORE", autoConnect: true });
    devices.remember({ role: "heart_rate", deviceId: "hr", name: "HRM-Pro", autoConnect: true });
    devices.setAutoConnect("heart_rate", false);

    expect(devices.listRemembered()).toEqual(
      expect.arrayContaining([
        { role: "power", deviceId: "new", name: "KICKR CORE", autoConnect: true },
        { role: "heart_rate", deviceId: "hr", name: "HRM-Pro", autoConnect: false }
      ])
    );
    expect(devices.listRemembered()).toHaveLength(2);

    devices.forget("heart_rate");
    expect(devices.listRemembered().map((device) => device.role)).toEqual(["power"]);
  });

  it("remembers the last trainer from before auto-connect existed, once", () => {
    db = new Database(":memory:");
    // A database from before remembered_devices: devices already holds trainers.
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY, name TEXT, manufacturer TEXT, serial_number TEXT, last_seen_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO devices (id, name, last_seen_at) VALUES ('older', 'Old trainer', '2026-09-01 10:00:00');
      INSERT INTO devices (id, name, last_seen_at) VALUES ('latest', 'KICKR CORE', '2026-11-01 10:00:00');
    `);
    applySchema(db);
    const { devices } = new Repositories(db);
    expect(devices.listRemembered()).toEqual([
      { role: "power", deviceId: "latest", name: "KICKR CORE", autoConnect: true }
    ]);

    // Forgetting sticks across later launches.
    devices.forget("power");
    applySchema(db);
    expect(devices.listRemembered()).toEqual([]);
  });
});
