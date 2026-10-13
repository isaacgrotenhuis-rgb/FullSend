import type { ReactElement, ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, Pause } from "lucide-react";
import type { WorkoutInterval } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatClock } from "../WorkoutTimelineChart";
import { kindLabels } from "../WorkoutProfileChart";
import { zoneFor } from "../zones";

/* Shared shell: the same rounded muted card as the recap/preview chart cards. */
export const RideCard = ({ className, children }: { className?: string; children: ReactNode }): ReactElement => (
  <Card className={cn("gap-0 rounded-xl border-foreground/15 bg-muted p-4 shadow-xs", className)}>{children}</Card>
);

export const CardLabel = ({ children, right }: { children: ReactNode; right?: ReactNode }): ReactElement => (
  <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
    <h6 className="m-0 text-[11px] text-muted-foreground">{children}</h6>
    {right}
  </div>
);

/** A big live number with its unit; an en dash while there's no reading. */
export const BigValue = ({
  value,
  unit,
  className
}: {
  value: string | number | null;
  unit: string;
  className?: string;
}): ReactElement => (
  <div className={cn("leading-none font-extrabold tabular-nums", className)}>
    {value !== null ? value : <span className="text-muted-foreground/60">–</span>}
    <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>
  </div>
);

/* ------------------------------------------------------------------ power */

/** Within ±5% of target reads as on target; the gauge spans ±25%. */
const onTargetBand = 0.05;
const gaugeSpan = 0.25;

/**
 * Actual and target watts side by side, the two numbers a rider compares most,
 * with a deviation gauge and a plain-language verdict (icon + words, never
 * colour alone). Zone and % FTP are derived from the target.
 */
export const PowerCard = ({
  actualWatts,
  targetWatts,
  ftpWatts,
  paused
}: {
  actualWatts: number | null;
  targetWatts: number | null;
  ftpWatts: number | null;
  paused: boolean;
}): ReactElement => {
  const zone = targetWatts !== null && ftpWatts ? zoneFor(targetWatts, ftpWatts) : null;
  const deviation = actualWatts !== null && targetWatts !== null && targetWatts > 0 ? (actualWatts - targetWatts) / targetWatts : null;
  const delta = actualWatts !== null && targetWatts !== null ? Math.round(actualWatts - targetWatts) : null;
  const onTarget = deviation !== null && Math.abs(deviation) <= onTargetBand;
  const markerPct = deviation !== null ? 50 + (Math.max(-gaugeSpan, Math.min(gaugeSpan, deviation)) / gaugeSpan) * 50 : null;

  const verdict = paused ? (
    <>
      <Pause className="size-4" /> Paused — target holding
    </>
  ) : targetWatts === null ? (
    "Free ride — no power target"
  ) : delta === null ? (
    "Waiting for power…"
  ) : onTarget ? (
    <>
      <Check className="size-4" /> On target
    </>
  ) : delta > 0 ? (
    <>
      <ArrowUp className="size-4" /> {delta} W over — ease off
    </>
  ) : (
    <>
      <ArrowDown className="size-4" /> {Math.abs(delta)} W under — push a little
    </>
  );

  return (
    <RideCard className="h-full">
      <CardLabel
        right={
          zone ? (
            <Badge variant="outline" className="gap-1.5 bg-background">
              <span aria-hidden className="size-2 rounded-full" style={{ background: zone.color }} />
              {zone.name}
            </Badge>
          ) : null
        }
      >
        Power
      </CardLabel>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Actual</div>
          <BigValue value={actualWatts !== null ? Math.round(actualWatts) : null} unit="W" className="text-6xl" />
        </div>
        <div className={cn("text-right", paused && "opacity-50")}>
          <div className="mb-1 text-xs font-semibold text-muted-foreground">Target</div>
          <BigValue value={targetWatts !== null ? Math.round(targetWatts) : null} unit="W" className="text-4xl" />
          {targetWatts !== null && ftpWatts ? (
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              {Math.round((targetWatts / ftpWatts) * 100)}% FTP
            </div>
          ) : null}
        </div>
      </div>

      {/* Deviation gauge: centre tick is the target, the band is ±5%. */}
      <div className="mt-4" aria-hidden>
        <div className="relative h-2 rounded-full bg-foreground/10">
          <span
            className="absolute inset-y-0 rounded-full bg-foreground/15"
            style={{ left: `${50 - (onTargetBand / gaugeSpan) * 50}%`, width: `${(onTargetBand / gaugeSpan) * 100}%` }}
          />
          <span className="absolute -inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-foreground/50" />
          {markerPct !== null && !paused ? (
            <span
              className={cn(
                "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-muted transition-[left] duration-500 ease-out",
                onTarget ? "bg-foreground" : "bg-primary"
              )}
              style={{ left: `${markerPct}%` }}
            />
          ) : null}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>Under</span>
          <span>Target</span>
          <span>Over</span>
        </div>
      </div>

      <div
        className={cn(
          "mt-2 flex items-center gap-1.5 text-sm font-semibold",
          !paused && delta !== null && !onTarget && "text-[var(--color-accent-700)]"
        )}
        aria-live="polite"
      >
        {verdict}
      </div>
    </RideCard>
  );
};

