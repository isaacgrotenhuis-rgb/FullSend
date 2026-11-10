import { Fragment, useEffect, useState, type ReactElement } from "react";
import type { EventPlanReport, EventType, LoadTag } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { useSpeedUnit } from "../speedUnit";
import { useSessionRecap } from "../useRideHistory";
import { formatEventDate, formatRideHours } from "./EventWrapUpCard";
import { RecentWorkoutCard } from "./RecentWorkoutsSection";
import { WorkoutRecapDialog } from "./WorkoutRecapDialog";

const eventTypeLabels: Record<EventType, string> = {
  "road-race": "Road race",
  "time-trial": "Time trial",
  criterium: "Criterium",
  "gran-fondo": "Gran fondo",
  "xc-mtb": "XC mountain bike",
  "marathon-mtb": "Marathon mountain bike"
};

const loadTagLabels: Record<LoadTag, string> = {
  build: "Build",
  recovery: "Recovery",
  taper: "Taper"
};

const formatShortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const percent = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const Stat = ({ label, value, detail }: { label: string; value: string; detail?: string }): ReactElement => (
  <div className="min-w-0 rounded-lg border border-foreground/15 bg-muted p-3">
    <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</div>
    <div className="text-xl font-extrabold tabular-nums">{value}</div>
    {detail ? <div className="text-[12px] text-muted-foreground">{detail}</div> : null}
  </div>
);

type Props = {
  /** The plan to show; the dialog is closed while null. */
  planId: string | null;
  onClose: () => void;
};

/** Read-only look back at a finished plan: headline stats, how each week
    went against plan, and the rides themselves, each opening its recap. */
export const PlanSummaryDialog = ({ planId, onClose }: Props): ReactElement => {
  const [report, setReport] = useState<EventPlanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speedUnit, setSpeedUnit] = useSpeedUnit();
  const { recapSessionId, recap, recapLoading, recapError, openRecap, closeRecap } = useSessionRecap();

  useEffect(() => {
    if (planId === null) return;
    let cancelled = false;
    setReport(null);
    setError(null);
    window.kickr.eventPlan
      .getReport({ planId })
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this plan");
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const summary = report?.summary ?? null;
  const openRide = report?.rides.find((ride) => ride.sessionId === recapSessionId) ?? null;
  const ftpChange = report && report.endFtp !== null ? report.endFtp - report.summary.startFtp : null;

  return (
    <>
      <Dialog open={planId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{summary?.name ?? "Plan summary"}</DialogTitle>
            <DialogDescription>
              {summary
                ? `${eventTypeLabels[summary.eventType]} · ${formatShortDate(summary.startDate)} – ${formatEventDate(
                    summary.eventDate
                  )}`
                : error ?? "Loading…"}
            </DialogDescription>
          </DialogHeader>

          {report && summary ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Weeks" value={String(summary.weekCount)} />
                <Stat
                  label="Rides"
                  value={`${summary.completedRides}/${summary.plannedRides}`}
                  detail={`${percent(summary.completedRides, summary.plannedRides)}% of planned`}
                />
                <Stat label="Time ridden" value={formatRideHours(summary.rideSeconds)} />
                <Stat
                  label="FTP"
                  value={report.endFtp !== null ? `${summary.startFtp} → ${report.endFtp} W` : `${summary.startFtp} W`}
                  detail={
                    ftpChange !== null
                      ? `${ftpChange >= 0 ? "+" : ""}${ftpChange} W from fitness test`
                      : "At plan start"
                  }
                />
              </div>

              <section aria-labelledby="plan-summary-weeks">
                <h4 id="plan-summary-weeks" className="mb-2">
                  Week by week
                </h4>
                <ItemGroup className="overflow-hidden rounded-xl border border-foreground/15">
                  {report.weeks.map((week, index) => (
                    <Fragment key={week.startDate}>
                      {index > 0 ? <ItemSeparator className="bg-foreground/10" /> : null}
                      <Item role="listitem" className="flex-nowrap gap-3 rounded-none px-3 py-2 text-[13px]">
                        <span className="w-16 shrink-0 font-semibold">Week {week.weekIndex + 1}</span>
                        <span className="w-14 shrink-0 text-muted-foreground">{formatShortDate(week.startDate)}</span>
                        <Badge variant="outline" className="w-20 shrink-0 justify-center border-foreground/25">
                          {loadTagLabels[week.loadTag]}
                        </Badge>
                        <Progress
                          className="min-w-12 flex-1"
                          value={Math.min(100, percent(week.completedRides, week.plannedRides))}
                          aria-label={`Week ${week.weekIndex + 1}: ${week.completedRides} of ${week.plannedRides} rides`}
                        />
                        <span className="w-24 shrink-0 text-right tabular-nums">
                          {week.completedRides}/{week.plannedRides} rides
                        </span>
                        <span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
                          {week.rideSeconds > 0 ? formatRideHours(week.rideSeconds) : "—"}
                        </span>
                      </Item>
                    </Fragment>
                  ))}
                </ItemGroup>
              </section>

              <section aria-labelledby="plan-summary-rides">
                <h4 id="plan-summary-rides" className="mb-2">
                  Your rides
                </h4>
                {report.rides.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">No rides recorded during this plan.</p>
                ) : (
                  <ItemGroup className="overflow-hidden rounded-xl border border-foreground/15 bg-muted">
                    {report.rides.map((ride, index) => (
                      <Fragment key={ride.sessionId}>
                        {index > 0 ? <ItemSeparator className="bg-foreground/10" /> : null}
                        <div role="listitem">
                          <RecentWorkoutCard session={ride} speedUnit={speedUnit} onOpen={openRecap} />
                        </div>
                      </Fragment>
                    ))}
                  </ItemGroup>
                )}
              </section>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {openRide ? (
        <WorkoutRecapDialog
          session={openRide}
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
