import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import { FitnessTestController } from "@main/workout/FitnessTestController";
import { buildFitnessTest, phaseRange, type FitnessTestPlan } from "@shared/fitnessTestProtocol";
import type { BleService } from "@main/ble/types";
import type { BleState } from "@shared/ipc/contracts";

class FakeBle implements BleService {
  private state: BleState = {
    lifecycle: "idle",
    scanning: false,
    connectedDeviceId: "dev1",
    lastError: null,
    discoveredDevices: [],
    ftmsProfile: null,
    liveTelemetry: null,
    connections: {
      heart_rate: { lifecycle: "idle", connectedDeviceId: null, lastError: null },
      cadence: { lifecycle: "idle", connectedDeviceId: null, lastError: null }
    },
    heartRate: null
  };
  private listener: ((state: BleState) => void) | null = null;

  emit(powerWatts: number | null, cadenceRpm: number | null, heartRateBpm: number | null): void {
    this.state = {
      ...this.state,
      liveTelemetry: { powerWatts, cadenceRpm, speedKmh: 30, distanceMeters: null, timestamp: new Date().toISOString() },
      heartRate: heartRateBpm === null ? this.state.heartRate : { bpm: heartRateBpm, timestamp: new Date().toISOString() }
    };
    this.listener?.(this.state);
  }

