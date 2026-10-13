import type { ReactElement, ReactNode } from "react";
import { Bluetooth, Play } from "lucide-react";
import type { SessionType, WorkoutDetail, WorkoutInterval } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { StatStrip, type Stat } from "../StatStrip";
import { averageTargetWatts, formatClock } from "../WorkoutTimelineChart";
import { WorkoutProfileChart } from "../WorkoutProfileChart";

type Props = {
  name: string;
  sessionType: SessionType | null;
  detail: WorkoutDetail;
  /** Rider's current FTP; zones fall back to it when the workout wasn't compiled at a known FTP. */
  ftpWatts?: number | null;
  connectedTrainerDeviceId: string | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onBack: () => void;
};

/** Shared DialogContent sizing for every workout preview (and the bank that hosts one). */
export const previewDialogClassName = "max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-[760px]";

const sessionTypeLabel: Record<SessionType, string> = {
  recovery: "Recovery",
  endurance: "Endurance",
  tempo: "Tempo",
  "sweet-spot": "Sweet spot",
  threshold: "Threshold",
  vo2: "VO2 max",
  anaerobic: "Anaerobic",
  neuromuscular: "Neuromuscular"
};

/**
 * IF from interval targets, matching the bank's deriveFswMetrics
 * (shared/fsw.ts): root of the duration-weighted mean of (watts / FTP)^2,
 * ramps at their midpoint, free-ride time excluded. null with no powered time.
 */
const intensityFromIntervals = (intervals: WorkoutInterval[], ftpWatts: number): number | null => {
  let weightedSquareSum = 0;
  let poweredSec = 0;
  for (const interval of intervals) {
    if (interval.targetPowerWatts === null) continue;
    const midpoint = (interval.targetPowerWatts + (interval.targetPowerWattsEnd ?? interval.targetPowerWatts)) / 2;
    weightedSquareSum += interval.durationSec * (midpoint / ftpWatts) ** 2;
    poweredSec += interval.durationSec;
  }
  return poweredSec > 0 ? Math.sqrt(weightedSquareSum / poweredSec) : null;
};

type ContentProps = {
  name: string;
  /** Badge next to the title: session type or primary zone. */
  typeLabel: string;
  description: string | null;
  intervals: WorkoutInterval[];
  /** Stored IF, if any; derived from the intervals otherwise. */
  intensityFactor: number | null;
  /** Stored TSS, if any; derived from IF otherwise. */
  storedTSS: number | null;
  /** FTP the zones (and any derived IF) are measured against. */
  zoneFtp: number | null;
  connectedTrainerDeviceId: string | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  startLabel?: string;
  /** The left-hand footer action: "Cancel" from a plan day, "Back" inside the bank. */
  secondaryLabel: string;
  onSecondary: () => void;
  /** Extra detail below the chart, e.g. the bank's segment list. */
  children?: ReactNode;
};

/**
 * The body of every pre-ride workout preview — header, stat strip, zone-shaded
 * profile and start footer — laid out like the ride recap so the before and
 * after views of a ride read as a pair. Rendered inside a DialogContent by
 * WorkoutPreviewDialog (plan days) and WorkoutBankBrowser (bank detail), so
 * both entry points always show the same preview.
 */
