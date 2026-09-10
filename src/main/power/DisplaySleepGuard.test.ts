import { describe, expect, it } from "vitest";
import { DisplaySleepGuard, type PowerSaveBlockerLike } from "@main/power/DisplaySleepGuard";
import type { WorkoutSessionLifecycle } from "@shared/ipc/contracts";

class FakePowerSaveBlocker implements PowerSaveBlockerLike {
  readonly starts: Array<"prevent-app-suspension" | "prevent-display-sleep"> = [];
  readonly stops: number[] = [];
  private nextId = 1;
  private readonly active = new Set<number>();

  start(type: "prevent-app-suspension" | "prevent-display-sleep"): number {
    this.starts.push(type);
    const id = this.nextId++;
    this.active.add(id);
    return id;
  }

  stop(id: number): void {
    this.stops.push(id);
    this.active.delete(id);
  }

  isStarted(id: number): boolean {
    return this.active.has(id);
  }

  get activeCount(): number {
    return this.active.size;
  }
}

const feed = (guard: DisplaySleepGuard, ...lifecycles: WorkoutSessionLifecycle[]): void => {
  for (const lifecycle of lifecycles) {
    guard.handleState({ lifecycle });
  }
};

const TERMINAL: WorkoutSessionLifecycle[] = ["stopped", "completed", "degraded", "error"];

describe("DisplaySleepGuard", () => {
  it("takes a prevent-display-sleep assertion when a session starts running", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "idle", "running");

    expect(blocker.starts).toEqual(["prevent-display-sleep"]);
    expect(blocker.activeCount).toBe(1);
  });

  it("does not acquire anything for the initial idle state", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "idle");

    expect(blocker.starts).toEqual([]);
    expect(blocker.stops).toEqual([]);
  });

  it("holds a single assertion across running -> paused -> running", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "running", "paused", "running", "paused");

    expect(blocker.starts).toEqual(["prevent-display-sleep"]);
    expect(blocker.stops).toEqual([]);
    expect(blocker.activeCount).toBe(1);
  });

  it.each(TERMINAL)("releases the assertion when the session becomes %s", (lifecycle) => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "running", lifecycle);

    expect(blocker.activeCount).toBe(0);
    expect(blocker.stops).toHaveLength(1);
  });

  it("releases the assertion when returning to idle", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "running", "idle");

    expect(blocker.activeCount).toBe(0);
  });

  it("is a no-op when a terminal state arrives with nothing held", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "idle", "completed");

    expect(blocker.starts).toEqual([]);
    expect(blocker.stops).toEqual([]);
  });

  it("acquires a fresh assertion for a subsequent session", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "running", "completed", "running");

    expect(blocker.starts).toEqual(["prevent-display-sleep", "prevent-display-sleep"]);
    expect(blocker.activeCount).toBe(1);
  });

  it("dispose() releases an active assertion", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    feed(guard, "running");
    guard.dispose();

    expect(blocker.activeCount).toBe(0);
  });

  it("dispose() is safe when nothing is held", () => {
    const blocker = new FakePowerSaveBlocker();
    const guard = new DisplaySleepGuard(blocker);

    expect(() => guard.dispose()).not.toThrow();
    expect(blocker.stops).toEqual([]);
  });
});
