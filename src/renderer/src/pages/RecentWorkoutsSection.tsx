import type { ReactElement } from "react";
import type { CompletedSessionSummary } from "@shared/ipc/contracts";
import { formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";
import { formatDistance, useSpeedUnit, type SpeedUnit } from "../speedUnit";
import { useRideHistory } from "../useRideHistory";
import { WorkoutRecapDialog } from "./WorkoutRecapDialog";

const cardStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 200px",
  gap: "var(--space-3)",
  alignItems: "center",
  textAlign: "left",
  border: 0,
  borderRadius: 0,
  cursor: "pointer",
  width: "100%"
} as const;

const RecentWorkoutCard = ({
  session,
  speedUnit,
  onOpen
}: {
  session: CompletedSessionSummary;
  speedUnit: SpeedUnit;
  onOpen: (sessionId: string) => void;
}): ReactElement => {
  const dateLabel = new Date(session.startedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  const stats = [
    formatClock(session.durationSec),
    session.avgPowerWatts != null ? `${session.avgPowerWatts} W` : null,
    formatDistance(session.distanceMeters, speedUnit)
  ]
    .filter((part): part is string => part !== null)
    .join("  ·  ");

  return (
    <button className="card" style={cardStyle} onClick={() => onOpen(session.sessionId)}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="card-meta" style={{ margin: 0 }}>
          {dateLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 800,
            fontSize: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {session.workoutName ?? "Ad-hoc ride"}
        </span>
        <span className="card-meta" style={{ margin: 0 }}>
          {stats}
        </span>
      </span>
      <span style={{ display: "block", height: 72, overflow: "hidden" }}>
        {session.plannedIntervals.length > 0 ? (
          <WorkoutTimelineChart
            intervals={session.plannedIntervals}
            elapsedSec={0}
            currentIndex={null}
            actualPowerWatts={null}
            compact
          />
        ) : (
          <span
            style={{
              display: "flex",
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 45%, transparent)",
              border: "1px solid var(--color-divider)"
            }}
          >
            No planned profile
          </span>
        )}
      </span>
    </button>
  );
};

/** Home "recent activity" — the 10 most recent completed rides, each opening a recap. */
export const RecentWorkoutsSection = (): ReactElement => {
  const { sessions, error, recapSessionId, recap, recapLoading, recapError, openRecap, closeRecap } =
    useRideHistory(10);
  const [speedUnit, setSpeedUnit] = useSpeedUnit();
  const openSession = sessions?.find((session) => session.sessionId === recapSessionId) ?? null;

  return (
    <>
      <h2 style={{ margin: 0 }}>Recent activity</h2>
      <div className="hr" />
      {error ? (
        <p style={{ color: "var(--color-accent-700)", marginBottom: "var(--space-8)" }}>{error}</p>
      ) : sessions === null ? (
        <p className="text-muted" style={{ marginBottom: "var(--space-8)" }}>
          Loading…
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-muted" style={{ marginBottom: "var(--space-8)" }}>
          No completed workouts recorded yet.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "var(--color-divider)",
            border: "2px solid var(--color-divider)",
            marginBottom: "var(--space-8)"
          }}
        >
          {sessions.map((session) => (
            <RecentWorkoutCard
              key={session.sessionId}
              session={session}
              speedUnit={speedUnit}
              onOpen={openRecap}
            />
          ))}
        </div>
      )}
      {openSession ? (
        <WorkoutRecapDialog
          session={openSession}
          recap={recap}
          loading={recapLoading}
          error={recapError}
          speedUnit={speedUnit}
          onSpeedUnitChange={setSpeedUnit}
          onClose={closeRecap}
        />
      ) : null}
    </>
  );
};
