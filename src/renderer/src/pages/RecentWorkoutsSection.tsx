import type { ReactElement } from "react";
import type { CompletedSessionSummary } from "@shared/ipc/contracts";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";
import { formatDistance, useSpeedUnit, type SpeedUnit } from "../speedUnit";
import { useRideHistory } from "../useRideHistory";
import { WorkoutRecapDialog } from "./WorkoutRecapDialog";

/** Legacy `.card-meta`: small flex row of muted 11px text. */
const cardMetaClass = "flex items-center gap-1.5 text-[11px] text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]";

export const RecentWorkoutCard = ({
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
    // A `Card` nested inside a plain `<button>` rather than a card that is
    // itself a button: this keeps exactly one interactive, focusable
    // control with one accessible name (its text content), instead of
    // layering interactive semantics on top of each other. The outer
    // button carries no surface styling of its own (transparent, no
    // border/padding) so the inner Card is the only visible surface.
    <button
      type="button"
      onClick={() => onOpen(session.sessionId)}
      className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left"
    >
      {/* Deliberate visual change: this card used to override its radius to
          0 (a square corner surviving PR 1's token flip). Removed so it
          picks up the hybrid theme's rounded-md, matching every other
          surface. */}
      <Card className="grid grid-cols-[1fr_200px] items-center gap-3 rounded-md border-0 bg-muted p-3 shadow-none">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className={cardMetaClass}>{dateLabel}</span>
          <span className="overflow-hidden text-[16px] font-extrabold text-ellipsis whitespace-nowrap">
            {session.workoutName ?? "Ad-hoc ride"}
          </span>
          <span className={cardMetaClass}>{stats}</span>
        </span>
        <span className="block h-[72px] overflow-hidden">
          {session.plannedIntervals.length > 0 ? (
            <WorkoutTimelineChart
              intervals={session.plannedIntervals}
              elapsedSec={0}
              currentIndex={null}
              actualPowerWatts={null}
              compact
            />
          ) : (
            <span className="flex h-full items-center justify-center border border-[color:var(--color-divider)] text-[11px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
              No planned profile
            </span>
          )}
        </span>
      </Card>
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
      <h2 className="m-0">Recent activity</h2>
      <Separator className="my-4 h-[2px] bg-[var(--color-divider)]" />
      {error ? (
        <p className="mb-8 text-[var(--color-accent-700)]">{error}</p>
      ) : sessions === null ? (
        <p className="mb-8 text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="mb-8 text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
          No completed workouts recorded yet.
        </p>
      ) : (
        <div className="mb-8 flex flex-col gap-0.5 border-2 border-[color:var(--color-divider)] bg-[var(--color-divider)]">
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