export const WorkoutPreviewContent = ({
  name,
  typeLabel,
  description,
  intervals,
  intensityFactor: storedIF,
  storedTSS,
  zoneFtp,
  connectedTrainerDeviceId,
  busy,
  error,
  onStart,
  startLabel = "Start workout",
  secondaryLabel,
  onSecondary,
  children
}: ContentProps): ReactElement => {
  const totalDurationSec = intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const avgWatts = averageTargetWatts(intervals);
  // Only bank-compiled workouts store an estTSS (and not every workout stores an
  // IF), so derive what's missing with the bank's own formula:
  // TSS = hours × IF² × 100, IF falling back to the interval targets.
  const intensityFactor = storedIF ?? (zoneFtp ? intensityFromIntervals(intervals, zoneFtp) : null);
  const estTSS =
    storedTSS !== null
      ? Math.round(storedTSS)
      : intensityFactor !== null
        ? Math.round((totalDurationSec / 3600) * intensityFactor ** 2 * 100)
        : null;
  const peakWatts = Math.max(
    0,
    ...intervals.flatMap((interval) => [interval.targetPowerWatts ?? 0, interval.targetPowerWattsEnd ?? 0])
  );
  const workIntervals = intervals.filter((interval) => interval.kind === "work").length;

  const stats: Stat[] = [
    { label: "Duration", value: formatClock(totalDurationSec) },
    { label: "Avg power", value: avgWatts !== null ? `${avgWatts}` : null, unit: "W" },
    { label: "Peak", value: peakWatts > 0 ? `${Math.round(peakWatts)}` : null, unit: "W" },
    { label: "Intensity", value: intensityFactor !== null ? intensityFactor.toFixed(2) : null, unit: "IF" },
    { label: "TSS", value: estTSS !== null ? `${estTSS}` : null },
    { label: "Intervals", value: `${intervals.length}` }
  ];

  const trainerMissing = connectedTrainerDeviceId === null;
  const canStart = !busy && !trainerMissing;

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <DialogTitle>{name}</DialogTitle>
          <Badge variant="secondary" className="capitalize">
            {typeLabel}
          </Badge>
        </div>
        <DialogDescription>
          {formatClock(totalDurationSec)}
          {workIntervals > 0 ? ` · ${workIntervals} work interval${workIntervals === 1 ? "" : "s"}` : ""}
        </DialogDescription>
        {description ? <p className="m-0 line-clamp-2 text-sm text-foreground/80">{description}</p> : null}
      </DialogHeader>

      <StatStrip stats={stats} label="Workout targets" />
      <WorkoutProfileChart intervals={intervals} ftpWatts={zoneFtp} />
      {children}

      {error ? <p className="m-0 text-[13px] text-destructive">{error}</p> : null}

      <DialogFooter className="sm:items-center">
        {trainerMissing ? (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bluetooth className="size-3.5" />
            Connect a trainer to start
          </span>
        ) : null}
        <Button type="button" variant="outline" disabled={busy} onClick={onSecondary}>
          {secondaryLabel}
        </Button>
        <Button type="button" className="min-w-[150px]" disabled={!canStart} onClick={onStart}>
          <Play />
          {startLabel}
        </Button>
      </DialogFooter>
    </>
  );
};

/** Preview of a planned workout, opened from a plan day. */
export const WorkoutPreviewDialog = ({
  name,
  sessionType,
  detail,
  ftpWatts = null,
  connectedTrainerDeviceId,
  busy,
  error,
  onStart,
  onBack
}: Props): ReactElement => {
  const meta = detail.metadata ?? {};
  const description = typeof meta.description === "string" && meta.description.trim() ? meta.description : null;
  const primaryZone = typeof meta.primaryZone === "string" ? meta.primaryZone : null;
  const storedTSS = typeof meta.estTSS === "number" ? meta.estTSS : null;
  // Bank workouts are compiled to watts at a specific FTP; zone them against that
  // FTP so the shading matches the targets, falling back to the rider's current one.
  const compiledAtFtp = typeof meta.compiledAtFtp === "number" && meta.compiledAtFtp > 0 ? meta.compiledAtFtp : null;
  const zoneFtp = compiledAtFtp ?? (ftpWatts && ftpWatts > 0 ? ftpWatts : null);

  const typeLabel =
    (sessionType ? sessionTypeLabel[sessionType] : null) ??
    (primaryZone ? primaryZone.replace(/-/g, " ") : null) ??
    detail.workout.source;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onBack();
      }}
    >
      <DialogContent className={previewDialogClassName}>
        <WorkoutPreviewContent
          name={name}
          typeLabel={typeLabel}
          description={description}
          intervals={detail.intervals}
          intensityFactor={detail.workout.intensityFactor}
          storedTSS={storedTSS}
          zoneFtp={zoneFtp}
          connectedTrainerDeviceId={connectedTrainerDeviceId}
          busy={busy}
          error={error}
          onStart={onStart}
          secondaryLabel="Cancel"
          onSecondary={onBack}
        />
      </DialogContent>
    </Dialog>
  );
};
