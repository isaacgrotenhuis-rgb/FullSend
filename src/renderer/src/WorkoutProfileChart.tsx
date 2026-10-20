import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import type { WorkoutInterval, WorkoutIntervalKind } from "@shared/ipc/contracts";
import { cn } from "@/lib/utils";
import { formatTick, timeTicks } from "./chartTime";
import { formatClock } from "./WorkoutTimelineChart";
import { powerZones, zoneFor, type PowerZone } from "./zones";

export type PowerSample = { elapsedSec: number; watts: number };

type Props = {
  intervals: WorkoutInterval[];
  /** FTP the zones are measured against; null draws every powered block in one colour and hides time-in-zone. */
  ftpWatts: number | null;
  /** Card heading; defaults to "Workout profile". */
  title?: string;
  /** Extra content for the right side of the card header (replaces the FTP note). */
  headerExtra?: ReactNode;
  /**
   * Live-ride mode: shades the elapsed part of the workout, marks "now",
   * emphasises the current block and draws the rider's actual power over the
   * targets. Also hides the time-in-zone breakdown, which is a planning aid.
   */
  live?: { elapsedSec: number; currentIndex: number | null; actualTrace: PowerSample[] };
  /** Plot height class; defaults to h-[200px]. */
  heightClass?: string;
};

const maxTracePoints = 300;

type Block = {
  index: number;
  kind: WorkoutIntervalKind;
  startSec: number;
  durationSec: number;
  /** null for a free-ride block (no power target). */
  startWatts: number | null;
  endWatts: number | null;
  zone: PowerZone | null;
};

export const kindLabels: Record<WorkoutIntervalKind, string> = {
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cool-down"
};

const freeRideColor = "var(--color-neutral-400)";
const mutedText = "text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]";

