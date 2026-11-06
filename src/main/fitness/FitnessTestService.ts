import { randomUUID } from "node:crypto";
import type { FitnessTestRow, Repositories } from "@main/database/repositories";
import type { ProfileService } from "@main/profile/ProfileService";
import { analyzeFitnessTest, type FitnessTestBaseline, type FitnessTestResult, type FitnessTestSample } from "@shared/fitnessTest";
import { phaseAt, type FitnessTestPhaseRange } from "@shared/fitnessTestProtocol";
import type {
  ApplyFitnessTestRequest,
  ApplyFitnessTestResult,
  FitnessTestRecord,
  UpdateProfileRequest
} from "@shared/ipc/contracts";

/** What FitnessTestController saved in the "fitness-test-started" event. */
type StartedPayload = {
  variant: "full" | "quick";
  phases: FitnessTestPhaseRange[];
  mapSeedWatts: number;
  rampStepSec: number;
  rampStepCount: number;
};

const activeStatuses = new Set(["running", "paused"]);

/** Profile bounds (contracts.userProfileSchema); a result outside them can't be applied. */
const bounds = {
  ftp: [100, 600],
  map: [100, 1000],
  thresholdHr: [80, 220],
  maxHr: [100, 230]
} as const;

const toRecord = (row: FitnessTestRow): FitnessTestRecord => ({
  id: row.id,
  sessionId: row.session_id,
  takenAt: row.taken_at,
  appliedAt: row.applied_at,
  result: JSON.parse(row.result_json) as FitnessTestResult
});

/**
 * Scores a finished fitness-test ride and applies the result to the profile.
 * Scoring is read-only over the saved session — telemetry positions plus the
 * controller's events — so it can run (once; the row is then cached) any
 * time after the ride ends.
 */
export class FitnessTestService {
  constructor(
    private readonly repositories: Repositories,
    private readonly profileService: ProfileService
  ) {}

