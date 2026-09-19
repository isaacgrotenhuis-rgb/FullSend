import { useEffect, useMemo, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import type {
  BankWorkoutDetail,
  BankWorkoutSummary,
  CompileBankWorkoutResult,
  FswSegment,
  TrainingZone,
  WorkoutInterval
} from "@shared/ipc/contracts";
import { ZONES } from "@shared/zones";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { averageTargetWatts, formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";

type Props = {
  ftp: number;
  connectedTrainerDeviceId: string | null;
  busy: boolean;
  error: string | null;
  onStartAdhoc: (bankWorkoutId: string, name: string, intervals: WorkoutInterval[]) => void;
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

/* Matches the legacy `.tag.tag-accent` pill exactly (styles.css ~L204-209):
   font-size 11px, letter-spacing 0.02em, 3px/10px padding, 6px radius
   (0.75 * --radius-md), --color-accent-100/800 background/text. */
const zoneTagClassName =
  "inline-flex items-center rounded-[6px] bg-[color:var(--color-accent-100)] px-2.5 py-[3px] text-[11px] tracking-[0.02em] text-[color:var(--color-accent-800)] capitalize";

/* Matches the legacy stat-tile pair (styles.css tileStyle/tileValueStyle
   constants this replaces): --color-bg background, --space-3 padding for the
   tile; 800-weight 22px/1 for the value. */
const tileClassName = "bg-[color:var(--color-bg)] p-3";
const tileValueClassName = "text-[22px] font-extrabold leading-none";

/* Filter chip group — was a hand-rolled chipStyle(active) cva reinvention on
   a <span onClick>, which meant no keyboard access at all (no tabIndex, no
   role, no key handler). Each row (zone / duration band / tag) is an
   independent optional single-select: clicking the active chip clears it,
   clicking another swaps it — exactly Radix ToggleGroup type="single"
   semantics, which also hands the row roving-tabindex/Enter/Space for free.
   spacing={1.5} (6px, via Tailwind's --spacing(1.5)) keeps the "wrapped pill
   cluster" look instead of ToggleGroup's default joined-segment styling,
   which only applies at spacing={0}. */
const chipItemClassName =
  "h-auto min-h-0 shrink-0 rounded-full border border-[color:var(--color-divider)] bg-transparent px-2.5 py-0.5 text-xs font-normal text-foreground shadow-none " +
  "hover:bg-transparent hover:text-foreground " +
  "data-[state=on]:bg-[color:var(--color-accent-100)] data-[state=on]:text-[color:var(--color-accent-800)] " +
  "data-[state=on]:hover:bg-[color:var(--color-accent-100)] data-[state=on]:hover:text-[color:var(--color-accent-800)]";

export const WorkoutBankBrowser = ({
  ftp,
  connectedTrainerDeviceId,
  busy,
  error,
  onStartAdhoc,
  onClose
}: Props): ReactElement => {
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
      <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <DialogTitle>Workout Bank</DialogTitle>
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Close">
            <X />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <ToggleGroup
          type="single"
          spacing={1.5}
          value={zone ?? ""}
          onValueChange={(next) => setZone(next ? (next as TrainingZone) : null)}
          className="w-full flex-wrap"
          aria-label="Filter by zone"
        >
          {zonesPresent.map((entry) => (
            <ToggleGroupItem key={entry} value={entry} className={chipItemClassName}>
              {zoneLabel(entry)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          spacing={1.5}
          value={bandKey ?? ""}
          onValueChange={(next) => setBandKey(next || null)}
          className="w-full flex-wrap"
          aria-label="Filter by duration"
        >
          {DURATION_BANDS.map((band) => (
            <ToggleGroupItem key={band.key} value={band.key} className={chipItemClassName}>
              {band.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {allTags.length > 0 ? (
          <ToggleGroup
            type="single"
            spacing={1.5}
            value={tag ?? ""}
            onValueChange={(next) => setTag(next || null)}
            className="w-full flex-wrap"
            aria-label="Filter by tag"
          >
            {allTags.map((entry) => (
              <ToggleGroupItem key={entry} value={entry} className={chipItemClassName}>
                #{entry}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      {listError ? <p className="m-0 text-[13px] text-[color:var(--color-accent-700)]">{listError}</p> : null}

      <div className="flex flex-col gap-0.5">
        {visible.length === 0 && !listError ? (
          <p className="m-0 flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--color-text)_50%,transparent)]">
            No workouts match these filters.
          </p>
        ) : null}
        {visible.map((summary) => (
          <Button
            key={summary.id}
            type="button"
            variant="outline"
            className="h-auto w-full justify-between px-3 py-2 text-left"
            onClick={() => setSelectedId(summary.id)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="overflow-hidden font-bold text-ellipsis">{summary.name}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--color-text)_50%,transparent)]">
                {zoneLabel(summary.primaryZone)} · {formatClock(summary.durationSec)}
                {summary.estTSS !== null ? ` · ${Math.round(summary.estTSS)} TSS` : ""}
              </span>
            </span>
          </Button>
        ))}
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
    const canStart = ready && !busy && connectedTrainerDeviceId !== null;

    return (
      <>
        <DialogHeader className="flex-row items-center justify-between gap-2 flex-wrap space-y-0">
          <div className="flex items-center gap-2 flex-wrap">
            {detail ? <span className={zoneTagClassName}>{zoneLabel(detail.primaryZone)}</span> : null}
            <DialogTitle>{detail?.name ?? "Loading…"}</DialogTitle>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </DialogHeader>

        {detailError ? (
          <p className="m-0 text-[13px] text-[color:var(--color-accent-700)]">{detailError}</p>
        ) : null}

        {ready ? (
          <>
            <div className="grid grid-cols-5 gap-0.5 bg-[color:var(--color-divider)] border-2 border-[color:var(--color-divider)]">
              <div className={tileClassName}>
                <h6 style={{ fontSize: 11 }}>Duration</h6>
                <div className={tileValueClassName}>{formatClock(totalDurationSec)}</div>
              </div>
              <div className={tileClassName}>
                <h6 style={{ fontSize: 11 }}>Avg power</h6>
                <div className={tileValueClassName}>
                  {avgWatts ?? "—"}
                  {avgWatts !== null ? <span className="text-[13px] font-semibold">W</span> : null}
                </div>
              </div>
              <div className={tileClassName}>
                <h6 style={{ fontSize: 11 }}>Intensity</h6>
                <div className={tileValueClassName}>
                  {compiled?.estIF !== null && compiled?.estIF !== undefined
                    ? compiled.estIF.toFixed(2)
                    : "—"}
                </div>
              </div>
              <div className={tileClassName}>
                <h6 style={{ fontSize: 11 }}>TSS</h6>
                <div className={tileValueClassName}>
                  {compiled?.estTSS !== null && compiled?.estTSS !== undefined
                    ? Math.round(compiled.estTSS)
                    : "—"}
                </div>
              </div>
              <div className={tileClassName}>
                <h6 style={{ fontSize: 11 }}>Blocks</h6>
                <div className={tileValueClassName}>{compiled?.intervals.length ?? 0}</div>
              </div>
            </div>

            {detail?.document.description ? (
              <p className="m-0 text-sm opacity-85">{detail.document.description}</p>
            ) : null}

            <div>
              <h6>Workout timeline</h6>
              <div className="relative">
                <div className="absolute top-2 left-2 z-[1] text-xs font-extrabold">
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
              <h6>Segments</h6>
              <ol className="m-0 flex flex-col gap-1 pl-4 text-[13px]">
                {detail?.document.segments.map((segment, index) => (
                  <li key={index}>{describeSegment(segment)}</li>
                ))}
              </ol>
            </div>
          </>
        ) : detailError === null ? (
          <p className="m-0 flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--color-text)_50%,transparent)]">
            Compiling at {ftp} W…
          </p>
        ) : null}

        {error ? <p className="m-0 text-[13px] text-[color:var(--color-accent-700)]">{error}</p> : null}

        <DialogFooter>
          {connectedTrainerDeviceId === null ? (
            <span className="mr-auto flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_srgb,var(--color-text)_50%,transparent)]">
              Connect a trainer to start
            </span>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => setSelectedId(null)}>
            Back
          </Button>
          <Button
            type="button"
            className="min-w-[150px]"
            disabled={!canStart}
            onClick={() =>
              detail && compiled ? onStartAdhoc(detail.id, detail.name, compiled.intervals) : undefined
            }
          >
            Start now
          </Button>
        </DialogFooter>
      </>
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100vh-2rem)] gap-3 overflow-y-auto sm:max-w-[720px]"
      >
        {selectedId === null ? renderList() : renderDetail()}
      </DialogContent>
    </Dialog>
  );
};
