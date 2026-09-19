import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import type { CompletedSessionSummary } from "@shared/ipc/contracts";
import { WorkoutRecapDialog } from "./WorkoutRecapDialog";

/* The reference conversion of the seven hand-rolled dialogs. These cover the
   behaviour the legacy `.dialog-backdrop` markup never had — Escape, outside
   click, focus restore and an accessible name — so the five agents converting
   the remaining six dialogs have something to copy and to check against. */

const session: CompletedSessionSummary = {
  sessionId: "session-1",
  workoutId: null,
  workoutName: "Iceman intervals",
  startedAt: "2026-03-04T17:30:00.000Z",
  durationSec: 3_600,
  avgPowerWatts: 212,
  distanceMeters: 31_000,
  plannedIntervals: []
};

/* Mirrors the real parent (RecentWorkoutsSection): the dialog is mounted
   conditionally and unmounted by the onClose callback, never toggled through
   an `open` prop of its own. */
const Harness = ({ onClose }: { onClose?: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open recap
      </button>
      {open ? (
        <WorkoutRecapDialog
          session={session}
          recap={null}
          loading
          error={null}
          speedUnit="kph"
          onSpeedUnitChange={vi.fn()}
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      ) : null}
    </>
  );
};

const openDialog = async (
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> => {
  await user.click(screen.getByRole("button", { name: "Open recap" }));
  return screen.findByRole("dialog");
};

describe("WorkoutRecapDialog", () => {
  it("opens with an accessible name taken from the workout", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const dialog = await openDialog(user);

    expect(dialog).toHaveAccessibleName("Iceman intervals");
    expect(screen.getByText("Loading recap…")).toBeInTheDocument();
  });

  it("falls back to an accessible name for an ad-hoc ride", async () => {
    render(
      <WorkoutRecapDialog
        session={{ ...session, workoutName: null }}
        recap={null}
        loading
        error={null}
        speedUnit="kph"
        onSpeedUnitChange={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Ad-hoc ride");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await openDialog(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside the panel", async () => {
    const onClose = vi.fn();
    /* Radix marks <body> pointer-events: none while a modal dialog is open,
       which user-event's default pointer check rejects. The overlay itself is
       still interactive in a real browser. */
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    render(<Harness onClose={onClose} />);
    await openDialog(user);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the Done button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await openDialog(user);

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the element that opened it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open recap" });
    await openDialog(user);

    expect(trigger).not.toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
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
