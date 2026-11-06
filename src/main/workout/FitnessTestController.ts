import type { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import { bestRollingPower, computeHrCap, CAPPED_SETTLE_SEC, RAMP_FTP_FACTOR } from "@shared/fitnessTest";
import type { FitnessTestVariant } from "@shared/fitnessTest";
import {
  buildFitnessTest,
  phaseAt,
  phaseRange,
  type FitnessTestPlan,
  type FitnessTestSeedProfile
} from "@shared/fitnessTestProtocol";
import type { FitnessTestLiveState, WorkoutSessionState } from "@shared/ipc/contracts";

/** Ramp failure: below this cadence... [calibrate] */
const FAIL_CADENCE_RPM = 55;
/** ...or below this share of the target power... [calibrate] */
const FAIL_POWER_FRACTION = 0.8;
/** ...for this many consecutive seconds. [calibrate] */
const FAIL_HOLD_SEC = 5;
/** Countdown shown before jumping to recovery, during which the rider can say "keep going". */
const RAMP_END_COUNTDOWN_SEC = 5;
/** After "keep going", failure detection is ignored for this long. */
const KEEP_GOING_GRACE_SEC = 15;
/** HR band under the cap that counts as "hold it here". */
const HR_HOLD_BAND_BPM = 3;
/** Show a starting-power suggestion for this long into the capped effort. */
const SUGGEST_START_SEC = 180;

type RampEndReason = NonNullable<FitnessTestLiveState["rampEndReason"]>;

/**
 * Coaches a fitness-test session on top of the generic ERG engine: tracks the
 * phase from the workout position, detects ramp failure, computes the HR cap
 * when the ramp ends, jumps the rider to recovery (or cool-down when there's
 * no heart rate), and keeps the capped-effort guidance current. The engine
 * stays test-agnostic; this class only talks to it through seek(),
 * setFitnessTestState() and recordEvent().
 */
export class FitnessTestController {
  private plan: FitnessTestPlan | null = null;
  private sessionId: string | null = null;
  private live: FitnessTestLiveState | null = null;
  private rampSamples: Array<{ powerWatts: number | null; heartRateBpm: number | null }> = [];
  private cappedScoredPowers: number[] = [];
  private lastClockSec = -1;
  private lowSec = 0;
  private graceSec = 0;
  private pendingRampEndReason: RampEndReason | null = null;
  private processing = false;

  constructor(private readonly engine: ErgWorkoutEngine) {
    engine.subscribe((state) => this.onState(state));
  }

  async start(input: {
    deviceId: string;
    variant: FitnessTestVariant;
    profile: FitnessTestSeedProfile;
  }): Promise<{ sessionId: string; plan: FitnessTestPlan }> {
    const plan = buildFitnessTest(input.profile, input.variant);
    const sessionId = await this.engine.start({
      workoutId: null,
      deviceId: input.deviceId,
      intervals: plan.intervals,
      metadata: { source: "fitness-test", variant: plan.variant }
    });
    this.attach(sessionId, plan);
    // Everything slice-4 scoring needs to rebuild the phases from telemetry.
    this.engine.recordEvent(sessionId, "fitness-test-started", {
      variant: plan.variant,
      phases: plan.phases,
      mapSeedWatts: plan.mapSeedWatts,
      mapSeedSource: plan.mapSeedSource,
      rampStartWatts: plan.rampStartWatts,
      rampStepWatts: plan.rampStepWatts,
      rampStepSec: plan.rampStepSec,
      rampStepCount: plan.rampStepCount
    });
    return { sessionId, plan };
  }

  /** Rider pressed "End ramp": finish it now, no countdown. */
  endRamp(sessionId: string): void {
    this.requireSession(sessionId);
    if (this.live?.phase !== "ramp" || this.live.rampEnded) {
      throw new Error("The ramp isn't running");
    }
    this.finishRamp("rider");
  }

  /** Rider pressed "Keep going" during the ramp-complete countdown. */
  keepGoing(sessionId: string): void {
    this.requireSession(sessionId);
    if (this.pendingRampEndReason === null) {
      return;
    }
    this.pendingRampEndReason = null;
    this.lowSec = 0;
    this.graceSec = KEEP_GOING_GRACE_SEC;
    this.engine.recordEvent(sessionId, "fitness-test-keep-going", {});
    this.publish({ rampEndCountdownSec: null });
  }

  private requireSession(sessionId: string): void {
    if (!this.plan || this.sessionId !== sessionId) {
      throw new Error(`No fitness test running for session ${sessionId}`);
    }
  }

  private attach(sessionId: string, plan: FitnessTestPlan): void {
    this.plan = plan;
    this.sessionId = sessionId;
    this.rampSamples = [];
    this.cappedScoredPowers = [];
    this.lastClockSec = -1;
    this.lowSec = 0;
    this.graceSec = 0;
    this.pendingRampEndReason = null;
    this.live = {
      variant: plan.variant,
      plannedVariant: plan.variant,
      phase: "warmup",
      phases: plan.phases,
      rampStepWatts: plan.rampStepWatts,
      rampStepSec: plan.rampStepSec,
      rampEnded: false,
      rampEndReason: null,
      rampEndCountdownSec: null,
      liveMapWatts: null,
      hrCapBpm: null,
      downgradedReason: null,
      cappedElapsedSec: 0,
      cappedScoredAvgPowerWatts: null,
      hrGuidance: null,
      suggestedStartWatts: null,
      minSeekPositionSec: null
    };
    this.engine.setFitnessTestState(sessionId, this.live);
  }

  private detach(): void {
    this.plan = null;
    this.sessionId = null;
    this.live = null;
    this.pendingRampEndReason = null;
  }

  private publish(patch: Partial<FitnessTestLiveState>): void {
    if (!this.live || !this.sessionId) return;
    this.live = { ...this.live, ...patch };
    this.engine.setFitnessTestState(this.sessionId, this.live);
  }

  private onState(state: WorkoutSessionState): void {
    // Our own seek()/setFitnessTestState() calls emit state too; skip those echoes.
    if (this.processing || !this.plan || !this.live) return;
    if (state.sessionId !== this.sessionId) {
      // Discarded (idle) or another session started.
      this.detach();
      return;
    }
    this.processing = true;
    try {
      this.process(state);
    } finally {
      this.processing = false;
    }
  }

  private process(state: WorkoutSessionState): void {
    // The rider stopped pedaling and auto-pause beat the countdown: jump now,
    // so they pedal straight into recovery when they start again.
    if (state.lifecycle === "paused" && this.pendingRampEndReason !== null) {
      this.finishRamp(this.pendingRampEndReason);
      return;
    }
    if (state.lifecycle !== "running") return;
    const metrics = state.liveMetrics;
    if (!metrics || metrics.elapsedSec === this.lastClockSec) return;
    this.lastClockSec = metrics.elapsedSec;

    const plan = this.plan!;
    const range = phaseAt(plan.phases, metrics.positionSec);
    const phase = range?.phase ?? null;
    const patch: Partial<FitnessTestLiveState> = { phase };
    const ramp = phaseRange(plan.phases, "ramp")!;

    if (phase === "ramp" && !this.live!.rampEnded) {
      this.rampSamples.push({ powerWatts: metrics.actualPowerWatts, heartRateBpm: metrics.actualHeartRateBpm });
      patch.liveMapWatts = this.roundOrNull(bestRollingPower(this.rampSamples.map((sample) => sample.powerWatts)));
      patch.minSeekPositionSec = metrics.positionSec;
      this.publish(patch);
      this.trackRampFailure(metrics);
      return;
    }

    if (phase !== null && phase !== "warmup" && !this.live!.rampEnded) {
      // Left the ramp without failing in it: rode every step, or dragged past it.
      const finished = metrics.positionSec - ramp.endSec <= 2 && this.rampSamples.length >= ramp.endSec - ramp.startSec - 2;
      this.publish(patch);
      this.finishRamp(finished ? "finished" : "skipped", { seek: false });
      return;
    }

    if (phase === "capped") {
      if (this.live!.hrCapBpm === null) {
        // No cap means nothing to ride against; score the ramp instead.
        this.publish(patch);
        this.downgrade("No heart rate was recorded in the ramp, so the capped effort was skipped.");
        return;
      }
      const cappedElapsedSec = metrics.positionSec - phaseRange(plan.phases, "capped")!.startSec;
      patch.cappedElapsedSec = cappedElapsedSec;
      if (cappedElapsedSec >= CAPPED_SETTLE_SEC && metrics.actualPowerWatts !== null) {
        this.cappedScoredPowers.push(metrics.actualPowerWatts);
      }
      patch.cappedScoredAvgPowerWatts =
        this.cappedScoredPowers.length > 0
          ? Math.round(this.cappedScoredPowers.reduce((sum, watts) => sum + watts, 0) / this.cappedScoredPowers.length)
          : null;
      patch.hrGuidance = this.guidanceFor(metrics.actualHeartRateBpm, this.live!.hrCapBpm);
      patch.suggestedStartWatts =
        cappedElapsedSec < SUGGEST_START_SEC && this.live!.liveMapWatts !== null
          ? Math.round(RAMP_FTP_FACTOR * this.live!.liveMapWatts)
          : null;
    } else {
      patch.hrGuidance = null;
      patch.suggestedStartWatts = null;
    }
    this.publish(patch);
  }

  private trackRampFailure(metrics: NonNullable<WorkoutSessionState["liveMetrics"]>): void {
    if (this.pendingRampEndReason !== null) {
      const remaining = (this.live!.rampEndCountdownSec ?? 0) - 1;
      if (remaining <= 0) {
        this.finishRamp(this.pendingRampEndReason);
      } else {
        this.publish({ rampEndCountdownSec: remaining });
      }
      return;
    }
    if (this.graceSec > 0) {
      this.graceSec -= 1;
      return;
    }
    const cadence = metrics.actualCadenceRpm;
    const power = metrics.actualPowerWatts;
    const target = metrics.targetPowerWatts;
    const struggling =
      cadence === null ||
      cadence < FAIL_CADENCE_RPM ||
      power === null ||
      (target !== null && target > 0 && power < FAIL_POWER_FRACTION * target);
    this.lowSec = struggling ? this.lowSec + 1 : 0;
    if (this.lowSec >= FAIL_HOLD_SEC) {
      this.pendingRampEndReason = "failure";
      this.engine.recordEvent(this.sessionId!, "fitness-test-failure-detected", {
        positionSec: metrics.positionSec,
        cadenceRpm: cadence,
        powerWatts: power,
        targetPowerWatts: target
      });
      this.publish({ rampEndCountdownSec: RAMP_END_COUNTDOWN_SEC });
    }
  }

  private finishRamp(reason: RampEndReason, options: { seek: boolean } = { seek: true }): void {
    const plan = this.plan!;
    const hrCapBpm = computeHrCap(this.rampSamples, plan.rampStepSec);
    const liveMapWatts = this.roundOrNull(bestRollingPower(this.rampSamples.map((sample) => sample.powerWatts)));
    this.pendingRampEndReason = null;
    const ramp = phaseRange(plan.phases, "ramp")!;
    this.publish({
      rampEnded: true,
      rampEndReason: reason,
      rampEndCountdownSec: null,
      hrCapBpm,
      liveMapWatts,
      minSeekPositionSec: ramp.endSec
    });
    this.engine.recordEvent(this.sessionId!, "fitness-test-ramp-ended", {
      reason,
      rampSec: this.rampSamples.length,
      mapWatts: liveMapWatts,
      hrCapBpm
    });

    if (this.live!.variant === "full" && hrCapBpm === null) {
      this.downgrade("No heart rate was recorded in the ramp, so the capped effort was skipped.");
      return;
    }
    if (!options.seek) return;
    const next = phaseRange(plan.phases, this.live!.variant === "full" ? "recovery" : "cooldown");
    if (next) this.seekTo(next.startSec);
  }

  private downgrade(reason: string): void {
    const cooldown = phaseRange(this.plan!.phases, "cooldown")!;
    this.publish({ variant: "quick", downgradedReason: reason, minSeekPositionSec: cooldown.startSec });
    this.engine.recordEvent(this.sessionId!, "fitness-test-downgraded", { reason });
    this.seekTo(cooldown.startSec);
  }

  private seekTo(positionSec: number): void {
    try {
      this.engine.seek(this.sessionId!, positionSec);
    } catch (error) {
      console.error("[FitnessTestController] seek failed:", error);
    }
  }

  private guidanceFor(heartRateBpm: number | null, capBpm: number | null): FitnessTestLiveState["hrGuidance"] {
    if (heartRateBpm === null || capBpm === null) return null;
    if (heartRateBpm > capBpm) return "ease";
    if (heartRateBpm >= capBpm - HR_HOLD_BAND_BPM) return "hold";
    return "push";
  }

  private roundOrNull(value: number | null): number | null {
    return value === null ? null : Math.round(value);
  }
}
