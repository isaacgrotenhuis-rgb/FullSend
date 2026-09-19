import type { ReactElement } from "react";
import type { WorkoutSessionSummary, WorkoutSessionTelemetrySamples } from "@shared/ipc/contracts";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock } from "./WorkoutTimelineChart";
import { SessionMetricChart } from "./SessionMetricChart";
import { KMH_TO_MPH, formatDistance, type SpeedUnit } from "./speedUnit";

type Props = {
  summary: WorkoutSessionSummary;
  telemetry: WorkoutSessionTelemetrySamples | null;
  telemetryLoading?: boolean;
  speedUnit: SpeedUnit;
  /** Pass a handler to show an MPH/KPH toggle on the Distance tile; omit to hide it. */
  onSpeedUnitChange?: (unit: SpeedUnit) => void;
};

const tileClassName = "bg-[var(--color-bg)] p-3";
const tileValueClassName = "text-xl font-extrabold";

/**
 * Post-ride stat tiles + Speed/Power/HR time-series. Shared by the live end-of-ride
 * "Saved" dialog (RidePage) and the Home workout-recap modal.
 */
export const WorkoutSummaryView = ({
  summary,
  telemetry,
  telemetryLoading = false,
  speedUnit,
  onSpeedUnitChange
}: Props): ReactElement => {
  const showToggle = onSpeedUnitChange != null;

  return (
    <>
      <div className="grid grid-cols-3 gap-[2px] border-2 border-[var(--color-divider)] bg-[var(--color-divider)]">
        <div className={tileClassName}>
          <h6>Duration</h6>
          <div className={tileValueClassName}>{formatClock(summary.durationSec)}</div>
        </div>
        <div className={tileClassName}>
          <h6>Avg power</h6>
          <div className={tileValueClassName}>{summary.avgPowerWatts != null ? `${summary.avgPowerWatts} W` : "—"}</div>
        </div>
        <div className={tileClassName}>
          <h6>Avg cadence</h6>
          <div className={tileValueClassName}>
            {summary.avgCadenceRpm != null ? `${summary.avgCadenceRpm} rpm` : "—"}
          </div>
        </div>
        <div className={tileClassName}>
          <h6>Avg HR</h6>
          <div className={tileValueClassName}>
            {summary.avgHeartRateBpm != null ? `${summary.avgHeartRateBpm} bpm` : "—"}
          </div>
        </div>
        <div className={tileClassName}>
          <div className="flex items-center justify-between gap-1">
            <h6 style={{ margin: 0 }}>Distance</h6>
            {showToggle ? (
              // Required single-select: a unit is always chosen, so the empty-string
              // callback Radix sends when re-clicking the active item is ignored
              // instead of being allowed to clear the selection.
              <ToggleGroup
                type="single"
                size="sm"
                value={speedUnit}
                onValueChange={(value) => {
                  if (value) onSpeedUnitChange?.(value as SpeedUnit);
                }}
                aria-label="Speed unit"
              >
                <ToggleGroupItem value="mph">MPH</ToggleGroupItem>
                <ToggleGroupItem value="kph">KPH</ToggleGroupItem>
              </ToggleGroup>
            ) : null}
          </div>
          <div className={tileValueClassName}>{formatDistance(summary.distanceMeters, speedUnit)}</div>
        </div>
      </div>

      <Separator className="my-2 h-0.5 bg-[var(--color-divider)]" />
      {telemetryLoading ? (
        <div className="py-2 text-xs text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
          Loading charts…
        </div>
      ) : telemetry && telemetry.length > 0 ? (
        <>
          <SessionMetricChart
            label="Speed"
            unit={speedUnit}
            color="var(--color-accent-700)"
            samples={telemetry.map((sample) => ({
              elapsedSec: sample.elapsedSec,
              value:
                sample.actualSpeedKmh !== null
                  ? speedUnit === "mph"
                    ? sample.actualSpeedKmh * KMH_TO_MPH
                    : sample.actualSpeedKmh
                  : null
            }))}
          />
          <SessionMetricChart
            label="Power output"
            unit="W"
            color="var(--color-accent)"
            samples={telemetry.map((sample) => ({ elapsedSec: sample.elapsedSec, value: sample.actualPowerWatts }))}
          />
          <SessionMetricChart
            label="Heart rate"
            unit="bpm"
            color="var(--color-accent-2)"
            samples={telemetry.map((sample) => ({ elapsedSec: sample.elapsedSec, value: sample.actualHeartRateBpm }))}
          />
          <Separator className="my-2 h-0.5 bg-[var(--color-divider)]" />
        </>
      ) : null}
    </>
  );
};
