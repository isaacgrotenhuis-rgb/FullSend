import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import type { WorkoutInterval, WorkoutSessionTelemetrySamples } from "@shared/ipc/contracts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatClock } from "./WorkoutTimelineChart";
import { KMH_TO_MPH, type SpeedUnit } from "./speedUnit";

type SeriesKey = "power" | "hr" | "speed";

type Bucket = {
  elapsedSec: number;
  power: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
};

type Props = {
  telemetry: WorkoutSessionTelemetrySamples | null;
  loading?: boolean;
  /** Planned blocks, drawn as a ghost target-power profile behind actual power. */
  plannedIntervals?: WorkoutInterval[];
  speedUnit: SpeedUnit;
  /** Pass a handler to show an MPH/KPH toggle in the chart header; omit to hide it. */
  onSpeedUnitChange?: (unit: SpeedUnit) => void;
};

export const metricColors: Record<SeriesKey, string> = {
  power: "var(--color-metric-power)",
  hr: "var(--color-metric-hr)",
  speed: "var(--color-metric-speed)"
};

const seriesOrder: SeriesKey[] = ["power", "hr", "speed"];
const seriesLabels: Record<SeriesKey, string> = { power: "Power", hr: "Heart rate", speed: "Speed" };

// viewBox units. The SVG stretches to its box (preserveAspectRatio="none"), so
// every stroke is non-scaling and anything round (dots) lives in the HTML overlay.
const viewWidth = 1000;
const viewHeight = 100;
const topPad = 8;
const maxBuckets = 300;

const average = (sum: number, count: number): number | null => (count > 0 ? sum / count : null);

/** Averages 1 Hz telemetry into at most `maxBuckets` evenly spaced buckets — smooths the trace and keeps paths small. */
const bucketize = (telemetry: WorkoutSessionTelemetrySamples, durationSec: number, speedUnit: SpeedUnit): Bucket[] => {
  const count = Math.min(maxBuckets, telemetry.length);
  const width = durationSec / count;
  const sums = Array.from({ length: count }, () => ({ power: [0, 0], hr: [0, 0], speed: [0, 0], cadence: [0, 0] }));
  const add = (pair: number[], value: number | null) => {
    if (value === null) return;
    pair[0] += value;
    pair[1] += 1;
  };
  for (const sample of telemetry) {
    const index = Math.min(count - 1, Math.floor(sample.elapsedSec / width));
    const bucket = sums[index];
    add(bucket.power, sample.actualPowerWatts);
    add(bucket.hr, sample.actualHeartRateBpm);
    add(
      bucket.speed,
      sample.actualSpeedKmh === null ? null : speedUnit === "mph" ? sample.actualSpeedKmh * KMH_TO_MPH : sample.actualSpeedKmh
    );
    add(bucket.cadence, sample.actualCadenceRpm);
  }
  return sums.map((bucket, index) => ({
    elapsedSec: (index + 0.5) * width,
    power: average(bucket.power[0], bucket.power[1]),
    hr: average(bucket.hr[0], bucket.hr[1]),
    speed: average(bucket.speed[0], bucket.speed[1]),
    cadence: average(bucket.cadence[0], bucket.cadence[1])
  }));
};

/** Min/max of a series padded so a flat trace doesn't hug an edge. */
const paddedDomain = (values: number[], minSpan: number): [number, number] => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(minSpan, max - min);
  const mid = (min + max) / 2;
  return [mid - span * 0.65, mid + span * 0.55];
};

/** Target watts at a moment of the planned workout, interpolating ramps. null outside the plan or for free-ride blocks. */
const targetWattsAt = (intervals: WorkoutInterval[], elapsedSec: number): number | null => {
  let startSec = 0;
  for (const interval of intervals) {
    if (elapsedSec < startSec + interval.durationSec) {
      if (interval.targetPowerWatts === null) return null;
      const end = interval.targetPowerWattsEnd ?? interval.targetPowerWatts;
      const progress = (elapsedSec - startSec) / interval.durationSec;
      return interval.targetPowerWatts + (end - interval.targetPowerWatts) * progress;
    }
    startSec += interval.durationSec;
  }
  return null;
};

