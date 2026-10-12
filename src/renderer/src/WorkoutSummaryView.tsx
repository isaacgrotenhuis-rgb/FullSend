import type { ReactElement } from "react";
import type { WorkoutInterval, WorkoutSessionSummary, WorkoutSessionTelemetrySamples } from "@shared/ipc/contracts";
import { formatClock } from "./WorkoutTimelineChart";
import { metricColors, RideMetricsChart } from "./RideMetricsChart";
import { KMH_TO_MPH, formatDistance, type SpeedUnit } from "./speedUnit";
import { StatStrip, type Stat } from "./StatStrip";

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
      <StatStrip stats={stats} label="Ride averages" />
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
