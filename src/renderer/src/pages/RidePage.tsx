import { useEffect, useRef, useState, type ReactElement } from "react";
import type {
  ApplyFitnessTestRequest,
  FitnessTestRecord,
  UserProfile,
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
import { Progress } from "@/components/ui/progress";
// Label import unused while the post-to-Strava checkbox below is disabled.
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  CircleCheck,
  Flag,
  Megaphone,
  Minus,
  Pause,
  Play,
  Plus,
  Save,
  SkipForward,
  Square,
  Trash2,
  TriangleAlert,
  Trophy
} from "lucide-react";
import { metricColors } from "../RideMetricsChart";
import { StatStrip } from "../StatStrip";
import { formatClock } from "../WorkoutTimelineChart";
import { WorkoutProfileChart, type PowerSample } from "../WorkoutProfileChart";
import { KMH_TO_MPH, useSpeedUnit, type SpeedUnit } from "../speedUnit";
import { WorkoutSummaryView } from "../WorkoutSummaryView";
import { activeCueAt, fillCue } from "../cues";
import { FitnessTestPanel } from "./FitnessTestPanel";
import { FitnessTestResults } from "./FitnessTestResults";
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
  /** Jump the workout cursor to a position (seconds into the planned workout). */
  seekWorkout: (positionSec: number) => Promise<void>;
  stopWorkout: () => Promise<void>;
  saveWorkout: () => Promise<WorkoutSessionSummary | null>;
  fetchSessionTelemetry: (sessionId: string) => Promise<WorkoutSessionTelemetrySamples>;
  discardWorkout: () => Promise<void>;
  finishRide: (postToStrava: boolean) => Promise<void>;
  adjustIntensity: (deltaFraction: number) => Promise<void>;
  /** Fitness test only: end the ramp now / cancel the ramp-complete countdown. */
  endFitnessTestRamp?: () => Promise<void>;
  keepGoingFitnessTest?: () => Promise<void>;
  /** Fitness test only: score the saved test, and apply its result to the profile. */
  fetchFitnessTestResult?: (sessionId: string) => Promise<FitnessTestRecord>;
  applyFitnessTest?: (testId: string, apply: ApplyFitnessTestRequest["apply"]) => Promise<FitnessTestRecord>;
  /** Current profile, for the results' "from → to". */
  profile?: UserProfile | null;
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
  seekWorkout,
  stopWorkout,
  saveWorkout,
  fetchSessionTelemetry,
  discardWorkout,
  finishRide,
  adjustIntensity,
  endFitnessTestRamp = async () => {},
  keepGoingFitnessTest = async () => {},
  fetchFitnessTestResult,
  applyFitnessTest,
  profile = null,
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
  const [testRecord, setTestRecord] = useState<FitnessTestRecord | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testApplying, setTestApplying] = useState(false);

  const totalDurationSec = activeIntervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  // Ride clock (moving time) vs. where the rider is in the workout: they differ
  // once the rider drags the workout bar to skip ahead or go back.
  const elapsedSec = workoutSessionState?.elapsedSec ?? 0;
  const positionSec = workoutSessionState?.positionSec ?? elapsedSec;
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

  // Actual power per ride second, for the trace over the workout chart. Each
  // sample is placed at its workout position (so it lines up with the targets
  // after a seek) but de-duplicated by the ride clock, which only moves forward.
  // Kept here because the engine only streams the current sample; reset when
  // a new session starts.
  const [powerTrace, setPowerTrace] = useState<PowerSample[]>([]);
  const lastSampleClockRef = useRef<number>(-1);
  useEffect(() => {
    setPowerTrace([]);
    lastSampleClockRef.current = -1;
  }, [sessionId]);
  const sampleClockSec = liveMetrics?.elapsedSec;
  const samplePositionSec = liveMetrics?.positionSec ?? sampleClockSec;
  const sampleWatts = liveMetrics?.actualPowerWatts ?? null;
  useEffect(() => {
    if (sampleClockSec === undefined || samplePositionSec === undefined || sampleWatts === null) return;
    if (sampleClockSec <= lastSampleClockRef.current) return;
    lastSampleClockRef.current = sampleClockSec;
    setPowerTrace((trace) => [...trace, { positionSec: samplePositionSec, watts: sampleWatts }]);
  }, [sampleClockSec, samplePositionSec, sampleWatts]);

  const isPaused = workoutSessionState?.lifecycle === "paused";
  const fitnessTest = workoutSessionState?.fitnessTest ?? null;
  const cue = isWorkoutSessionActive ? activeCueAt(activeIntervals, positionSec) : null;
  const isAutoPaused = isPaused && workoutSessionState?.pauseReason === "auto";
  const intervalStarts = activeIntervals.reduce<number[]>(
    (starts, interval, index) => [...starts, index === 0 ? 0 : starts[index - 1] + activeIntervals[index - 1].durationSec],
    []
  );
  const nextIntervalStartSec = currentIndex !== null ? intervalStarts[currentIndex + 1] : undefined;
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

  // End-of-ride readouts. Average power comes from the trace kept above, since
  // the saved summary doesn't exist until the rider chooses Save.
  const lifecycle = workoutSessionState?.lifecycle;
  const endTone = lifecycle === "completed" ? "done" : lifecycle === "degraded" || lifecycle === "error" ? "warn" : "stopped";
  const testDone = fitnessTest?.rampEnded === true;
  const endEyebrow =
    endTone === "warn"
      ? "Ride interrupted"
      : testDone
        ? "Test complete"
        : endTone === "done"
          ? "Workout complete"
          : "Ride ended early";
  const completionPct = totalDurationSec > 0 ? Math.min(100, Math.round((positionSec / totalDurationSec) * 100)) : 0;
  const completedIntervals = lifecycle === "completed" ? activeIntervals.length : (currentIndex ?? 0);
  const avgPowerWatts =
    powerTrace.length > 0 ? Math.round(powerTrace.reduce((sum, sample) => sum + sample.watts, 0) / powerTrace.length) : null;

  const handleDiscard = async (): Promise<void> => {
    await discardWorkout();
  };

  const loadTestResult = async (savedSessionId: string): Promise<void> => {
    if (!fetchFitnessTestResult) return;
    setTestLoading(true);
    setTestError(null);
    try {
      setTestRecord(await fetchFitnessTestResult(savedSessionId));
    } catch (error) {
      console.error("[fitness test] scoring failed:", error);
      setTestError(error instanceof Error ? error.message : "Couldn't score this test.");
    } finally {
      setTestLoading(false);
    }
  };

  const handleApplyTest = async (apply: ApplyFitnessTestRequest["apply"]): Promise<void> => {
    if (!testRecord || !applyFitnessTest) return;
    setTestApplying(true);
    setTestError(null);
    try {
      setTestRecord(await applyFitnessTest(testRecord.id, apply));
    } catch (error) {
      console.error("[fitness test] apply failed:", error);
      setTestError(error instanceof Error ? error.message : "Couldn't apply the result.");
    } finally {
      setTestApplying(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const summary = await saveWorkout();
    if (summary) {
      setSavedSummary(summary);
      setSummaryStage("saved");
      if (fitnessTest) {
        void loadTestResult(summary.sessionId);
      }
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
                {isAutoPaused ? "Auto-paused" : "Paused"}
              </Badge>
            ) : null}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <div className="text-right">
            <div className="text-xs font-semibold text-muted-foreground">Elapsed</div>
            <div className="text-2xl leading-tight font-extrabold tabular-nums">{formatClock(elapsedSec)}</div>
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

      {isAutoPaused ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
          <Pause className="size-4 shrink-0 text-primary" />
          <span>
            <span className="font-semibold">Paused because you stopped pedaling.</span> Start pedaling to resume, or drag
            the workout bar below to jump to another part of the workout first.
          </span>
        </div>
      ) : null}

      {cue ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-foreground/15 bg-background px-3 py-2.5 text-[15px] font-medium"
        >
          <Megaphone className="mt-0.5 size-4 shrink-0 text-primary" />
          {fillCue(cue, fitnessTest?.hrCapBpm ?? null)}
        </div>
      ) : null}

      {fitnessTest && isWorkoutSessionActive ? (
        <FitnessTestPanel
          test={fitnessTest}
          positionSec={positionSec}
          targetWatts={liveMetrics?.targetPowerWatts ?? null}
          heartRateBpm={liveMetrics?.actualHeartRateBpm ?? null}
          busy={liveWorkoutBusy}
          onEndRamp={() => void endFitnessTestRamp()}
          onKeepGoing={() => void keepGoingFitnessTest()}
        />
      ) : null}

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
          <IntervalCard intervals={activeIntervals} currentIndex={currentIndex} elapsedSec={positionSec} />
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
        live={{
          positionSec,
          currentIndex,
          actualTrace: powerTrace,
          seek: {
            onSeek: (target) => void seekWorkout(target),
            // Paused: drop to jump (the "stop pedaling, drag, pedal" flow).
            // Riding: confirm first, so a stray drag can't skip a block.
            confirm: !isPaused,
            disabled: liveWorkoutBusy || !isWorkoutSessionActive,
            minSec: fitnessTest?.minSeekPositionSec ?? null
          }
        }}
        headerExtra={
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full bg-foreground" />
              Your power
            </span>
            <span className="tabular-nums">{formatClock(Math.max(0, totalDurationSec - positionSec))} to go</span>
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

        <Button
          variant="outline"
          size="lg"
          disabled={liveWorkoutBusy || !isWorkoutSessionActive || nextIntervalStartSec === undefined}
          onClick={() => {
            if (nextIntervalStartSec !== undefined) void seekWorkout(nextIntervalStartSec);
          }}
        >
          <SkipForward />
          Skip interval
        </Button>

        {fitnessTest ? (
          <div className="text-right">
            <div className="text-sm font-semibold">Intensity 100%</div>
            <div className="text-xs text-muted-foreground">Locked during the test</div>
          </div>
        ) : (
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
        )}

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
          <DialogHeader className="flex-row items-center gap-4 text-left">
            <div
              aria-hidden
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl [&_svg]:size-6",
                endTone === "warn" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              )}
            >
              {summaryStage === "saved" ? <CircleCheck /> : endTone === "warn" ? <TriangleAlert /> : endTone === "done" ? <Trophy /> : <Flag />}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {summaryStage === "saved" ? "Saved to history" : endEyebrow}
              </p>
              <DialogTitle className="truncate text-xl leading-tight font-extrabold">
                {activeWorkoutName ?? "Workout"}
              </DialogTitle>
              <DialogDescription className="tabular-nums">
                {formatClock(elapsedSec)} ridden · {formatClock(totalDurationSec)} planned
              </DialogDescription>
            </div>
          </DialogHeader>

          {summaryStage === "pending" ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">Workout completed</span>
                  <span className="font-extrabold tabular-nums">{completionPct}%</span>
                </div>
                <Progress value={completionPct} aria-label="Workout completed" />
              </div>
              <StatStrip
                label="Ride so far"
                stats={[
                  { label: "Time", value: formatClock(elapsedSec) },
                  { label: "Distance", value: displayLiveDistance, unit: speedUnit === "mph" ? "mi" : "km" },
                  { label: "Avg power", value: avgPowerWatts !== null ? String(avgPowerWatts) : null, unit: "W" },
                  { label: "Intervals", value: `${completedIntervals}/${activeIntervals.length}` }
                ]}
              />
              <DialogFooter className="-mx-6 -mb-6 items-center rounded-b-lg border-t bg-muted/60 px-6 py-4 sm:justify-between">
                <p className="m-0 text-xs text-muted-foreground">Discarding can't be undone.</p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button variant="ghost" disabled={liveWorkoutBusy} onClick={() => void handleDiscard()}>
                    <Trash2 />
                    Discard
                  </Button>
                  <Button disabled={liveWorkoutBusy} onClick={() => void handleSave()}>
                    <Save />
                    Save Workout
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : (
            <>
              {fitnessTest ? (
                <FitnessTestResults
                  record={testRecord}
                  loading={testLoading}
                  error={testRecord ? null : testError}
                  profile={profile}
                  applying={testApplying}
                  onApply={(apply) => void handleApplyTest(apply)}
                />
              ) : null}
              {fitnessTest && testRecord && testError ? (
                <p className="m-0 text-sm text-destructive">{testError}</p>
              ) : null}
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

              <DialogFooter className="-mx-6 -mb-6 rounded-b-lg border-t bg-muted/60 px-6 py-4">
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
