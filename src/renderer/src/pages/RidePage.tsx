import type { ReactElement } from "react";
import type { WorkoutInterval, WorkoutSessionState } from "@shared/ipc/contracts";
import { formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";

type Props = {
  activeIntervals: WorkoutInterval[];
  activeWorkoutName: string | null;
  workoutSessionState: WorkoutSessionState | null;
  liveWorkoutError: string | null;
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  pauseWorkout: () => Promise<void>;
  resumeWorkout: () => Promise<void>;
  stopWorkout: () => Promise<void>;
  closeLiveWorkout: () => void;
  adjustIntensity: (deltaFraction: number) => Promise<void>;
  rampDurationInput: string;
  setRampDurationInput: (value: string) => void;
  applyRampDuration: () => Promise<void>;
};

export const RidePage = ({
  activeIntervals,
  activeWorkoutName,
  workoutSessionState,
  liveWorkoutError,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  pauseWorkout,
  resumeWorkout,
  stopWorkout,
  closeLiveWorkout,
  adjustIntensity,
  rampDurationInput,
  setRampDurationInput,
  applyRampDuration
}: Props): ReactElement => (
  <main className="app">
    <section>
      <h2>Live workout{activeWorkoutName ? `: ${activeWorkoutName}` : ""}</h2>
      <p>
        Status: {workoutSessionState?.lifecycle ?? "idle"} — elapsed{" "}
        {formatClock(workoutSessionState?.elapsedSec ?? 0)} /{" "}
        {formatClock(activeIntervals.reduce((sum, interval) => sum + interval.durationSec, 0))}
      </p>
      {workoutSessionState?.liveMetrics ? (
        <p>
          Current block: {workoutSessionState.liveMetrics.blockKind} — target{" "}
          {workoutSessionState.liveMetrics.targetPowerWatts ?? "-"} W
          {" · actual "}
          {workoutSessionState.liveMetrics.actualPowerWatts ?? "-"} W
          {workoutSessionState.liveMetrics.actualCadenceRpm !== null
            ? ` · ${Math.round(workoutSessionState.liveMetrics.actualCadenceRpm)} rpm`
            : ""}
          {workoutSessionState.liveMetrics.targetResistancePercent !== null
            ? ` / ${workoutSessionState.liveMetrics.targetResistancePercent}% resistance`
            : ""}
        </p>
      ) : null}
      {liveWorkoutError ? <p>Error: {liveWorkoutError}</p> : null}
      {workoutSessionState?.lastError ? <p>Session error: {workoutSessionState.lastError}</p> : null}

      <WorkoutTimelineChart
        intervals={activeIntervals}
        elapsedSec={workoutSessionState?.elapsedSec ?? 0}
        currentIndex={workoutSessionState?.currentIntervalIndex ?? null}
        actualPowerWatts={workoutSessionState?.liveMetrics?.actualPowerWatts ?? null}
      />

      <div className="row">
        {workoutSessionState?.lifecycle === "running" ? (
          <button onClick={() => void pauseWorkout()} disabled={liveWorkoutBusy}>
            Pause
          </button>
        ) : null}
        {workoutSessionState?.lifecycle === "paused" ? (
          <button onClick={() => void resumeWorkout()} disabled={liveWorkoutBusy}>
            Resume
          </button>
        ) : null}
        {isWorkoutSessionActive ? (
          <button onClick={() => void stopWorkout()} disabled={liveWorkoutBusy}>
            End workout
          </button>
        ) : (
          <button onClick={closeLiveWorkout} disabled={liveWorkoutBusy}>
            Close
          </button>
        )}
      </div>

      <div className="row">
        <span>Intensity: {Math.round((workoutSessionState?.intensityMultiplier ?? 1) * 100)}%</span>
        <button onClick={() => void adjustIntensity(-0.05)} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
          -5%
        </button>
        <button onClick={() => void adjustIntensity(0.05)} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
          +5%
        </button>
      </div>

      <div className="row">
        <label>
          Ramp-in duration (sec){" "}
          <input
            type="number"
            min={0}
            max={60}
            value={rampDurationInput}
            onChange={(event) => setRampDurationInput(event.target.value)}
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          />
        </label>
        <button onClick={() => void applyRampDuration()} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
          Apply
        </button>
      </div>
    </section>
  </main>
);
