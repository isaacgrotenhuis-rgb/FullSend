import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FitnessTestLiveState } from "@shared/ipc/contracts";
import { buildFitnessTest } from "@shared/fitnessTestProtocol";
import { activeCueAt, fillCue } from "../cues";
import { FitnessTestBriefingDialog } from "./FitnessTestBriefingDialog";
import { FitnessTestPanel } from "./FitnessTestPanel";

const plan = buildFitnessTest({ mapWatts: 300, ftpWatts: null, weightKg: 75 }, "full");
const range = (phase: string) => plan.phases.find((entry) => entry.phase === phase)!;

const baseLive: FitnessTestLiveState = {
  variant: "full",
  plannedVariant: "full",
  phase: "warmup",
  phases: plan.phases,
  rampStepWatts: plan.rampStepWatts,
  rampStepSec: 60,
  rampEnded: false,
  rampEndReason: null,
  rampEndCountdownSec: null,
  liveMapWatts: null,
  hrCapBpm: null,
  downgradedReason: null,
  cappedElapsedSec: 0,
  cappedScoredAvgPowerWatts: null,
  hrGuidance: null,
  suggestedStartWatts: null,
  minSeekPositionSec: null
};

describe("interval cues", () => {
  it("shows a cue for 10 s from its moment, following the workout position", () => {
    expect(activeCueAt(plan.intervals, 0)).toMatch(/^Warm-up/);
    expect(activeCueAt(plan.intervals, 9)).toMatch(/^Warm-up/);
    expect(activeCueAt(plan.intervals, 10)).toBeNull();
    expect(activeCueAt(plan.intervals, range("ramp").startSec - 30)).toBe("Ramp starts in 30 seconds.");
    expect(activeCueAt(plan.intervals, range("ramp").startSec + 2)).toMatch(/^Ramp: \+15 W every minute/);
  });

  it("fills in the HR cap once the ramp has set it", () => {
    const message = activeCueAt(plan.intervals, range("capped").startSec)!;
    expect(fillCue(message, 168)).toContain("at or under 168 bpm");
    expect(fillCue(message, null)).toContain("at or under the cap set by your ramp");
  });
});

describe("FitnessTestPanel", () => {
  const renderPanel = (test: Partial<FitnessTestLiveState>, positionSec: number, extra: { hr?: number } = {}) => {
    const onEndRamp = vi.fn();
    const onKeepGoing = vi.fn();
    render(
      <FitnessTestPanel
        test={{ ...baseLive, ...test }}
        positionSec={positionSec}
        targetWatts={195}
        heartRateBpm={extra.hr ?? null}
        busy={false}
        onEndRamp={onEndRamp}
        onKeepGoing={onKeepGoing}
      />
    );
    return { onEndRamp, onKeepGoing };
  };

  it("counts down to the ramp during the warm-up", () => {
    renderPanel({}, range("ramp").startSec - 90);
    expect(screen.getByText(/The ramp starts in/)).toHaveTextContent("1:30");
  });

  it("shows the ramp step and lets the rider end it", async () => {
    const user = userEvent.setup();
    const { onEndRamp } = renderPanel({ phase: "ramp", liveMapWatts: 210 }, range("ramp").startSec + 4 * 60 + 15);
    expect(screen.getByText(/Step 5 · next \+15 W in/)).toHaveTextContent("0:45");
    expect(screen.getByText("210")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /end ramp/ }));
    expect(onEndRamp).toHaveBeenCalled();
  });

  it("offers Keep going during the ramp-complete countdown", async () => {
    const user = userEvent.setup();
    const { onKeepGoing } = renderPanel({ phase: "ramp", rampEndCountdownSec: 3 }, range("ramp").startSec + 400);
    expect(screen.getByRole("alert")).toHaveTextContent("Ramp complete. Moving to recovery in 3");
    await user.click(screen.getByRole("button", { name: "Keep going" }));
    expect(onKeepGoing).toHaveBeenCalled();
  });

  it("coaches the capped effort against the cap", () => {
    renderPanel(
      { phase: "capped", rampEnded: true, hrCapBpm: 168, hrGuidance: "ease", cappedElapsedSec: 120, suggestedStartWatts: 240 },
      range("capped").startSec + 120,
      { hr: 171 }
    );
    expect(screen.getByText("Ease off — over the cap")).toBeInTheDocument();
    expect(screen.getByText(/\/ 168 bpm/)).toBeInTheDocument();
    expect(screen.getByText(/Scoring starts in 3:00/)).toBeInTheDocument();
    expect(screen.getByText(/Start around/)).toHaveTextContent("240 W");
  });

  it("explains a downgrade to the ramp-only result", () => {
    renderPanel(
      { phase: "cooldown", variant: "quick", downgradedReason: "No heart rate was recorded in the ramp, so the capped effort was skipped." },
      range("cooldown").startSec + 5
    );
    expect(screen.getByText(/use the ramp estimate/)).toBeInTheDocument();
    expect(screen.getByText("Quick ramp")).toBeInTheDocument();
  });
});

describe("FitnessTestBriefingDialog", () => {
  const renderBriefing = (props: { heartRateConnected: boolean; trainerConnected?: boolean }) => {
    const onStart = vi.fn();
    render(
      <FitnessTestBriefingDialog
        open
        onOpenChange={vi.fn()}
        profile={{ mapWatts: null, ftpWatts: 250, weightKg: 75 }}
        trainerConnected={props.trainerConnected ?? true}
        heartRateConnected={props.heartRateConnected}
        busy={false}
        error={null}
        onStart={onStart}
      />
    );
    return { onStart };
  };

  it("defaults to the full test with a strap and starts it", async () => {
    const user = userEvent.setup();
    const { onStart } = renderBriefing({ heartRateConnected: true });
    expect(screen.getByRole("radio", { name: /Full test/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Ramp scaled from your FTP/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(onStart).toHaveBeenCalledWith("full");
  });

  it("defaults to the quick ramp without a strap, and won't start the full test", async () => {
    const user = userEvent.setup();
    const { onStart } = renderBriefing({ heartRateConnected: false });
    expect(screen.getByRole("radio", { name: /Quick ramp/ })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: /Full test/ }));
    expect(screen.getByText(/needs a heart-rate strap/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /Quick ramp/ }));
    await user.click(screen.getByRole("button", { name: "Start test" }));
    expect(onStart).toHaveBeenCalledWith("quick");
  });

  it("needs a trainer", () => {
    renderBriefing({ heartRateConnected: true, trainerConnected: false });
    expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();
    expect(screen.getByText("Connect a trainer to start")).toBeInTheDocument();
  });
});
