import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import type { WorkoutInterval, WorkoutSessionState, WorkoutSessionSummary } from "@shared/ipc/contracts";
import { RidePage } from "./RidePage";

/* RidePage is the live-ride screen; its end-of-ride dialog is the one dialog in
   the app that must NOT be dismissible via Escape or an outside click (see the
   non-dismissibility comment above the <Dialog> in RidePage.tsx). These tests
   guard that behaviour plus the MPH/KPH ToggleGroup (required single-select,
   cannot be cleared). The post-to-Strava Checkbox this file used to also
   cover is commented out in RidePage.tsx along with the rest of the Strava
   integration for now (see StravaService.ts / docs/onboarding-plan.md) —
   finishRide is always called with `false`, and its own describe block below
   is commented out to match rather than deleted. */

const intervals: WorkoutInterval[] = [
  { kind: "work", durationSec: 600, targetPowerWatts: 200, targetResistancePercent: null }
];

const endedSessionState: WorkoutSessionState = {
  sessionId: "session-1",
  workoutId: "workout-1",
  deviceId: null,
  lifecycle: "stopped",
  startedAt: null,
  pausedAt: null,
  endedAt: null,
  elapsedSec: 120,
  positionSec: 120,
  pauseReason: null,
  fitnessTest: null,
  currentIntervalIndex: null,
  intervalsTotal: 1,
  lastError: null,
  liveMetrics: null,
  intensityMultiplier: 1,
  rampDurationSec: 0
};

const runningSessionState: WorkoutSessionState = {
  ...endedSessionState,
  lifecycle: "running",
  elapsedSec: 30,
  positionSec: 30
};

const summary: WorkoutSessionSummary = {
  sessionId: "session-1",
  durationSec: 120,
  avgPowerWatts: 180,
  avgCadenceRpm: 85,
  avgHeartRateBpm: 140,
  avgSpeedKmh: 25,
  distanceMeters: 5000
};

const baseProps = {
  activeIntervals: intervals,
  activeWorkoutName: "Iceman intervals",
  liveWorkoutError: null,
  liveWorkoutBusy: false,
  isWorkoutSessionActive: true,
  pauseWorkout: vi.fn().mockResolvedValue(undefined),
  resumeWorkout: vi.fn().mockResolvedValue(undefined),
  seekWorkout: vi.fn().mockResolvedValue(undefined),
  stopWorkout: vi.fn().mockResolvedValue(undefined),
  saveWorkout: vi.fn().mockResolvedValue(summary),
  fetchSessionTelemetry: vi.fn().mockResolvedValue([]),
  discardWorkout: vi.fn().mockResolvedValue(undefined),
  finishRide: vi.fn().mockResolvedValue(undefined),
  adjustIntensity: vi.fn().mockResolvedValue(undefined),
  rampDurationInput: "0",
  setRampDurationInput: vi.fn(),
  applyRampDuration: vi.fn().mockResolvedValue(undefined)
};