const formatTick = (sec: number): string => {
  if (sec === 0) return "0";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.round((sec % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h${`${minutes}`.padStart(2, "0")}`;
};

const tickStepSec = (durationSec: number): number =>
  [60, 300, 600, 900, 1800, 3600, 7200].find((step) => durationSec / step <= 6) ?? 7200;

const mutedText = "text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]";

/**
 * Power, heart rate and speed layered on one time axis. Each series is scaled to
 * its own range — there is deliberately no y-axis, because three units can't
 * share one honestly — so exact values live in the hover/keyboard readout and
 * the legend's maxima. Power is the hero (filled area under the
 * planned target, a dashed step line); HR and speed are lines.
 */
export const RideMetricsChart = ({
  telemetry,
  loading = false,
  plannedIntervals = [],
  speedUnit,
  onSpeedUnitChange
}: Props): ReactElement => {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const model = useMemo(() => {
    if (!telemetry || telemetry.length === 0) return null;
    const durationSec = Math.max(1, ...telemetry.map((sample) => sample.elapsedSec + 1));
    const buckets = bucketize(telemetry, durationSec, speedUnit);
    const valuesOf = (key: SeriesKey) => buckets.flatMap((bucket) => (bucket[key] === null ? [] : [bucket[key] as number]));

    const plannedMax = Math.max(
      0,
      ...plannedIntervals.flatMap((interval) => [interval.targetPowerWatts ?? 0, interval.targetPowerWattsEnd ?? 0])
    );
    const power = valuesOf("power");
    const hr = valuesOf("hr");
    const speed = valuesOf("speed");
    const domains: Record<SeriesKey, [number, number] | null> = {
      // Power is anchored at zero so the area reads as effort, not just variation.
      power: power.length > 0 || plannedMax > 0 ? [0, Math.max(50, ...power, plannedMax) * 1.08] : null,
      hr: hr.length > 0 ? paddedDomain(hr, 20) : null,
      // Trainer speed is derived from power, so on its own min/max it would trace
      // the power line exactly. Anchoring it at zero with headroom flattens it
      // into the lower band, where it reads as its own line.
      speed: speed.length > 0 ? [0, Math.max(...speed) * 1.7] : null
    };
    const maxima: Record<SeriesKey, number | null> = {
      power: power.length > 0 ? Math.max(...power) : null,
      hr: hr.length > 0 ? Math.max(...hr) : null,
      speed: speed.length > 0 ? Math.max(...speed) : null
    };
    return { durationSec, buckets, domains, maxima };
  }, [telemetry, plannedIntervals, speedUnit]);

  const unitToggle = onSpeedUnitChange ? (
    // Required single-select: Radix sends "" when the active item is re-clicked; ignore it.
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={speedUnit}
      onValueChange={(value) => {
        if (value) onSpeedUnitChange(value as SpeedUnit);
      }}
      aria-label="Speed unit"
    >
      <ToggleGroupItem value="mph" className="px-2 text-[11px]">
        MPH
      </ToggleGroupItem>
      <ToggleGroupItem value="kph" className="px-2 text-[11px]">
        KPH
      </ToggleGroupItem>
    </ToggleGroup>
  ) : null;

  const frameClass = "relative h-[200px] rounded-lg bg-background";

  if (!model) {
    return (
      <div className="rounded-xl border border-foreground/15 bg-muted p-3">
        <div className="mb-2 flex min-h-8 items-center justify-between">
          <h6 className="m-0">Ride</h6>
          {unitToggle}
        </div>
        <div className={cn(frameClass, "flex items-center justify-center text-xs", mutedText)}>
          {loading ? "Loading charts…" : "No telemetry recorded for this ride"}
        </div>
        <div className="h-5" />
      </div>
    );
  }

  const { durationSec, buckets, domains, maxima } = model;
  const xFor = (sec: number): number => (Math.min(sec, durationSec) / durationSec) * viewWidth;
  const yFor = (key: SeriesKey, value: number): number => {
    const [min, max] = domains[key] ?? [0, 1];
    const clamped = Math.min(max, Math.max(min, value));
    return topPad + (1 - (clamped - min) / (max - min)) * (viewHeight - topPad);
  };

  const runsOf = (key: SeriesKey): Array<Array<[number, number]>> => {
    const runs: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    for (const bucket of buckets) {
      const value = bucket[key];
      if (value === null) {
        if (current.length > 0) runs.push(current);
        current = [];
      } else {
        current.push([xFor(bucket.elapsedSec), yFor(key, value)]);
      }
    }
    if (current.length > 0) runs.push(current);
    return runs;
  };
  const linePath = (key: SeriesKey): string =>
    runsOf(key)
      .map((run) => run.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(2)}`).join(""))
      .join("");
  const areaPath = (key: SeriesKey): string =>
    runsOf(key)
      .map((run) => {
        const first = run[0];
        const last = run[run.length - 1];
        return `M${first[0].toFixed(1)},${viewHeight}${run.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(2)}`).join("")}L${last[0].toFixed(1)},${viewHeight}Z`;
      })
      .join("");

  let plannedPath = "";
  if (plannedIntervals.length > 0 && domains.power) {
    let startSec = 0;
    const points: string[] = [];
    for (const interval of plannedIntervals) {
      if (startSec >= durationSec) break;
      const start = interval.targetPowerWatts ?? 0;
      const end = interval.targetPowerWattsEnd ?? start;
      const endSec = Math.min(durationSec, startSec + interval.durationSec);
      const endWatts = start + (end - start) * ((endSec - startSec) / interval.durationSec);
      points.push(`L${xFor(startSec).toFixed(1)},${yFor("power", start).toFixed(2)}`);
      points.push(`L${xFor(endSec).toFixed(1)},${yFor("power", endWatts).toFixed(2)}`);
      startSec = endSec;
    }
    plannedPath = `M${points.join("").slice(1)}`;
  }

  const visible = (key: SeriesKey): boolean => domains[key] !== null && maxima[key] !== null && !hidden.has(key);
  const toggleSeries = (key: SeriesKey) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const step = tickStepSec(durationSec);
  const ticks: number[] = [];
  for (let sec = 0; sec <= durationSec - step * 0.4; sec += step) ticks.push(sec);

  const indexFromPointer = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / Math.max(1, rect.width);
    return Math.min(buckets.length - 1, Math.max(0, Math.floor(fraction * buckets.length)));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const jump = Math.max(1, Math.round(buckets.length / 30));
    const from = activeIndex ?? 0;
    const moves: Record<string, number> = {
      ArrowLeft: from - (event.shiftKey ? jump : 1),
      ArrowRight: activeIndex === null ? 0 : from + (event.shiftKey ? jump : 1),
      Home: 0,
      End: buckets.length - 1
    };
    if (event.key in moves) {
      event.preventDefault();
      setActiveIndex(Math.min(buckets.length - 1, Math.max(0, moves[event.key])));
    } else if (event.key === "Escape" && activeIndex !== null) {
      // Clear the readout first; a second Escape still reaches the dialog.
      event.stopPropagation();
      setActiveIndex(null);
    }
  };

  const active = activeIndex !== null ? buckets[activeIndex] : null;
  const activeLeftPct = active ? (xFor(active.elapsedSec) / viewWidth) * 100 : 0;
  const activeTarget = active && plannedIntervals.length > 0 ? targetWattsAt(plannedIntervals, active.elapsedSec) : null;
  const speedLabel = speedUnit === "mph" ? "mph" : "km/h";
  const formatValue = (key: SeriesKey, value: number): string =>
    key === "power" ? `${Math.round(value)} W` : key === "hr" ? `${Math.round(value)} bpm` : `${value.toFixed(1)} ${speedLabel}`;

  return (
    <div className="rounded-xl border border-foreground/15 bg-muted p-3">
      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart series">
          {seriesOrder.map((key) => {
            const hasData = maxima[key] !== null;
            const on = hasData && !hidden.has(key);
            return (
              <button
                key={key}
                type="button"
                disabled={!hasData}
                aria-pressed={on}
                onClick={() => toggleSeries(key)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  on
                    ? "border-foreground/15 bg-background shadow-xs"
                    : "border-dashed border-foreground/25 bg-transparent opacity-60 hover:opacity-90",
                  !hasData && "cursor-not-allowed hover:opacity-60"
                )}
              >
                {/* Key mirrors the mark: a block for the power area, a stroke for the lines. */}
                <span
                  aria-hidden
                  className={cn(key === "power" ? "h-2.5 w-2.5 rounded-[3px]" : "h-[3px] w-3 rounded-full")}
                  style={{ background: metricColors[key] }}
                />
                <span className="font-semibold">{seriesLabels[key]}</span>
                <span className={mutedText}>
                  {hasData ? `max ${formatValue(key, maxima[key] as number)}` : "no data"}
                </span>
              </button>
            );
          })}
          {plannedPath ? (
            <span className={cn("ml-1 flex items-center gap-1.5 text-xs", mutedText)}>
              <span aria-hidden className="w-3 border-t-[1.5px] border-dashed border-[var(--color-neutral-700)]" />
              Target
            </span>
          ) : null}
        </div>
        {unitToggle}
      </div>

      <div
        className={cn(frameClass, "cursor-crosshair touch-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}
        tabIndex={0}
        role="group"
        aria-label="Power, heart rate and speed over the ride. Use the arrow keys to read values."
        onPointerMove={(event) => setActiveIndex(indexFromPointer(event))}
        onPointerLeave={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setActiveIndex(null)}
      >
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          <defs>
            <linearGradient id="ride-power-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-metric-power)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--color-metric-power)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          {ticks.slice(1).map((sec) => (
            <line
              key={sec}
              x1={xFor(sec)}
              x2={xFor(sec)}
              y1={0}
              y2={viewHeight}
              stroke="color-mix(in srgb, var(--color-text) 8%, transparent)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {visible("power") ? (
            <>
              <path d={areaPath("power")} fill="url(#ride-power-fill)" />
              <path
                d={linePath("power")}
                fill="none"
                stroke={metricColors.power}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
          {plannedPath && !hidden.has("power") ? (
            <path
              d={plannedPath}
              fill="none"
              stroke="var(--color-neutral-700)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {(["speed", "hr"] as const).map((key) =>
            visible(key) ? (
              <path
                key={key}
                d={linePath(key)}
                fill="none"
                stroke={metricColors[key]}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}
          {active ? (
            <line
              x1={xFor(active.elapsedSec)}
              x2={xFor(active.elapsedSec)}
              y1={0}
              y2={viewHeight}
              stroke="color-mix(in srgb, var(--color-text) 45%, transparent)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {active
          ? seriesOrder.map((key) =>
              visible(key) && active[key] !== null ? (
                <span
                  key={key}
                  aria-hidden
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                  style={{
                    left: `${activeLeftPct}%`,
                    top: `${yFor(key, active[key] as number)}%`,
                    background: metricColors[key]
                  }}
                />
              ) : null
            )
          : null}

        {active ? (
          <div
            className={cn(
              "pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-foreground/10 bg-popover px-2.5 py-2 text-xs shadow-md",
              activeLeftPct > 60 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3"
            )}
            style={{ left: `${activeLeftPct}%` }}
          >
            <div className={cn("mb-1 tabular-nums", mutedText)}>{formatClock(active.elapsedSec)}</div>
            {seriesOrder.map((key) =>
              visible(key) ? (
                <div key={key} className="flex items-center gap-2 py-px">
                  <span aria-hidden className="h-[3px] w-2.5 rounded-full" style={{ background: metricColors[key] }} />
                  <span className="font-bold tabular-nums">
                    {active[key] !== null ? formatValue(key, active[key] as number) : "—"}
                  </span>
                  <span className={mutedText}>{seriesLabels[key]}</span>
                </div>
              ) : null
            )}
            {activeTarget !== null && !hidden.has("power") ? (
              <div className={cn("mt-1 border-t border-foreground/10 pt-1 tabular-nums", mutedText)}>
                Target {Math.round(activeTarget)} W
              </div>
            ) : null}
            {active.cadence !== null ? (
              <div className={cn("tabular-nums", mutedText)}>Cadence {Math.round(active.cadence)} rpm</div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative mt-1 h-4 text-[11px] tabular-nums" aria-hidden>
        {ticks.map((sec) => (
          <span
            key={sec}
            className={cn("absolute", sec === 0 ? "" : "-translate-x-1/2", mutedText)}
            style={{ left: `${(xFor(sec) / viewWidth) * 100}%` }}
          >
            {formatTick(sec)}
          </span>
        ))}
      </div>
    </div>
  );
};
