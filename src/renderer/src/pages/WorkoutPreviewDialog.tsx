import type { ReactElement } from "react";
import { Bluetooth, Play } from "lucide-react";
import type { SessionType, WorkoutDetail } from "@shared/ipc/contracts";
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
const intensityFromIntervals = (intervals: WorkoutDetail["intervals"], ftpWatts: number): number | null => {
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

/**
 * Pre-ride preview of a planned workout, laid out like the ride recap: a stat
 * strip, then the zone-shaded workout profile, so the before and after views
 * of a ride read as a pair. Sized to fit without scrolling.
 */
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
  const storedTSS = typeof meta.estTSS === "number" ? Math.round(meta.estTSS) : null;
  // Bank workouts are compiled to watts at a specific FTP; zone them against that
  // FTP so the shading matches the targets, falling back to the rider's current one.
  const compiledAtFtp = typeof meta.compiledAtFtp === "number" && meta.compiledAtFtp > 0 ? meta.compiledAtFtp : null;
  const zoneFtp = compiledAtFtp ?? (ftpWatts && ftpWatts > 0 ? ftpWatts : null);

  const totalDurationSec = detail.intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const avgWatts = averageTargetWatts(detail.intervals);
  // Only bank-compiled workouts store an estTSS (and not every workout stores an
  // IF), so derive what's missing with the bank's own formula:
  // TSS = hours × IF² × 100, IF falling back to the interval targets.
  const intensityFactor =
    detail.workout.intensityFactor ?? (zoneFtp ? intensityFromIntervals(detail.intervals, zoneFtp) : null);
  const estTSS =
    storedTSS ??
    (intensityFactor !== null ? Math.round((totalDurationSec / 3600) * intensityFactor ** 2 * 100) : null);
  const peakWatts = Math.max(
    0,
    ...detail.intervals.flatMap((interval) => [interval.targetPowerWatts ?? 0, interval.targetPowerWattsEnd ?? 0])
  );
  const workIntervals = detail.intervals.filter((interval) => interval.kind === "work").length;

  const typeLabel =
    (sessionType ? sessionTypeLabel[sessionType] : null) ??
    (primaryZone ? primaryZone.replace(/-/g, " ") : null) ??
    detail.workout.source;

  const stats: Stat[] = [
    { label: "Duration", value: formatClock(totalDurationSec) },
    { label: "Avg power", value: avgWatts !== null ? `${avgWatts}` : null, unit: "W" },
    { label: "Peak", value: peakWatts > 0 ? `${Math.round(peakWatts)}` : null, unit: "W" },
    { label: "Intensity", value: intensityFactor !== null ? intensityFactor.toFixed(2) : null, unit: "IF" },
    { label: "TSS", value: estTSS !== null ? `${estTSS}` : null },
    { label: "Intervals", value: `${detail.intervals.length}` }
  ];

  const trainerMissing = connectedTrainerDeviceId === null;
  const canStart = !busy && !trainerMissing;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onBack();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
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
        <WorkoutProfileChart intervals={detail.intervals} ftpWatts={zoneFtp} />

        {error ? <p className="m-0 text-[13px] text-destructive">{error}</p> : null}

        <DialogFooter className="sm:items-center">
          {trainerMissing ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bluetooth className="size-3.5" />
              Connect a trainer to start
            </span>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
            Cancel
          </Button>
          <Button type="button" className="min-w-[150px]" disabled={!canStart} onClick={onStart}>
            <Play />
            Start workout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
