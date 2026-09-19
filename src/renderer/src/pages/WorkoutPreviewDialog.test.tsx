import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import type { WorkoutDetail } from "@shared/ipc/contracts";
import { WorkoutPreviewDialog } from "./WorkoutPreviewDialog";

/* One of the two hand-rolled dialogs converted together in this PR (the other
   is WorkoutBankBrowser) — see WorkoutRecapDialog.test.tsx for the pattern
   these tests follow. */

const detail: WorkoutDetail = {
  workout: {
    id: "workout-1",
    name: "Sweet Spot Intervals",
    source: "manual-builder",
    durationSec: 1_800,
    intensityFactor: 0.85
  },
  intervals: [
    {
      kind: "work",
      durationSec: 1_800,
      targetPowerWatts: 200,
      targetResistancePercent: null
    }
  ],
  metadata: null
};

/* Mirrors the real parent (App.tsx): the dialog is mounted conditionally and
   unmounted by the onBack callback, never toggled through an `open` prop of
   its own. */
const Harness = ({ onBack }: { onBack?: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open preview
      </button>
      {open ? (
        <WorkoutPreviewDialog
          name="Sweet Spot Intervals"
          sessionType="sweet-spot"
          detail={detail}
          connectedTrainerDeviceId={null}
          busy={false}
          error={null}
          onStart={vi.fn()}
          onBack={() => {
            setOpen(false);
            onBack?.();
          }}
        />
      ) : null}
    </>
  );
};

const openDialog = async (
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> => {
  await user.click(screen.getByRole("button", { name: "Open preview" }));
  return screen.findByRole("dialog");
};

describe("WorkoutPreviewDialog", () => {
  it("opens with an accessible name taken from the workout", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openDialog(user);

    expect(dialog).toHaveAccessibleName("Sweet Spot Intervals");
  });

  it("closes on Escape", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<Harness onBack={onBack} />);
    await openDialog(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside the panel", async () => {
    const onBack = vi.fn();
    /* Radix marks <body> pointer-events: none while a modal dialog is open,
       which user-event's default pointer check rejects. The overlay itself is
       still interactive in a real browser. */
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    render(<Harness onBack={onBack} />);
    await openDialog(user);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("closes from the Cancel button", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<Harness onBack={onBack} />);
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("traps Tab inside the panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openDialog(user);

    /* More tab stops than the panel holds, so a leak past the last one would
       land on the harness trigger behind the overlay. */
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