  /** The scored result for a test session, scoring it on first request. */
  getOrScore(sessionId: string): FitnessTestRecord {
    const existing = this.repositories.fitnessTests.getBySessionId(sessionId);
    if (existing) return toRecord(existing);

    const session = this.repositories.workoutSessions.getById(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (activeStatuses.has(String(session.status))) {
      throw new Error("The test is still running; results are ready once the ride ends.");
    }

    const events = this.repositories.workoutSessionEvents.listBySession(sessionId);
    const payloadOf = (eventType: string): Record<string, unknown> | null => {
      const matches = events.filter((event) => event.eventType === eventType);
      return matches.length > 0 ? (JSON.parse(matches[matches.length - 1].payloadJson) as Record<string, unknown>) : null;
    };
    const started = payloadOf("fitness-test-started") as StartedPayload | null;
    if (!started) throw new Error("This ride isn't a fitness test.");
    const rampEnded = payloadOf("fitness-test-ramp-ended");
    const downgraded = payloadOf("fitness-test-downgraded") !== null;

    const samples = this.samplesFor(sessionId, started.phases);
    const profile = this.profileService.getProfile();
    const takenAt = String(session.started_at);
    const result = analyzeFitnessTest({
      variant: downgraded ? "quick" : started.variant,
      samples,
      rampStepCount: started.rampStepCount,
      rampStepSec: started.rampStepSec,
      mapSeedWatts: started.mapSeedWatts,
      hrCapBpm: typeof rampEnded?.hrCapBpm === "number" ? rampEnded.hrCapBpm : null,
      weightKg: profile.weightKg,
      previous: this.baselineBefore(takenAt)
    });

    const id = randomUUID();
    this.repositories.fitnessTests.create({
      id,
      sessionId,
      variant: result.variant,
      takenAt,
      mapSeedWatts: started.mapSeedWatts,
      mapWatts: result.mapWatts,
      ftpRampWatts: result.ftpRampWatts,
      ftpCappedWatts: result.ftpCappedWatts,
      ftpWatts: result.ftpWatts,
      thresholdHrBpm: result.thresholdHrBpm,
      maxHrBpm: result.maxHrBpm,
      hrCapBpm: result.hrCapBpm,
      weightKg: profile.weightKg,
      vo2maxEst: result.vo2maxEst,
      valid: result.valid,
      flagsJson: JSON.stringify(result.flags),
      resultJson: JSON.stringify(result)
    });
    return toRecord(this.repositories.fitnessTests.getById(id)!);
  }

  list(limit = 20): FitnessTestRecord[] {
    return this.repositories.fitnessTests.list(limit).map(toRecord);
  }

  /** Write the chosen metrics to the profile, snapshot them for trends, and mark the test applied. */
  apply(request: ApplyFitnessTestRequest): ApplyFitnessTestResult {
    const row = this.repositories.fitnessTests.getById(request.testId);
    if (!row) throw new Error("Fitness test not found");
    if (!row.valid) throw new Error("This test didn't produce a valid result, so it can't be applied.");

    const current = this.profileService.getProfile();
    const update: UpdateProfileRequest = {};
    const take = (
      key: keyof typeof bounds,
      value: number | null,
      field: "ftpWatts" | "mapWatts" | "thresholdHrBpm" | "maxHrBpm"
    ) => {
      if (value === null) return;
      const [min, max] = bounds[key];
      if (value < min || value > max) {
        throw new Error(`The measured ${key} (${value}) is outside what a profile can hold (${min}–${max}).`);
      }
      update[field] = value;
    };
    if (request.apply.ftp) take("ftp", row.ftp_watts, "ftpWatts");
    if (request.apply.map) take("map", row.map_watts, "mapWatts");
    if (request.apply.thresholdHr) take("thresholdHr", row.threshold_hr_bpm, "thresholdHrBpm");
    // A test only shows how high HR went that day, so it can raise max HR but never lower it.
    if (request.apply.maxHr && row.max_hr_bpm !== null && (current.maxHrBpm === null || row.max_hr_bpm > current.maxHrBpm)) {
      take("maxHr", row.max_hr_bpm, "maxHrBpm");
    }
    if (Object.keys(update).length === 0) throw new Error("Nothing selected to apply.");

    const appliedAt = new Date().toISOString();
    const profile = this.repositories.transaction(() => {
      const updated = this.profileService.updateProfile(update);
      this.repositories.fitnessTests.markApplied(row.id, appliedAt);
      this.repositories.metricsSnapshots.create({
        id: randomUUID(),
        capturedAt: appliedAt,
        ftpWatts: updated.ftpWatts,
        weightKg: updated.weightKg,
        vo2max: row.vo2max_est,
        metadataJson: JSON.stringify({ source: "fitness-test", fitnessTestId: row.id, applied: Object.keys(update) })
      });
      return updated;
    });
    return { profile, record: toRecord(this.repositories.fitnessTests.getById(row.id)!) };
  }

  /** One sample per ride second (last write wins), tagged with the phase at its workout position. */
  private samplesFor(sessionId: string, phases: FitnessTestPhaseRange[]): FitnessTestSample[] {
    const bySecond = new Map<number, ReturnType<Repositories["workoutSessionTelemetry"]["getPositionedSamples"]>[number]>();
    for (const row of this.repositories.workoutSessionTelemetry.getPositionedSamples(sessionId)) {
      bySecond.set(row.elapsedSec, row);
    }
    const samples: FitnessTestSample[] = [];
    for (const row of [...bySecond.values()].sort((a, b) => a.elapsedSec - b.elapsedSec)) {
      const range = phaseAt(phases, row.positionSec ?? row.elapsedSec);
      if (!range) continue;
      samples.push({
        phase: range.phase,
        powerWatts: row.actualPowerWatts,
        heartRateBpm: row.actualHeartRateBpm,
        cadenceRpm: row.actualCadenceRpm
      });
    }
    return samples;
  }

  /** The last valid test before this one; failing that, what the profile held (if it has an FTP). */
  private baselineBefore(takenAt: string): FitnessTestBaseline | null {
    const previous = this.repositories.fitnessTests.getLatestValid(takenAt);
    if (previous) {
      return { mapWatts: previous.map_watts, ftpWatts: previous.ftp_watts, thresholdHrBpm: previous.threshold_hr_bpm };
    }
    const profile = this.profileService.getProfile();
    return profile.ftpWatts !== null
      ? { mapWatts: profile.mapWatts, ftpWatts: profile.ftpWatts, thresholdHrBpm: profile.thresholdHrBpm }
      : null;
  }
}
