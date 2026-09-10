import type { ReactElement } from "react";
import type { WorkoutSessionSummary, WorkoutSessionTelemetrySamples } from "@shared/ipc/contracts";
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

const tileStyle = { background: "var(--color-bg)", padding: "var(--space-3)" } as const;
const tileValueStyle = { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20 } as const;

const unitButtonStyle = (active: boolean) =>
  ({
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: active ? 800 : 500,
    opacity: active ? 1 : 0.5
  }) as const;

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 2,
          background: "var(--color-divider)",
          border: "2px solid var(--color-divider)"
        }}
      >
        <div style={tileStyle}>
          <h6>Duration</h6>
          <div style={tileValueStyle}>{formatClock(summary.durationSec)}</div>
        </div>
        <div style={tileStyle}>
          <h6>Avg power</h6>
          <div style={tileValueStyle}>{summary.avgPowerWatts != null ? `${summary.avgPowerWatts} W` : "—"}</div>
        </div>
        <div style={tileStyle}>
          <h6>Avg cadence</h6>
          <div style={tileValueStyle}>{summary.avgCadenceRpm != null ? `${summary.avgCadenceRpm} rpm` : "—"}</div>
        </div>
        <div style={tileStyle}>
          <h6>Avg HR</h6>
          <div style={tileValueStyle}>{summary.avgHeartRateBpm != null ? `${summary.avgHeartRateBpm} bpm` : "—"}</div>
        </div>
        <div style={tileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
            <h6 style={{ margin: 0 }}>Distance</h6>
            {showToggle ? (
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  className="btn btn-secondary"
                  style={unitButtonStyle(speedUnit === "mph")}
                  onClick={() => onSpeedUnitChange?.("mph")}
                >
                  MPH
                </button>
                <button
                  className="btn btn-secondary"
                  style={unitButtonStyle(speedUnit === "kph")}
                  onClick={() => onSpeedUnitChange?.("kph")}
                >
                  KPH
                </button>
              </div>
            ) : null}
          </div>
          <div style={tileValueStyle}>{formatDistance(summary.distanceMeters, speedUnit)}</div>
        </div>
      </div>

      <div className="hr" style={{ margin: "var(--space-2) 0" }} />
      {telemetryLoading ? (
        <div
          style={{
            fontSize: 12,
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            padding: "var(--space-2) 0"
          }}
        >
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
          <div className="hr" style={{ margin: "var(--space-2) 0" }} />
        </>
      ) : null}
    </>
  );
};
