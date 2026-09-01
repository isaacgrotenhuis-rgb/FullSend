import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { WorkoutBankService } from "@main/workout/WorkoutBankService";
import { deriveFswMetrics, type FswDocument } from "@shared/fsw";

const freerideOnly: FswDocument = {
  schemaVersion: 1,
  id: "skills-only",
  name: "Skills only",
  discipline: "cycling",
  primaryZone: "endurance",
  tags: ["skills"],
  phases: [],
  segments: [{ type: "freeride", durationSec: 3600 }]
};

describe("WorkoutBankService", () => {
  let db: Database.Database;
  let service: WorkoutBankService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    service = new WorkoutBankService(new Repositories(db));
  });

  afterEach(() => {
    db.close();
  });

  it("deriveMetrics matches the shared deriveFswMetrics (single source of truth)", () => {
    const doc: FswDocument = {
      schemaVersion: 1,
      id: "surge-check",
      name: "Surge check",
      discipline: "cycling",
      primaryZone: "threshold",
      tags: [],
      phases: [],
      segments: [
        { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.8 },
        {
          type: "intervals",
          repeat: 2,
          onDurationSec: 800,
          onPower: 0.9,
          offDurationSec: 300,
          offPower: 0.55,
          // 800 is not a multiple of everySec (150) -> trailing partial window.
          surges: { everySec: 150, durationSec: 20, power: 1.5 }
        },
        { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
      ]
    };
    const shared = deriveFswMetrics(doc);
    const derived = service.deriveMetrics(doc);
    expect(derived.durationSec).toBe(shared.durationSec);
    expect(derived.estTSS).toBe(shared.estTSS);
    expect(derived.estIF).toBeCloseTo(shared.estIF, 4);
  });

  it("stores and reads back an all-free-ride workout (estIF 0, no validation error)", () => {
    const { id } = service.createBankWorkout(freerideOnly, "seed");
    // toDetail re-parses document_json, which now carries "estIF": 0.
    const detail = service.getBankWorkout(id);
    expect(detail.estIF).toBe(0);
    expect(detail.estTSS).toBe(0);
    expect(detail.durationSec).toBe(3600);
    expect(detail.document.segments).toHaveLength(1);
  });

  it("compileAndPersist stamps preview metadata (description, tags, estTSS) on the compiled workout", () => {
    const doc: FswDocument = {
      schemaVersion: 1,
      id: "sst-2x10",
      name: "Sweet Spot 2x10",
      description: "Two sweet-spot blocks to build muscular endurance.",
      discipline: "cycling",
      primaryZone: "sweet-spot",
      tags: ["muscular-endurance"],
      phases: ["base"],
      segments: [
        { type: "warmup", durationSec: 300, powerLow: 0.5, powerHigh: 0.8 },
        {
          type: "intervals",
          repeat: 2,
          onDurationSec: 600,
          onPower: 0.9,
          offDurationSec: 180,
          offPower: 0.55
        }
      ]
    };
    service.createBankWorkout(doc, "seed");
    const { workoutId } = service.compileAndPersist({ bankWorkoutId: "sst-2x10", ftp: 250 });

    const row = db
      .prepare("SELECT metadata_json AS m FROM workouts WHERE id = ?")
      .get(workoutId) as { m: string };
    const metadata = JSON.parse(row.m) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      bankWorkoutId: "sst-2x10",
      primaryZone: "sweet-spot",
      description: "Two sweet-spot blocks to build muscular endurance.",
      tags: ["muscular-endurance"]
    });
    expect(typeof metadata.estTSS).toBe("number");
  });

  it("compileForFtp returns intervals without persisting, and scales targets with FTP", () => {
    const doc: FswDocument = {
      schemaVersion: 1,
      id: "steady-1x20",
      name: "Steady 1x20",
      discipline: "cycling",
      primaryZone: "threshold",
      tags: [],
      phases: [],
      segments: [{ type: "steady", durationSec: 1200, power: 1.0 }]
    };
    service.createBankWorkout(doc, "seed");

    const low = service.compileForFtp("steady-1x20", 200);
    const high = service.compileForFtp("steady-1x20", 300);

    expect(low.intervals.reduce((sum, i) => sum + i.durationSec, 0)).toBe(1200);
    expect(low.intervals[0].targetPowerWatts).toBe(200);
    expect(high.intervals[0].targetPowerWatts).toBe(300);
    // Nothing was written to the workouts table.
    expect((db.prepare("SELECT COUNT(*) AS n FROM workouts").get() as { n: number }).n).toBe(0);
  });
});
