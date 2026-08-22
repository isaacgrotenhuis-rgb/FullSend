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

  setTelemetry(powerWatts: number | null, cadenceRpm: number | null): void {
    this.state = {
      ...this.state,
      liveTelemetry: { powerWatts, cadenceRpm, timestamp: new Date().toISOString() }
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
  async applyErgTarget(): Promise<void> {}
  async safeErgStop(): Promise<void> {}
  async startOrResume(): Promise<void> {}
  async stopOrPause(): Promise<void> {}
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
      avgHeartRateBpm: 130
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

    const secondCall = engine.finalizeSession(sessionId);
    expect(secondCall).toEqual(summary);
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

    const preFinalizeRow = db.prepare("SELECT status FROM workout_sessions WHERE id = ?").get(sessionId) as {
      status: string;
    };
    expect(preFinalizeRow.status).toBe("completed");

    const summary = engine.finalizeSession(sessionId);
    expect(summary.avgPowerWatts).toBe(110);

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
});
