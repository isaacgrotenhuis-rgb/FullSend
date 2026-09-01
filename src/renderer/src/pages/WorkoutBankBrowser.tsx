import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  BankWorkoutDetail,
  BankWorkoutSummary,
  CompileBankWorkoutResult,
  FswSegment,
  TrainingZone,
  WorkoutInterval
} from "@shared/ipc/contracts";
import { ZONES } from "@shared/zones";
import { averageTargetWatts, formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";

type AdhocAction = {
  kind: "adhoc";
  connectedTrainerDeviceId: string | null;
  onStartAdhoc: (bankWorkoutId: string, name: string, intervals: WorkoutInterval[]) => void;
};

type AssignAction = {
  kind: "assign";
  dayLabel: string;
  /** True when the day still has an un-replaced prescribed workout (enables "Swap"). */
  canSwap: boolean;
  onAssign: (bankWorkoutId: string, name: string, mode: "add" | "swap") => void;
};

type Props = {
  ftp: number;
  busy: boolean;
  error: string | null;
  action: AdhocAction | AssignAction;
  onClose: () => void;
};

type DurationBand = { key: string; label: string; minSec: number; maxSec: number };

const DURATION_BANDS: DurationBand[] = [
  { key: "short", label: "< 45m", minSec: 0, maxSec: 45 * 60 },
  { key: "mid", label: "45–75m", minSec: 45 * 60, maxSec: 75 * 60 },
  { key: "long", label: "75–120m", minSec: 75 * 60, maxSec: 120 * 60 },
  { key: "epic", label: "> 120m", minSec: 120 * 60, maxSec: Number.POSITIVE_INFINITY }
];

const zoneLabel = (zone: TrainingZone): string => ZONES[zone]?.label ?? zone;

const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** One-line human summary of an .fsw segment for the detail list. */
const describeSegment = (segment: FswSegment): string => {
  switch (segment.type) {
    case "warmup":
      return `Warm-up · ${formatClock(segment.durationSec)} · ${pct(segment.powerLow)}→${pct(segment.powerHigh)} FTP`;
    case "cooldown":
      return `Cool-down · ${formatClock(segment.durationSec)} · ${pct(segment.powerLow)}→${pct(segment.powerHigh)} FTP`;
    case "ramp":
      return `Ramp · ${formatClock(segment.durationSec)} · ${pct(segment.powerLow)}→${pct(segment.powerHigh)} FTP`;
    case "steady":
      return `Steady · ${formatClock(segment.durationSec)} · ${pct(segment.power)} FTP${segment.surges ? " · surges" : ""}`;
    case "freeride":
      return `Free ride · ${formatClock(segment.durationSec)}`;
    case "intervals": {
      const work = segment.onPattern
        ? `${segment.onPattern.length}-step pattern`
        : `${formatClock(segment.onDurationSec ?? 0)} @ ${pct(segment.onPower ?? 0)}`;
      const off =
        segment.offDurationSec > 0
          ? ` / ${formatClock(segment.offDurationSec)} @ ${pct(segment.offPower)}`
          : "";
      return `${segment.repeat}× (${work}${off})`;
    }
    default:
      return "Segment";
  }
};

const tileStyle = { background: "var(--color-bg)", padding: "var(--space-3)" } as const;
const tileValueStyle = {
  fontFamily: "var(--font-heading)",
  fontWeight: 800,
  fontSize: 22,
  lineHeight: 1
} as const;

const chipStyle = (active: boolean) =>
  ({
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-divider)",
    background: active ? "var(--color-accent-100)" : "transparent",
    color: active ? "var(--color-accent-800)" : "inherit"
  }) as const;

