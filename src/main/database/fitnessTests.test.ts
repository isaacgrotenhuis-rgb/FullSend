import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { ProfileService } from "@main/profile/ProfileService";

describe("fitness test storage", () => {
  let db: Database.Database;
  let repos: Repositories;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    repos = new Repositories(db);
  });

  afterEach(() => {
    db.close();
  });

  const addSession = (id: string): void => {
    repos.workoutSessions.create({
      id,
      workoutId: null,
      deviceId: null,
      startedAt: "2026-11-05T10:00:00Z",
      status: "completed",
      summaryJson: "{}"
    });
  };

  const addTest = (id: string, sessionId: string, takenAt: string, valid: boolean, ftpWatts: number): void =>
    repos.fitnessTests.create({
      id,
      sessionId,
      variant: "full",
      takenAt,
      mapSeedWatts: 333,
      mapWatts: 335,
      ftpRampWatts: 251,
      ftpCappedWatts: ftpWatts,
      ftpWatts,
      thresholdHrBpm: 165,
      maxHrBpm: 190,
      hrCapBpm: 171,
      weightKg: 75,
      vo2maxEst: 55.2,
      valid,
      flagsJson: "[]",
      resultJson: "{}"
    });

  it("stores MAP, threshold HR and max HR on the profile, and leaves omitted fields alone", () => {
    const profile = new ProfileService(repos);
    profile.updateProfile({ ftpWatts: 250, mapWatts: 335 });
    profile.updateProfile({ thresholdHrBpm: 165, maxHrBpm: 190 });
    expect(profile.getProfile()).toMatchObject({ ftpWatts: 250, mapWatts: 335, thresholdHrBpm: 165, maxHrBpm: 190 });

    profile.updateProfile({ mapWatts: null });
    expect(profile.getProfile()).toMatchObject({ ftpWatts: 250, mapWatts: null, thresholdHrBpm: 165 });
  });

  it("lists tests newest first, finds the latest valid baseline, and records an apply", () => {
    addSession("s1");
    addSession("s2");
    addSession("s3");
    addTest("t1", "s1", "2026-09-01T10:00:00Z", true, 250);
    addTest("t2", "s2", "2026-10-01T10:00:00Z", true, 258);
    addTest("t3", "s3", "2026-11-01T10:00:00Z", false, 270);

    expect(repos.fitnessTests.list(10).map((row) => row.id)).toEqual(["t3", "t2", "t1"]);
    expect(repos.fitnessTests.getLatestValid()?.id).toBe("t2");
    expect(repos.fitnessTests.getLatestValid("2026-10-01T10:00:00Z")?.id).toBe("t1");
    expect(repos.fitnessTests.getBySessionId("s2")?.ftp_watts).toBe(258);

    repos.fitnessTests.markApplied("t2", "2026-10-01T11:00:00Z");
    expect(repos.fitnessTests.getById("t2")?.applied_at).toBe("2026-10-01T11:00:00Z");
  });

  it("goes away with its session when the ride is discarded", () => {
    addSession("s1");
    addTest("t1", "s1", "2026-11-01T10:00:00Z", true, 250);
    repos.workoutSessions.deleteById("s1");
    expect(repos.fitnessTests.getById("t1")).toBeUndefined();
  });
});
