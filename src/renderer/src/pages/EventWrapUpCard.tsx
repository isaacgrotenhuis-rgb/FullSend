import { useEffect, useState, type ReactElement } from "react";
import { Flag } from "lucide-react";
import type { EventPlanSummary } from "@shared/ipc/contracts";
import { Button } from "@/components/ui/button";

const parseIsoDate = (iso: string): Date => new Date(`${iso}T00:00:00`);

export const formatEventDate = (iso: string): string =>
  parseIsoDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const formatRideHours = (seconds: number): string => {
  const hours = seconds / 3600;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
};

/** "18 of 24 rides · 21.5 h" — rides ridden between the plan's first week and its event. */
export const formatRideStats = (summary: EventPlanSummary): string =>
  `${summary.completedRides} of ${summary.plannedRides} ride${summary.plannedRides === 1 ? "" : "s"} · ${formatRideHours(
    summary.rideSeconds
  )}`;

type Props = {
  planId: string;
  currentFtp: number;
  onPlanNextEvent: () => void;
  onViewPlan: () => void;
};

const Stat = ({ label, value }: { label: string; value: string }): ReactElement => (
  <div className="min-w-0">
    <div className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</div>
    <div className="text-xl font-extrabold tabular-nums">{value}</div>
  </div>
);

/** Shown on Home once the active plan's event date has passed: a short look
    back at the block, and the way into the next one. */
export const EventWrapUpCard = ({ planId, currentFtp, onPlanNextEvent, onViewPlan }: Props): ReactElement | null => {
  const [summary, setSummary] = useState<EventPlanSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    window.kickr.eventPlan
      .getSummary({ planId })
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        // The card still offers the next step without its stats.
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const ftpDelta = summary ? currentFtp - summary.startFtp : 0;

  return (
    <section
      aria-label="Event complete"
      className="mb-10 rounded-xl border border-primary/40 bg-[var(--color-accent-100)] p-5 shadow-xs motion-safe:animate-in motion-safe:fade-in-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Flag className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-xl">{summary ? `${summary.name} complete` : "Event complete"}</h2>
            <p className="m-0 text-sm text-muted-foreground">
              {summary ? `${formatEventDate(summary.eventDate)} · ` : ""}Nice work. Ready for the next one?
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onViewPlan}>
            View plan
          </Button>
          <Button onClick={onPlanNextEvent}>Plan your next event</Button>
        </div>
      </div>

      {summary ? (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Weeks" value={String(summary.weekCount)} />
          <Stat label="Rides" value={`${summary.completedRides}/${summary.plannedRides}`} />
          <Stat label="Time ridden" value={formatRideHours(summary.rideSeconds)} />
          <Stat
            label="FTP"
            value={
              ftpDelta === 0
                ? `${currentFtp} W`
                : `${summary.startFtp} → ${currentFtp} W`
            }
          />
        </div>
      ) : null}
    </section>
  );
};
