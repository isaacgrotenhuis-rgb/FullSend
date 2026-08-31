import type { ReactElement } from "react";
import type { SessionType, WorkoutDetail } from "@shared/ipc/contracts";
import { averageTargetWatts, formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";

type Props = {
  name: string;
  sessionType: SessionType | null;
  detail: WorkoutDetail;
  connectedTrainerDeviceId: string | null;
  busy: boolean;
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

const tileStyle = { background: "var(--color-bg)", padding: "var(--space-4)" } as const;
const tileValueStyle = { fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 32, lineHeight: 1 } as const;

export const WorkoutPreviewPage = ({
  name,
  sessionType,
  detail,
  connectedTrainerDeviceId,
  busy,
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
    <main className="app">
      <button className="btn btn-ghost" style={{ marginBottom: "var(--space-4)", paddingLeft: 0 }} onClick={onBack}>
        ← Back
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-4)" }}>
        <div>
          <span className="tag tag-accent" style={{ textTransform: "capitalize" }}>{typeLabel}</span>
          <h1 style={{ margin: "var(--space-2) 0 0" }}>{name}</h1>
        </div>
      </div>

      <div className="hr" style={{ margin: "var(--space-4) 0 var(--space-6)" }} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 2,
          background: "var(--color-divider)",
          border: "2px solid var(--color-divider)",
          marginBottom: "var(--space-6)"
        }}
      >
        <div style={tileStyle}>
          <h6>Duration</h6>
          <div style={tileValueStyle}>{formatClock(totalDurationSec)}</div>
        </div>
        <div style={tileStyle}>
          <h6>Avg power</h6>
          <div style={tileValueStyle}>
            {avgWatts ?? "—"}
            {avgWatts !== null ? <span style={{ fontSize: 16, fontWeight: 600 }}>W</span> : null}
          </div>
        </div>
        <div style={tileStyle}>
          <h6>Intensity</h6>
          <div style={tileValueStyle}>{intensityFactor !== null ? intensityFactor.toFixed(2) : "—"}</div>
        </div>
        <div style={tileStyle}>
          <h6>TSS</h6>
          <div style={tileValueStyle}>{estTSS ?? "—"}</div>
        </div>
        <div style={tileStyle}>
          <h6>Intervals</h6>
          <div style={tileValueStyle}>{detail.intervals.length}</div>
        </div>
      </div>

      {description ? (
        <p style={{ maxWidth: "68ch", color: "color-mix(in srgb, var(--color-text) 75%, transparent)", marginBottom: "var(--space-6)" }}>
          {description}
        </p>
      ) : null}

      <h6 style={{ marginBottom: "var(--space-3)" }}>Workout timeline</h6>
      <div style={{ position: "relative", marginBottom: "var(--space-8)" }}>
        <div
          style={{
            position: "absolute",
            top: "var(--space-3)",
            left: "var(--space-3)",
            fontFamily: "var(--font-heading)",
            fontWeight: 800,
            fontSize: 13,
            zIndex: 1
          }}
        >
          {Math.round(maxWatts)} W peak
        </div>
        <WorkoutTimelineChart intervals={detail.intervals} elapsedSec={0} currentIndex={null} actualPowerWatts={null} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
        <button className="btn btn-secondary" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" style={{ minWidth: 160 }} disabled={!canStart} onClick={onStart}>
          Start workout
        </button>
        {connectedTrainerDeviceId === null ? (
          <span className="card-meta">Connect a trainer to start</span>
        ) : null}
      </div>
    </main>
  );
};
