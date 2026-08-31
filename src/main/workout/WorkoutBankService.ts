import { randomUUID } from "node:crypto";
import type { Repositories } from "@main/database/repositories";
import { compile } from "@main/workout/WorkoutCompiler";
import { deriveFswMetrics } from "@shared/fsw";
import {
  fswDocumentSchema,
  type BankWorkoutDetail,
  type BankWorkoutFilter,
  type BankWorkoutSummary,
  type FswDocument,
  type TrainingPhase,
  type TrainingZone,
  type WorkoutInterval
} from "@shared/ipc/contracts";

type BankRow = {
  id: string;
  name: string;
  primary_zone: string;
  discipline: string;
  tags_json: string;
  phases_json: string;
  duration_seconds: number;
  est_if: number | null;
  est_tss: number | null;
  document_json: string;
  source: string;
  archived: number;
  created_at: string;
  updated_at: string;
};

export type DerivedMetrics = {
  durationSec: number;
  estIF: number;
  estTSS: number;
};

export type SelectForPlanDayInput = {
  zone: TrainingZone;
  phase: TrainingPhase;
  targetDurationMin: number;
  discipline?: string;
  excludeIds?: string[];
};

export class WorkoutBankService {
  constructor(private readonly repositories: Repositories) {}

  private toSummary(row: BankRow): BankWorkoutSummary {
    return {
      id: row.id,
      name: row.name,
      primaryZone: row.primary_zone as TrainingZone,
      discipline: row.discipline,
      tags: JSON.parse(row.tags_json) as string[],
      phases: JSON.parse(row.phases_json) as TrainingPhase[],
      durationSec: row.duration_seconds,
      estIF: row.est_if,
      estTSS: row.est_tss,
      source: row.source,
      archived: row.archived === 1
    };
  }

  private toDetail(row: BankRow): BankWorkoutDetail {
    return {
      ...this.toSummary(row),
      document: fswDocumentSchema.parse(JSON.parse(row.document_json))
    };
  }

  /**
   * Duration + relative intensity metrics derived from the document (doc §3.3).
   * Delegates to `deriveFswMetrics` (@shared/fsw) so the bank's stored est_if /
   * est_tss match the values the seed test and any client compute. Free-ride time
   * carries no power target and is excluded from estIF (estIF is 0 for an
   * all-free-ride document).
   */
  deriveMetrics(document: FswDocument): DerivedMetrics {
    const metrics = deriveFswMetrics(document);
    return {
      durationSec: metrics.durationSec,
      estIF: Number(metrics.estIF.toFixed(4)),
      estTSS: metrics.estTSS
    };
  }

  listBankWorkouts(filter?: BankWorkoutFilter): BankWorkoutSummary[] {
    const rows = this.repositories.workoutBank.list({
      zone: filter?.zone,
      tag: filter?.tag,
      phase: filter?.phase,
      discipline: filter?.discipline,
      maxDurationSec: filter?.maxDurationMin != null ? filter.maxDurationMin * 60 : undefined,
      includeArchived: filter?.includeArchived
    }) as BankRow[];
    return rows.map((row) => this.toSummary(row));
  }

  getBankWorkout(id: string): BankWorkoutDetail {
    const row = this.repositories.workoutBank.getById(id) as BankRow | undefined;
    if (!row) {
      throw new Error(`Bank workout not found: ${id}`);
    }
    return this.toDetail(row);
  }

  createBankWorkout(rawDocument: unknown, source = "user"): { id: string } {
    const document = fswDocumentSchema.parse(rawDocument);
    const metrics = this.deriveMetrics(document);
    const stored: FswDocument = {
      ...document,
      durationSec: metrics.durationSec,
      estIF: metrics.estIF,
      estTSS: metrics.estTSS
    };
    this.repositories.workoutBank.create({
      id: document.id,
      name: document.name,
      primaryZone: document.primaryZone,
      discipline: document.discipline,
      tagsJson: JSON.stringify(document.tags),
      phasesJson: JSON.stringify(document.phases),
      durationSeconds: metrics.durationSec,
      estIf: metrics.estIF,
      estTss: metrics.estTSS,
      documentJson: JSON.stringify(stored),
      source
    });
    return { id: document.id };
  }

  updateBankWorkout(id: string, rawDocument: unknown): { id: string } {
    const existing = this.repositories.workoutBank.getById(id) as BankRow | undefined;
    if (!existing) {
      throw new Error(`Bank workout not found: ${id}`);
    }
    const document = fswDocumentSchema.parse(rawDocument);
    const metrics = this.deriveMetrics(document);
    const stored: FswDocument = {
      ...document,
      id,
      durationSec: metrics.durationSec,
      estIF: metrics.estIF,
      estTSS: metrics.estTSS
    };
    this.repositories.workoutBank.update({
      id,
      name: document.name,
      primaryZone: document.primaryZone,
      discipline: document.discipline,
      tagsJson: JSON.stringify(document.tags),
      phasesJson: JSON.stringify(document.phases),
      durationSeconds: metrics.durationSec,
      estIf: metrics.estIF,
      estTss: metrics.estTSS,
      documentJson: JSON.stringify(stored)
    });
    return { id };
  }

