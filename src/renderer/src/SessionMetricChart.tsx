import type { ReactElement } from "react";
import { timelineChartClass } from "./WorkoutTimelineChart";
import { cn } from "@/lib/utils";

export type MetricSample = {
  elapsedSec: number;
  value: number | null;
};

type Props = {
  label: string;
  unit: string;
  color: string;
  samples: MetricSample[];
};

const width = 1000;
const height = 120;
const topMargin = 10;
const bottomMargin = 10;
const plotHeight = height - topMargin - bottomMargin;

export const SessionMetricChart = ({ label, unit, color, samples }: Props): ReactElement => {
  const points = samples.filter((sample): sample is { elapsedSec: number; value: number } => sample.value !== null);
  const maxElapsedSec = Math.max(1, ...samples.map((sample) => sample.elapsedSec));

  if (points.length === 0) {
    return (
      <div className="mb-4">
        <h6 className="mb-2">{label}</h6>
        <div className="text-xs text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">No data recorded</div>
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const minValue = rawMin === rawMax ? rawMin - 1 : rawMin;
  const maxValue = rawMin === rawMax ? rawMax + 1 : rawMax;

  const xFor = (elapsedSec: number): number => (elapsedSec / maxElapsedSec) * width;
  const yFor = (value: number): number => topMargin + (plotHeight - ((value - minValue) / (maxValue - minValue)) * plotHeight);

  const polylinePoints = points.map((point) => `${xFor(point.elapsedSec)},${yFor(point.value)}`).join(" ");

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h6 className="m-0">{label}</h6>
        <span className="text-[11px] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
          {Math.round(rawMax)} {unit} max
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn(timelineChartClass, "h-[220px]")}
        role="img"
        aria-label={`${label} over time`}
      >
        <line x1={0} y1={topMargin + plotHeight} x2={width} y2={topMargin + plotHeight} stroke="var(--color-divider)" strokeWidth={1} />
        <polyline points={polylinePoints} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </div>
  );
};
