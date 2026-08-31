import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { WorkoutLibraryService } from "@main/workout/WorkoutLibraryService";

describe("WorkoutLibraryService.getWorkoutDetail", () => {
  let db: Database.Database;
  let service: WorkoutLibraryService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    service = new WorkoutLibraryService(new Repositories(db));
  });

  afterEach(() => {
    db.close();
  });

  it("round-trips ramp end watts and cadence targets (not just the flat fields)", () => {
    const { workoutId } = service.createWorkout({
      name: "Ramp + cadence",
      source: "manual-builder",
      intensityFactor: 0.7,
      intervals: [
        {
          kind: "warmup",
          durationSec: 600,
          targetPowerWatts: 120,
          targetPowerWattsEnd: 190,
          targetResistancePercent: null,
          targetCadenceRpm: 90
        },
        {
          kind: "work",
          durationSec: 300,
          targetPowerWatts: 240,
          targetPowerWattsEnd: null,
          targetResistancePercent: null,
          targetCadenceRpm: null
        }
      ]
    });

    const { intervals } = service.getWorkoutDetail(workoutId);

    expect(intervals[0]).toMatchObject({
      kind: "warmup",
      targetPowerWatts: 120,
      targetPowerWattsEnd: 190,
      targetCadenceRpm: 90
    });
    expect(intervals[1]).toMatchObject({
      targetPowerWatts: 240,
      targetPowerWattsEnd: null,
      targetCadenceRpm: null
    });
  });
});
