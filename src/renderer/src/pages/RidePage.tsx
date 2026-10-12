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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { Minus, Pause, Play, Plus, Square, TriangleAlert } from "lucide-react";
import { metricColors } from "../RideMetricsChart";
import { StatStrip } from "../StatStrip";
import { formatClock } from "../WorkoutTimelineChart";
import { WorkoutProfileChart, type PowerSample } from "../WorkoutProfileChart";
import { KMH_TO_MPH, useSpeedUnit, type SpeedUnit } from "../speedUnit";
import { WorkoutSummaryView } from "../WorkoutSummaryView";
import { BigValue, CardLabel, IntervalCard, PowerCard, RideCard } from "./RideMetricCards";

type Props = {
  activeIntervals: WorkoutInterval[];
  activeWorkoutName: string | null;
  /** Rider's FTP, for the power zone and % FTP readouts. */
  ftpWatts?: number | null;
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

export const RidePage = ({
  activeIntervals,
  activeWorkoutName,
  ftpWatts = null,
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
  const sessionId = workoutSessionState?.sessionId ?? null;

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

  // Actual power per elapsed second, for the trace over the workout chart.
  // Kept here because the engine only streams the current sample; reset when
  // a new session starts.
  const [powerTrace, setPowerTrace] = useState<PowerSample[]>([]);
  useEffect(() => {
    setPowerTrace([]);
  }, [sessionId]);
  const sampleSec = liveMetrics?.elapsedSec;
  const sampleWatts = liveMetrics?.actualPowerWatts ?? null;
  useEffect(() => {
    if (sampleSec === undefined || sampleWatts === null) return;
    setPowerTrace((trace) =>
      trace.length > 0 && trace[trace.length - 1].elapsedSec >= sampleSec
        ? trace
        : [...trace, { elapsedSec: sampleSec, watts: sampleWatts }]
    );
  }, [sampleSec, sampleWatts]);

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
    <main className="mx-auto flex max-w-[1120px] flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Now riding</p>
          <h2 className="m-0 flex items-center gap-3 truncate">
            {activeWorkoutName ?? "Workout"}
            {isPaused ? (
              <Badge className="gap-1 font-extrabold tracking-[0.08em] uppercase">
                <Pause />
                Paused
              </Badge>
            ) : null}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <div className="text-right">
            <div className="text-xs font-semibold text-muted-foreground">Elapsed</div>
            <div className="text-2xl leading-tight font-extrabold tabular-nums">
              {formatClock(elapsedSec)}
              <span className="text-base font-semibold text-muted-foreground"> / {formatClock(totalDurationSec)}</span>
            </div>
          </div>
          {isWorkoutSessionActive ? (
            <Button variant="outline" disabled={liveWorkoutBusy} onClick={() => void stopWorkout()}>
              <Square />
              End ride
            </Button>
          ) : null}
        </div>
      </header>

      {[liveWorkoutError, workoutSessionState?.lastError].filter(Boolean).map((message) => (
        <div
          key={message}
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="size-4 shrink-0" />
          {message}
        </div>
      ))}

      {/* Related readouts share a card: actual beside target for power and
          cadence; speed with distance. The interval card answers "how long
          until this ends, and what's next". */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <PowerCard
            actualWatts={liveMetrics?.actualPowerWatts ?? null}
            targetWatts={liveMetrics?.targetPowerWatts ?? null}
            ftpWatts={ftpWatts}
            paused={isPaused}
          />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <IntervalCard intervals={activeIntervals} currentIndex={currentIndex} elapsedSec={elapsedSec} />
        </div>

        <RideCard className="col-span-4">
          <CardLabel>Cadence</CardLabel>
          <div className="flex items-end justify-between gap-2">
            <BigValue
              value={liveMetrics?.actualCadenceRpm != null ? Math.round(liveMetrics.actualCadenceRpm) : null}
              unit="rpm"
              className="text-4xl"
            />
            {liveMetrics?.targetCadenceRpm != null ? (
              <div className="text-right text-sm text-muted-foreground">
                Target <span className="font-bold text-foreground tabular-nums">{Math.round(liveMetrics.targetCadenceRpm)}</span>
              </div>
            ) : null}
          </div>
        </RideCard>

        <RideCard className="col-span-4">
          <CardLabel>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: metricColors.hr }} />
              Heart rate
            </span>
          </CardLabel>
          <BigValue
            value={liveMetrics?.actualHeartRateBpm != null ? Math.round(liveMetrics.actualHeartRateBpm) : null}
            unit="bpm"
            className="text-4xl"
          />
        </RideCard>

        <RideCard className="col-span-4">
          <CardLabel
            right={
              // Required single-select: a unit is always chosen, so we ignore
              // the empty-string callback Radix sends when re-clicking the
              // active item instead of letting it clear the selection.
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={speedUnit}
                onValueChange={(value) => {
                  if (value) setSpeedUnit(value as SpeedUnit);
                }}
                aria-label="Speed unit"
              >
                <ToggleGroupItem value="mph" className="h-6 px-2 text-[11px]">
                  MPH
                </ToggleGroupItem>
                <ToggleGroupItem value="kph" className="h-6 px-2 text-[11px]">
                  KPH
                </ToggleGroupItem>
              </ToggleGroup>
            }
          >
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: metricColors.speed }} />
              Speed &amp; distance
            </span>
          </CardLabel>
          <div className="flex items-end justify-between gap-2">
            <BigValue value={displaySpeed} unit={speedUnit === "mph" ? "mph" : "km/h"} className="text-4xl" />
            <div className="text-right text-sm text-muted-foreground">
              <span className="font-bold text-foreground tabular-nums">{displayLiveDistance ?? "–"}</span>{" "}
              {speedUnit === "mph" ? "mi" : "km"}
            </div>
          </div>
        </RideCard>
      </div>

      <WorkoutProfileChart
        intervals={activeIntervals}
        ftpWatts={ftpWatts}
        title="Workout"
        heightClass="h-[140px]"
        live={{ elapsedSec, currentIndex, actualTrace: powerTrace }}
        headerExtra={
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-foreground" />
              Your power
            </span>
            <span className="tabular-nums">{formatClock(Math.max(0, totalDurationSec - elapsedSec))} to go</span>
          </span>
        }
      />

      <RideCard className="flex-row flex-wrap items-center justify-between gap-4 py-3">
        <Button
          size="lg"
          className="min-w-40"
          disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          onClick={() => void (isPaused ? resumeWorkout() : pauseWorkout())}
        >
          {isPaused ? <Play /> : <Pause />}
          {isPaused ? "Resume" : "Pause"}
        </Button>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-semibold">Intensity</div>
            <div className="text-xs text-muted-foreground">Scales every target</div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-foreground/15 bg-background p-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Decrease intensity"
              disabled={liveWorkoutBusy || !isWorkoutSessionActive}
              onClick={() => void adjustIntensity(-0.05)}
            >
              <Minus />
            </Button>
            <div className="min-w-14 text-center text-lg font-extrabold tabular-nums">
              {Math.round((workoutSessionState?.intensityMultiplier ?? 1) * 100)}%
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Increase intensity"
              disabled={liveWorkoutBusy || !isWorkoutSessionActive}
              onClick={() => void adjustIntensity(0.05)}
            >
              <Plus />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="ramp-in" className="text-right">
            <div className="text-sm font-semibold">Ramp-in</div>
            <div className="text-xs text-muted-foreground">Seconds to ease into targets</div>
          </label>
          <Input
            id="ramp-in"
            className="h-9 w-16 bg-background text-center tabular-nums"
            type="number"
            min={0}
            max={60}
            value={rampDurationInput}
            onChange={(event) => setRampDurationInput(event.target.value)}
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
          />
          <Button
            variant="outline"
            disabled={liveWorkoutBusy || !isWorkoutSessionActive}
            onClick={() => void applyRampDuration()}
          >
            Apply
          </Button>
        </div>
      </RideCard>

      {/* Deliberately non-dismissible: this is the end-of-ride summary, and unlike
          every other dialog in the app there is no way out except Discard/Save or
          Done. Radix closes on Escape and outside click by default, so both are
          explicitly cancelled below, and the corner close button is hidden. Do not
          "fix" this to make it dismissible — a stray Escape or click shouldn't be
          able to drop a finished ride. */}
      <Dialog open={showEndSummary} onOpenChange={() => {}}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto",
            summaryStage === "saved" ? "sm:max-w-[760px]" : "sm:max-w-[480px]"
          )}
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
              <StatStrip
                label="Ride so far"
                stats={[
                  { label: "Time", value: formatClock(elapsedSec) },
                  { label: "Distance", value: displayLiveDistance, unit: speedUnit === "mph" ? "mi" : "km" }
                ]}
              />
              <p className="m-0 text-sm text-muted-foreground">Save this ride to your history, or discard it.</p>
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
                  plannedIntervals={activeIntervals}
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