  archiveBankWorkout(id: string): void {
    const existing = this.repositories.workoutBank.getById(id) as BankRow | undefined;
    if (!existing) {
      throw new Error(`Bank workout not found: ${id}`);
    }
    this.repositories.workoutBank.setArchived(id, true);
  }

  isEmpty(): boolean {
    return this.repositories.workoutBank.count() === 0;
  }

  /**
   * Pick the best bank workout for a plan day (doc §7.2):
   *   1. phase-eligible (empty `phases` = eligible for any phase)
   *   2. prefer workouts not used recently (`excludeIds`); fall back to all if that
   *      empties the pool (small-bank case, doc §11.4)
   *   3. nearest duration to the target
   * Returns null when nothing in the zone is phase-eligible.
   */
  selectForPlanDay(input: SelectForPlanDayInput): BankWorkoutDetail | null {
    const rows = this.repositories.workoutBank.list({
      zone: input.zone,
      discipline: input.discipline,
      includeArchived: false
    }) as BankRow[];

    const phaseEligible = rows
      .map((row) => this.toDetail(row))
      .filter((workout) => workout.phases.length === 0 || workout.phases.includes(input.phase));
    if (phaseEligible.length === 0) {
      return null;
    }

    const exclude = new Set(input.excludeIds ?? []);
    const fresh = phaseEligible.filter((workout) => !exclude.has(workout.id));
    const pool = fresh.length > 0 ? fresh : phaseEligible;

    const targetSec = input.targetDurationMin * 60;
    pool.sort(
      (a, b) => Math.abs(a.durationSec - targetSec) - Math.abs(b.durationSec - targetSec)
    );
    return pool[0] ?? null;
  }

  /** Compile a bank workout at a specific FTP without persisting anything. */
  compileForFtp(id: string, ftp: number): { document: FswDocument; intervals: WorkoutInterval[] } {
    const row = this.repositories.workoutBank.getById(id) as BankRow | undefined;
    if (!row) {
      throw new Error(`Bank workout not found: ${id}`);
    }
    const document = fswDocumentSchema.parse(JSON.parse(row.document_json));
    return { document, intervals: compile(document, ftp) };
  }

  /**
   * Compile a bank workout into a `workouts` row (+ intervals) stamped with
   * `bank_workout_id` and `compiled_at_ftp` for session/telemetry/Strava provenance.
   */
  compileAndPersist(input: { bankWorkoutId: string; ftp: number; name?: string }): {
    workoutId: string;
    intervals: WorkoutInterval[];
  } {
    const row = this.repositories.workoutBank.getById(input.bankWorkoutId) as BankRow | undefined;
    if (!row) {
      throw new Error(`Bank workout not found: ${input.bankWorkoutId}`);
    }
    const document = fswDocumentSchema.parse(JSON.parse(row.document_json));
    const intervals = compile(document, input.ftp);
    const workoutId = randomUUID();
    const durationSeconds = intervals.reduce((sum, interval) => sum + interval.durationSec, 0);

    this.repositories.workouts.create({
      id: workoutId,
      name: input.name ?? document.name,
      source: "workout-bank",
      intensityFactor: row.est_if,
      durationSeconds,
      metadataJson: JSON.stringify({
        bankWorkoutId: document.id,
        compiledAtFtp: input.ftp,
        primaryZone: document.primaryZone,
        // Denormalized for the pre-start workout preview (issue #13) so it renders
        // from one getWorkoutDetail call without re-reading the bank row.
        description: document.description ?? null,
        tags: document.tags,
        estTSS: row.est_tss
      }),
      bankWorkoutId: document.id,
      compiledAtFtp: input.ftp
    });

    intervals.forEach((interval, intervalIndex) => {
      this.repositories.workoutIntervals.create({
        id: randomUUID(),
        workoutId,
        intervalIndex,
        kind: interval.kind,
        targetPowerWatts: interval.targetPowerWatts,
        targetPowerWattsEnd: interval.targetPowerWattsEnd ?? null,
        targetResistancePercent: interval.targetResistancePercent,
        targetCadenceRpm: interval.targetCadenceRpm ?? null,
        durationSeconds: interval.durationSec,
        notes: null
      });
    });

    return { workoutId, intervals };
  }
}