/* --------------------------------------------------------------- interval */

const describeInterval = (interval: WorkoutInterval): string => {
  const watts =
    interval.targetPowerWatts === null
      ? "free ride"
      : interval.targetPowerWattsEnd != null && interval.targetPowerWattsEnd !== interval.targetPowerWatts
        ? `${Math.round(interval.targetPowerWatts)} → ${Math.round(interval.targetPowerWattsEnd)} W`
        : `${Math.round(interval.targetPowerWatts)} W`;
  return `${kindLabels[interval.kind]} · ${formatClock(interval.durationSec)} · ${watts}`;
};

/**
 * Where the rider is in the workout right now: a countdown for the current
 * interval (the number riders watch most), its progress, and what's next.
 */
export const IntervalCard = ({
  intervals,
  currentIndex,
  elapsedSec
}: {
  intervals: WorkoutInterval[];
  currentIndex: number | null;
  elapsedSec: number;
}): ReactElement => {
  const current = currentIndex !== null ? intervals[currentIndex] : undefined;
  const startSec = currentIndex !== null ? intervals.slice(0, currentIndex).reduce((sum, i) => sum + i.durationSec, 0) : 0;
  const intoSec = Math.max(0, elapsedSec - startSec);
  const remainingSec = current ? Math.max(0, current.durationSec - intoSec) : null;
  const progress = current ? Math.min(100, (intoSec / current.durationSec) * 100) : 0;
  const next = currentIndex !== null ? intervals[currentIndex + 1] : undefined;

  return (
    <RideCard className="h-full">
      <CardLabel
        right={
          current ? (
            <Badge variant="outline" className="bg-background">
              {kindLabels[current.kind]}
            </Badge>
          ) : null
        }
      >
        {currentIndex !== null ? `Interval ${currentIndex + 1} of ${intervals.length}` : "Interval"}
      </CardLabel>

      <div className="mb-1 text-xs font-semibold text-muted-foreground">Time left</div>
      <div className="text-6xl leading-none font-extrabold tabular-nums">
        {remainingSec !== null ? formatClock(remainingSec) : "–"}
      </div>
      <Progress value={progress} aria-label="Interval progress" className="mt-4 h-2 bg-foreground/10" />

      <div className="mt-auto flex items-center gap-2 pt-3 text-sm">
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        {next ? (
          <span className="truncate">
            <span className="font-semibold">Next:</span> {describeInterval(next)}
          </span>
        ) : (
          <span className="font-semibold">Last interval — finish strong</span>
        )}
      </div>
    </RideCard>
  );
};
