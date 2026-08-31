import type { ReactElement } from "react";
import type { SessionType, WorkoutDetail } from "@shared/ipc/contracts";
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

const tileStyle = { background: "var(--color-bg)", padding: "var(--space-3)" } as const;
const tileValueStyle = {
  fontFamily: "var(--font-heading)",
  fontWeight: 800,
  fontSize: 22,
  lineHeight: 1
} as const;

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
    <div className="dialog-backdrop" onClick={onBack} style={{ zIndex: 150 }}>
      <div
        className="dialog"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(720px, 100%)" }}
      >
        <div
          className="dialog-title"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}
        >
          <span className="tag tag-accent" style={{ textTransform: "capitalize" }}>
            {typeLabel}
          </span>
          <span>{name}</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 2,
            background: "var(--color-divider)",
            border: "2px solid var(--color-divider)"
          }}
        >
          <div style={tileStyle}>
            <h6 style={{ fontSize: 11 }}>Duration</h6>
            <div style={tileValueStyle}>{formatClock(totalDurationSec)}</div>
          </div>
          <div style={tileStyle}>
            <h6 style={{ fontSize: 11 }}>Avg power</h6>
            <div style={tileValueStyle}>
              {avgWatts ?? "—"}
              {avgWatts !== null ? <span style={{ fontSize: 13, fontWeight: 600 }}>W</span> : null}
            </div>
          </div>
          <div style={tileStyle}>
            <h6 style={{ fontSize: 11 }}>Intensity</h6>
            <div style={tileValueStyle}>{intensityFactor !== null ? intensityFactor.toFixed(2) : "—"}</div>
          </div>
          <div style={tileStyle}>
            <h6 style={{ fontSize: 11 }}>TSS</h6>
            <div style={tileValueStyle}>{estTSS ?? "—"}</div>
          </div>
          <div style={tileStyle}>
            <h6 style={{ fontSize: 11 }}>Intervals</h6>
            <div style={tileValueStyle}>{detail.intervals.length}</div>
          </div>
        </div>

        {description ? (
          <p className="dialog-body" style={{ margin: 0 }}>
            {description}
          </p>
        ) : null}

        <div>
          <h6 style={{ marginBottom: "var(--space-2)" }}>Workout timeline</h6>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: "var(--space-2)",
                left: "var(--space-2)",
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: 12,
                zIndex: 1
              }}
            >
              {Math.round(maxWatts)} W peak
            </div>
            <WorkoutTimelineChart
              intervals={detail.intervals}
              elapsedSec={0}
              currentIndex={null}
              actualPowerWatts={null}
            />
          </div>
        </div>

        {error ? (
          <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}

        <div className="dialog-actions">
          {connectedTrainerDeviceId === null ? (
            <span className="card-meta" style={{ marginRight: "auto" }}>
              Connect a trainer to start
            </span>
          ) : null}
          <button className="btn btn-secondary" disabled={busy} onClick={onBack}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ minWidth: 150 }} disabled={!canStart} onClick={onStart}>
            Start workout
          </button>
        </div>
      </div>
    </div>
  );
};
