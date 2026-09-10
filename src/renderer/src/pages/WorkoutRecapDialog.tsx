import type { ReactElement } from "react";
import type { CompletedSessionSummary, SessionRecap } from "@shared/ipc/contracts";
import { formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";
import type { SpeedUnit } from "../speedUnit";
import { WorkoutSummaryView } from "../WorkoutSummaryView";

type Props = {
  session: CompletedSessionSummary;
  recap: SessionRecap | null;
  loading: boolean;
  error: string | null;
  speedUnit: SpeedUnit;
  onSpeedUnitChange: (unit: SpeedUnit) => void;
  onClose: () => void;
};

const startedLabel = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

/** Read-only recap for a past ride — the end-of-ride "Saved" view without the save/Strava flow. */
export const WorkoutRecapDialog = ({
  session,
  recap,
  loading,
  error,
  speedUnit,
  onSpeedUnitChange,
  onClose
}: Props): ReactElement => {
  return (
    <div className="dialog-backdrop" style={{ zIndex: 150 }} onClick={onClose}>
      <div className="dialog" style={{ width: "min(560px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">{session.workoutName ?? "Ad-hoc ride"}</div>
        <div className="card-meta">
          {startedLabel(session.startedAt)} · {formatClock(session.durationSec)}
        </div>

        {error ? (
          <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>{error}</p>
        ) : loading || !recap ? (
          <p className="card-meta" style={{ margin: 0 }}>
            Loading recap…
          </p>
        ) : (
          <>
            {recap.plannedIntervals.length > 0 ? (
              <WorkoutTimelineChart
                intervals={recap.plannedIntervals}
                elapsedSec={0}
                currentIndex={null}
                actualPowerWatts={null}
              />
            ) : null}
            <WorkoutSummaryView
              summary={recap.summary}
              telemetry={recap.telemetry}
              speedUnit={speedUnit}
              onSpeedUnitChange={onSpeedUnitChange}
            />
          </>
        )}

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
