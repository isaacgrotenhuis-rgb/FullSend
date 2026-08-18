import { randomUUID } from "node:crypto";
import type { Repositories } from "@main/database/repositories";
import type {
  WorkoutBuilderInterval,
  WorkoutInterval,
  WorkoutIntervalKind
} from "@shared/ipc/contracts";

type WorkoutRow = {
  id: string;
  name: string;
  source: string;
  intensity_factor: number | null;
  duration_seconds: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type IntervalRow = {
  id: string;
  workout_id: string;
  interval_index: number;
  kind: WorkoutIntervalKind;
  target_power_watts: number | null;
  target_resistance_percent: number | null;
  duration_seconds: number;
  notes: string | null;
};

type PlanWeekRow = {
  id: string;
  plan_id: string;
  week_index: number;
  start_date: string;
  notes: string | null;
};

export class WorkoutLibraryService {
  constructor(private readonly repositories: Repositories) {}

  private normalizeIntervals(intervals: WorkoutInterval[]): WorkoutInterval[] {
    return intervals.map((interval) => ({
      ...interval,
      targetPowerWatts: interval.targetPowerWatts ?? null,
      targetResistancePercent: interval.targetResistancePercent ?? null
    }));
  }

  private calculateDuration(intervals: WorkoutInterval[]): number {
    return intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  }

  private recalculateWorkoutDuration(workoutId: string): void {
    const intervalRows = this.repositories.workoutIntervals.byWorkout(workoutId) as IntervalRow[];
    const durationSeconds = intervalRows.reduce((sum, interval) => sum + interval.duration_seconds, 0);
    const workout = this.repositories.workouts.getById(workoutId) as WorkoutRow | undefined;
    if (!workout) {
      return;
    }
    this.repositories.workouts.update({
      id: workout.id,
      name: workout.name,
      intensityFactor: workout.intensity_factor,
      durationSeconds,
      metadataJson: workout.metadata_json
    });
  }

  listWorkouts(): Array<{
    id: string;
    name: string;
    source: string;
    durationSec: number;
    intensityFactor: number | null;
  }> {
    const rows = this.repositories.workouts.list() as WorkoutRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      durationSec: row.duration_seconds,
      intensityFactor: row.intensity_factor
    }));
  }

  getWorkoutDetail(workoutId: string): {
    workout: { id: string; name: string; source: string; durationSec: number; intensityFactor: number | null };
    intervals: WorkoutBuilderInterval[];
  } {
    const workout = this.repositories.workouts.getById(workoutId) as WorkoutRow | undefined;
    if (!workout) {
      throw new Error(`Workout not found: ${workoutId}`);
    }
    const intervals: WorkoutBuilderInterval[] = (
      this.repositories.workoutIntervals.byWorkout(workoutId) as IntervalRow[]
    ).map((row) => ({
      id: row.id,
      kind: row.kind,
      durationSec: row.duration_seconds,
      targetPowerWatts: row.target_power_watts,
      targetResistancePercent: row.target_resistance_percent
    }));

    return {
      workout: {
        id: workout.id,
        name: workout.name,
        source: workout.source,
        durationSec: workout.duration_seconds,
        intensityFactor: workout.intensity_factor
      },
      intervals
    };
  }

  createWorkout(input: {
    name: string;
    source: string;
    intensityFactor: number | null;
    intervals: WorkoutInterval[];
  }): { workoutId: string } {
    const workoutId = randomUUID();
    const intervals = this.normalizeIntervals(input.intervals);
    this.repositories.workouts.create({
      id: workoutId,
      name: input.name,
      source: input.source,
      intensityFactor: input.intensityFactor,
      durationSeconds: this.calculateDuration(intervals),
      metadataJson: JSON.stringify({ authoredManually: true })
    });

    intervals.forEach((interval, index) => {
      this.repositories.workoutIntervals.create({
        id: randomUUID(),
        workoutId,
        intervalIndex: index,
        kind: interval.kind,
        targetPowerWatts: interval.targetPowerWatts,
        targetResistancePercent: interval.targetResistancePercent,
        durationSeconds: interval.durationSec,
        notes: null
      });
    });

    return { workoutId };
  }

  updateWorkout(input: {
    workoutId: string;
    name: string;
    intensityFactor: number | null;
  }): void {
    const workout = this.repositories.workouts.getById(input.workoutId) as WorkoutRow | undefined;
    if (!workout) {
      throw new Error(`Workout not found: ${input.workoutId}`);
    }
    this.repositories.workouts.update({
      id: input.workoutId,
      name: input.name,
      intensityFactor: input.intensityFactor,
      durationSeconds: workout.duration_seconds,
      metadataJson: workout.metadata_json
    });
  }

  deleteWorkout(workoutId: string): void {
    this.repositories.workouts.delete(workoutId);
  }

  createInterval(input: { workoutId: string; interval: WorkoutInterval; index: number | null }): { intervalId: string } {
    const intervals = this.repositories.workoutIntervals.byWorkout(input.workoutId) as IntervalRow[];
    const insertIndex = input.index ?? intervals.length;
    intervals
      .filter((item) => item.interval_index >= insertIndex)
      .sort((a, b) => b.interval_index - a.interval_index)
      .forEach((item) => {
        this.repositories.workoutIntervals.updateIndex(item.id, item.interval_index + 1);
      });

    const intervalId = randomUUID();
    this.repositories.workoutIntervals.create({
      id: intervalId,
      workoutId: input.workoutId,
      intervalIndex: insertIndex,
      kind: input.interval.kind,
      targetPowerWatts: input.interval.targetPowerWatts,
      targetResistancePercent: input.interval.targetResistancePercent,
      durationSeconds: input.interval.durationSec,
      notes: null
    });
    this.recalculateWorkoutDuration(input.workoutId);
    return { intervalId };
  }

  updateInterval(input: { intervalId: string; interval: WorkoutInterval }): void {
    const existing = this.repositories.workoutIntervals.getById(input.intervalId) as
    | { workout_id: string }
    | undefined;
    if (!existing) {
    throw new Error(`Interval not found: ${input.intervalId}`);
    }
    this.repositories.workoutIntervals.update({
    id: input.intervalId,
    kind: input.interval.kind,
    targetPowerWatts: input.interval.targetPowerWatts,
    targetResistancePercent: input.interval.targetResistancePercent,
    durationSeconds: input.interval.durationSec,
    notes: null
    });
    this.recalculateWorkoutDuration(existing.workout_id);
  }

  deleteInterval(input: { workoutId: string; intervalId: string }): void {
    this.repositories.workoutIntervals.delete(input.intervalId);
    const intervals = this.repositories.workoutIntervals.byWorkout(input.workoutId) as IntervalRow[];
    intervals.forEach((interval, index) => {
      if (interval.interval_index !== index) {
        this.repositories.workoutIntervals.updateIndex(interval.id, index);
      }
    });
    this.recalculateWorkoutDuration(input.workoutId);
  }

  reorderIntervals(input: { workoutId: string; orderedIntervalIds: string[] }): void {
    input.orderedIntervalIds.forEach((intervalId, index) => {
      this.repositories.workoutIntervals.updateIndex(intervalId, index);
    });
    this.recalculateWorkoutDuration(input.workoutId);
  }

  assignWorkoutToPlanDay(input: { planWeekId: string; dayIndex: number; workoutId: string }): void {
    this.repositories.planWeekWorkouts.assignWorkout({
      id: randomUUID(),
      planWeekId: input.planWeekId,
      dayIndex: input.dayIndex,
      workoutId: input.workoutId
    });
  }

  unassignWorkoutFromPlanDay(input: { planWeekId: string; dayIndex: number }): void {
    this.repositories.planWeekWorkouts.unassignWorkout(input);
  }

  listPlanWeeks(): Array<{
    id: string;
    planId: string;
    weekIndex: number;
    startDate: string;
    notes: string | null;
    assignments: Array<{ dayIndex: number; workoutId: string; workoutName: string }>;
  }> {
    const weeks = this.repositories.planWeeks.list() as PlanWeekRow[];
    return weeks.map((week) => {
      const assignments = this.repositories.planWeekWorkouts.listAssignmentsForWeek(week.id) as Array<{
        day_index: number;
        workout_id: string;
        workout_name: string;
      }>;
      return {
        id: week.id,
        planId: week.plan_id,
        weekIndex: week.week_index,
        startDate: week.start_date,
        notes: week.notes,
        assignments: assignments.map((assignment) => ({
          dayIndex: assignment.day_index,
          workoutId: assignment.workout_id,
          workoutName: assignment.workout_name
        }))
      };
    });
  }
}
