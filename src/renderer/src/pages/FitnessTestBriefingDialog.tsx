import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Bluetooth, HeartPulse, Play } from "lucide-react";
import type { FitnessTestVariant } from "@shared/fitnessTest";
import { buildFitnessTest, phaseRange, type FitnessTestSeedProfile } from "@shared/fitnessTestProtocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatStrip } from "../StatStrip";
import { WorkoutProfileChart } from "../WorkoutProfileChart";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: FitnessTestSeedProfile;
  trainerConnected: boolean;
  heartRateConnected: boolean;
  busy: boolean;
  error: string | null;
  onStart: (variant: FitnessTestVariant) => void;
};

/** Ramp minutes for a rider who fails right at the seed, for the duration estimate. */
const expectedRampMinutes = (plan: ReturnType<typeof buildFitnessTest>): number =>
  Math.ceil((plan.mapSeedWatts - plan.rampStartWatts) / plan.rampStepWatts) + 1;

/** Expected total: the fixed phases plus the ramp a rider at the seed would ride. */
const expectedMinutes = (plan: ReturnType<typeof buildFitnessTest>): number => {
  const ramp = phaseRange(plan.phases, "ramp")!;
  return Math.round((plan.totalSec - (ramp.endSec - ramp.startSec)) / 60) + expectedRampMinutes(plan);
};

const seedCopy: Record<ReturnType<typeof buildFitnessTest>["mapSeedSource"], string> = {
  map: "your last MAP",
  ftp: "your FTP",
  weight: "your weight",
  default: "a typical rider (add your FTP or weight to your profile for a better start)"
};

/**
 * Pre-ride briefing for the fitness test: what it measures, what to expect,
 * what you need, and the Full / Quick choice. The plan shown is built with the
 * same pure builder the main process uses to start the ride.
 */
export const FitnessTestBriefingDialog = ({
  open,
  onOpenChange,
  profile,
  trainerConnected,
  heartRateConnected,
  busy,
  error,
  onStart
}: Props): ReactElement => {
  const [variant, setVariant] = useState<FitnessTestVariant>(heartRateConnected ? "full" : "quick");
  // Follow the strap while the dialog is open: connecting one mid-briefing should
  // offer the full test, losing it should fall back to the quick one.
  useEffect(() => {
    setVariant(heartRateConnected ? "full" : "quick");
  }, [heartRateConnected, open]);

  const plans = useMemo(
    () => ({ full: buildFitnessTest(profile, "full"), quick: buildFitnessTest(profile, "quick") }),
    [profile]
  );
  const plan = plans[variant];
  const rampMinutes = expectedRampMinutes(plan);
  const needsStrap = variant === "full" && !heartRateConnected;
  const canStart = trainerConnected && !needsStrap && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Fitness test</DialogTitle>
          <DialogDescription>
            Measures your MAP, FTP and threshold heart rate, and sets your training zones from them.
          </DialogDescription>
        </DialogHeader>

        <ToggleGroup
          type="single"
          variant="outline"
          value={variant}
          onValueChange={(value) => {
            if (value) setVariant(value as FitnessTestVariant);
          }}
          aria-label="Test type"
          className="w-full"
        >
          <ToggleGroupItem value="full" className="flex-1">
            Full test · ~{expectedMinutes(plans.full)} min
          </ToggleGroupItem>
          <ToggleGroupItem value="quick" className="flex-1">
            Quick ramp · ~{expectedMinutes(plans.quick)} min
          </ToggleGroupItem>
        </ToggleGroup>

        <StatStrip
          label="Ramp"
          stats={[
            { label: "Starts at", value: `${plan.rampStartWatts}`, unit: "W" },
            { label: "Every minute", value: `+${plan.rampStepWatts}`, unit: "W" },
            { label: "Expected ramp", value: `~${rampMinutes}`, unit: "min" }
          ]}
        />
        <WorkoutProfileChart intervals={plan.intervals} ftpWatts={null} title="What you'll ride" heightClass="h-[120px]" />

        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          <li>
            <span className="font-semibold">Warm up for 10 minutes</span>, with two short openers.
          </li>
          <li>
            <span className="font-semibold">Ramp until you can't hold the power.</span> The trainer adds {plan.rampStepWatts} W
            every minute. Stay seated at 85–95 rpm and keep going until you truly can't turn the pedals. When you stop, we
            detect it and move you on — or press <span className="font-semibold">I'm done</span>.
          </li>
          {variant === "full" ? (
            <>
              <li>
                <span className="font-semibold">Recover for 10 minutes.</span> Your ramp sets a heart-rate cap.
              </li>
              <li>
                <span className="font-semibold">Ride 20 minutes as hard as you can without going over the cap.</span> You
                control the power with your gears; we coach you to stay just under it.
              </li>
            </>
          ) : null}
          <li>
            <span className="font-semibold">Cool down</span>, then see your results.
          </li>
        </ol>

        <p className="m-0 text-xs text-muted-foreground">
          Ramp scaled from {seedCopy[plan.mapSeedSource]}. Come in rested and fueled, with a fan on. Intensity can't be
          changed during the test, so the result stays comparable.
        </p>

        {variant === "full" ? (
          <p
            className={`m-0 flex items-center gap-2 text-sm ${heartRateConnected ? "text-muted-foreground" : "text-destructive"}`}
          >
            <HeartPulse className="size-4 shrink-0" />
            {heartRateConnected
              ? "Heart-rate strap connected."
              : "The full test needs a heart-rate strap. Connect one, or take the quick ramp instead."}
          </p>
        ) : null}

        {error ? <p className="m-0 text-[13px] text-destructive">{error}</p> : null}

        <DialogFooter className="sm:items-center">
          {!trainerConnected ? (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bluetooth className="size-3.5" />
              Connect a trainer to start
            </span>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="min-w-[150px]" disabled={!canStart} onClick={() => onStart(variant)}>
            <Play />
            Start test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
