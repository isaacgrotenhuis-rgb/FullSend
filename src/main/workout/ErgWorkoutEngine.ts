import { randomUUID } from "node:crypto";
import { IntervalScheduler } from "@main/workout/intervalScheduler";
import type { BleService } from "@main/ble/types";
import type {
  StartWorkoutSessionRequest,
  WorkoutLiveMetrics,
  WorkoutSessionLifecycle,
  WorkoutSessionState
} from "@shared/ipc/contracts";

type WorkoutPersistence = {
  workoutSessions: {
    create: (input: {
      id: string;
      workoutId: string | null;
      deviceId: string | null;
      startedAt: string;
      status: string;
      summaryJson: string;
    }) => void;
    updateStatus: (input: {
      id: string;
      status: string;
      endedAt?: string | null;
      summaryJson?: string;
    }) => void;
  };
  workoutSessionEvents: {
    append: (input: {
      id: string;
      sessionId: string;
      eventType: string;
      payloadJson: string;
    }) => void;
  };
  workoutSessionTelemetry: {
    append: (input: {
      id: string;
      sessionId: string;
      elapsedSeconds: number;
      blockType: string;
      blockIndex: number;
      targetPowerWatts: number | null;
      targetResistancePercent: number | null;
      actualPowerWatts: number | null;
      actualCadenceRpm: number | null;
      payloadJson: string;
    }) => void;
  };
};

const createIdleState = (): WorkoutSessionState => ({
  sessionId: null,
  workoutId: null,
  deviceId: null,
  lifecycle: "idle",
  startedAt: null,
  pausedAt: null,
  endedAt: null,
  elapsedSec: 0,
  currentIntervalIndex: null,
  intervalsTotal: 0,
  lastError: null,
  liveMetrics: null,
  intensityMultiplier: 1,
  rampDurationSec: 15
});

export class ErgWorkoutEngine {
  private readonly bleService: BleService;
  private readonly persistence: WorkoutPersistence;
  private state: WorkoutSessionState = createIdleState();
  private scheduler: IntervalScheduler | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private sessionStartedAtMs: number | null = null;
  private pausedAtMs: number | null = null;
  private totalPausedMs = 0;
  private lastAppliedPowerWatts: number | null = null;
  private lastAppliedResistancePercent: number | null = null;
  private tickInFlight = false;
  private expectedNextTickAtMs: number | null = null;
  private lastElapsedSec = 0;
  private readonly maxTickDriftMs = 2500;
  private readonly maxElapsedJumpSec = 4;
  private readonly minIntensityMultiplier = 0.5;
  private readonly maxIntensityMultiplier = 1.5;
  private readonly maxRampDurationSec = 60;
  private rampBlockIndex: number | null = null;
  private rampFromWatts: number | null = null;
  private forceRampReset = false;
  private latestTelemetry: { powerWatts: number | null; cadenceRpm: number | null } | null = null;
  private listeners = new Set<(state: WorkoutSessionState) => void>();

  constructor(bleService: BleService, persistence: WorkoutPersistence) {
    this.bleService = bleService;
    this.persistence = persistence;
    this.bleService.subscribeState((bleState) => {
      this.latestTelemetry = bleState.liveTelemetry
        ? { powerWatts: bleState.liveTelemetry.powerWatts, cadenceRpm: bleState.liveTelemetry.cadenceRpm }
        : null;
      if (
        this.state.sessionId &&
        (this.state.lifecycle === "running" || this.state.lifecycle === "paused") &&
        (bleState.lifecycle === "disconnected" || bleState.lifecycle === "error")
      ) {
        void this.handleDisconnectFailsafe(bleState.lifecycle);
      }
    });
  }

