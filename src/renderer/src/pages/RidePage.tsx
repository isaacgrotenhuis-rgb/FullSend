import { useState, type ReactElement } from "react";
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
  finishRide: (postToStrava: boolean) => Promise<void>;
  adjustIntensity: (deltaFraction: number) => Promise<void>;
  rampDurationInput: string;
  setRampDurationInput: (value: string) => void;
  applyRampDuration: () => Promise<void>;
};

const blockKindLabel = (kind: string): string => kind.charAt(0).toUpperCase() + kind.slice(1);

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
  finishRide,
  adjustIntensity,
  rampDurationInput,
  setRampDurationInput,
  applyRampDuration
}: Props): ReactElement => {
  const [postToStrava, setPostToStrava] = useState(true);

  const totalDurationSec = activeIntervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const elapsedSec = workoutSessionState?.elapsedSec ?? 0;
  const currentIndex = workoutSessionState?.currentIntervalIndex ?? null;
  const liveMetrics = workoutSessionState?.liveMetrics ?? null;
  const maxWatts = Math.max(50, ...activeIntervals.map((interval) => interval.targetPowerWatts ?? 0));

  const currentKind = liveMetrics?.blockKind ?? (currentIndex !== null ? activeIntervals[currentIndex]?.kind : undefined);
  const intervalPositionLabel =
    currentIndex !== null && activeIntervals.length > 0 ? `Interval ${currentIndex + 1} of ${activeIntervals.length}` : "";

  const isPaused = workoutSessionState?.lifecycle === "paused";
  const showEndSummary = activeIntervals.length > 0 && !isWorkoutSessionActive;

  return (
    <main className="app">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "var(--space-4)" }}>
        <div>
          <h6 style={{ color: "var(--color-accent-700)", marginBottom: 2 }}>{currentKind ? blockKindLabel(currentKind) : "Workout"}</h6>
          <h2 style={{ margin: 0 }}>{activeWorkoutName ?? "Workout"}</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
          <div style={{ textAlign: "right" }}>
            <h6 style={{ marginBottom: 2 }}>Elapsed / Total</h6>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20 }}>
              {formatClock(elapsedSec)} / {formatClock(totalDurationSec)}
            </div>
          </div>
          {isWorkoutSessionActive ? (
            <button className="btn btn-secondary" disabled={liveWorkoutBusy} onClick={() => void stopWorkout()}>
              End
            </button>
          ) : null}
        </div>
      </div>
      <div className="hr" style={{ margin: "0 0 var(--space-6)" }} />

      {liveWorkoutError ? (
        <p style={{ color: "var(--color-accent-700)" }}>{liveWorkoutError}</p>
      ) : null}
      {workoutSessionState?.lastError ? <p style={{ color: "var(--color-accent-700)" }}>{workoutSessionState.lastError}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 2,
          background: "var(--color-divider)",
          border: "2px solid var(--color-divider)",
          marginBottom: "var(--space-6)"
        }}
      >
        <div style={{ background: "var(--color-bg)", padding: "var(--space-4)" }}>
          <h6>Target power</h6>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 64, lineHeight: 1 }}>
            {liveMetrics?.targetPowerWatts ?? "—"}
            <span style={{ fontSize: 22, fontWeight: 600 }}>W</span>
          </div>
        </div>
        <div style={{ background: "var(--color-bg)", padding: "var(--space-4)" }}>
          <h6>Actual power</h6>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 64, lineHeight: 1, color: "var(--color-accent)" }}>
            {liveMetrics?.actualPowerWatts ?? "—"}
            <span style={{ fontSize: 22, fontWeight: 600 }}>W</span>
          </div>
        </div>
        <div style={{ background: "var(--color-bg)", padding: "var(--space-4)" }}>
          <h6>Cadence</h6>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 64, lineHeight: 1 }}>
            {liveMetrics?.actualCadenceRpm !== null && liveMetrics?.actualCadenceRpm !== undefined
              ? Math.round(liveMetrics.actualCadenceRpm)
              : "—"}
            <span style={{ fontSize: 22, fontWeight: 600 }}>rpm</span>
          </div>
        </div>
      </div>

      <h6 style={{ marginBottom: "var(--space-3)" }}>Workout timeline{intervalPositionLabel ? ` · ${intervalPositionLabel}` : ""}</h6>
      <div style={{ display: "flex", gap: "var(--space-3)", marginBottom: "var(--space-8)" }}>
        <div
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          Watts
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: "var(--space-3)",
                left: "var(--space-3)",
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: 13,
                zIndex: 1
              }}
            >
              {Math.round(maxWatts)} W peak
            </div>
            <WorkoutTimelineChart
              intervals={activeIntervals}
              elapsedSec={elapsedSec}
              currentIndex={currentIndex}
              actualPowerWatts={liveMetrics?.actualPowerWatts ?? null}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
              Time
            </span>
            <span style={{ fontSize: 10, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
              {formatClock(totalDurationSec)} total
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
        <button
          className="btn btn-primary"
          style={{ minWidth: 140 }}
          disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          onClick={() => void (isPaused ? resumeWorkout() : pauseWorkout())}
        >
          {isPaused ? "Resume" : "Pause"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <h6 style={{ margin: 0 }}>Intensity</h6>
          <button
            className="btn btn-secondary btn-icon"
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
            onClick={() => void adjustIntensity(-0.05)}
          >
            −
          </button>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 18, minWidth: 52, textAlign: "center" }}>
            {Math.round((workoutSessionState?.intensityMultiplier ?? 1) * 100)}%
          </div>
          <button
            className="btn btn-secondary btn-icon"
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
            onClick={() => void adjustIntensity(0.05)}
          >
            +
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-8)" }}>
        <label className="card-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Ramp-in (sec)
          <input
            className="input"
            style={{ minHeight: 28, padding: "2px 6px", width: 64 }}
            type="number"
            min={0}
            max={60}
            value={rampDurationInput}
            onChange={(event) => setRampDurationInput(event.target.value)}
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          />
        </label>
        <button
          className="btn btn-secondary"
          style={{ padding: "4px 10px", fontSize: 12 }}
          disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          onClick={() => void applyRampDuration()}
        >
          Apply
        </button>
      </div>

      {showEndSummary ? (
        <div className="dialog-backdrop" style={{ zIndex: 100 }}>
          <div className="dialog" style={{ width: "min(480px, 100%)" }}>
            <div className="dialog-title">{activeWorkoutName ?? "Workout"}</div>
            <div className="card-meta">Completed · {formatClock(elapsedSec)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, background: "var(--color-divider)", border: "2px solid var(--color-divider)" }}>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6>Duration</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20 }}>{formatClock(elapsedSec)}</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6>Avg power</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, opacity: 0.4 }}>—</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6>Avg cadence</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, opacity: 0.4 }}>—</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6>TSS</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, opacity: 0.4 }}>—</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6>IF</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, opacity: 0.4 }}>—</div>
              </div>
            </div>

            <div className="hr" style={{ margin: "var(--space-2) 0" }} />
            <label className="radio" style={{ gap: 10 }}>
              <input
                type="checkbox"
                checked={postToStrava}
                onChange={(event) => setPostToStrava(event.target.checked)}
                style={{ position: "static", opacity: 1, width: 16, height: 16, pointerEvents: "auto" }}
              />
              <span style={{ fontSize: 13 }}>Post this workout to Strava</span>
            </label>

            <div className="dialog-actions">
              <button className="btn btn-primary" disabled={liveWorkoutBusy} onClick={() => void finishRide(postToStrava)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};
