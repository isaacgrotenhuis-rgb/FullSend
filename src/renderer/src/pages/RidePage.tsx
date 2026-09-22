import { useEffect, useState, type ReactElement } from "react";
import type {
  WorkoutInterval,
  WorkoutSessionState,
  WorkoutSessionSummary,
  WorkoutSessionTelemetrySamples
} from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// Checkbox import unused while the post-to-Strava checkbox below is disabled.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
// Label import unused while the post-to-Strava checkbox below is disabled.
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatClock, WorkoutTimelineChart } from "../WorkoutTimelineChart";
import { KMH_TO_MPH, useSpeedUnit, type SpeedUnit } from "../speedUnit";
import { WorkoutSummaryView } from "../WorkoutSummaryView";

type Props = {
  activeIntervals: WorkoutInterval[];
  activeWorkoutName: string | null;
  workoutSessionState: WorkoutSessionState | null;
  liveWorkoutError: string | null;
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  pauseWorkout: () => Promise<void>;
  resumeWorkout: () => Promise<void>;
  stopWorkout: () => Promise<void>;
  saveWorkout: () => Promise<WorkoutSessionSummary | null>;
  fetchSessionTelemetry: (sessionId: string) => Promise<WorkoutSessionTelemetrySamples>;
  discardWorkout: () => Promise<void>;
  finishRide: (postToStrava: boolean) => Promise<void>;
  adjustIntensity: (deltaFraction: number) => Promise<void>;
  rampDurationInput: string;
  setRampDurationInput: (value: string) => void;
  applyRampDuration: () => Promise<void>;
};

const blockKindLabel = (kind: string): string => kind.charAt(0).toUpperCase() + kind.slice(1);

/* --font-heading and --font-body (index.css) currently resolve to the same
   family string, so these callouts rely on the inherited body font instead of
   repeating fontFamily: var(--font-heading) — no visual change, one less
   inline style. */
const MetricTileValue = ({
  value,
  unit,
  color
}: {
  value: string | number | null;
  unit: string;
  color?: string;
}): ReactElement => (
  // `color` is a runtime CSS-variable string (e.g. "var(--color-accent)") chosen per-tile —
  // it can't be a static Tailwind class, so it stays inline. See the PR7 hard constraint:
  // never rename the --color-* tokens these strings point at.
  <div className="text-[48px] font-extrabold leading-none" style={{ color }}>
    {value !== null ? value : <span className="text-[28px] font-normal opacity-[0.35]">–</span>}
    <span className="ml-1 text-lg font-semibold">{unit}</span>
  </div>
);