const formatMinutes = (sec: number): string => {
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h ${rest}m`;
};

/**
 * The planned workout as zone-shaded power blocks on a time axis, with the
 * FTP line for reference and a time-in-zone breakdown underneath. Blocks are
 * HTML, not SVG, so they keep crisp rounded tops at any width; ramps are a
 * clip-path wedge. Hover (or arrow keys on the focused chart) reads out a
 * block's target, zone and timing.
 */
export const WorkoutProfileChart = ({
  intervals,
  ftpWatts,
  title = "Workout profile",
  headerExtra,
  live,
  heightClass = "h-[200px]"
}: Props): ReactElement => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const model = useMemo(() => {
    let cursor = 0;
    const blocks: Block[] = intervals.map((interval, index) => {
      const startWatts = interval.targetPowerWatts;
      const endWatts = startWatts === null ? null : (interval.targetPowerWattsEnd ?? startWatts);
      const meanWatts = startWatts === null || endWatts === null ? null : (startWatts + endWatts) / 2;
      const block: Block = {
        index,
        kind: interval.kind,
        startSec: cursor,
        durationSec: interval.durationSec,
        startWatts,
        endWatts,
        zone: meanWatts !== null && ftpWatts ? zoneFor(meanWatts, ftpWatts) : null
      };
      cursor += interval.durationSec;
      return block;
    });
    const durationSec = Math.max(1, cursor);
    const peakWatts = Math.max(0, ...blocks.flatMap((block) => [block.startWatts ?? 0, block.endWatts ?? 0]));
    // Headroom above the taller of the peak and the FTP line, so both stay inside the frame.
    const maxWatts = Math.max(100, peakWatts, ftpWatts ?? 0) * 1.12;

    const zoneSeconds = new Map<PowerZone["key"], number>();
    let freeRideSec = 0;
    for (const block of blocks) {
      if (block.startWatts === null) freeRideSec += block.durationSec;
      else if (block.zone) zoneSeconds.set(block.zone.key, (zoneSeconds.get(block.zone.key) ?? 0) + block.durationSec);
    }
    return { blocks, durationSec, maxWatts, zoneSeconds, freeRideSec };
  }, [intervals, ftpWatts]);

  const { blocks, durationSec, maxWatts, zoneSeconds, freeRideSec } = model;
  const pct = (sec: number): number => (sec / durationSec) * 100;
  const heightPct = (watts: number): number => (watts / maxWatts) * 100;
  const colorOf = (block: Block): string =>
    block.startWatts === null ? freeRideColor : (block.zone?.color ?? "var(--color-accent)");
  const ticks = timeTicks(durationSec);

  const blockAt = (sec: number): number => {
    const found = blocks.findIndex((block) => sec < block.startSec + block.durationSec);
    return found === -1 ? blocks.length - 1 : found;
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    setActiveIndex(blockAt(fraction * durationSec));
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: (activeIndex ?? 0) - 1,
      ArrowRight: activeIndex === null ? 0 : activeIndex + 1,
      Home: 0,
      End: blocks.length - 1
    };
    if (event.key in moves) {
      event.preventDefault();
      setActiveIndex(Math.min(blocks.length - 1, Math.max(0, moves[event.key])));
    } else if (event.key === "Escape" && activeIndex !== null) {
      // Clear the readout first; a second Escape still reaches the dialog.
      event.stopPropagation();
      setActiveIndex(null);
    }
  };

  const active = activeIndex !== null ? blocks[activeIndex] : null;
  const activeCenterPct = active ? pct(active.startSec + active.durationSec / 2) : 0;
  const ftpPct = ftpWatts ? heightPct(ftpWatts) : null;
  const zonesUsed = live ? [] : powerZones.filter((zone) => zoneSeconds.has(zone.key));

  const elapsedPct = live ? Math.min(100, pct(live.elapsedSec)) : 0;
  // Actual power, averaged into at most maxTracePoints buckets so a long ride
  // stays a smooth, cheap path. Clamped to the plot rather than rescaling it,
  // so the target blocks never jump while riding.
  let tracePath = "";
  if (live && live.actualTrace.length > 1) {
    const bucketSec = Math.max(1, durationSec / maxTracePoints);
    const buckets = new Map<number, { sum: number; count: number }>();
    for (const sample of live.actualTrace) {
      const key = Math.floor(sample.elapsedSec / bucketSec);
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += sample.watts;
      bucket.count += 1;
      buckets.set(key, bucket);
    }
    tracePath = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([key, bucket], index) => {
        const x = Math.min(1000, ((key + 0.5) * bucketSec * 1000) / durationSec);
        const y = 100 - Math.min(100, heightPct(bucket.sum / bucket.count));
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(2)}`;
      })
      .join("");
  }

  return (
    <div className="rounded-xl border border-foreground/15 bg-muted p-3">
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <h6 className="m-0">{title}</h6>
        {headerExtra ??
          (ftpWatts ? <span className={cn("text-xs", mutedText)}>Zones at FTP {Math.round(ftpWatts)} W</span> : null)}
      </div>

      <div
        className={cn(
          "relative cursor-crosshair touch-none rounded-lg bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          heightClass
        )}
        tabIndex={0}
        role="group"
        aria-label="Workout power profile. Use the arrow keys to step through the intervals."
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        onBlur={() => setActiveIndex(null)}
      >
        {/* Plot area inset from the frame's top so the tallest block keeps its rounded corners off the edge. */}
        <div className="absolute inset-x-0 top-2 bottom-0" aria-hidden>
          {ticks.slice(1).map((sec) => (
            <span
              key={sec}
              className="absolute inset-y-0 w-px bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)]"
              style={{ left: `${pct(sec)}%` }}
            />
          ))}

          {blocks.map((block) => {
            const isActive = activeIndex === block.index;
            const isCurrent = live?.currentIndex === block.index;
            const isDone = live !== undefined && live.currentIndex !== null && block.index < live.currentIndex;
            const dimmed = activeIndex !== null ? !isActive : isDone;
            const color = colorOf(block);
            const common = cn(
              "absolute bottom-0 transition-[opacity,filter] duration-150",
              dimmed && "opacity-45",
              (isActive || (activeIndex === null && isCurrent)) && "brightness-110"
            );
            // 2px surface gap between neighbours; never thinner than a hairline.
            const geometry = { left: `${pct(block.startSec)}%`, width: `max(1px, calc(${pct(block.durationSec)}% - 2px))` };

            if (block.startWatts === null || block.endWatts === null) {
              return (
                <span
                  key={block.index}
                  className={cn(common, "h-[14%] rounded-t-[4px]")}
                  style={{ ...geometry, background: color }}
                />
              );
            }
            const top = Math.max(block.startWatts, block.endWatts);
            if (block.startWatts === block.endWatts) {
              return (
                <span
                  key={block.index}
                  className={cn(common, "rounded-t-[4px]")}
                  style={{ ...geometry, height: `${heightPct(top)}%`, background: color }}
                />
              );
            }
            // Ramp: a box as tall as its higher end, clipped to a wedge.
            const startInset = (1 - block.startWatts / top) * 100;
            const endInset = (1 - block.endWatts / top) * 100;
            return (
              <span
                key={block.index}
                className={common}
                style={{
                  ...geometry,
                  height: `${heightPct(top)}%`,
                  background: color,
                  clipPath: `polygon(0 ${startInset}%, 100% ${endInset}%, 100% 100%, 0 100%)`
                }}
              />
            );
          })}

          {live ? (
            <>
              {/* Elapsed wash and the "now" line. */}
              <span
                className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--color-text)_5%,transparent)]"
                style={{ width: `${elapsedPct}%` }}
              />
              {tracePath ? (
                <svg
                  viewBox="0 0 1000 100"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                >
                  <path
                    d={tracePath}
                    fill="none"
                    stroke="var(--color-text)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
              <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${elapsedPct}%` }}>
                <span className="absolute -top-1.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-background" />
              </span>
            </>
          ) : null}

          {ftpPct !== null ? (
            <div className="pointer-events-none absolute inset-x-0" style={{ bottom: `${ftpPct}%` }}>
              <div className="border-t-[1.5px] border-dashed border-[var(--color-neutral-700)]" />
              <span className="absolute right-1.5 bottom-0.5 rounded-sm bg-background/85 px-1 text-[10px] font-bold tracking-wide text-[var(--color-neutral-800)] uppercase">
                FTP
              </span>
            </div>
          ) : null}
        </div>

        {active ? (
          <div
            className={cn(
              "pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border border-foreground/10 bg-popover px-2.5 py-2 text-xs shadow-md",
              activeCenterPct > 60 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3"
            )}
            style={{ left: `${activeCenterPct}%` }}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: colorOf(active) }} />
              <span className="font-bold">{kindLabels[active.kind]}</span>
              {active.zone ? (
                <span className={mutedText}>
                  {active.zone.name}
                </span>
              ) : null}
            </div>
            <div className="text-sm font-extrabold tabular-nums">
              {active.startWatts === null || active.endWatts === null
                ? "Free ride"
                : active.startWatts === active.endWatts
                  ? `${Math.round(active.startWatts)} W`
                  : `${Math.round(active.startWatts)} → ${Math.round(active.endWatts)} W`}
              {ftpWatts && active.startWatts !== null && active.endWatts !== null ? (
                <span className={cn("ml-1.5 text-xs font-semibold", mutedText)}>
                  {Math.round(((active.startWatts + active.endWatts) / 2 / ftpWatts) * 100)}% FTP
                </span>
              ) : null}
            </div>
            <div className={cn("mt-0.5 tabular-nums", mutedText)}>
              {formatClock(active.durationSec)} · from {formatClock(active.startSec)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative mt-1 h-4 text-[11px] tabular-nums" aria-hidden>
        {ticks.map((sec) => (
          <span
            key={sec}
            className={cn("absolute", sec === 0 ? "" : "-translate-x-1/2", mutedText)}
            style={{ left: `${pct(sec)}%` }}
          >
            {formatTick(sec)}
          </span>
        ))}
      </div>

      {zonesUsed.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {zonesUsed.map((zone) => (
              <span key={zone.key} style={{ flexGrow: zoneSeconds.get(zone.key), background: zone.color }} />
            ))}
            {freeRideSec > 0 ? <span style={{ flexGrow: freeRideSec, background: freeRideColor }} /> : null}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs" aria-label="Time in zone">
            {zonesUsed.map((zone) => (
              <li key={zone.key} className="flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: zone.color }} />
                <span className="font-semibold">{zone.name}</span>
                <span className={cn("tabular-nums", mutedText)}>{formatMinutes(zoneSeconds.get(zone.key) ?? 0)}</span>
              </li>
            ))}
            {freeRideSec > 0 ? (
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: freeRideColor }} />
                <span className="font-semibold">Free ride</span>
                <span className={cn("tabular-nums", mutedText)}>{formatMinutes(freeRideSec)}</span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
