import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";
import { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import type { BleService } from "@main/ble/types";
import type { BleState } from "@shared/ipc/contracts";

const createInitialBleState = (): BleState => ({
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
});

class FakeBleService implements BleService {
  private state: BleState = createInitialBleState();
  private listener: ((state: BleState) => void) | null = null;

  setTelemetry(
    powerWatts: number | null,
    cadenceRpm: number | null,
    speedKmh: number | null = null,
    distanceMeters: number | null = null
  ): void {
    this.state = {
      ...this.state,
      liveTelemetry: { powerWatts, cadenceRpm, speedKmh, distanceMeters, timestamp: new Date().toISOString() }
    };
    this.listener?.(this.state);
  }

  setHeartRate(bpm: number | null): void {
    this.state = { ...this.state, heartRate: bpm === null ? null : { bpm, timestamp: new Date().toISOString() } };
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
    return { deviceId: "dev1", serviceUuid: "1826", characteristics: [], ergControlAvailable: true, discoveredAt: new Date().toISOString() };
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

describe("ErgWorkoutEngine finalize/discard", () => {
  let db: Database.Database;
  let repos: Repositories;
  let ble: FakeBleService;
  let engine: ErgWorkoutEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    db.prepare("INSERT INTO devices (id, name) VALUES ('dev1', 'Test Trainer')").run();
    repos = new Repositories(db);
    ble = new FakeBleService();
    engine = new ErgWorkoutEngine(ble, {
      workoutSessions: repos.workoutSessions,
      workoutSessionEvents: repos.workoutSessionEvents,
      workoutSessionTelemetry: repos.workoutSessionTelemetry
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  const startSession = async (durationSec: number): Promise<string> => {
    return engine.start({
      workoutId: null,
      deviceId: "dev1",
      intervals: [{ kind: "work", durationSec, targetPowerWatts: 150, targetResistancePercent: null }]
    });
  };

  it("computes rounded averages, preserves elapsedSec for Strava, and is idempotent", async () => {
    ble.setTelemetry(100, 80);
    ble.setHeartRate(120);
    const sessionId = await startSession(60);

    ble.setTelemetry(200, 90);
    ble.setHeartRate(130);
    await vi.advanceTimersByTimeAsync(1000);

    ble.setTelemetry(150, 85);
    ble.setHeartRate(140);
    await vi.advanceTimersByTimeAsync(1000);

    await engine.stop(sessionId);
    expect(engine.getState().elapsedSec).toBe(2);

    const summary = engine.finalizeSession(sessionId);
    expect(summary).toEqual({
      sessionId,
      durationSec: 2,
      avgPowerWatts: 150,
      avgCadenceRpm: 85,
      avgHeartRateBpm: 130,
      avgSpeedKmh: null,
      distanceMeters: null
    });

    const row = db.prepare("SELECT status, summary_json FROM workout_sessions WHERE id = ?").get(sessionId) as {
      status: string;
      summary_json: string;
    };
    expect(row.status).toBe("completed");
    const summaryJson = JSON.parse(row.summary_json);
    expect(summaryJson.elapsedSec).toBe(2);
    expect(summaryJson.endReason).toBe("manual-stop");
    expect(summaryJson.avgPowerWatts).toBe(150);
    expect(summaryJson.avgCadenceRpm).toBe(85);
    expect(summaryJson.avgHeartRateBpm).toBe(130);
    // Speed/distance are persisted too now, so ride-history reads don't re-scan telemetry.
    expect(summaryJson.avgSpeedKmh).toBe(null);
    expect(summaryJson.distanceMeters).toBe(null);

    const secondCall = engine.finalizeSession(sessionId);
    expect(secondCall).toEqual(summary);
  });

  it("computes average speed and takes the max reading as total distance since the ride started", async () => {
    // The trainer's odometer starts at 100m (leftover from before this ride, e.g. a
    // lifetime counter) — session distance should be baselined to 0 at the first
    // reading, not report the trainer's raw absolute value.
    ble.setTelemetry(100, 80, 20, 100);
    const sessionId = await startSession(60);

    ble.setTelemetry(200, 90, 30, 200);
    await vi.advanceTimersByTimeAsync(1000);

    ble.setTelemetry(150, 85, 25, 300);
    await vi.advanceTimersByTimeAsync(1000);

    await engine.stop(sessionId);
    const summary = engine.finalizeSession(sessionId);
    expect(summary.avgSpeedKmh).toBe(25);
    expect(summary.distanceMeters).toBe(200);
  });

  it("integrates distance from speed live, tick by tick, when the trainer never reports a distance reading", async () => {
    // distanceMeters stays null every tick, e.g. a trainer that doesn't set FTMS's
    // optional "Total Distance Present" flag (the real-world case that motivated this).
    ble.setTelemetry(100, 80, 20, null);
    const sessionId = await startSession(60);

    ble.setTelemetry(100, 80, 30, null);
    await vi.advanceTimersByTimeAsync(1000);

    expect(engine.getState().liveMetrics?.actualDistanceMeters).toBeCloseTo(8.33, 1);

    ble.setTelemetry(100, 80, 36, null);
    await vi.advanceTimersByTimeAsync(1000);

    // Tick-by-tick integration: the t=0 sample has no preceding interval (contributes
    // 0), then 30 km/h covers 0s->1s and 36 km/h covers 1s->2s: (30 + 36) * (1000/3600)
    // ≈ 18.33m — an estimate from speed, not a real device reading.
    await engine.stop(sessionId);
    const summary = engine.finalizeSession(sessionId);
    expect(summary.distanceMeters).toBe(18);
  });

  it("handles a session with no heart-rate monitor connected", async () => {
    ble.setTelemetry(100, 80);
    const sessionId = await startSession(60);
    await engine.stop(sessionId);

    const summary = engine.finalizeSession(sessionId);
    expect(summary.avgHeartRateBpm).toBeNull();
    expect(summary.avgPowerWatts).toBe(100);
  });

  it("remains finalizable after natural completion, without a manual stop", async () => {
    ble.setTelemetry(100, 80);
    ble.setHeartRate(120);
    const sessionId = await startSession(2);

    ble.setTelemetry(120, 82);
    await vi.advanceTimersByTimeAsync(1000);

    // Elapsed reaches the interval's total duration: the scheduler runs out and the
    // engine auto-completes without any user action.
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.getState().lifecycle).toBe("completed");
    // Natural completion snaps elapsed to the full workout length (2s here), not
    // the last in-bounds tick (1s) — a 66:00 workout records 66:00, not 65:59.
    expect(engine.getState().elapsedSec).toBe(2);

    const preFinalizeRow = db.prepare("SELECT status FROM workout_sessions WHERE id = ?").get(sessionId) as {
      status: string;
    };
    expect(preFinalizeRow.status).toBe("completed");

    const summary = engine.finalizeSession(sessionId);
    expect(summary.durationSec).toBe(2);
    expect(summary.avgPowerWatts).toBe(110);

    const finalizedRow = db.prepare("SELECT summary_json FROM workout_sessions WHERE id = ?").get(sessionId) as {
      summary_json: string;
    };
    expect(JSON.parse(finalizedRow.summary_json).elapsedSec).toBe(2);

    const row = db.prepare("SELECT summary_json FROM workout_sessions WHERE id = ?").get(sessionId) as {
      summary_json: string;
    };
    expect(JSON.parse(row.summary_json).endReason).toBe("all-intervals-finished");
  });

  it("discardSession deletes the session, its telemetry, and its events", async () => {
    ble.setTelemetry(100, 80);
    const sessionId = await startSession(60);
    await vi.advanceTimersByTimeAsync(1000);
    await engine.stop(sessionId);

    engine.discardSession(sessionId);

    const sessionRows = db.prepare("SELECT COUNT(*) AS n FROM workout_sessions WHERE id = ?").get(sessionId) as { n: number };
    const telemetryRows = db
      .prepare("SELECT COUNT(*) AS n FROM workout_session_telemetry WHERE session_id = ?")
      .get(sessionId) as { n: number };
    const eventRows = db.prepare("SELECT COUNT(*) AS n FROM workout_session_events WHERE session_id = ?").get(sessionId) as {
      n: number;
    };
    expect(sessionRows.n).toBe(0);
    expect(telemetryRows.n).toBe(0);
    expect(eventRows.n).toBe(0);
    expect(engine.getState().lifecycle).toBe("idle");
  });

  it("throws when finalizing or discarding a session that hasn't ended", async () => {
    const sessionId = await startSession(60);
    expect(() => engine.finalizeSession(sessionId)).toThrow();
    expect(() => engine.discardSession(sessionId)).toThrow();
  });

  it("interpolates targetPowerWatts across a ramp interval and passes cadence through", async () => {
    // A single sample then 49 s of silence would trip auto-pause; this test is about
    // target interpolation, so run it with auto-pause off.
    engine = new ErgWorkoutEngine(
      ble,
      {
        workoutSessions: repos.workoutSessions,
        workoutSessionEvents: repos.workoutSessionEvents,
        workoutSessionTelemetry: repos.workoutSessionTelemetry
      },
      { autoPause: false }
    );
    ble.setTelemetry(120, 85);
    const sessionId = await engine.start({
      workoutId: null,
      deviceId: "dev1",
      intervals: [
        {
          kind: "work",
          durationSec: 100,
          targetPowerWatts: 100,
          targetPowerWattsEnd: 200,
          targetResistancePercent: null,
          targetCadenceRpm: 90
        }
      ]
    });
    engine.setRampDuration(sessionId, 0); // disable the block-entry transition smoother

    await vi.advanceTimersByTimeAsync(1000);
    const early = engine.getState().liveMetrics;
    await vi.advanceTimersByTimeAsync(49_000);
    const mid = engine.getState().liveMetrics;

    expect(early?.targetPowerWatts).not.toBeNull();
    expect(mid?.targetPowerWatts).toBeGreaterThan(early?.targetPowerWatts ?? 0);
    // ~halfway through a 100->200 W ramp.
    expect(mid?.targetPowerWatts).toBeGreaterThanOrEqual(145);
    expect(mid?.targetPowerWatts).toBeLessThanOrEqual(155);
    expect(mid?.targetCadenceRpm).toBe(90);

    const telemetryRow = db
      .prepare(
        "SELECT target_cadence_rpm AS c FROM workout_session_telemetry WHERE session_id = ? ORDER BY elapsed_seconds DESC LIMIT 1"
      )
      .get(sessionId) as { c: number | null };
    expect(telemetryRow.c).toBe(90);

    await engine.stop(sessionId);
  });

  it("runs a free-ride block in resistance mode (null power, 0% resistance)", async () => {
    ble.setTelemetry(110, 80);
    const sessionId = await engine.start({
      workoutId: null,
      deviceId: "dev1",
      intervals: [
        {
          kind: "work",
          durationSec: 30,
          targetPowerWatts: null,
          targetPowerWattsEnd: null,
          targetResistancePercent: 0,
          targetCadenceRpm: null
        }
      ]
    });

    await vi.advanceTimersByTimeAsync(1000);
    const metrics = engine.getState().liveMetrics;
    expect(metrics?.targetPowerWatts).toBeNull();
    expect(metrics?.targetResistancePercent).toBe(0);

    await engine.stop(sessionId);
  });
});

describe("ErgWorkoutEngine pause freezes targets, not live metrics", () => {
  let db: Database.Database;
  let repos: Repositories;
  let ble: FakeBleService;
  let engine: ErgWorkoutEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    db.prepare("INSERT INTO devices (id, name) VALUES ('dev1', 'Test Trainer')").run();
    repos = new Repositories(db);
    ble = new FakeBleService();
    engine = new ErgWorkoutEngine(ble, {
      workoutSessions: repos.workoutSessions,
      workoutSessionEvents: repos.workoutSessionEvents,
      workoutSessionTelemetry: repos.workoutSessionTelemetry
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  const startFlatSession = async (): Promise<string> => {
    const sessionId = await engine.start({
      workoutId: null,
      deviceId: "dev1",
      intervals: [{ kind: "work", durationSec: 600, targetPowerWatts: 150, targetResistancePercent: null }]
    });
    engine.setRampDuration(sessionId, 0); // no block-entry smoothing: target is a flat 150 W
    return sessionId;
  };

  it("holds the clock and target tiles while paused, but keeps live HR/cadence flowing", async () => {
    ble.setTelemetry(150, 88);
    ble.setHeartRate(120);
    const sessionId = await startFlatSession();

    await vi.advanceTimersByTimeAsync(3000);
    const elapsedAtPause = engine.getState().elapsedSec;
    expect(elapsedAtPause).toBeGreaterThanOrEqual(2);
    const targetAtPause = engine.getState().liveMetrics?.targetPowerWatts ?? null;
    expect(targetAtPause).toBe(150);
    const ergWritesBeforePause = ble.applyErgTarget.mock.calls.length;

    await engine.pause(sessionId);

    // Still on the bike: strap and cranks keep reporting after the pause.
    ble.setHeartRate(134);
    ble.setTelemetry(120, 72);
    await vi.advanceTimersByTimeAsync(2000);

    const state = engine.getState();
    expect(state.lifecycle).toBe("paused");
    expect(state.elapsedSec).toBe(elapsedAtPause); // clock held
    expect(state.liveMetrics?.targetPowerWatts).toBe(targetAtPause); // target tile held
    expect(state.liveMetrics?.actualHeartRateBpm).toBe(134); // live HR still updating
    expect(state.liveMetrics?.actualCadenceRpm).toBe(72);
    expect(state.liveMetrics?.actualPowerWatts).toBe(120);
    expect(ble.applyErgTarget.mock.calls.length).toBe(ergWritesBeforePause); // no ERG writes while paused
  });

  it("drops live power/cadence to a no-reading state when the sensors go quiet while paused", async () => {
    ble.setTelemetry(150, 88);
    ble.setHeartRate(120);
    const sessionId = await startFlatSession();
    await vi.advanceTimersByTimeAsync(2000);

    await engine.pause(sessionId);

    // Rider stops pedalling and takes the strap off: no new samples arrive.
    await vi.advanceTimersByTimeAsync(4000);

    const metrics = engine.getState().liveMetrics;
    expect(metrics?.actualPowerWatts).toBeNull();
    expect(metrics?.actualCadenceRpm).toBeNull();
    expect(metrics?.actualSpeedKmh).toBeNull();
    expect(metrics?.actualHeartRateBpm).toBeNull();
    // Target tile still holds its programmed value.
    expect(metrics?.targetPowerWatts).toBe(150);
  });

  it("resumes the elapsed clock from where it stopped, not inflated by pause time", async () => {
    ble.setTelemetry(150, 88);
    const sessionId = await startFlatSession();
    await vi.advanceTimersByTimeAsync(3000);
    const elapsedAtPause = engine.getState().elapsedSec;

    await engine.pause(sessionId);
    await vi.advanceTimersByTimeAsync(30_000); // long pause
    expect(engine.getState().elapsedSec).toBe(elapsedAtPause);

    await engine.resume(sessionId);
    ble.setTelemetry(150, 88);
    await vi.advanceTimersByTimeAsync(2000);

    const elapsedAfterResume = engine.getState().elapsedSec;
    expect(engine.getState().lifecycle).toBe("running");
    expect(elapsedAfterResume).toBeGreaterThanOrEqual(elapsedAtPause + 2);
    expect(elapsedAfterResume).toBeLessThan(elapsedAtPause + 4); // pause seconds not counted
  });

  it("keeps live tiles honest while running too: coasting mid-interval reads as no power", async () => {
    ble.setTelemetry(160, 90);
    await startFlatSession();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.getState().liveMetrics?.actualPowerWatts).toBe(160);

    // No fresh telemetry for several seconds while still "running".
    await vi.advanceTimersByTimeAsync(4000);
    expect(engine.getState().liveMetrics?.actualPowerWatts).toBeNull();
    expect(engine.getState().liveMetrics?.actualCadenceRpm).toBeNull();
  });
});

describe("ErgWorkoutEngine seeking and auto-pause", () => {
  let db: Database.Database;
  let repos: Repositories;
  let ble: FakeBleService;
  let engine: ErgWorkoutEngine;

  // 0-60 warm-up @100 W, 60-120 work @200 W, 120-180 cool-down @80 W.
  const threeBlocks = [
    { kind: "warmup" as const, durationSec: 60, targetPowerWatts: 100, targetResistancePercent: null },
    { kind: "work" as const, durationSec: 60, targetPowerWatts: 200, targetResistancePercent: null },
    { kind: "cooldown" as const, durationSec: 60, targetPowerWatts: 80, targetResistancePercent: null }
  ];

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applySchema(db);
    db.prepare("INSERT INTO devices (id, name) VALUES ('dev1', 'Test Trainer')").run();
    repos = new Repositories(db);
    ble = new FakeBleService();
    engine = new ErgWorkoutEngine(ble, {
      workoutSessions: repos.workoutSessions,
      workoutSessionEvents: repos.workoutSessionEvents,
      workoutSessionTelemetry: repos.workoutSessionTelemetry
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  const start = async (): Promise<string> => {
    ble.setTelemetry(100, 85);
    const sessionId = await engine.start({ workoutId: null, deviceId: "dev1", intervals: threeBlocks });
    engine.setRampDuration(sessionId, 0);
    return sessionId;
  };

  // Keep fresh samples arriving once a second, like a rider pedaling.
  const pedal = async (seconds: number, watts = 150, cadence = 88): Promise<void> => {
    for (let i = 0; i < seconds; i += 1) {
      ble.setTelemetry(watts, cadence);
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  const coast = async (seconds: number): Promise<void> => {
    for (let i = 0; i < seconds; i += 1) {
      ble.setTelemetry(0, 0);
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  const eventTypes = (sessionId: string): string[] =>
    (
      db
        .prepare("SELECT event_type FROM workout_session_events WHERE session_id = ? ORDER BY rowid")
        .all(sessionId) as Array<{ event_type: string }>
    ).map((row) => row.event_type);

  it("moves the workout cursor on seek while the ride clock keeps counting moving time", async () => {
    const sessionId = await start();
    await pedal(5);
    expect(engine.getState().positionSec).toBe(5);

    engine.seek(sessionId, 125);
    expect(engine.getState().positionSec).toBe(125);
    expect(engine.getState().currentIntervalIndex).toBe(2);

    await pedal(3);
    const state = engine.getState();
    expect(state.elapsedSec).toBe(8); // clock untouched by the jump
    expect(state.positionSec).toBe(128);
    expect(state.liveMetrics?.blockKind).toBe("cooldown");
    expect(state.liveMetrics?.targetPowerWatts).toBe(80);

    const row = db
      .prepare(
        "SELECT elapsed_seconds AS e, position_sec AS p FROM workout_session_telemetry WHERE session_id = ? ORDER BY rowid DESC LIMIT 1"
      )
      .get(sessionId) as { e: number; p: number };
    expect(row).toEqual({ e: 8, p: 128 });
    expect(eventTypes(sessionId)).toContain("seek");
  });

  it("can seek backwards too", async () => {
    const sessionId = await start();
    await pedal(3);
    engine.seek(sessionId, 90);
    await pedal(2);
    engine.seek(sessionId, 10);
    await pedal(2);
    expect(engine.getState().positionSec).toBe(12);
    expect(engine.getState().elapsedSec).toBe(7);
    expect(engine.getState().liveMetrics?.targetPowerWatts).toBe(100);
  });

  it("previews the new block while paused and continues from it on resume", async () => {
    const sessionId = await start();
    await pedal(4);
    await engine.pause(sessionId);
    const ergWrites = ble.applyErgTarget.mock.calls.length;

    engine.seek(sessionId, 60);
    expect(engine.getState().lifecycle).toBe("paused");
    expect(engine.getState().liveMetrics?.targetPowerWatts).toBe(200); // target tile previews the jump
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.getState().positionSec).toBe(60); // cursor held while paused
    expect(ble.applyErgTarget.mock.calls.length).toBe(ergWrites); // nothing sent until resume

    await engine.resume(sessionId);
    await pedal(2);
    expect(engine.getState().positionSec).toBeGreaterThanOrEqual(61);
    expect(engine.getState().positionSec).toBeLessThanOrEqual(62);
    expect(engine.getState().liveMetrics?.blockKind).toBe("work");
  });

  it("clamps a seek to the workout's last second, then completes with the real ride time", async () => {
    const sessionId = await start();
    await pedal(5);
    engine.seek(sessionId, 10_000);
    expect(engine.getState().positionSec).toBe(179);

    await pedal(2);
    const state = engine.getState();
    expect(state.lifecycle).toBe("completed");
    expect(state.positionSec).toBe(180);
    // 5 s before the jump + 1 s to reach the end: not the 3:00 the workout is planned for.
    expect(state.elapsedSec).toBe(6);
    expect(engine.finalizeSession(sessionId).durationSec).toBe(6);
  });

  it("rejects a seek when no session is running or paused", async () => {
    const sessionId = await start();
    await engine.stop(sessionId);
    expect(() => engine.seek(sessionId, 30)).toThrow();
    expect(() => engine.seek("nope", 30)).toThrow();
  });

  it("auto-pauses after the rider stops pedaling for the idle window, holding clock and cursor", async () => {
    const sessionId = await start();
    await pedal(5);
    await coast(9);
    expect(engine.getState().lifecycle).toBe("running");

    await coast(1);
    const state = engine.getState();
    expect(state.lifecycle).toBe("paused");
    expect(state.pauseReason).toBe("auto");
    expect(ble.stopOrPause).toHaveBeenCalledWith("dev1", "pause");

    const clockAtPause = state.elapsedSec;
    await vi.advanceTimersByTimeAsync(20_000); // sensors silent
    expect(engine.getState().elapsedSec).toBe(clockAtPause);
    expect(engine.getState().lifecycle).toBe("paused");
  });

  it("does not auto-pause before the rider has pedaled at all", async () => {
    ble.setTelemetry(null, null);
    const sessionId = await engine.start({ workoutId: null, deviceId: "dev1", intervals: threeBlocks });
    await coast(15);
    expect(engine.getState().lifecycle).toBe("running");
    await engine.stop(sessionId);
  });

  it("supports the stop-pedaling, drag, start-pedaling flow", async () => {
    const sessionId = await start();
    await pedal(30);
    await coast(10);
    expect(engine.getState().pauseReason).toBe("auto");

    engine.seek(sessionId, 120); // drag to the cool-down
    await pedal(1);
    expect(engine.getState().lifecycle).toBe("paused"); // one stroke isn't enough
    await pedal(1);
    expect(engine.getState().lifecycle).toBe("running");
    expect(engine.getState().pauseReason).toBeNull();

    await pedal(2);
    expect(engine.getState().liveMetrics?.blockKind).toBe("cooldown");
    expect(eventTypes(sessionId)).toEqual(expect.arrayContaining(["seek", "auto-resume", "session-resumed"]));
  });

  it("never auto-resumes a manual pause", async () => {
    const sessionId = await start();
    await pedal(3);
    await engine.pause(sessionId);
    await pedal(5);
    expect(engine.getState().lifecycle).toBe("paused");
    expect(engine.getState().pauseReason).toBe("manual");
  });

  it("can be turned off", async () => {
    engine = new ErgWorkoutEngine(
      ble,
      {
        workoutSessions: repos.workoutSessions,
        workoutSessionEvents: repos.workoutSessionEvents,
        workoutSessionTelemetry: repos.workoutSessionTelemetry
      },
      { autoPause: false }
    );
    await start();
    await pedal(3);
    await coast(20);
    expect(engine.getState().lifecycle).toBe("running");
  });
});
