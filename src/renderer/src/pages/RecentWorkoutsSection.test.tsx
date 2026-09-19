import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompletedSessionSummary } from "@shared/ipc/contracts";
import { RecentWorkoutCard } from "./RecentWorkoutsSection";

/* RecentWorkoutCard used to be a `<button className="card">` — a card that
   is itself a button. PR 4 composes it as a plain button wrapping a shadcn
   Card, so these tests pin the thing that composition has to preserve: a
   single focusable control with one accessible name, not two nested
   interactive elements each fighting for focus/activation. */

const session: CompletedSessionSummary = {
  sessionId: "session-42",
  workoutId: null,
  workoutName: "Iceman intervals",
  startedAt: "2026-03-04T17:30:00.000Z",
  durationSec: 3_600,
  avgPowerWatts: 212,
  distanceMeters: 31_000,
  plannedIntervals: []
};

describe("RecentWorkoutCard", () => {
  it("renders as a single focusable control with an accessible name", () => {
    render(<RecentWorkoutCard session={session} speedUnit="kph" onOpen={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Iceman intervals/);

    // No interactive element nested inside the card-button.
    expect(buttons[0].querySelector("button, a, [role='button']")).toBeNull();
  });

  it("calls onOpen with the session id when clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<RecentWorkoutCard session={session} speedUnit="kph" onOpen={onOpen} />);

    await user.click(screen.getByRole("button"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("session-42");
  });

  it("calls onOpen on keyboard activation (Enter and Space)", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<RecentWorkoutCard session={session} speedUnit="kph" onOpen={onOpen} />);

    const button = screen.getByRole("button");
    await user.tab();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("falls back to 'Ad-hoc ride' when the session has no workout name", () => {
    render(
      <RecentWorkoutCard
        session={{ ...session, workoutName: null }}
        speedUnit="kph"
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByRole("button")).toHaveAccessibleName(/Ad-hoc ride/);
  });
});
