import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BankWorkoutSummary } from "@shared/ipc/contracts";
import { WorkoutBankBrowser } from "./WorkoutBankBrowser";

/* The other of the two hand-rolled dialogs converted together in this PR
   (see WorkoutPreviewDialog.test.tsx and WorkoutRecapDialog.test.tsx for the
   shared dialog behaviour). These tests cover what's specific to this file:
   the filter-chip row that replaced the hand-rolled chipStyle(active) span
   cluster with a Radix ToggleGroup per filter dimension. */

const summaries: BankWorkoutSummary[] = [
  {
    id: "bank-endurance",
    name: "Endurance Base",
    primaryZone: "endurance",
    discipline: "cycling",
    tags: ["long-ride"],
    phases: ["base"],
    durationSec: 1_500,
    estIF: 0.65,
    estTSS: 45,
    source: "seed",
    archived: false
  },
  {
    id: "bank-threshold",
    name: "Threshold Intervals",
    primaryZone: "threshold",
    discipline: "cycling",
    tags: ["intervals"],
    phases: ["build"],
    durationSec: 3_600,
    estIF: 0.92,
    estTSS: 85,
    source: "seed",
    archived: false
  }
];

const renderBrowser = () =>
  render(
    <WorkoutBankBrowser
      ftp={250}
      connectedTrainerDeviceId={null}
      busy={false}
      error={null}
      onStartAdhoc={vi.fn()}
      onClose={vi.fn()}
    />
  );

describe("WorkoutBankBrowser filter chips", () => {
  beforeEach(() => {
    vi.mocked(window.kickr.workoutBank.list).mockResolvedValue(summaries);
  });

  it("filters the list by zone and clears on a second click", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await screen.findByText("Endurance Base");
    expect(screen.getByText("Threshold Intervals")).toBeInTheDocument();

    const enduranceChip = screen.getByRole("radio", { name: "Endurance" });
    await user.click(enduranceChip);

    expect(screen.getByText("Endurance Base")).toBeInTheDocument();
    expect(screen.queryByText("Threshold Intervals")).not.toBeInTheDocument();
    expect(enduranceChip).toHaveAttribute("data-state", "on");

    await user.click(enduranceChip);

    expect(screen.getByText("Threshold Intervals")).toBeInTheDocument();
    expect(enduranceChip).toHaveAttribute("data-state", "off");
  });

  it("only one zone chip is active at a time", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await screen.findByText("Endurance Base");

    const enduranceChip = screen.getByRole("radio", { name: "Endurance" });
    const thresholdChip = screen.getByRole("radio", { name: "Threshold" });

    await user.click(enduranceChip);
    expect(enduranceChip).toHaveAttribute("data-state", "on");

    await user.click(thresholdChip);
    expect(thresholdChip).toHaveAttribute("data-state", "on");
    expect(enduranceChip).toHaveAttribute("data-state", "off");
    expect(screen.getByText("Threshold Intervals")).toBeInTheDocument();
    expect(screen.queryByText("Endurance Base")).not.toBeInTheDocument();
  });

  it("is keyboard-operable: Tab reaches a chip and Space toggles it", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await screen.findByText("Endurance Base");

    const enduranceChip = screen.getByRole("radio", { name: "Endurance" });
    enduranceChip.focus();
    expect(enduranceChip).toHaveFocus();

    await user.keyboard(" ");

    await waitFor(() => expect(enduranceChip).toHaveAttribute("data-state", "on"));
    expect(screen.queryByText("Threshold Intervals")).not.toBeInTheDocument();
  });
});

/* The bank used to carry its own copy of the pre-ride preview and missed the
   redesign that plan days got. It now renders the shared WorkoutPreviewContent,
   so these pin the shared pieces showing up from the bank as well. */
describe("WorkoutBankBrowser detail", () => {
  beforeEach(() => {
    vi.mocked(window.kickr.workoutBank.list).mockResolvedValue(summaries);
    vi.mocked(window.kickr.workoutBank.get).mockResolvedValue({
      ...summaries[1],
      document: {
        schemaVersion: 1,
        id: "bank-threshold",
        name: "Threshold Intervals",
        primaryZone: "threshold",
        description: "Two long threshold efforts.",
        segments: [{ type: "steady", durationSec: 3_600, power: 0.92 }]
      }
    } as Awaited<ReturnType<typeof window.kickr.workoutBank.get>>);
    vi.mocked(window.kickr.workoutBank.compile).mockResolvedValue({
      intervals: [{ kind: "work", durationSec: 3_600, targetPowerWatts: 230, targetResistancePercent: null }],
      durationSec: 3_600,
      estIF: 0.92,
      estTSS: 85
    });
  });

  it("opens a workout in the shared preview, with Back returning to the list", async () => {
    const user = userEvent.setup();
    renderBrowser();
    await user.click(await screen.findByRole("button", { name: /Threshold Intervals/ }));

    expect(await screen.findByRole("group", { name: "Workout targets" })).toHaveTextContent("85");
    expect(screen.getByRole("group", { name: /Workout power profile/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /1 segment/ })).toBeInTheDocument();
    // 230 W at FTP 250 is 92%: the app's Sweet Spot band (88–93%), so the chart
    // must agree with the bank's own zone naming rather than call it Tempo/Threshold.
    expect(screen.getByRole("list", { name: "Time in zone" })).toHaveTextContent("Sweet Spot");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Endurance Base")).toBeInTheDocument();
  });
});
