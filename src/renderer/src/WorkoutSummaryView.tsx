import type { ReactElement, ReactNode } from "react";
import type { WorkoutInterval, WorkoutSessionSummary, WorkoutSessionTelemetrySamples } from "@shared/ipc/contracts";
import { formatClock } from "./WorkoutTimelineChart";
import { metricColors, RideMetricsChart } from "./RideMetricsChart";
import { KMH_TO_MPH, formatDistance, type SpeedUnit } from "./speedUnit";

type Props = {
  summary: WorkoutSessionSummary;
  telemetry: WorkoutSessionTelemetrySamples | null;
  telemetryLoading?: boolean;
  /** Planned blocks, drawn as the target-power ghost behind the chart. */
  plannedIntervals?: WorkoutInterval[];
  speedUnit: SpeedUnit;
  /** Pass a handler to show an MPH/KPH toggle on the chart; omit to hide it. */
  onSpeedUnitChange?: (unit: SpeedUnit) => void;
};

type Stat = { label: string; value: string | null; unit?: string; color?: string };

const StatCell = ({ label, value, unit, color }: Stat): ReactElement => (
  <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[color-mix(in_srgb,var(--color-text)_55%,transparent)] uppercase">
      {color ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      {label}
    </span>
    <span className="truncate text-lg leading-tight font-extrabold tabular-nums">
      {value ?? "—"}
      {value !== null && unit ? <Unit>{unit}</Unit> : null}
    </span>
  </div>
);

const Unit = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="ml-0.5 text-xs font-semibold text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
    {children}
  </span>
);

/**
 * Post-ride stat strip + layered Power/HR/Speed chart. Shared by the live
 * end-of-ride "Saved" dialog (RidePage) and the Home workout-recap modal.
 */
export const WorkoutSummaryView = ({
  summary,
  telemetry,
  telemetryLoading = false,
  plannedIntervals,
  speedUnit,
  onSpeedUnitChange
}: Props): ReactElement => {
  const [distanceValue, distanceUnit] = splitUnit(formatDistance(summary.distanceMeters, speedUnit));
  const avgSpeed =
    summary.avgSpeedKmh != null
      ? (speedUnit === "mph" ? summary.avgSpeedKmh * KMH_TO_MPH : summary.avgSpeedKmh).toFixed(1)
      : null;

  const stats: Stat[] = [
    { label: "Time", value: formatClock(summary.durationSec) },
    { label: "Distance", value: distanceValue, unit: distanceUnit },
    {
      label: "Power",
      value: summary.avgPowerWatts != null ? `${Math.round(summary.avgPowerWatts)}` : null,
      unit: "W",
      color: metricColors.power
    },
    {
      label: "Heart rate",
      value: summary.avgHeartRateBpm != null ? `${Math.round(summary.avgHeartRateBpm)}` : null,
      unit: "bpm",
      color: metricColors.hr
    },
    { label: "Speed", value: avgSpeed, unit: speedUnit === "mph" ? "mph" : "km/h", color: metricColors.speed },
    {
      label: "Cadence",
      value: summary.avgCadenceRpm != null ? `${Math.round(summary.avgCadenceRpm)}` : null,
      unit: "rpm"
    }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid grid-cols-3 divide-foreground/10 overflow-hidden rounded-xl border border-foreground/15 bg-muted sm:grid-cols-6 sm:divide-x"
        aria-label="Ride averages"
        role="group"
      >
        {stats.map((stat) => (
          <StatCell key={stat.label} {...stat} />
        ))}
      </div>
      <RideMetricsChart
        telemetry={telemetry}
        loading={telemetryLoading}
        plannedIntervals={plannedIntervals}
        speedUnit={speedUnit}
        onSpeedUnitChange={onSpeedUnitChange}
      />
    </div>
  );
};

/** "12.4 mi" → ["12.4", "mi"]; "—" → [null, undefined]. */
const splitUnit = (formatted: string): [string | null, string | undefined] => {
  const match = /^([\d.,]+)\s*(.*)$/.exec(formatted);
  return match ? [match[1], match[2] || undefined] : [null, undefined];
};
