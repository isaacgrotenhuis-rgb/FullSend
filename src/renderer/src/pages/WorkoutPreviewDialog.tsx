import type { ReactElement } from "react";
import type { SessionType, WorkoutDetail } from "@shared/ipc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { averageTargetWatts, formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";

type Props = {
  name: string;
  sessionType: SessionType | null;
  detail: WorkoutDetail;
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

/* Matches the legacy `.tag.tag-accent` pill exactly (styles.css ~L204-209):
   font-size 11px, letter-spacing 0.02em, 3px/10px padding, 6px radius
   (0.75 * --radius-md), --color-accent-100/800 background/text. */
const zoneTagClassName =
  "inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-100)] px-2.5 py-[3px] text-[11px] tracking-[0.02em] text-[color:var(--color-accent-800)] capitalize";

/* Matches the legacy stat-tile pair (former tileStyle/tileValueStyle
   constants): --color-bg background, --space-3 padding for the tile;
   800-weight 22px/1 for the value. */
const tileClassName = "bg-[color:var(--color-bg)] p-3";
const tileValueClassName = "text-[22px] font-extrabold leading-none";

export const WorkoutPreviewDialog = ({
  name,
  sessionType,
  detail,
  connectedTrainerDeviceId,
  busy,
  error,
  onStart,
  onBack
}: Props): ReactElement => {
  const meta = detail.metadata ?? {};
  const description = typeof meta.description === "string" && meta.description.trim() ? meta.description : null;
  const primaryZone = typeof meta.primaryZone === "string" ? meta.primaryZone : null;
  const estTSS = typeof meta.estTSS === "number" ? Math.round(meta.estTSS) : null;

  const totalDurationSec = detail.intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const avgWatts = averageTargetWatts(detail.intervals);
  const intensityFactor = detail.workout.intensityFactor;
  const maxWatts = Math.max(
    50,
    ...detail.intervals.flatMap((interval) => [interval.targetPowerWatts ?? 0, interval.targetPowerWattsEnd ?? 0])
  );

  const typeLabel =
    (sessionType ? sessionTypeLabel[sessionType] : null) ??
    (primaryZone ? primaryZone.replace(/-/g, " ") : null) ??
    detail.workout.source;

  const canStart = !busy && connectedTrainerDeviceId !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onBack();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-3 overflow-y-auto sm:max-w-[720px]">
        <DialogHeader className="flex-row items-center gap-2 flex-wrap space-y-0">
          <span className={zoneTagClassName}>{typeLabel}</span>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-5 gap-0.5 bg-[color:var(--color-divider)] border-2 border-[color:var(--color-divider)]">
          <div className={tileClassName}>
            <h6 className="text-[11px]">Duration</h6>
            <div className={tileValueClassName}>{formatClock(totalDurationSec)}</div>
          </div>
          <div className={tileClassName}>
            <h6 className="text-[11px]">Avg power</h6>
            <div className={tileValueClassName}>
              {avgWatts ?? "—"}
              {avgWatts !== null ? <span className="text-[13px] font-semibold">W</span> : null}
            </div>
          </div>
          <div className={tileClassName}>
            <h6 className="text-[11px]">Intensity</h6>
            <div className={tileValueClassName}>{intensityFactor !== null ? intensityFactor.toFixed(2) : "—"}</div>
          </div>
          <div className={tileClassName}>
            <h6 className="text-[11px]">TSS</h6>
            <div className={tileValueClassName}>{estTSS ?? "—"}</div>
          </div>
          <div className={tileClassName}>
            <h6 className="text-[11px]">Intervals</h6>
            <div className={tileValueClassName}>{detail.intervals.length}</div>
          </div>
        </div>

        {description ? <p className="m-0 text-sm opacity-85">{description}</p> : null}

        <div>
          <h6>Workout timeline</h6>
          <div className="relative">
            <div className="absolute top-2 left-2 z-[1] text-xs font-extrabold">{Math.round(maxWatts)} W peak</div>
            <WorkoutTimelineChart
              intervals={detail.intervals}
              elapsedSec={0}
              currentIndex={null}
              actualPowerWatts={null}
            />
          </div>
        </div>

        {error ? <p className="m-0 text-[13px] text-[color:var(--color-accent-700)]">{error}</p> : null}

        <DialogFooter>
          {connectedTrainerDeviceId === null ? (
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--color-text)_50%,transparent)]">
              Connect a trainer to start
            </span>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onBack}>
            Cancel
          </Button>
          <Button type="button" className="min-w-[150px]" disabled={!canStart} onClick={onStart}>
            Start workout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