  async startScan(): Promise<void> {}
  async stopScan(): Promise<void> {}
  listDevices() {
    return [];
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getState(): BleState {
    return this.state;
  }
  getCapabilities() {
    return {
      canScan: true,
      canConnect: true,
      canDisconnect: true,
      supportsFtmsDiscovery: true,
      supportsHeartRateDiscovery: true,
      supportsBackgroundReconnect: true,
      knownLimitations: []
    };
  }
  async discoverFtms() {
    return { deviceId: "dev1", serviceUuid: "1826", characteristics: [], ergControlAvailable: true, discoveredAt: "" };
  }
  applyErgTarget = vi.fn(async (): Promise<void> => {});
  async safeErgStop(): Promise<void> {}
  startOrResume = vi.fn(async (): Promise<void> => {});
  stopOrPause = vi.fn(async (): Promise<void> => {});
  subscribeState(listener: (state: BleState) => void): () => void {
    this.listener = listener;
    listener(this.state);
    return () => {
      this.listener = null;
    };
  }
}

describe("buildFitnessTest", () => {
  it("lays out contiguous phases and scales the ramp from MAP", () => {
    const plan = buildFitnessTest({ mapWatts: 333, ftpWatts: null, weightKg: null }, "full");
    expect(plan.phases.map((range) => range.phase)).toEqual(["warmup", "ramp", "recovery", "capped", "cooldown"]);
    for (let index = 1; index < plan.phases.length; index += 1) {
      expect(plan.phases[index].startSec).toBe(plan.phases[index - 1].endSec);
    }
    expect(plan.totalSec).toBe(plan.intervals.reduce((sum, interval) => sum + interval.durationSec, 0));
    expect(phaseRange(plan.phases, "warmup")?.endSec).toBe(600);
    expect(plan.rampStartWatts).toBe(150);
    expect(plan.rampStepWatts).toBe(15);
    // Steps continue to at least 160% of the seed.
    expect(plan.rampStartWatts + (plan.rampStepCount - 1) * plan.rampStepWatts).toBeGreaterThanOrEqual(1.6 * 333);
    const capped = plan.intervals.find((interval) => interval.targetResistancePercent === 0);
    expect(capped).toMatchObject({ durationSec: 1200, targetPowerWatts: null });
  });

  it("seeds from FTP, then weight, then a default", () => {
    expect(buildFitnessTest({ mapWatts: null, ftpWatts: 240, weightKg: 80 }, "full")).toMatchObject({
      mapSeedWatts: 320,
      mapSeedSource: "ftp"
    });
    expect(buildFitnessTest({ mapWatts: null, ftpWatts: null, weightKg: 70 }, "full")).toMatchObject({
      mapSeedWatts: 231,
      mapSeedSource: "weight"
    });
    expect(buildFitnessTest({ mapWatts: null, ftpWatts: null, weightKg: null }, "quick")).toMatchObject({
      mapSeedWatts: 250,
      mapSeedSource: "default"
    });
  });

  it("quick variant skips recovery and the capped effort", () => {
    const plan = buildFitnessTest({ mapWatts: 300, ftpWatts: null, weightKg: null }, "quick");
    expect(plan.phases.map((range) => range.phase)).toEqual(["warmup", "ramp", "cooldown"]);
    expect(plan.name).toBe("Quick Ramp Test");
  });
});

describe("FitnessTestController", () => {
  let db: Database.Database;
  let repos: Repositories;
  let ble: FakeBle;
  let engine: ErgWorkoutEngine;
  let controller: FitnessTestController;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    db.prepare("INSERT INTO devices (id, name) VALUES ('dev1', 'Trainer')").run();
    repos = new Repositories(db);
    ble = new FakeBle();
    engine = new ErgWorkoutEngine(ble, {
      workoutSessions: repos.workoutSessions,
      workoutSessionEvents: repos.workoutSessionEvents,
      workoutSessionTelemetry: repos.workoutSessionTelemetry
    });
    controller = new FitnessTestController(engine);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  const hrFor = (watts: number): number => Math.round(70 + 0.4 * watts);

  /** Ride `seconds` at whatever ERG asks for (or `watts` on a free-ride block). */
  const ride = async (seconds: number, options: { cadence?: number; withHr?: boolean; watts?: number; hr?: number } = {}) => {
    const { cadence = 90, withHr = true } = options;
    for (let s = 0; s < seconds; s += 1) {
      const target = engine.getState().liveMetrics?.targetPowerWatts ?? null;
      const watts = options.watts ?? target ?? 150;
      ble.emit(watts, cadence, withHr ? (options.hr ?? hrFor(watts)) : null);
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  /** Grind to a halt: cadence collapses and power falls well short of target. */
  const fail = async (seconds: number) => {
    for (let s = 0; s < seconds; s += 1) {
      const target = engine.getState().liveMetrics?.targetPowerWatts ?? 200;
      ble.emit(Math.round(target * 0.5), 40, hrFor(target));
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  const startTest = async (variant: "full" | "quick" = "full"): Promise<{ sessionId: string; plan: FitnessTestPlan }> => {
    ble.emit(100, 90, 100);
    const started = await controller.start({
      deviceId: "dev1",
      variant,
      profile: { mapWatts: 300, ftpWatts: null, weightKg: 75 }
    });
    engine.setRampDuration(started.sessionId, 0);
    return started;
  };

  const skipTo = (sessionId: string, plan: FitnessTestPlan, phase: "ramp" | "recovery" | "capped" | "cooldown") =>
    engine.seek(sessionId, phaseRange(plan.phases, phase)!.startSec);

  const live = () => engine.getState().fitnessTest!;
  const events = (sessionId: string): string[] =>
    (
      db.prepare("SELECT event_type FROM workout_session_events WHERE session_id = ? ORDER BY rowid").all(sessionId) as Array<{
        event_type: string;
      }>
    ).map((row) => row.event_type);

  it("detects ramp failure, counts down, then jumps to recovery with an HR cap", async () => {
    const { sessionId, plan } = await startTest();
    await ride(2);
    expect(live().phase).toBe("warmup");

    skipTo(sessionId, plan, "ramp");
    await ride(8 * 60); // 8 steps: 135 → 240 W
    expect(live().phase).toBe("ramp");
    expect(live().liveMapWatts).toBeGreaterThan(200);

    await fail(5);
    expect(live().rampEndCountdownSec).toBe(5);
    expect(live().rampEnded).toBe(false);

    await fail(5);
    const state = engine.getState();
    expect(state.fitnessTest?.rampEnded).toBe(true);
    expect(state.fitnessTest?.rampEndReason).toBe("failure");
    expect(state.fitnessTest?.hrCapBpm).not.toBeNull();
    expect(state.positionSec).toBe(phaseRange(plan.phases, "recovery")!.startSec);
    expect(events(sessionId)).toEqual(
      expect.arrayContaining(["fitness-test-started", "fitness-test-failure-detected", "fitness-test-ramp-ended", "seek"])
    );

    // No replaying the ramp, and no intensity scaling during a test.
    expect(() => skipTo(sessionId, plan, "ramp")).toThrow(/back into the ramp/);
    expect(() => engine.setIntensity(sessionId, 1.1)).toThrow(/locked/);
  });

  it("coaches the capped effort against the cap and scores from minute 5", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(8 * 60);
    await fail(10);
    const cap = live().hrCapBpm!;

    skipTo(sessionId, plan, "capped");
    await ride(3, { watts: 230, hr: cap - 10 });
    expect(live().phase).toBe("capped");
    expect(live().hrGuidance).toBe("push");
    expect(live().suggestedStartWatts).toBe(Math.round(0.75 * live().liveMapWatts!));

    await ride(2, { watts: 240, hr: cap - 1 });
    expect(live().hrGuidance).toBe("hold");
    await ride(2, { watts: 250, hr: cap + 4 });
    expect(live().hrGuidance).toBe("ease");
    expect(live().cappedScoredAvgPowerWatts).toBeNull(); // still settling

    await ride(300, { watts: 245, hr: cap - 1 });
    expect(live().cappedElapsedSec).toBeGreaterThanOrEqual(300);
    expect(live().suggestedStartWatts).toBeNull();
    expect(live().cappedScoredAvgPowerWatts).toBe(245);
  });

  it("lets the rider cancel the countdown and keep climbing", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(6 * 60);
    await fail(6);
    expect(live().rampEndCountdownSec).not.toBeNull();

    controller.keepGoing(sessionId);
    expect(live().rampEndCountdownSec).toBeNull();
    await fail(10); // inside the 15 s grace window
    expect(live().rampEnded).toBe(false);
    expect(live().phase).toBe("ramp");
    expect(events(sessionId)).toContain("fitness-test-keep-going");
  });

  it("ends the ramp at once when the rider presses End ramp", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(6 * 60);
    controller.endRamp(sessionId);
    expect(live()).toMatchObject({ rampEnded: true, rampEndReason: "rider" });
    expect(engine.getState().positionSec).toBe(phaseRange(plan.phases, "recovery")!.startSec);
  });

  it("drops to the quick result when there's no heart rate", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(6 * 60, { withHr: false });
    controller.endRamp(sessionId);
    expect(live()).toMatchObject({ variant: "quick", plannedVariant: "full", hrCapBpm: null });
    expect(live().downgradedReason).toMatch(/No heart rate/);
    expect(engine.getState().positionSec).toBe(phaseRange(plan.phases, "cooldown")!.startSec);
    expect(events(sessionId)).toContain("fitness-test-downgraded");
  });

  it("quick variant goes from the ramp straight to cool-down", async () => {
    const { sessionId, plan } = await startTest("quick");
    skipTo(sessionId, plan, "ramp");
    await ride(6 * 60);
    await fail(10);
    expect(live()).toMatchObject({ rampEnded: true, variant: "quick", downgradedReason: null });
    expect(engine.getState().positionSec).toBe(phaseRange(plan.phases, "cooldown")!.startSec);
  });

  it("handles the stop-pedaling-and-drag flow out of the ramp", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(7 * 60);
    await engine.pause(sessionId);
    skipTo(sessionId, plan, "recovery"); // dragged while paused
    await engine.resume(sessionId);
    await ride(2);
    expect(live()).toMatchObject({ rampEnded: true, rampEndReason: "skipped", phase: "recovery" });
    expect(live().hrCapBpm).not.toBeNull();
  });

  it("finishes the ramp when auto-pause beats the countdown", async () => {
    const { sessionId, plan } = await startTest();
    skipTo(sessionId, plan, "ramp");
    await ride(7 * 60);
    // Rider stops dead: no samples at all.
    await vi.advanceTimersByTimeAsync(20_000);
    const state = engine.getState();
    expect(state.fitnessTest?.rampEnded).toBe(true);
    expect(state.positionSec).toBe(phaseRange(plan.phases, "recovery")!.startSec);
    expect(state.lifecycle).toBe("paused");
    expect(state.pauseReason).toBe("auto");
  });

  it("lets go of the session once it's discarded", async () => {
    const { sessionId } = await startTest();
    await ride(2);
    await engine.stop(sessionId);
    expect(engine.getState().fitnessTest).not.toBeNull(); // kept for the results screen
    engine.discardSession(sessionId);
    expect(engine.getState().fitnessTest).toBeNull();
    expect(() => controller.keepGoing(sessionId)).toThrow();
  });
});
