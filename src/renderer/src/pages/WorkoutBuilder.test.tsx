import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BankWorkoutDetail, BankWorkoutSummary } from "@shared/ipc/contracts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { WorkoutBankBrowser } from "./WorkoutBankBrowser";
import { WorkoutBuilder, type BuilderMode } from "./WorkoutBuilder";

const userWorkout: BankWorkoutDetail = {
  id: "my-threshold",
  name: "My Threshold",
  primaryZone: "threshold",
  discipline: "cycling",
  tags: ["ftp"],
  phases: ["build"],
  durationSec: 2_700,
  estIF: 0.85,
  estTSS: 54,
  source: "user",
  archived: false,
  document: {
    schemaVersion: 1,
    id: "my-threshold",
    name: "My Threshold",
    discipline: "cycling",
    primaryZone: "threshold",
    tags: ["ftp"],
    phases: ["build"],
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.75 },
      { type: "intervals", repeat: 2, onDurationSec: 600, onPower: 1, offDurationSec: 300, offPower: 0.55 },
      { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.45 }
    ]
  }
};

const renderBuilder = (mode: BuilderMode = "create", source: BankWorkoutDetail | null = null) => {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <Dialog open>
      <DialogContent>
        <WorkoutBuilder
          mode={mode}
          source={source}
          ftp={250}
          takenIds={["sweet-spot-3-12"]}
          onDirtyChange={vi.fn()}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
  return { onSaved, onCancel };
};

const chooseZone = async (user: ReturnType<typeof userEvent.setup>, label: RegExp): Promise<void> => {
  await user.click(screen.getByRole("combobox", { name: "Primary zone" }));
  await user.click(await screen.findByRole("option", { name: label }));
};

