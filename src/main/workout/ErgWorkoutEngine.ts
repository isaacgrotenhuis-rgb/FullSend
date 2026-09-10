import { randomUUID } from "node:crypto";
import { IntervalScheduler } from "@main/workout/intervalScheduler";
import type { BleService } from "@main/ble/types";
import type {
  BleState,
  StartWorkoutSessionRequest,
  WorkoutLiveMetrics,
  WorkoutSessionLifecycle,
  WorkoutSessionState,
  WorkoutSessionSummary
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
    deleteById: (id: string) => void;
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
      targetCadenceRpm: number | null;
      actualPowerWatts: number | null;
      actualCadenceRpm: number | null;
      actualHeartRateBpm: number | null;
      actualSpeedKmh: number | null;
      actualDistanceMeters: number | null;
      payloadJson: string;
    }) => void;
    getAverages: (sessionId: string) => {
      avgPowerWatts: number | null;
      avgCadenceRpm: number | null;
      avgHeartRateBpm: number | null;
      avgSpeedKmh: number | null;
      distanceMeters: number | null;
    };
    getSeries: (sessionId: string) => Array<{
      elapsedSec: number;
      actualPowerWatts: number | null;
      actualCadenceRpm: number | null;
      actualHeartRateBpm: number | null;
      actualSpeedKmh: number | null;
    }>;
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
  interruptReason: null,
  liveMetrics: null,
  intensityMultiplier: 1,
  rampDurationSec: 10
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
  // A live tile (power/cadence/speed/HR) reflects a real sensor reading only while a
  // fresh sample keeps arriving. Trainers and straps go quiet when you stop pedaling
  // or the signal drops rather than sending an explicit 0, so once a source hasn't
  // reported for this long we surface it as "no reading" (null → em dash) instead of
  // freezing the last value. Matters most while paused, where nothing else moves.
  private readonly staleTelemetryMs = 3000;
  private rampBlockIndex: number | null = null;
  private rampFromWatts: number | null = null;
  private forceRampReset = false;
  private latestTelemetry: {
    powerWatts: number | null;
    cadenceRpm: number | null;
    speedKmh: number | null;
    distanceMeters: number | null;
  } | null = null;
  private latestTelemetryAtMs: number | null = null;
  private latestHeartRateBpm: number | null = null;
  private latestHeartRateAtMs: number | null = null;
  private lastSeenTelemetryRef: BleState["liveTelemetry"] = null;
  private lastSeenHeartRateRef: BleState["heartRate"] = null;
  // Trainers may report a cumulative odometer via FTMS (source of truth for this ride
  // once seen); many never set that optional flag, so distance falls back to
  // integrating speed live, tick by tick. Both paths are baselined to the first
  // reading seen this session, so a trainer's persistent lifetime odometer doesn't
  // leak into a single ride's distance.
  private trainerDistanceBaselineMeters: number | null = null;
  private fallbackDistanceMeters = 0;
  private sessionDistanceMeters = 0;
  private hasDistanceReading = false;
  private lastEndReason: string | null = null;
  // Trainer-disconnect handling (#52). A mid-ride BLE drop pauses the session and
  // prompts the rider to reconnect instead of ending it outright.
  //   - debounce: ignore a brief blip; only treat it as an interruption after this.
  //   - grace: auto-finalize the session if it never reconnects within this window.
  //   - poll: how often the engine itself retries the trainer connection.
  private readonly disconnectDebounceMs = 3000;
  private readonly reconnectGraceMs = 5 * 60_000;
  private readonly reconnectPollMs = 4000;
  private disconnectDebounceTimer: NodeJS.Timeout | null = null;
  private reconnectGraceTimer: NodeJS.Timeout | null = null;
  private reconnectPollTimer: NodeJS.Timeout | null = null;
  private interruptReason: WorkoutSessionState["interruptReason"] = null;
  // Where a successful reconnect should return the session: "running" when the drop
  // interrupted an active ride, "paused" when the rider had already paused.
  private interruptResumeLifecycle: "running" | "paused" | null = null;
  private readonly terminalLifecycles = new Set<WorkoutSessionLifecycle>(["stopped", "completed", "degraded", "error"]);
  private listeners = new Set<(state: WorkoutSessionState) => void>();

  constructor(bleService: BleService, persistence: WorkoutPersistence) {
    this.bleService = bleService;
    this.persistence = persistence;
    this.bleService.subscribeState((bleState) => {
      const nowMs = Date.now();
      // subscribeState fires on every BLE state change, not only telemetry updates.
      // The BLE layer swaps in a fresh liveTelemetry / heartRate object for each new
      // sample and leaves the reference untouched otherwise, so an identity change is
      // our "a new reading landed" signal — used to age out stale tiles below.
      if (bleState.liveTelemetry !== this.lastSeenTelemetryRef) {
        this.lastSeenTelemetryRef = bleState.liveTelemetry ?? null;
        this.latestTelemetry = bleState.liveTelemetry
          ? {
              powerWatts: bleState.liveTelemetry.powerWatts,
              cadenceRpm: bleState.liveTelemetry.cadenceRpm,
              speedKmh: bleState.liveTelemetry.speedKmh,
              distanceMeters: bleState.liveTelemetry.distanceMeters
            }
          : null;
        this.latestTelemetryAtMs = bleState.liveTelemetry ? nowMs : null;
      }
      if (bleState.heartRate !== this.lastSeenHeartRateRef) {
        this.lastSeenHeartRateRef = bleState.heartRate ?? null;
        this.latestHeartRateBpm = bleState.heartRate?.bpm ?? null;
        this.latestHeartRateAtMs = bleState.heartRate ? nowMs : null;
      }
      const sessionInProgress =
        this.state.sessionId !== null &&
        (this.state.lifecycle === "running" || this.state.lifecycle === "paused");
      const trainerDown = bleState.lifecycle === "disconnected" || bleState.lifecycle === "error";
      if (sessionInProgress && trainerDown && this.interruptReason === null && this.disconnectDebounceTimer === null) {
        this.beginDisconnectDebounce();
      } else if (bleState.lifecycle === "connected") {
        this.cancelDisconnectDebounce();
        if (sessionInProgress && this.interruptReason !== null) {
          void this.handleTrainerReconnected();
        }
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
      targetCadenceRpm: metrics.targetCadenceRpm,
      actualPowerWatts: metrics.actualPowerWatts,
      actualCadenceRpm: metrics.actualCadenceRpm,
      actualHeartRateBpm: metrics.actualHeartRateBpm,
      actualSpeedKmh: metrics.actualSpeedKmh,
      actualDistanceMeters: metrics.actualDistanceMeters,
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
    this.clearInterruptTimers();
    this.interruptReason = null;
    this.interruptResumeLifecycle = null;
    this.expectedNextTickAtMs = null;
    this.tickInFlight = false;
    this.lastEndReason = reason;
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
      endedAt,
      interruptReason: null
    });
    this.scheduler = null;
  }

  // A live actual is real only while its sensor keeps reporting. Once a source has
  // been silent past staleTelemetryMs — you stopped pedaling, or the signal dropped —
  // surface it as "no reading" (null) rather than the frozen last value. The held
  // last-known reading stays in this.latestTelemetry so it can recover instantly.
  private resolveActuals(nowMs: number): {
    telemetry: ErgWorkoutEngine["latestTelemetry"];
    powerWatts: number | null;
    cadenceRpm: number | null;
    speedKmh: number | null;
    heartRateBpm: number | null;
  } {
    const telemetryFresh =
      this.latestTelemetryAtMs !== null && nowMs - this.latestTelemetryAtMs <= this.staleTelemetryMs;
    const heartRateFresh =
      this.latestHeartRateAtMs !== null && nowMs - this.latestHeartRateAtMs <= this.staleTelemetryMs;
    const telemetry = telemetryFresh ? this.latestTelemetry : null;
    return {
      telemetry,
      powerWatts: telemetry?.powerWatts ?? null,
      cadenceRpm: telemetry?.cadenceRpm ?? null,
      speedKmh: telemetry?.speedKmh ?? null,
      heartRateBpm: heartRateFresh ? this.latestHeartRateBpm : null
    };
  }

  // While paused, keep the live tiles (HR, cadence, power, speed) tracking the sensor
  // stream, but hold everything the rider controls: elapsed clock, interval cursor,
  // and target tiles stay put, and no ERG control-point write goes out. Target tiles
  // hold their last programmed value; live tiles that go quiet fall to "no reading".
  private tickPaused(): void {
    if (!this.scheduler) {
      return;
    }
    const nowMs = Date.now();
    const frozenElapsedSec = this.lastElapsedSec;
    const held = this.state.liveMetrics;
    const cursor = this.scheduler.locate(frozenElapsedSec);
    const actuals = this.resolveActuals(nowMs);
    const metrics: WorkoutLiveMetrics = {
      timestamp: new Date().toISOString(),
      elapsedSec: frozenElapsedSec,
      blockIndex: held?.blockIndex ?? cursor?.index ?? this.state.currentIntervalIndex ?? 0,
      blockKind: held?.blockKind ?? cursor?.interval.kind ?? "work",
      targetPowerWatts: held?.targetPowerWatts ?? null,
      targetResistancePercent: held?.targetResistancePercent ?? null,
      targetCadenceRpm: held?.targetCadenceRpm ?? cursor?.interval.targetCadenceRpm ?? null,
      actualPowerWatts: actuals.powerWatts,
      actualCadenceRpm: actuals.cadenceRpm,
      actualHeartRateBpm: actuals.heartRateBpm,
      actualSpeedKmh: actuals.speedKmh,
      // Distance is frozen — a paused rider isn't covering ground.
      actualDistanceMeters: held?.actualDistanceMeters ?? (this.hasDistanceReading ? this.sessionDistanceMeters : null)
    };
    this.patchState({ liveMetrics: metrics });
  }

  private async tick(): Promise<void> {
    if (!this.scheduler || this.tickInFlight) {
      return;
    }
    if (this.state.lifecycle === "paused") {
      this.tickPaused();
      return;
    }
    if (this.state.lifecycle !== "running") {
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
      const deltaSec = Math.max(0, elapsedSec - this.lastElapsedSec);
      this.lastElapsedSec = elapsedSec;
      const cursor = this.scheduler.locate(elapsedSec);

      if (!cursor) {
        // The scheduler reports "past the end" the instant elapsed reaches the
        // total duration, so this tick's elapsedSec (e.g. 3960 for a 66:00
        // workout) is never patched into state before we bail. Snap state up to
        // the full duration here so the recorded/displayed length is 66:00, not
        // 65:59 — this value also feeds Strava elapsed_time and "actually did".
        this.patchState({ elapsedSec: this.scheduler.getTotalDurationSec() });
        await this.completeSession("completed", "all-intervals-finished");
        await this.safeErgStop();
        return;
      }

      const intensityMultiplier = this.state.intensityMultiplier;
      // cursor.targetPowerWatts is already interpolated for ramp intervals
      // (targetPowerWattsEnd set); flat blocks pass through unchanged.
      const blockTargetPowerWatts =
        cursor.targetPowerWatts !== null
          ? Math.max(0, Math.round(cursor.targetPowerWatts * intensityMultiplier))
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

      const actuals = this.resolveActuals(nowMs);
      const metrics: WorkoutLiveMetrics = {
        timestamp: new Date().toISOString(),
        elapsedSec,
        blockIndex: cursor.index,
        blockKind: cursor.interval.kind,
        targetPowerWatts: scaledTargetPowerWatts,
        targetResistancePercent: scaledTargetResistancePercent,
        // Display-only cadence target; not scaled by intensity, no control-point write.
        // Free-ride blocks (targetPowerWatts null + targetResistancePercent 0) fall
        // through applyTargets() to FTMS Set Target Resistance Level (slope mode).
        targetCadenceRpm: cursor.interval.targetCadenceRpm ?? null,
        actualPowerWatts: actuals.powerWatts,
        actualCadenceRpm: actuals.cadenceRpm,
        actualHeartRateBpm: actuals.heartRateBpm,
        actualSpeedKmh: actuals.speedKmh,
        actualDistanceMeters: this.updateDistance(deltaSec, actuals.telemetry)
      };

      let applyTargetsError: string | null = null;
      try {
        await this.applyTargets(metrics);
      } catch (error) {
        // A failed/timed-out target push (flaky control-point write) shouldn't stop
        // reporting live power/cadence/elapsed time, which arrive independently over
        // the indoor-bike-data notification stream.
        applyTargetsError = error instanceof Error ? error.message : "Unknown ERG target error";
        console.error("[ErgWorkoutEngine] apply targets failed:", error);
        this.persistEvent("apply-targets-failed", { message: applyTargetsError });
      }

      this.persistTelemetry(metrics);
      this.patchState({
        elapsedSec,
        currentIntervalIndex: cursor.index,
        liveMetrics: metrics,
        lastError: applyTargetsError
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

  private updateDistance(deltaSec: number, telemetry: ErgWorkoutEngine["latestTelemetry"]): number | null {
    const trainerDistanceMeters = telemetry?.distanceMeters ?? null;
    if (trainerDistanceMeters !== null) {
      if (this.trainerDistanceBaselineMeters === null) {
        this.trainerDistanceBaselineMeters = trainerDistanceMeters;
      }
      this.sessionDistanceMeters = Math.max(0, trainerDistanceMeters - this.trainerDistanceBaselineMeters);
      this.hasDistanceReading = true;
    } else if (this.trainerDistanceBaselineMeters === null) {
      const speedKmh = telemetry?.speedKmh ?? null;
      if (speedKmh !== null) {
        this.fallbackDistanceMeters += (speedKmh * 1000 * deltaSec) / 3600;
        this.sessionDistanceMeters = this.fallbackDistanceMeters;
        this.hasDistanceReading = true;
      }
    }
    return this.hasDistanceReading ? this.sessionDistanceMeters : null;
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

  private clearInterruptTimers(): void {
    this.cancelDisconnectDebounce();
    if (this.reconnectGraceTimer) {
      clearTimeout(this.reconnectGraceTimer);
      this.reconnectGraceTimer = null;
    }
    if (this.reconnectPollTimer) {
      clearInterval(this.reconnectPollTimer);
      this.reconnectPollTimer = null;
    }
  }

  private cancelDisconnectDebounce(): void {
    if (this.disconnectDebounceTimer) {
      clearTimeout(this.disconnectDebounceTimer);
      this.disconnectDebounceTimer = null;
    }
  }

  // A trainer dropout fires BLE "disconnected"/"error" events that can also be a
  // momentary blip. Wait out disconnectDebounceMs before treating it as a real
  // interruption; if the link is back by then, the ride never noticed.
  private beginDisconnectDebounce(): void {
    this.persistEvent("trainer-disconnect-detected", {});
    this.disconnectDebounceTimer = setTimeout(() => {
      this.disconnectDebounceTimer = null;
      if (this.bleService.getState().lifecycle === "connected") {
        return;
      }
      void this.enterInterrupted();
    }, this.disconnectDebounceMs);
  }

  // Trainer is really gone: freeze the session like a pause (clock, cursor and
  // targets hold — see tickPaused), surface interruptReason so the ride screen can
  // prompt for reconnect, and start both the background reconnect poll and the
  // auto-finalize grace timer. Data collected so far is untouched.
  private async enterInterrupted(): Promise<void> {
    if (!this.state.sessionId || this.interruptReason !== null) {
      return;
    }
    if (this.state.lifecycle !== "running" && this.state.lifecycle !== "paused") {
      return;
    }
    this.interruptResumeLifecycle = this.state.lifecycle === "running" ? "running" : "paused";
    this.interruptReason = "trainer-disconnected";
    if (this.state.lifecycle === "running") {
      // Same freeze bookkeeping as pause(): stop the elapsed clock from here.
      this.pausedAtMs = Date.now();
      this.expectedNextTickAtMs = null;
    }
    this.persistence.workoutSessions.updateStatus({ id: this.state.sessionId, status: "paused" });
    this.persistEvent("session-interrupted", {
      reason: this.interruptReason,
      resumeLifecycle: this.interruptResumeLifecycle,
      elapsedSec: this.state.elapsedSec
    });
    this.patchState({
      lifecycle: "paused",
      pausedAt: this.state.pausedAt ?? new Date().toISOString(),
      interruptReason: this.interruptReason
    });
    await this.pauseErg();
    // Arm both timers before the first reconnect attempt: a reconnect that lands
    // synchronously (e.g. in tests) runs handleTrainerReconnected, which clears
    // these — so they must already exist for that teardown to catch them.
    this.reconnectGraceTimer = setTimeout(() => {
      this.reconnectGraceTimer = null;
      void this.finalizeInterrupted("reconnect-grace-expired");
    }, this.reconnectGraceMs);
    this.reconnectPollTimer = setInterval(() => {
      this.attemptReconnect();
    }, this.reconnectPollMs);
    this.attemptReconnect();
  }

  // BleService runs its own short-lived auto-reconnect; this keeps retrying for the
  // whole grace window so a longer outage still recovers. connect() is a no-op while
  // BleService is already connecting or connected, so calling it on a timer is safe.
  private attemptReconnect(): void {
    if (this.interruptReason === null) {
      return;
    }
    const deviceId = this.state.deviceId;
    if (!deviceId || this.bleService.getState().lifecycle === "connected") {
      return;
    }
    void this.bleService.connect(deviceId, "power").catch((error) => {
      this.persistEvent("reconnect-attempt-failed", {
        message: error instanceof Error ? error.message : "Unknown reconnect error"
      });
    });
  }

  // Trainer came back before the grace window expired. Tear down the interrupt
  // timers and either resume the ride or, if the rider had already paused before
  // the drop, just leave it paused for them to resume by hand.
  private async handleTrainerReconnected(): Promise<void> {
    if (this.interruptReason === null || !this.state.sessionId) {
      return;
    }
    const resumeTo = this.interruptResumeLifecycle ?? "running";
    this.clearInterruptTimers();
    this.interruptReason = null;
    this.interruptResumeLifecycle = null;
    this.persistEvent("session-reconnected", { resumeTo, elapsedSec: this.state.elapsedSec });
    if (resumeTo === "running") {
      await this.resumeInternal(this.state.sessionId, "trainer-reconnected");
    } else {
      this.persistence.workoutSessions.updateStatus({ id: this.state.sessionId, status: "paused" });
      this.patchState({ interruptReason: null });
    }
  }

  // Grace window elapsed with no reconnect: finalize as "degraded" so everything
  // recorded up to the disconnect is preserved and can still be saved.
  private async finalizeInterrupted(reason: string): Promise<void> {
    if (this.interruptReason === null) {
      return;
    }
    this.interruptReason = null;
    this.interruptResumeLifecycle = null;
    this.persistEvent("session-interrupt-timeout", { reason });
    this.patchState({ interruptReason: null });
    await this.completeSession("degraded", reason);
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
    this.lastEndReason = null;
    this.trainerDistanceBaselineMeters = null;
    this.fallbackDistanceMeters = 0;
    this.sessionDistanceMeters = 0;
    this.hasDistanceReading = false;
    this.clearInterruptTimers();
    this.interruptReason = null;
    this.interruptResumeLifecycle = null;

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
      interruptReason: null,
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
    // The tick timer keeps running through a pause so live tiles (HR, cadence, power)
    // stay current; the loop routes to tickPaused(), which holds the clock, cursor,
    // and targets. It's torn down for real in completeSession()/stop().
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
    if (this.interruptReason !== null) {
      throw new Error("Trainer disconnected — reconnect the trainer to resume");
    }
    await this.resumeInternal(sessionId, "user-resumed");
  }

  // Shared by the manual resume() and the auto-resume after a trainer reconnect.
  // Both fold the paused span into totalPausedMs so elapsed time never counts the
  // seconds the rider (or the trainer) was away.
  private async resumeInternal(sessionId: string, reason: string): Promise<void> {
    if (this.pausedAtMs) {
      this.totalPausedMs += Date.now() - this.pausedAtMs;
    }
    this.pausedAtMs = null;
    this.interruptReason = null;
    this.interruptResumeLifecycle = null;
    this.persistence.workoutSessions.updateStatus({
      id: sessionId,
      status: "running"
    });
    this.persistEvent("session-resumed", { elapsedSec: this.state.elapsedSec, reason });
    this.patchState({
      lifecycle: "running",
      pausedAt: null,
      interruptReason: null
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

  finalizeSession(sessionId: string): WorkoutSessionSummary {
    this.requireActiveSession(sessionId);
    if (!this.terminalLifecycles.has(this.state.lifecycle)) {
      throw new Error("Session must have ended before it can be saved");
    }
    const averages = this.persistence.workoutSessionTelemetry.getAverages(sessionId);
    const avgPowerWatts = averages.avgPowerWatts !== null ? Math.round(averages.avgPowerWatts) : null;
    const avgCadenceRpm = averages.avgCadenceRpm !== null ? Math.round(averages.avgCadenceRpm) : null;
    const avgHeartRateBpm = averages.avgHeartRateBpm !== null ? Math.round(averages.avgHeartRateBpm) : null;
    const avgSpeedKmh = averages.avgSpeedKmh !== null ? Math.round(averages.avgSpeedKmh * 10) / 10 : null;
    // Each tick's actualDistanceMeters is already baselined-and-integrated live (see
    // updateDistance), so the max value recorded for the session is its total distance.
    const distanceMeters = averages.distanceMeters !== null ? Math.round(averages.distanceMeters) : null;

    this.persistence.workoutSessions.updateStatus({
      id: sessionId,
      status: "completed",
      summaryJson: JSON.stringify({
        endReason: this.lastEndReason ?? "unknown",
        elapsedSec: this.state.elapsedSec,
        currentIntervalIndex: this.state.currentIntervalIndex,
        avgPowerWatts,
        avgCadenceRpm,
        avgHeartRateBpm,
        // Persisted so historical reads (ride history / recap) don't have to re-scan
        // telemetry. Older completed rows predate these keys — readers fall back to a
        // telemetry MAX/AVG for those.
        avgSpeedKmh,
        distanceMeters,
        savedAt: new Date().toISOString()
      })
    });
    this.persistEvent("session-saved", { avgPowerWatts, avgCadenceRpm, avgHeartRateBpm });
    this.patchState({ lifecycle: "completed" });

    return {
      sessionId,
      durationSec: this.state.elapsedSec,
      avgPowerWatts,
      avgCadenceRpm,
      avgHeartRateBpm,
      avgSpeedKmh,
      distanceMeters
    };
  }

  getSessionTelemetrySeries(sessionId: string): Array<{
    elapsedSec: number;
    actualPowerWatts: number | null;
    actualCadenceRpm: number | null;
    actualHeartRateBpm: number | null;
    actualSpeedKmh: number | null;
  }> {
    this.requireActiveSession(sessionId);
    return this.persistence.workoutSessionTelemetry.getSeries(sessionId);
  }

  discardSession(sessionId: string): void {
    this.requireActiveSession(sessionId);
    if (!this.terminalLifecycles.has(this.state.lifecycle)) {
      throw new Error("Session must have ended before it can be discarded");
    }
    this.persistence.workoutSessions.deleteById(sessionId);
    this.lastEndReason = null;
    this.emitState(createIdleState());
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