export const RidePage = ({
  activeIntervals,
  activeWorkoutName,
  workoutSessionState,
  liveWorkoutError,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  pauseWorkout,
  resumeWorkout,
  stopWorkout,
  saveWorkout,
  fetchSessionTelemetry,
  discardWorkout,
  finishRide,
  adjustIntensity,
  rampDurationInput,
  setRampDurationInput,
  applyRampDuration
}: Props): ReactElement => {
  // postToStrava state disabled along with the checkbox below (Strava
  // integration isn't functional yet). finishRide is always called with
  // false until this is restored.
  // const [postToStrava, setPostToStrava] = useState(true);
  const [summaryStage, setSummaryStage] = useState<"none" | "pending" | "saved">("none");
  const [savedSummary, setSavedSummary] = useState<WorkoutSessionSummary | null>(null);
  const [speedUnit, setSpeedUnit] = useSpeedUnit();
  const [telemetrySeries, setTelemetrySeries] = useState<WorkoutSessionTelemetrySamples | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  const totalDurationSec = activeIntervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const elapsedSec = workoutSessionState?.elapsedSec ?? 0;
  const currentIndex = workoutSessionState?.currentIntervalIndex ?? null;
  const liveMetrics = workoutSessionState?.liveMetrics ?? null;
  const maxWatts = Math.max(50, ...activeIntervals.map((interval) => interval.targetPowerWatts ?? 0));

  const speedKmh = liveMetrics?.actualSpeedKmh ?? null;
  const displaySpeed =
    speedKmh !== null ? (speedUnit === "mph" ? (speedKmh * KMH_TO_MPH).toFixed(1) : speedKmh.toFixed(1)) : null;

  const liveDistanceMeters = liveMetrics?.actualDistanceMeters ?? null;
  const displayLiveDistance =
    liveDistanceMeters !== null
      ? speedUnit === "mph"
        ? ((liveDistanceMeters / 1000) * KMH_TO_MPH).toFixed(2)
        : (liveDistanceMeters / 1000).toFixed(2)
      : null;

  const currentKind = liveMetrics?.blockKind ?? (currentIndex !== null ? activeIntervals[currentIndex]?.kind : undefined);
  const intervalPositionLabel =
    currentIndex !== null && activeIntervals.length > 0 ? `Interval ${currentIndex + 1} of ${activeIntervals.length}` : "";

  const isPaused = workoutSessionState?.lifecycle === "paused";
  const hasEndedLifecycle =
    workoutSessionState?.lifecycle === "stopped" ||
    workoutSessionState?.lifecycle === "completed" ||
    workoutSessionState?.lifecycle === "degraded" ||
    workoutSessionState?.lifecycle === "error";

  useEffect(() => {
    if (hasEndedLifecycle && summaryStage === "none") {
      setSummaryStage("pending");
    }
  }, [hasEndedLifecycle, summaryStage]);

  const showEndSummary = activeIntervals.length > 0 && summaryStage !== "none";

  const handleDiscard = async (): Promise<void> => {
    await discardWorkout();
  };

  const handleSave = async (): Promise<void> => {
    const summary = await saveWorkout();
    if (summary) {
      setSavedSummary(summary);
      setSummaryStage("saved");
      setTelemetryLoading(true);
      try {
        const series = await fetchSessionTelemetry(summary.sessionId);
        setTelemetrySeries(series);
      } catch (error) {
        console.error("[workout summary] failed to load telemetry series:", error);
      } finally {
        setTelemetryLoading(false);
      }
    }
  };

  return (
    <main className="mx-auto max-w-[960px] p-6">
      <div className="flex items-center justify-between pb-4">
        <div>
          <h6 className="mb-0.5 text-[var(--color-accent-700)]">
            {currentKind ? blockKindLabel(currentKind) : "Workout"}
          </h6>
          <h2 className="m-0 flex items-center gap-3">
            {activeWorkoutName ?? "Workout"}
            {isPaused ? (
              <Badge className="border-transparent bg-[color-mix(in_srgb,var(--color-accent-700)_15%,transparent)] font-extrabold uppercase tracking-[0.08em] text-[var(--color-accent-700)]">
                Paused
              </Badge>
            ) : null}
          </h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <h6 className="mb-0.5">Elapsed / Total</h6>
            <div className="text-xl font-extrabold">
              {formatClock(elapsedSec)} / {formatClock(totalDurationSec)}
            </div>
          </div>
          {isWorkoutSessionActive ? (
            <Button variant="outline" disabled={liveWorkoutBusy} onClick={() => void stopWorkout()}>
              End
            </Button>
          ) : null}
        </div>
      </div>
      <Separator className="mb-6 h-0.5 bg-[var(--color-divider)]" />

      {liveWorkoutError ? <p className="text-[var(--color-accent-700)]">{liveWorkoutError}</p> : null}
      {workoutSessionState?.lastError ? (
        <p className="text-[var(--color-accent-700)]">{workoutSessionState.lastError}</p>
      ) : null}

      <div className="mb-6 grid grid-cols-3 gap-[2px] border-2 border-[var(--color-divider)] bg-[var(--color-divider)]">
        <div className={cn("bg-[var(--color-bg)] p-4", isPaused && "opacity-[0.45]")}>
          <h6>Target power{isPaused ? " · holding" : ""}</h6>
          <MetricTileValue value={liveMetrics?.targetPowerWatts ?? null} unit="W" />
        </div>
        <div className="bg-[var(--color-bg)] p-4">
          <h6>Actual power</h6>
          <MetricTileValue value={liveMetrics?.actualPowerWatts ?? null} unit="W" color="var(--color-accent)" />
        </div>
        <div className="bg-[var(--color-bg)] p-4">
          <h6>Cadence</h6>
          <MetricTileValue
            value={
              liveMetrics?.actualCadenceRpm !== null && liveMetrics?.actualCadenceRpm !== undefined
                ? Math.round(liveMetrics.actualCadenceRpm)
                : null
            }
            unit="rpm"
          />
        </div>
        <div className="bg-[var(--color-bg)] p-4">
          <h6>Heart rate</h6>
          <MetricTileValue
            value={
              liveMetrics?.actualHeartRateBpm !== null && liveMetrics?.actualHeartRateBpm !== undefined
                ? Math.round(liveMetrics.actualHeartRateBpm)
                : null
            }
            unit="bpm"
            color="var(--color-accent-2)"
          />
        </div>
        <div className="bg-[var(--color-bg)] p-4">
          <div className="mb-2 flex items-center justify-between gap-1">
            <h6 className="m-0">Speed</h6>
            {/* Required single-select: a unit is always chosen, so we ignore
                the empty-string callback Radix sends when re-clicking the
                active item instead of letting it clear the selection. */}
            <ToggleGroup
              type="single"
              size="sm"
              value={speedUnit}
              onValueChange={(value) => {
                if (value) setSpeedUnit(value as SpeedUnit);
              }}
              aria-label="Speed unit"
            >
              <ToggleGroupItem value="mph">MPH</ToggleGroupItem>
              <ToggleGroupItem value="kph">KPH</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <MetricTileValue value={displaySpeed} unit={speedUnit} />
        </div>
        <div className="bg-[var(--color-bg)] p-4">
          <h6>Distance</h6>
          <MetricTileValue value={displayLiveDistance} unit={speedUnit === "mph" ? "mi" : "km"} />
        </div>
      </div>

      <h6 className="mb-3">
        Workout timeline{intervalPositionLabel ? ` · ${intervalPositionLabel}` : ""}
      </h6>
      <div className="mb-8 flex gap-3">
        <div className="flex items-center justify-center rotate-180 text-[10px] uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)] [writing-mode:vertical-rl]">
          Watts
        </div>
        <div className="flex-1">
          <div className="relative">
            <div className="absolute top-3 left-3 z-[1] text-[13px] font-extrabold">{Math.round(maxWatts)} W peak</div>
            <WorkoutTimelineChart
              intervals={activeIntervals}
              elapsedSec={elapsedSec}
              currentIndex={currentIndex}
              actualPowerWatts={liveMetrics?.actualPowerWatts ?? null}
            />
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
              Time
            </span>
            <span className="text-[10px] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
              {formatClock(totalDurationSec)} total
            </span>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between gap-4">
        <Button
          className="min-w-[140px]"
          disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          onClick={() => void (isPaused ? resumeWorkout() : pauseWorkout())}
        >
          {isPaused ? "Resume" : "Pause"}
        </Button>
        <div className="flex items-center gap-3">
          <h6 className="m-0">Intensity</h6>
          <Button
            variant="outline"
            size="icon"
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
            onClick={() => void adjustIntensity(-0.05)}
          >
            −
          </Button>
          <div className="min-w-[52px] text-center text-lg font-extrabold">
            {Math.round((workoutSessionState?.intensityMultiplier ?? 1) * 100)}%
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
            onClick={() => void adjustIntensity(0.05)}
          >
            +
          </Button>
        </div>
      </div>

      <div className="mb-8 flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]">
          Ramp-in (sec)
          <Input
            className="h-7 w-16 px-1.5 py-0.5"
            type="number"
            min={0}
            max={60}
            value={rampDurationInput}
            onChange={(event) => setRampDurationInput(event.target.value)}
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          onClick={() => void applyRampDuration()}
        >
          Apply
        </Button>
      </div>

      {/* Deliberately non-dismissible: this is the end-of-ride summary, and unlike
          every other dialog in the app there is no way out except Discard/Save or
          Done. Radix closes on Escape and outside click by default, so both are
          explicitly cancelled below, and the corner close button is hidden. Do not
          "fix" this to make it dismissible — a stray Escape or click shouldn't be
          able to drop a finished ride. */}
      <Dialog open={showEndSummary} onOpenChange={() => {}}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100vh-2rem)] gap-3 overflow-y-auto sm:max-w-[480px]"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{activeWorkoutName ?? "Workout"}</DialogTitle>
            <DialogDescription>
              {summaryStage === "saved" ? "Saved" : "Ended"} · {formatClock(elapsedSec)}
            </DialogDescription>
          </DialogHeader>

          {summaryStage === "pending" ? (
            <>
              <div className="grid grid-cols-1 gap-[2px] border-2 border-[var(--color-divider)] bg-[var(--color-divider)]">
                <div className="bg-[var(--color-bg)] p-3">
                  <h6>Duration</h6>
                  <div className="text-xl font-extrabold">{formatClock(elapsedSec)}</div>
                </div>
              </div>

              <Separator className="my-2 h-0.5 bg-[var(--color-divider)]" />
              <DialogFooter>
                <Button variant="outline" disabled={liveWorkoutBusy} onClick={() => void handleDiscard()}>
                  Discard
                </Button>
                <Button disabled={liveWorkoutBusy} onClick={() => void handleSave()}>
                  Save Workout
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {savedSummary ? (
                <WorkoutSummaryView
                  summary={savedSummary}
                  telemetry={telemetrySeries}
                  telemetryLoading={telemetryLoading}
                  speedUnit={speedUnit}
                />
              ) : null}
              {/* Post-to-Strava checkbox disabled for now — Strava
                  integration isn't functional yet (see StravaService.ts /
                  docs/onboarding-plan.md). finishRide is always called with
                  false below until this is restored.

              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="post-to-strava"
                  checked={postToStrava}
                  onCheckedChange={(checked) => setPostToStrava(checked === true)}
                />
                <Label htmlFor="post-to-strava" className="text-[13px] font-normal">
                  Post this workout to Strava
                </Label>
              </div>

              */}

              <DialogFooter>
                <Button disabled={liveWorkoutBusy} onClick={() => void finishRide(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
};
