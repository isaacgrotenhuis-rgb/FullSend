import type { ReactElement } from "react";
import type { WorkoutInterval, WorkoutIntervalKind } from "@shared/ipc/contracts";

const blockColors: Record<WorkoutIntervalKind, string> = {
  warmup: "var(--color-neutral-400)",
  work: "var(--color-accent)",
  recovery: "var(--color-neutral-500)",
  cooldown: "var(--color-neutral-600)"
};

export const formatClock = (totalSec: number): string => {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
};

/** Effective watts for a ramp block: midpoint of its start and end targets. */
const rampMeanWatts = (interval: WorkoutInterval): number => {
  const start = interval.targetPowerWatts ?? 0;
  const end = interval.targetPowerWattsEnd ?? start;
  return (start + end) / 2;
};

/**
 * Duration-weighted mean target power across the blocks that have one. Ramp blocks
 * contribute their start/end midpoint. Returns null when no block has a power target
 * (e.g. an all-free-ride skills workout).
 */
export const averageTargetWatts = (intervals: WorkoutInterval[]): number | null => {
  let weighted = 0;
  let poweredSec = 0;
  for (const interval of intervals) {
    if (interval.targetPowerWatts === null || interval.targetPowerWatts === undefined) {
      continue;
    }
    weighted += rampMeanWatts(interval) * interval.durationSec;
    poweredSec += interval.durationSec;
  }
  return poweredSec > 0 ? Math.round(weighted / poweredSec) : null;
};

type Props = {
  intervals: WorkoutInterval[];
  elapsedSec: number;
  currentIndex: number | null;
  actualPowerWatts: number | null;
};

const width = 1000;
const height = 240;
const topMargin = 12;
const bottomMargin = 12;
const plotHeight = height - topMargin - bottomMargin;

export const WorkoutTimelineChart = ({
  intervals,
  elapsedSec,
  currentIndex,
  actualPowerWatts
}: Props): ReactElement => {
  const totalDurationSec = intervals.reduce((sum, interval) => sum + interval.durationSec, 0) || 1;
  const maxWatts = Math.max(
    50,
    ...intervals.flatMap((interval) => [interval.targetPowerWatts ?? 0, interval.targetPowerWattsEnd ?? 0])
  );
  const yFor = (watts: number): number => topMargin + (plotHeight - (Math.max(0, watts) / maxWatts) * plotHeight);

  let cumulativeSec = 0;
  const bars = intervals.map((interval, index) => {
    const startSec = cumulativeSec;
    cumulativeSec += interval.durationSec;
    const x0 = (startSec / totalDurationSec) * width;
    const x1 = (cumulativeSec / totalDurationSec) * width;
    const startWatts = interval.targetPowerWatts ?? 0;
    const endWatts = interval.targetPowerWattsEnd ?? startWatts;
    const isRamp = interval.targetPowerWattsEnd !== null && interval.targetPowerWattsEnd !== undefined;
    const baseline = topMargin + plotHeight;
    return {
      key: `${index}-${interval.kind}`,
      isRamp,
      // Rect fields (flat block)
      x: x0,
      y: yFor(startWatts),
      width: Math.max(0, x1 - x0),
      height: baseline - yFor(startWatts),
      // Polygon points (ramp block): bottom-left, top-left, top-right, bottom-right
      points: `${x0},${baseline} ${x0},${yFor(startWatts)} ${x1},${yFor(endWatts)} ${x1},${baseline}`,
      color: blockColors[interval.kind],
      isCurrent: index === currentIndex
    };
  });

  const progressX = Math.min(width, (elapsedSec / totalDurationSec) * width);
  const actualY =
    actualPowerWatts !== null
      ? topMargin + (plotHeight - Math.min(plotHeight, (Math.max(0, actualPowerWatts) / maxWatts) * plotHeight))
      : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="workout-timeline" role="img" aria-label="Workout power timeline">
      <line x1={0} y1={topMargin + plotHeight} x2={width} y2={topMargin + plotHeight} stroke="var(--color-divider)" strokeWidth={1} />
      {bars.map((bar) =>
        bar.isRamp ? (
          <polygon
            key={bar.key}
            points={bar.points}
            fill={bar.color}
            opacity={bar.isCurrent ? 1 : 0.6}
            stroke={bar.isCurrent ? "var(--color-text)" : "none"}
            strokeWidth={bar.isCurrent ? 2 : 0}
          />
        ) : (
          <rect
            key={bar.key}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={bar.color}
            opacity={bar.isCurrent ? 1 : 0.6}
            stroke={bar.isCurrent ? "var(--color-text)" : "none"}
            strokeWidth={bar.isCurrent ? 2 : 0}
          />
        )
      )}
      <rect x={0} y={topMargin} width={progressX} height={plotHeight} fill="color-mix(in srgb, var(--color-text) 6%, transparent)" />
      <line x1={progressX} y1={topMargin} x2={progressX} y2={topMargin + plotHeight} stroke="var(--color-accent-700)" strokeWidth={2} />
      {actualY !== null ? (
        <circle cx={progressX} cy={actualY} r={5} fill="var(--color-bg)" stroke="var(--color-accent-700)" strokeWidth={2} />
      ) : null}
    </svg>
  );
};
