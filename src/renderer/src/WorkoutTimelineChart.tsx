import type { ReactElement } from "react";
import type { WorkoutInterval, WorkoutIntervalKind } from "@shared/ipc/contracts";

const blockColors: Record<WorkoutIntervalKind, string> = {
  warmup: "#f59e0b",
  work: "#ef4444",
  recovery: "#38bdf8",
  cooldown: "#22c55e"
};

export const formatClock = (totalSec: number): string => {
  const minutes = Math.floor(totalSec / 60);
  const seconds = Math.floor(totalSec % 60);
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
};

type Props = {
  intervals: WorkoutInterval[];
  elapsedSec: number;
  currentIndex: number | null;
  actualPowerWatts: number | null;
};

const width = 1000;
const height = 240;
const topMargin = 20;
const bottomMargin = 24;
const plotHeight = height - topMargin - bottomMargin;

export const WorkoutTimelineChart = ({
  intervals,
  elapsedSec,
  currentIndex,
  actualPowerWatts
}: Props): ReactElement => {
  const totalDurationSec = intervals.reduce((sum, interval) => sum + interval.durationSec, 0) || 1;
  const maxWatts = Math.max(50, ...intervals.map((interval) => interval.targetPowerWatts ?? 0));

  let cumulativeSec = 0;
  const bars = intervals.map((interval, index) => {
    const startSec = cumulativeSec;
    cumulativeSec += interval.durationSec;
    const x0 = (startSec / totalDurationSec) * width;
    const x1 = (cumulativeSec / totalDurationSec) * width;
    const watts = interval.targetPowerWatts ?? 0;
    const barHeight = (watts / maxWatts) * plotHeight;
    return {
      key: `${index}-${interval.kind}`,
      x: x0,
      y: topMargin + (plotHeight - barHeight),
      width: Math.max(0, x1 - x0),
      height: barHeight,
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
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="workout-timeline"
      role="img"
      aria-label="Workout power timeline"
    >
      <line
        x1={0}
        y1={topMargin + plotHeight}
        x2={width}
        y2={topMargin + plotHeight}
        stroke="#3a3f4b"
        strokeWidth={1}
      />
      {bars.map((bar) => (
        <rect
          key={bar.key}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill={bar.color}
          opacity={bar.isCurrent ? 0.95 : 0.55}
          stroke={bar.isCurrent ? "#f3f4f6" : "none"}
          strokeWidth={bar.isCurrent ? 2 : 0}
        />
      ))}
      <rect x={0} y={topMargin} width={progressX} height={plotHeight} fill="#f3f4f6" opacity={0.08} />
      <line x1={progressX} y1={topMargin} x2={progressX} y2={topMargin + plotHeight} stroke="#f3f4f6" strokeWidth={2} />
      {actualY !== null ? (
        <circle cx={progressX} cy={actualY} r={5} fill="#ffffff" stroke="#111827" strokeWidth={1.5} />
      ) : null}
      <text x={4} y={topMargin - 6} fill="#9ca3af" fontSize={14}>
        {Math.round(maxWatts)} W
      </text>
      <text x={width - 4} y={height - 6} fill="#9ca3af" fontSize={14} textAnchor="end">
        {formatClock(totalDurationSec)} total
      </text>
    </svg>
  );
};
