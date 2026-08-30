import type { FswDocument } from "@shared/ipc/contracts";
import type { WorkoutBankService } from "@main/workout/WorkoutBankService";

/**
 * Starter workout-bank documents (doc §8, iceman-2026-training-plan.md §Part 5).
 *
 * NOTE: the actual ~17-workout seed array is owned by the parallel PR
 * `feat/iceman-seed-workouts`, which is building `src/shared/fsw.ts` with a
 * structurally identical schema. This stays an empty placeholder until that PR
 * lands; a short follow-up will point this loader at the shared seed array and
 * dedupe the two schema homes.
 */
export const SEED_WORKOUTS: FswDocument[] = []; // filled by feat/iceman-seed-workouts

/**
 * First-run seeding: insert the starter documents if the bank table is empty.
 * Safe to call on every startup (same pattern as `applySchema`).
 */
export const seedWorkoutBankIfEmpty = (bankService: WorkoutBankService): void => {
  if (SEED_WORKOUTS.length === 0 || !bankService.isEmpty()) {
    return;
  }
  for (const document of SEED_WORKOUTS) {
    try {
      bankService.createBankWorkout(document, "seed");
    } catch (error) {
      console.error(`[seedWorkoutBank] failed to seed "${document.id}":`, error);
    }
  }
};