describe("RidePage end-of-ride dialog", () => {
  it("does not close on Escape", async () => {
    const user = userEvent.setup();
    render(<RidePage {...baseProps} workoutSessionState={endedSessionState} />);
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
  });

  it("does not close on a click outside the panel", async () => {
    /* Radix marks <body> pointer-events: none while a modal dialog is open,
       which user-event's default pointer check rejects. The overlay itself is
       still interactive in a real browser. */
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    render(<RidePage {...baseProps} workoutSessionState={endedSessionState} />);
    await screen.findByRole("dialog");

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("has no corner close button", async () => {
    render(<RidePage {...baseProps} workoutSessionState={endedSessionState} />);
    await screen.findByRole("dialog");

    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("closes only through its own Discard action", async () => {
    const discardWorkout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RidePage {...baseProps} workoutSessionState={endedSessionState} discardWorkout={discardWorkout} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(discardWorkout).toHaveBeenCalledTimes(1);
  });

  it("moves to the Saved panel through its own Save Workout action, and Done finishes the ride", async () => {
    const finishRide = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RidePage {...baseProps} workoutSessionState={endedSessionState} finishRide={finishRide} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Save Workout" }));
    await screen.findByRole("button", { name: "Done" });

    await user.click(screen.getByRole("button", { name: "Done" }));

    // Was `true` when the post-to-Strava checkbox defaulted checked; RidePage
    // now always passes false while that checkbox is disabled (see the file
    // comment above).
    expect(finishRide).toHaveBeenCalledWith(false);
  });
});

// Post-to-Strava checkbox disabled along with the rest of the Strava
// integration for now (RidePage.tsx) — kept here, commented out, rather than
// deleted, for when it's restored.
//
// describe("RidePage Strava checkbox", () => {
//   it("is labelled and keyboard-operable", async () => {
//     const user = userEvent.setup();
//     render(<RidePage {...baseProps} workoutSessionState={endedSessionState} />);
//     await screen.findByRole("dialog");
//     await user.click(screen.getByRole("button", { name: "Save Workout" }));
//
//     const checkbox = await screen.findByRole("checkbox", { name: "Post this workout to Strava" });
//     expect(checkbox).toHaveAttribute("aria-checked", "true");
//
//     checkbox.focus();
//     await user.keyboard(" ");
//     expect(checkbox).toHaveAttribute("aria-checked", "false");
//   });
// });

describe("RidePage speed unit toggle", () => {
  it("switches units, is keyboard-operable, and cannot be cleared", async () => {
    const user = userEvent.setup();
    render(<RidePage {...baseProps} workoutSessionState={runningSessionState} />);

    const mph = screen.getByRole("radio", { name: "MPH" });
    const kph = screen.getByRole("radio", { name: "KPH" });
    expect(mph).toHaveAttribute("aria-checked", "true");
    expect(kph).toHaveAttribute("aria-checked", "false");

    await user.click(kph);
    expect(kph).toHaveAttribute("aria-checked", "true");
    expect(mph).toHaveAttribute("aria-checked", "false");

    // Re-clicking the already-active option must not clear the selection.
    await user.click(kph);
    expect(kph).toHaveAttribute("aria-checked", "true");
    expect(mph).toHaveAttribute("aria-checked", "false");

    // Keyboard: arrow keys move the roving-focus tabstop, Space activates it.
    kph.focus();
    await user.keyboard("{ArrowLeft}");
    expect(mph).toHaveFocus();
    await user.keyboard(" ");
    expect(mph).toHaveAttribute("aria-checked", "true");
    expect(kph).toHaveAttribute("aria-checked", "false");
  });
});

describe("RidePage seeking", () => {
  const twoBlocks: WorkoutInterval[] = [
    { kind: "warmup", durationSec: 300, targetPowerWatts: 120, targetResistancePercent: null },
    { kind: "cooldown", durationSec: 300, targetPowerWatts: 90, targetResistancePercent: null }
  ];
  const riding: WorkoutSessionState = {
    ...runningSessionState,
    currentIntervalIndex: 0,
    elapsedSec: 40,
    positionSec: 40,
    intervalsTotal: 2
  };

  it("skips to the start of the next interval", async () => {
    const seekWorkout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RidePage {...baseProps} activeIntervals={twoBlocks} workoutSessionState={riding} seekWorkout={seekWorkout} />);

    await user.click(screen.getByRole("button", { name: "Skip interval" }));
    expect(seekWorkout).toHaveBeenCalledWith(300);
  });

  it("disables Skip interval on the last interval", () => {
    render(
      <RidePage
        {...baseProps}
        activeIntervals={twoBlocks}
        workoutSessionState={{ ...riding, currentIntervalIndex: 1, positionSec: 400 }}
      />
    );
    expect(screen.getByRole("button", { name: "Skip interval" })).toBeDisabled();
  });

  it("asks before jumping while riding", async () => {
    const seekWorkout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RidePage {...baseProps} activeIntervals={twoBlocks} workoutSessionState={riding} seekWorkout={seekWorkout} />);

    const chart = screen.getByRole("group", { name: /Workout power profile/ });
    chart.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    expect(seekWorkout).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog", { name: "Confirm jump" });
    expect(confirm).toHaveTextContent("Jump to 5:00 — Cool-down?");
    await user.click(screen.getByRole("button", { name: "Jump" }));
    expect(seekWorkout).toHaveBeenCalledWith(300);
  });

  it("jumps straight away while paused, and explains auto-pause", async () => {
    const seekWorkout = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <RidePage
        {...baseProps}
        activeIntervals={twoBlocks}
        workoutSessionState={{ ...riding, lifecycle: "paused", pauseReason: "auto" }}
        seekWorkout={seekWorkout}
      />
    );

    expect(screen.getByText("Auto-paused")).toBeInTheDocument();
    expect(screen.getByText(/Paused because you stopped pedaling/).closest('[role="status"]')).toHaveTextContent(
      "Start pedaling to resume"
    );

    const chart = screen.getByRole("group", { name: /Workout power profile/ });
    chart.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    expect(seekWorkout).toHaveBeenCalledWith(300);
    expect(screen.queryByRole("alertdialog", { name: "Confirm jump" })).not.toBeInTheDocument();
  });
});