export const WorkoutBankBrowser = ({ ftp, busy, error, action, onClose }: Props): ReactElement => {
  const [summaries, setSummaries] = useState<BankWorkoutSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [zone, setZone] = useState<TrainingZone | null>(null);
  const [bandKey, setBandKey] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BankWorkoutDetail | null>(null);
  const [compiled, setCompiled] = useState<CompileBankWorkoutResult | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSummaries(await window.kickr.workoutBank.list({}));
      } catch (err) {
        setListError(err instanceof Error ? err.message : "Could not load the workout bank");
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setCompiled(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    setDetail(null);
    setCompiled(null);
    void (async () => {
      try {
        const [nextDetail, nextCompiled] = await Promise.all([
          window.kickr.workoutBank.get({ id: selectedId }),
          window.kickr.workoutBank.compile({ id: selectedId, ftp })
        ]);
        if (cancelled) {
          return;
        }
        setDetail(nextDetail);
        setCompiled(nextCompiled);
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Could not compile this workout");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, ftp]);

  const allTags = useMemo(
    () => [...new Set(summaries.flatMap((summary) => summary.tags))].sort(),
    [summaries]
  );

  const visible = useMemo(() => {
    const band = DURATION_BANDS.find((entry) => entry.key === bandKey) ?? null;
    return summaries
      .filter((summary) => !summary.archived)
      .filter((summary) => (zone ? summary.primaryZone === zone : true))
      .filter((summary) => (tag ? summary.tags.includes(tag) : true))
      .filter((summary) =>
        band ? summary.durationSec >= band.minSec && summary.durationSec < band.maxSec : true
      );
  }, [summaries, zone, tag, bandKey]);

  const zonesPresent = useMemo(
    () => [...new Set(summaries.map((summary) => summary.primaryZone))],
    [summaries]
  );

  const renderList = (): ReactElement => (
    <>
      <div className="dialog-title">Workout Bank</div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {zonesPresent.map((entry) => (
            <span
              key={entry}
              style={chipStyle(zone === entry)}
              onClick={() => setZone(zone === entry ? null : entry)}
            >
              {zoneLabel(entry)}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DURATION_BANDS.map((band) => (
            <span
              key={band.key}
              style={chipStyle(bandKey === band.key)}
              onClick={() => setBandKey(bandKey === band.key ? null : band.key)}
            >
              {band.label}
            </span>
          ))}
        </div>
        {allTags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allTags.map((entry) => (
              <span
                key={entry}
                style={chipStyle(tag === entry)}
                onClick={() => setTag(tag === entry ? null : entry)}
              >
                #{entry}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {listError ? (
        <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>{listError}</p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.length === 0 && !listError ? (
          <p className="card-meta" style={{ margin: 0 }}>
            No workouts match these filters.
          </p>
        ) : null}
        {visible.map((summary) => (
          <button
            key={summary.id}
            className="btn btn-secondary"
            style={{
              justifyContent: "space-between",
              textAlign: "left",
              width: "100%",
              padding: "var(--space-2) var(--space-3)"
            }}
            onClick={() => setSelectedId(summary.id)}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                {summary.name}
              </span>
              <span className="card-meta" style={{ margin: 0 }}>
                {zoneLabel(summary.primaryZone)} · {formatClock(summary.durationSec)}
                {summary.estTSS !== null ? ` · ${Math.round(summary.estTSS)} TSS` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );

  const renderDetail = (): ReactElement => {
    const ready = detail !== null && compiled !== null;
    const totalDurationSec = compiled?.durationSec ?? 0;
    const avgWatts = compiled ? averageTargetWatts(compiled.intervals) : null;
    const maxWatts = compiled
      ? Math.max(
          50,
          ...compiled.intervals.flatMap((interval) => [
            interval.targetPowerWatts ?? 0,
            interval.targetPowerWattsEnd ?? 0
          ])
        )
      : 0;
    const canStart =
      ready && !busy && (action.kind !== "adhoc" || action.connectedTrainerDeviceId !== null);

    return (
      <>
        <div
          className="dialog-title"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}
        >
          {detail ? (
            <span className="tag tag-accent" style={{ textTransform: "capitalize" }}>
              {zoneLabel(detail.primaryZone)}
            </span>
          ) : null}
          <span>{detail?.name ?? "Loading…"}</span>
        </div>

        {detailError ? (
          <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>{detailError}</p>
        ) : null}

        {ready ? (
          <>
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
                <div style={tileValueStyle}>
                  {compiled?.estIF !== null && compiled?.estIF !== undefined
                    ? compiled.estIF.toFixed(2)
                    : "—"}
                </div>
              </div>
              <div style={tileStyle}>
                <h6 style={{ fontSize: 11 }}>TSS</h6>
                <div style={tileValueStyle}>
                  {compiled?.estTSS !== null && compiled?.estTSS !== undefined
                    ? Math.round(compiled.estTSS)
                    : "—"}
                </div>
              </div>
              <div style={tileStyle}>
                <h6 style={{ fontSize: 11 }}>Blocks</h6>
                <div style={tileValueStyle}>{compiled?.intervals.length ?? 0}</div>
              </div>
            </div>

            {detail?.document.description ? (
              <p className="dialog-body" style={{ margin: 0 }}>
                {detail.document.description}
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
                  {Math.round(maxWatts)} W peak · FTP {ftp} W
                </div>
                {compiled ? (
                  <WorkoutTimelineChart
                    intervals={compiled.intervals}
                    elapsedSec={0}
                    currentIndex={null}
                    actualPowerWatts={null}
                  />
                ) : null}
              </div>
            </div>

            <div>
              <h6 style={{ marginBottom: "var(--space-2)" }}>Segments</h6>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: "var(--space-4)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 13
                }}
              >
                {detail?.document.segments.map((segment, index) => (
                  <li key={index}>{describeSegment(segment)}</li>
                ))}
              </ol>
            </div>
          </>
        ) : detailError === null ? (
          <p className="card-meta" style={{ margin: 0 }}>
            Compiling at {ftp} W…
          </p>
        ) : null}

        {error ? (
          <p style={{ color: "var(--color-accent-700)", fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}

        <div className="dialog-actions">
          {action.kind === "adhoc" && action.connectedTrainerDeviceId === null ? (
            <span className="card-meta" style={{ marginRight: "auto" }}>
              Connect a trainer to start
            </span>
          ) : null}
          <button className="btn btn-secondary" disabled={busy} onClick={() => setSelectedId(null)}>
            Back
          </button>
          {action.kind === "adhoc" ? (
            <button
              className="btn btn-primary"
              style={{ minWidth: 150 }}
              disabled={!canStart}
              onClick={() =>
                detail && compiled
                  ? action.onStartAdhoc(detail.id, detail.name, compiled.intervals)
                  : undefined
              }
            >
              Start now
            </button>
          ) : (
            <>
              {action.canSwap ? (
                <button
                  className="btn btn-secondary"
                  disabled={!canStart}
                  onClick={() => (detail ? action.onAssign(detail.id, detail.name, "swap") : undefined)}
                >
                  Swap {action.dayLabel}
                </button>
              ) : null}
              <button
                className="btn btn-primary"
                style={{ minWidth: 150 }}
                disabled={!canStart}
                onClick={() => (detail ? action.onAssign(detail.id, detail.name, "add") : undefined)}
              >
                Add to {action.dayLabel}
              </button>
            </>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="dialog-backdrop" onClick={onClose} style={{ zIndex: 150 }}>
      <div
        className="dialog"
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(720px, 100%)" }}
      >
        {selectedId === null ? renderList() : renderDetail()}
      </div>
    </div>
  );
};
