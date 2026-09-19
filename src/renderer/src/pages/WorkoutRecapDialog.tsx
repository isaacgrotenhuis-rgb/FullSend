import type { ReactElement } from "react";
import type { CompletedSessionSummary, SessionRecap } from "@shared/ipc/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
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

/**
 * Read-only recap for a past ride — the end-of-ride "Saved" view without the
 * save/Strava flow.
 *
 * REFERENCE CONVERSION for the six other hand-rolled dialogs. The shape below
 * is the one to copy:
 *
 *  - The parent still decides whether this component is mounted at all, so
 *    `open` is hardcoded `true` and `onOpenChange` forwards only the close
 *    edge to the existing `onClose`/`onBack` callback. That keeps the
 *    unmount-on-close contract the parents already rely on, and means no
 *    parent has to grow an `open` prop.
 *  - No `DialogTrigger`: these dialogs are opened by parent state, never by a
 *    trigger element inside themselves.
 *  - Radix supplies what the legacy `.dialog-backdrop` never did — a portal, a
 *    focus trap, focus restore, Escape, scroll lock and `role="dialog"` — so
 *    the hand-maintained z-index and the `stopPropagation` click guard both go
 *    away. Delete them; do not port them across.
 *  - `DialogTitle` is required. Radix warns without one; use
 *    `VisuallyHidden` around it if the design has no visible title.
 */
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-3 overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{session.workoutName ?? "Ad-hoc ride"}</DialogTitle>
          <DialogDescription>
            {startedLabel(session.startedAt)} · {formatClock(session.durationSec)}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="m-0 text-[13px] text-destructive">{error}</p>
        ) : loading || !recap ? (
          <p className="m-0 text-sm text-muted-foreground">Loading recap…</p>
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

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
