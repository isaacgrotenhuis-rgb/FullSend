import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus } from "lucide-react";
import type {
  BankWorkoutDetail,
  BankWorkoutSummary,
  CompileBankWorkoutResult,
  FswSegment,
  TrainingZone,
  WorkoutInterval
} from "@shared/ipc/contracts";
import { ZONES } from "@shared/zones";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock } from "../WorkoutTimelineChart";
import { WorkoutBuilder, type BuilderMode } from "./WorkoutBuilder";
import { previewDialogClassName, WorkoutPreviewContent } from "./WorkoutPreviewDialog";

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
  // Bumped after an edit is saved so the detail view re-reads the same id.
  const [detailVersion, setDetailVersion] = useState(0);

  // The builder replaces the list/detail view while it's open.
  const [builder, setBuilder] = useState<{ mode: BuilderMode; source: BankWorkoutDetail | null } | null>(null);
  const [builderDirty, setBuilderDirty] = useState(false);
  // Set while "Discard changes?" is showing; runs if the rider confirms.
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);

  const loadSummaries = useCallback(async (): Promise<void> => {
    try {
      setSummaries(await window.kickr.workoutBank.list({}));
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load the workout bank");
    }
  }, []);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

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
  }, [selectedId, ftp, detailVersion]);

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

  const openBuilder = (mode: BuilderMode, source: BankWorkoutDetail | null): void => {
    setBuilderDirty(false);
    setBuilder({ mode, source });
  };

  const renderList = (): ReactElement => (
    <>
      <DialogHeader className="flex-row items-start justify-between gap-4 pr-8">
        <div className="flex flex-col gap-2">
          <DialogTitle>Workout Bank</DialogTitle>
          <DialogDescription>Pick a workout to preview it at your FTP of {ftp} W.</DialogDescription>
        </div>
        <Button type="button" size="sm" onClick={() => openBuilder("create", null)}>
          <Plus />
          New workout
        </Button>
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

      {visible.length === 0 && !listError ? (
        <p className="m-0 text-sm text-muted-foreground">No workouts match these filters.</p>
      ) : null}
      {visible.length > 0 ? (
        /* Same rounded card of Item rows as Home's Recent activity. ItemGroup is
           role="list", so each row is wrapped in a listitem. */
        <Card className="gap-0 overflow-clip rounded-xl border-foreground/15 bg-muted py-0 shadow-xs">
          <ItemGroup>
            {visible.map((summary, index) => (
              <Fragment key={summary.id}>
                {index > 0 ? <ItemSeparator className="bg-foreground/10" /> : null}
                <div role="listitem">
                  <Item
                    asChild
                    className="w-full cursor-pointer rounded-none px-3 py-2.5 text-left hover:bg-foreground/5 focus-visible:ring-inset"
                  >
                    <button type="button" onClick={() => setSelectedId(summary.id)}>
                      <ItemContent className="min-w-0">
                        <ItemTitle className="font-bold">
                          {summary.name}
                          {summary.source === "user" ? (
                            <Badge variant="outline" className="font-normal">
                              Custom
                            </Badge>
                          ) : null}
                        </ItemTitle>
                        <ItemDescription className="text-xs">
                          {zoneLabel(summary.primaryZone)} · {formatClock(summary.durationSec)}
                          {summary.estTSS !== null ? ` · ${Math.round(summary.estTSS)} TSS` : ""}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </ItemActions>
                    </button>
                  </Item>
                </div>
              </Fragment>
            ))}
          </ItemGroup>
        </Card>
      ) : null}
    </>
  );

  const renderDetail = (): ReactElement => {
    if (detail === null || compiled === null) {
      return (
        <>
          <DialogHeader>
            <DialogTitle>{detailError ? "Couldn't load workout" : "Loading…"}</DialogTitle>
            <DialogDescription>
              {detailError ?? `Compiling at your FTP of ${ftp} W…`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setSelectedId(null)}>
              Back
            </Button>
          </div>
        </>
      );
    }

    // The bank's own preview is the same component a plan day opens, so the
    // two entry points can't drift apart again; the bank adds its segment list.
    return (
      <WorkoutPreviewContent
        name={detail.name}
        typeLabel={zoneLabel(detail.primaryZone)}
        description={detail.document.description ?? null}
        intervals={compiled.intervals}
        intensityFactor={compiled.estIF}
        storedTSS={compiled.estTSS}
        zoneFtp={ftp}
        connectedTrainerDeviceId={connectedTrainerDeviceId}
        busy={busy}
        error={error}
        onStart={() => onStartAdhoc(detail.id, detail.name, compiled.intervals)}
        startLabel="Start now"
        secondaryLabel="Back"
        onSecondary={() => setSelectedId(null)}
      >
        {/* Collapsed by default so the preview still fits without scrolling. */}
        <Collapsible className="flex flex-col">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="group/segments -ml-2 text-muted-foreground">
                <ChevronDown className="transition-transform group-data-[state=open]/segments:rotate-180" />
                {detail.document.segments.length} segment{detail.document.segments.length === 1 ? "" : "s"}
              </Button>
            </CollapsibleTrigger>
            {/* Seed workouts are the curated library plans draw from, so they're
                copied rather than changed; the rider's own can be edited in place. */}
            <ButtonGroup aria-label="Workout actions">
              {detail.source === "user" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => openBuilder("edit", detail)}>
                  <Pencil />
                  Edit
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => openBuilder("duplicate", detail)}>
                <Copy />
                Duplicate
              </Button>
            </ButtonGroup>
          </div>
          <CollapsibleContent>
            <ol className="m-0 mt-1 flex flex-col gap-1 rounded-xl border border-foreground/15 bg-muted py-3 pr-3 pl-8 text-[13px]">
              {detail.document.segments.map((segment, index) => (
                <li key={index}>{describeSegment(segment)}</li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      </WorkoutPreviewContent>
    );
  };

  /** Run `action` now, or after "Discard changes?" if the builder has unsaved edits. */
  const confirmLeaveBuilder = (action: () => void): void => {
    if (builder && builderDirty) {
      setPendingDiscard(() => action);
    } else {
      action();
    }
  };

  const closeBuilder = (): void => {
    setBuilder(null);
    setBuilderDirty(false);
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) confirmLeaveBuilder(onClose);
        }}
      >
        <DialogContent className={previewDialogClassName}>
          {builder ? (
            <WorkoutBuilder
              key={`${builder.mode}:${builder.source?.id ?? "new"}`}
              mode={builder.mode}
              source={builder.source}
              ftp={ftp}
              takenIds={summaries.map((summary) => summary.id)}
              onDirtyChange={setBuilderDirty}
              onCancel={() => confirmLeaveBuilder(closeBuilder)}
              onSaved={(id) => {
                closeBuilder();
                void loadSummaries();
                setSelectedId(id);
                setDetailVersion((version) => version + 1);
              }}
            />
          ) : selectedId === null ? (
            renderList()
          ) : (
            renderDetail()
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDiscard !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDiscard(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {builder?.mode === "edit"
                ? "Your edits to this workout haven't been saved."
                : "This workout hasn't been saved to the bank yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const action = pendingDiscard;
                setPendingDiscard(null);
                closeBuilder();
                action?.();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
