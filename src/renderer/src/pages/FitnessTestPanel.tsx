import type { ReactElement } from "react";
import { ArrowDown, ArrowUp, Check, Flag, HeartPulse, TriangleAlert } from "lucide-react";
import type { FitnessTestLiveState } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatClock } from "../WorkoutTimelineChart";
import { BigValue, CardLabel, RideCard } from "./RideMetricCards";

type Props = {
  test: FitnessTestLiveState;
  positionSec: number;
  targetWatts: number | null;
  heartRateBpm: number | null;
  busy: boolean;
  onEndRamp: () => void;
  onKeepGoing: () => void;
};

const phaseLabels: Record<NonNullable<FitnessTestLiveState["phase"]>, string> = {
  warmup: "Warm-up",
  ramp: "Ramp",
  recovery: "Recovery",
  capped: "Capped effort",
  cooldown: "Cool-down"
};

const SCORING_STARTS_SEC = 300;

const guidanceCopy = {
  push: { label: "Push a little harder", icon: ArrowUp, tone: "text-primary" },
  hold: { label: "Hold it here", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
  ease: { label: "Ease off — over the cap", icon: ArrowDown, tone: "text-destructive" }
} as const;

/**
 * Fitness-test coaching beside the normal ride tiles: what phase you're in,
 * what the ramp is doing, the ramp-complete countdown, and in the capped effort
 * your heart rate against the cap with a plain-language nudge.
 */
export const FitnessTestPanel = ({
  test,
  positionSec,
  targetWatts,
  heartRateBpm,
  busy,
  onEndRamp,
  onKeepGoing
}: Props): ReactElement => {
  const range = (phase: FitnessTestLiveState["phases"][number]["phase"]) => test.phases.find((entry) => entry.phase === phase);
  const ramp = range("ramp");
  const phase = test.phase;

  return (
    <RideCard className="gap-3">
      <CardLabel
        right={
          <Badge variant="outline" className="bg-background">
            {test.variant === "full" ? "Fitness test" : "Quick ramp"}
          </Badge>
        }
      >
        <span className="flex items-center gap-1.5">
          <Flag className="size-3.5" />
          {phase ? phaseLabels[phase] : "Fitness test"}
        </span>
      </CardLabel>

      {test.downgradedReason ? (
        <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {test.downgradedReason} Your result will use the ramp estimate.
        </p>
      ) : null}

      {test.rampEndCountdownSec !== null ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-background px-3 py-2"
        >
          <span className="text-sm">
            <span className="font-bold">Ramp complete.</span> Moving to{" "}
            {test.variant === "full" ? "recovery" : "the cool-down"} in{" "}
            <span className="font-bold tabular-nums">{test.rampEndCountdownSec}</span>…
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={onKeepGoing}>
            Keep going
          </Button>
        </div>
      ) : null}

      {phase === "warmup" && ramp ? (
        <p className="m-0 text-sm">
          The ramp starts in{" "}
          <span className="font-bold tabular-nums">{formatClock(Math.max(0, ramp.startSec - positionSec))}</span>. It adds{" "}
          {test.rampStepWatts} W every minute until you can't hold the power.
        </p>
      ) : null}

      {phase === "ramp" && !test.rampEnded && ramp ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-muted-foreground">
              Step {Math.floor((positionSec - ramp.startSec) / test.rampStepSec) + 1} · next +{test.rampStepWatts} W in{" "}
              <span className="tabular-nums">
                {formatClock(test.rampStepSec - ((positionSec - ramp.startSec) % test.rampStepSec))}
              </span>
            </div>
            <BigValue value={targetWatts} unit="W" className="text-4xl" />
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-muted-foreground">Best minute so far</div>
            <BigValue value={test.liveMapWatts} unit="W" className="text-2xl" />
          </div>
          <Button variant="outline" disabled={busy} onClick={onEndRamp}>
            I'm done — end ramp
          </Button>
        </div>
      ) : null}

      {phase === "recovery" ? (
        <p className="m-0 text-sm">
          {test.hrCapBpm !== null ? (
            <>
              Your heart-rate cap for the capped effort is{" "}
              <span className="font-bold tabular-nums">{test.hrCapBpm} bpm</span>. Spin easy until it starts.
            </>
          ) : (
            "Spin easy and get your breath back."
          )}
          {test.liveMapWatts !== null ? (
            <span className="text-muted-foreground"> Ramp best minute: {test.liveMapWatts} W.</span>
          ) : null}
        </p>
      ) : null}

      {phase === "capped" ? <CappedEffort test={test} heartRateBpm={heartRateBpm} /> : null}

      {phase === "cooldown" ? (
        <p className="m-0 text-sm">
          Test complete. Spin easy — end the ride whenever you're ready
          {test.liveMapWatts !== null ? ` (ramp best minute: ${test.liveMapWatts} W)` : ""}.
        </p>
      ) : null}
    </RideCard>
  );
};

const CappedEffort = ({ test, heartRateBpm }: { test: FitnessTestLiveState; heartRateBpm: number | null }): ReactElement => {
  const cap = test.hrCapBpm;
  const guidance = test.hrGuidance ? guidanceCopy[test.hrGuidance] : null;
  // Gauge spans cap − 20 … cap + 10 bpm, with the hold band shaded just under the cap.
  const low = (cap ?? 160) - 20;
  const span = 30;
  const pct = (bpm: number) => Math.min(100, Math.max(0, ((bpm - low) / span) * 100));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <HeartPulse className="size-3.5" />
            Heart rate vs cap
          </div>
          <div className="text-4xl leading-none font-extrabold tabular-nums">
            {heartRateBpm !== null ? Math.round(heartRateBpm) : <span className="text-muted-foreground/60">–</span>}
            <span className="ml-1 text-xl font-semibold text-muted-foreground">/ {cap ?? "–"} bpm</span>
          </div>
        </div>
        {guidance ? (
          <div className={cn("flex items-center gap-1.5 text-lg font-bold", guidance.tone)} role="status">
            <guidance.icon className="size-5" />
            {guidance.label}
          </div>
        ) : null}
        <div className="text-right">
          <div className="text-xs font-semibold text-muted-foreground">
            {test.cappedElapsedSec < SCORING_STARTS_SEC
              ? `Scoring starts in ${formatClock(SCORING_STARTS_SEC - test.cappedElapsedSec)}`
              : "Scored average"}
          </div>
          <BigValue value={test.cappedScoredAvgPowerWatts} unit="W" className="text-2xl" />
        </div>
      </div>

      {cap !== null ? (
        <div className="relative h-3 rounded-full bg-foreground/10" aria-hidden>
          <span
            className="absolute inset-y-0 rounded-full bg-emerald-500/30"
            style={{ left: `${pct(cap - 3)}%`, width: `${pct(cap) - pct(cap - 3)}%` }}
          />
          <span className="absolute inset-y-[-3px] w-0.5 bg-foreground/60" style={{ left: `${pct(cap)}%` }} />
          {heartRateBpm !== null ? (
            <span
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
              style={{ left: `${pct(heartRateBpm)}%` }}
            />
          ) : null}
        </div>
      ) : null}

      {test.suggestedStartWatts !== null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Start around <span className="font-bold text-foreground tabular-nums">{test.suggestedStartWatts} W</span> and
          adjust from your heart rate. You set the power with your gears.
        </p>
      ) : null}
    </div>
  );
};
