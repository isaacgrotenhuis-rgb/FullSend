import { Fragment, type ReactElement } from "react";
import type { CompletedSessionSummary } from "@shared/ipc/contracts";
import { Card } from "@/components/ui/card";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
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
    // The row itself is the one interactive control: `Item asChild` renders
    // a plain <button> carrying the row layout, so there is exactly one
    // focusable element whose accessible name is its text content. The row
    // is square-cornered because the surrounding Card clips it to its own
    // radius, and the focus ring is inset so that clipping cannot hide it.
    // Its contents are <span>s, not ItemContent/ItemTitle/ItemMedia: those
    // render <div>/<p>, which a <button> may not contain.
    <Item asChild className="w-full flex-nowrap cursor-pointer rounded-none p-3 text-left hover:bg-foreground/5 focus-visible:ring-inset">
      <button type="button" onClick={() => onOpen(session.sessionId)}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cardMetaClass}>{dateLabel}</span>
          <span className="overflow-hidden text-[16px] font-extrabold text-ellipsis whitespace-nowrap">
            {session.workoutName ?? "Ad-hoc ride"}
          </span>
          <span className={cardMetaClass}>{stats}</span>
        </span>
        <span className="block h-[72px] w-[200px] shrink-0 overflow-hidden rounded-md">
          {session.plannedIntervals.length > 0 ? (
            <WorkoutTimelineChart
              intervals={session.plannedIntervals}
              elapsedSec={0}
              currentIndex={null}
              actualPowerWatts={null}
              compact
            />
          ) : (
            <span className="flex h-full items-center justify-center rounded-md border border-dashed border-foreground/30 text-[11px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
              No planned profile
            </span>
          )}
        </span>
      </button>
    </Item>
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
        /* One rounded card holding the whole list, rows split by hairlines —
           the same muted surface, soft border and shadow as the This week
           workout tiles. ItemGroup is role="list", so each row is wrapped in
           a listitem (a <button> cannot carry that role itself). The card
           clips with overflow-clip, not overflow-hidden: a hidden overflow
           would make it a scroll container, and the rows' scroll-reveal
           view() timeline would then track the card instead of the page. */
        <Card className="mb-8 gap-0 overflow-clip rounded-xl border-foreground/15 bg-muted py-0 shadow-xs">
          <ItemGroup>
            {sessions.map((session, index) => (
              <Fragment key={session.sessionId}>
                {index > 0 ? <ItemSeparator className="bg-foreground/10" /> : null}
                <div role="listitem" className="scroll-reveal">
                  <RecentWorkoutCard session={session} speedUnit={speedUnit} onOpen={openRecap} />
                </div>
              </Fragment>
            ))}
          </ItemGroup>
        </Card>
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