  private emitState(next: WorkoutSessionState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private patchState(next: Partial<WorkoutSessionState>): void {
    this.emitState({
      ...this.state,
      ...next
    });
  }

  private requireActiveSession(sessionId: string): void {
    if (!this.state.sessionId || this.state.sessionId !== sessionId) {
      throw new Error(`Session not active: ${sessionId}`);
    }
  }

  private getElapsedSec(nowMs: number): number {
    if (!this.sessionStartedAtMs) {
      return 0;
    }
    const rawElapsed = Math.max(0, Math.floor((nowMs - this.sessionStartedAtMs - this.totalPausedMs) / 1000));
    if (rawElapsed < this.lastElapsedSec) {
      return this.lastElapsedSec;
    }
    return rawElapsed;
  }

  private persistEvent(eventType: string, payload: Record<string, unknown>): void {
    if (!this.state.sessionId) {
      return;
    }
    this.persistence.workoutSessionEvents.append({
      id: randomUUID(),
      sessionId: this.state.sessionId,
      eventType,
      payloadJson: JSON.stringify(payload)
    });
  }

  private persistTelemetry(metrics: WorkoutLiveMetrics): void {
    if (!this.state.sessionId) {
      return;
    }
    this.persistence.workoutSessionTelemetry.append({
      id: randomUUID(),
      sessionId: this.state.sessionId,
      elapsedSeconds: metrics.elapsedSec,
      blockType: metrics.blockKind,
      blockIndex: metrics.blockIndex,
      targetPowerWatts: metrics.targetPowerWatts,
      targetResistancePercent: metrics.targetResistancePercent,
      actualPowerWatts: metrics.actualPowerWatts,
      actualCadenceRpm: metrics.actualCadenceRpm,
      payloadJson: JSON.stringify(metrics)
    });
  }

  private stopTicking(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async applyTargets(metrics: WorkoutLiveMetrics): Promise<void> {
    const deviceId = this.state.deviceId;
    if (!deviceId) {
      return;
    }
    if (
      metrics.targetPowerWatts !== this.lastAppliedPowerWatts ||
      metrics.targetResistancePercent !== this.lastAppliedResistancePercent
    ) {
      await this.bleService.applyErgTarget(deviceId, {
        targetPowerWatts: metrics.targetPowerWatts,
        targetResistancePercent: metrics.targetResistancePercent
      });
      this.lastAppliedPowerWatts = metrics.targetPowerWatts;
      this.lastAppliedResistancePercent = metrics.targetResistancePercent;
    }
  }

  private async completeSession(lifecycle: WorkoutSessionLifecycle, reason: string): Promise<void> {
    if (!this.state.sessionId) {
      return;
    }
    this.stopTicking();
    this.expectedNextTickAtMs = null;
    this.tickInFlight = false;
    const endedAt = new Date().toISOString();
    this.persistence.workoutSessions.updateStatus({
      id: this.state.sessionId,
      status: lifecycle,
      endedAt,
      summaryJson: JSON.stringify({
        reason,
        elapsedSec: this.state.elapsedSec,
        currentIntervalIndex: this.state.currentIntervalIndex
      })
    });
    this.persistEvent("session-finalized", { lifecycle, reason });
    this.patchState({
      lifecycle,
      endedAt
    });
    this.scheduler = null;
  }

  private async tick(): Promise<void> {
    if (!this.scheduler || this.state.lifecycle !== "running" || this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      const nowMs = Date.now();
      if (this.expectedNextTickAtMs !== null) {
        const driftMs = nowMs - this.expectedNextTickAtMs;
        if (Math.abs(driftMs) > this.maxTickDriftMs) {
          this.persistEvent("tick-drift-detected", { driftMs });
        }
      }
      const elapsedSecRaw = this.getElapsedSec(nowMs);
      const elapsedJump = elapsedSecRaw - this.lastElapsedSec;
      const elapsedSec = elapsedJump > this.maxElapsedJumpSec ? this.lastElapsedSec + this.maxElapsedJumpSec : elapsedSecRaw;
      if (elapsedJump > this.maxElapsedJumpSec) {
        this.persistEvent("tick-elapsed-clamped", {
          elapsedSecRaw,
          previousElapsedSec: this.lastElapsedSec,
          clampedElapsedSec: elapsedSec
        });
      }
      this.lastElapsedSec = elapsedSec;
      const cursor = this.scheduler.locate(elapsedSec);

      if (!cursor) {
        await this.completeSession("completed", "all-intervals-finished");
        await this.safeErgStop();
        return;
      }

      const intensityMultiplier = this.state.intensityMultiplier;
      const blockTargetPowerWatts =
        cursor.interval.targetPowerWatts !== null
          ? Math.max(0, Math.round(cursor.interval.targetPowerWatts * intensityMultiplier))
          : null;
      const scaledTargetResistancePercent =
        cursor.interval.targetResistancePercent !== null
          ? Math.min(100, Math.max(0, Math.round(cursor.interval.targetResistancePercent * intensityMultiplier)))
          : null;

      if (cursor.index !== this.rampBlockIndex || this.forceRampReset) {
        this.rampFromWatts = this.forceRampReset ? 0 : this.lastAppliedPowerWatts ?? 0;
        this.rampBlockIndex = cursor.index;
        this.forceRampReset = false;
      }

      const rampDurationSec = this.state.rampDurationSec;
      let scaledTargetPowerWatts = blockTargetPowerWatts;
      if (
        blockTargetPowerWatts !== null &&
        this.rampFromWatts !== null &&
        rampDurationSec > 0 &&
        cursor.elapsedInIntervalSec < rampDurationSec
      ) {
        const progress = cursor.elapsedInIntervalSec / rampDurationSec;
        scaledTargetPowerWatts = Math.round(this.rampFromWatts + (blockTargetPowerWatts - this.rampFromWatts) * progress);
      }

      const metrics: WorkoutLiveMetrics = {
        timestamp: new Date().toISOString(),
        elapsedSec,
        blockIndex: cursor.index,
        blockKind: cursor.interval.kind,
        targetPowerWatts: scaledTargetPowerWatts,
        targetResistancePercent: scaledTargetResistancePercent,
        actualPowerWatts: this.latestTelemetry?.powerWatts ?? null,
        actualCadenceRpm: this.latestTelemetry?.cadenceRpm ?? null
      };

      await this.applyTargets(metrics);
      this.persistTelemetry(metrics);
      this.patchState({
        elapsedSec,
        currentIntervalIndex: cursor.index,
        liveMetrics: metrics
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workout engine error";
      console.error("[ErgWorkoutEngine] tick failure:", error);
      this.persistEvent("tick-failure", { message });
      await this.completeSession("error", "tick-failure");
      this.patchState({ lastError: message });
      await this.safeErgStop();
    } finally {
      this.expectedNextTickAtMs = Date.now() + 1000;
      this.tickInFlight = false;
    }
  }

  private async safeErgStop(): Promise<void> {
    const deviceId = this.state.deviceId;
    if (!deviceId) {
      return;
    }
    try {
      await this.bleService.safeErgStop(deviceId);
    } catch (error) {
      console.error("[ErgWorkoutEngine] safe stop failed:", error);
      this.persistEvent("safe-stop-failed", { message: "Failed to transmit safe stop over BLE" });
    }
  }

  private async safeStartOrResume(): Promise<void> {
    const deviceId = this.state.deviceId;
    if (!deviceId) {
      return;
    }
    try {
      await this.bleService.startOrResume(deviceId);
    } catch (error) {
      console.error("[ErgWorkoutEngine] start-or-resume failed:", error);
      this.persistEvent("start-or-resume-failed", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  private async pauseErg(): Promise<void> {
    const deviceId = this.state.deviceId;
    if (!deviceId) {
      return;
    }
    try {
      await this.bleService.stopOrPause(deviceId, "pause");
    } catch (error) {
      console.error("[ErgWorkoutEngine] pause failed:", error);
      this.persistEvent("pause-failed", {
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  private async handleDisconnectFailsafe(disconnectLifecycle: "disconnected" | "error"): Promise<void> {
    if (!this.state.sessionId || this.state.lifecycle === "degraded" || this.state.lifecycle === "stopped") {
      return;
    }
    this.persistEvent("disconnect-failsafe", { disconnectLifecycle });
    await this.completeSession("degraded", "ble-disconnect-failsafe");
    await this.safeErgStop();
  }

  async start(request: StartWorkoutSessionRequest): Promise<string> {
    if (this.state.lifecycle === "running" || this.state.lifecycle === "paused") {
      throw new Error("A workout session is already active");
    }

    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    this.scheduler = new IntervalScheduler(request.intervals);
    this.sessionStartedAtMs = Date.now();
    this.pausedAtMs = null;
    this.totalPausedMs = 0;
    this.lastAppliedPowerWatts = null;
    this.lastAppliedResistancePercent = null;
    this.lastElapsedSec = 0;
    this.tickInFlight = false;
    this.expectedNextTickAtMs = Date.now() + 1000;
    this.rampBlockIndex = null;
    this.rampFromWatts = null;
    this.forceRampReset = false;

    this.persistence.workoutSessions.create({
      id: sessionId,
      workoutId: request.workoutId ?? null,
      deviceId: request.deviceId,
      startedAt,
      status: "running",
      summaryJson: JSON.stringify({
        intervalsTotal: request.intervals.length,
        metadata: request.metadata ?? {}
      })
    });

    this.emitState({
      sessionId,
      workoutId: request.workoutId ?? null,
      deviceId: request.deviceId,
      lifecycle: "running",
      startedAt,
      pausedAt: null,
      endedAt: null,
      elapsedSec: 0,
      currentIntervalIndex: 0,
      intervalsTotal: request.intervals.length,
      lastError: null,
      liveMetrics: null,
      intensityMultiplier: 1,
      rampDurationSec: this.state.rampDurationSec
    });
    this.persistEvent("session-started", { workoutId: request.workoutId ?? null });

    await this.safeStartOrResume();

    this.stopTicking();
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 1000);
    await this.tick();
    return sessionId;
  }

  async pause(sessionId: string): Promise<void> {
    this.requireActiveSession(sessionId);
    if (this.state.lifecycle !== "running") {
      throw new Error("Session must be running to pause");
    }
    this.pausedAtMs = Date.now();
    this.expectedNextTickAtMs = null;
    this.stopTicking();
    this.persistence.workoutSessions.updateStatus({
      id: sessionId,
      status: "paused"
    });
    this.persistEvent("session-paused", { elapsedSec: this.state.elapsedSec });
    this.patchState({
      lifecycle: "paused",
      pausedAt: new Date().toISOString()
    });
    await this.pauseErg();
  }

  async resume(sessionId: string): Promise<void> {
    this.requireActiveSession(sessionId);
    if (this.state.lifecycle !== "paused" || !this.pausedAtMs) {
      throw new Error("Session must be paused to resume");
    }
    this.totalPausedMs += Date.now() - this.pausedAtMs;
    this.pausedAtMs = null;
    this.persistence.workoutSessions.updateStatus({
      id: sessionId,
      status: "running"
    });
    this.persistEvent("session-resumed", { elapsedSec: this.state.elapsedSec });
    this.patchState({
      lifecycle: "running",
      pausedAt: null
    });
    this.forceRampReset = true;
    await this.safeStartOrResume();
    this.expectedNextTickAtMs = Date.now() + 1000;
    this.stopTicking();
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 1000);
    await this.tick();
  }

  setIntensity(sessionId: string, multiplier: number): void {
    this.requireActiveSession(sessionId);
    if (this.state.lifecycle !== "running" && this.state.lifecycle !== "paused") {
      throw new Error("Session must be running or paused to adjust intensity");
    }
    const clamped = Math.min(this.maxIntensityMultiplier, Math.max(this.minIntensityMultiplier, multiplier));
    this.persistEvent("intensity-changed", { intensityMultiplier: clamped });
    this.patchState({ intensityMultiplier: clamped });
  }

  setRampDuration(sessionId: string, seconds: number): void {
    this.requireActiveSession(sessionId);
    if (this.state.lifecycle !== "running" && this.state.lifecycle !== "paused") {
      throw new Error("Session must be running or paused to adjust ramp duration");
    }
    const clamped = Math.min(this.maxRampDurationSec, Math.max(0, seconds));
    this.persistEvent("ramp-duration-changed", { rampDurationSec: clamped });
    this.patchState({ rampDurationSec: clamped });
  }

  async stop(sessionId: string): Promise<void> {
    this.requireActiveSession(sessionId);
    await this.completeSession("stopped", "manual-stop");
    await this.safeErgStop();
    this.scheduler = null;
  }

  getState(): WorkoutSessionState {
    return this.state;
  }

  subscribe(listener: (state: WorkoutSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
