import type { WorkoutSessionLifecycle, WorkoutSessionState } from "@shared/ipc/contracts";

/**
 * The slice of Electron's `powerSaveBlocker` this guard depends on, narrowed to
 * an interface so it can be unit-tested without the electron runtime.
 */
export type PowerSaveBlockerLike = {
  start: (type: "prevent-app-suspension" | "prevent-display-sleep") => number;
  stop: (id: number) => void;
  isStarted: (id: number) => boolean;
};

// A workout keeps the display awake while it is running or paused (a pause is a
// rest between intervals, not a reason to let the screen sleep). Every other
// lifecycle — idle, plus the terminal states that back the post-workout summary
// screen — releases the assertion.
const AWAKE_LIFECYCLES: ReadonlySet<WorkoutSessionLifecycle> = new Set<WorkoutSessionLifecycle>([
  "running",
  "paused"
]);

/**
 * Holds a `prevent-display-sleep` power assertion while a workout session is
 * active, so the Mac display stays on mid-ride. Fed from
 * `ErgWorkoutEngine.subscribe`; the assertion is released as soon as the session
 * ends or is discarded, and on app shutdown via {@link dispose}.
 */
export class DisplaySleepGuard {
  private blockerId: number | null = null;

  constructor(private readonly powerSaveBlocker: PowerSaveBlockerLike) {}

  handleState(state: Pick<WorkoutSessionState, "lifecycle">): void {
    if (AWAKE_LIFECYCLES.has(state.lifecycle)) {
      this.acquire();
    } else {
      this.release();
    }
  }

  /** Release the assertion unconditionally (app shutdown). */
  dispose(): void {
    this.release();
  }

  private acquire(): void {
    if (this.blockerId !== null && this.powerSaveBlocker.isStarted(this.blockerId)) {
      return;
    }
    this.blockerId = this.powerSaveBlocker.start("prevent-display-sleep");
  }

  private release(): void {
    if (this.blockerId === null) {
      return;
    }
    if (this.powerSaveBlocker.isStarted(this.blockerId)) {
      this.powerSaveBlocker.stop(this.blockerId);
    }
    this.blockerId = null;
  }
}