describe("WorkoutBuilder", () => {
  beforeEach(() => {
    vi.mocked(window.kickr.workoutBank.create).mockResolvedValue({ ok: true, id: "sweet-spot-3-12-2" });
    vi.mocked(window.kickr.workoutBank.update).mockResolvedValue({ ok: true, id: "my-threshold" });
  });

  it("won't leave step 1 without a name and a zone, and says why", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Give the workout a name")).toBeInTheDocument();
    expect(screen.getByText("Pick the zone this workout targets")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("list", { name: "Workout blocks" })).not.toBeInTheDocument();
  });

  it("creates a workout from the starter blocks with a collision-free id", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderBuilder();

    await user.type(screen.getByLabelText("Name"), "Sweet Spot 3×12");
    await chooseZone(user, /Sweet Spot/);
    await user.click(screen.getByRole("button", { name: /Training phases|Build/ }));
    await user.type(screen.getByLabelText(/Tags/), "Over Unders{Enter}");
    expect(screen.getByText("#over-unders")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    const blocks = screen.getByRole("list", { name: "Workout blocks" });
    expect(within(blocks).getAllByRole("listitem")).toHaveLength(3);
    // Watts and zone are shown at the rider's FTP next to each % field.
    expect(screen.getAllByText(/225 W · Sweet Spot/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Save workout" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("sweet-spot-3-12-2"));
    const { document } = vi.mocked(window.kickr.workoutBank.create).mock.calls[0][0];
    expect(document).toMatchObject({
      id: "sweet-spot-3-12-2",
      name: "Sweet Spot 3×12",
      primaryZone: "sweet-spot",
      phases: ["build"],
      tags: ["over-unders"]
    });
    expect(document.segments.map((segment) => segment.type)).toEqual(["warmup", "intervals", "cooldown"]);
  });

  it("blocks Save on an invalid field and points at it", async () => {
    const user = userEvent.setup();
    renderBuilder("edit", userWorkout);
    await user.click(screen.getByRole("button", { name: /next/i }));

    const workPower = screen.getByLabelText("Work power");
    await user.clear(workPower);
    await user.type(workPower, "900");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Between 20% and 300%")).toBeInTheDocument();
    expect(workPower).toHaveAttribute("aria-invalid", "true");
    expect(window.kickr.workoutBank.update).not.toHaveBeenCalled();
  });

  it("edits in place: keeps the id and saves through update", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderBuilder("edit", userWorkout);

    expect(screen.getByLabelText("Name")).toHaveValue("My Threshold");
    await user.click(screen.getByRole("button", { name: /next/i }));
    const reps = screen.getByLabelText("Reps");
    await user.clear(reps);
    await user.type(reps, "3");
    await user.click(screen.getByRole("button", { name: "Remove Cool-down, block 3" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("my-threshold"));
    const request = vi.mocked(window.kickr.workoutBank.update).mock.calls[0][0];
    expect(request.id).toBe("my-threshold");
    expect(request.document.segments).toHaveLength(2);
    expect(request.document.segments[1]).toMatchObject({ type: "intervals", repeat: 3 });
  });

  it("reorders blocks with the move buttons", async () => {
    const user = userEvent.setup();
    renderBuilder("edit", userWorkout);
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByRole("button", { name: "Move Warm-up, block 1 up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Warm-up, block 1 down" }));

    const items = within(screen.getByRole("list", { name: "Workout blocks" })).getAllByRole("listitem");
    expect(items[0]).toHaveAccessibleName("Intervals, block 1");
    expect(items[1]).toHaveAccessibleName("Warm-up, block 2");
  });

  it("shows the main process's message when saving fails", async () => {
    vi.mocked(window.kickr.workoutBank.update).mockRejectedValue(
      new Error("Error invoking remote method 'workout-bank:update': Error: Bank workout not found: my-threshold")
    );
    const user = userEvent.setup();
    renderBuilder("edit", userWorkout);
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Bank workout not found: my-threshold")).toBeInTheDocument();
  });
});

describe("WorkoutBankBrowser + builder", () => {
  const summary: BankWorkoutSummary = { ...userWorkout };
  delete (summary as Partial<BankWorkoutDetail>).document;

  beforeEach(() => {
    vi.mocked(window.kickr.workoutBank.list).mockResolvedValue([summary]);
    vi.mocked(window.kickr.workoutBank.get).mockResolvedValue(userWorkout);
    vi.mocked(window.kickr.workoutBank.compile).mockResolvedValue({
      intervals: [],
      durationSec: 2_700,
      estIF: 0.85,
      estTSS: 54
    });
  });

  const renderBank = () => {
    const onClose = vi.fn();
    render(
      <WorkoutBankBrowser
        ftp={250}
        connectedTrainerDeviceId={null}
        busy={false}
        error={null}
        onStartAdhoc={vi.fn()}
        onClose={onClose}
      />
    );
    return { onClose };
  };

  it("offers Edit for the rider's own workouts and opens it filled in", async () => {
    const user = userEvent.setup();
    renderBank();
    expect(await screen.findByText("Custom")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /My Threshold/ }));
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(screen.getByRole("heading", { name: "Edit workout" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("My Threshold");
  });

  it("only offers Duplicate for seed workouts", async () => {
    const seed = { ...userWorkout, source: "seed" };
    vi.mocked(window.kickr.workoutBank.list).mockResolvedValue([{ ...summary, source: "seed" }]);
    vi.mocked(window.kickr.workoutBank.get).mockResolvedValue(seed);
    const user = userEvent.setup();
    renderBank();
    await user.click(await screen.findByRole("button", { name: /My Threshold/ }));
    await user.click(await screen.findByRole("button", { name: "Duplicate" }));

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("My Threshold (copy)");
  });

  it("asks before throwing away unsaved changes", async () => {
    const user = userEvent.setup();
    const { onClose } = renderBank();
    await user.click(await screen.findByRole("button", { name: /New workout/ }));
    await user.type(screen.getByLabelText("Name"), "Half-built");

    await user.keyboard("{Escape}");
    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Half-built");
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByRole("heading", { name: "Workout Bank" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
