import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventPlanDay, EventPlanWeek } from "@shared/ipc/contracts";
import { HomePage } from "./HomePage";

/* Regression coverage for the same bug class Nav.tsx fixed: the "This week"
   calendar rendered every day as a `<div onClick>`, which Tab never reaches
   and Enter/Space never activates, so opening a day's workout preview was
   unavailable to keyboard users. Days with a workout are now real <button>s;
   rest days, which were never actionable, stay plain divs. */

const restDay = (dayIndex: number): EventPlanDay => ({
  dayIndex,
  workoutId: null,
  workoutName: null,
  sessionType: null,
  durationMin: 0,
  targetIF: null
});

const workoutDay = (dayIndex: number): EventPlanDay => ({
  dayIndex,
  workoutId: "workout-7",
  workoutName: "Threshold 2x20",
  sessionType: "threshold",
  durationMin: 60,
  targetIF: 0.88
});

const isoDate = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");

/* HomePage renders whichever week contains today, so the fixture is anchored
   to the real Sunday of the current week rather than a frozen date — that
   keeps the grid on screen without reaching for fake timers, which
   userEvent's own timer handling makes awkward. */
const thisWeek = (): EventPlanWeek => {
  const sunday = new Date();
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return {
    weekId: "week-1",
    weekIndex: 0,
    startDate: isoDate(sunday),
    loadTag: "build",
    targetMinutes: 300,
    targetIF: 0.7,
    notes: null,
    days: [0, 1, 2, 3, 4, 5, 6].map((dayIndex) =>
      dayIndex === 2 ? workoutDay(dayIndex) : restDay(dayIndex)
    )
  };
};

const renderPage = () => {
  // Keeps the recent-activity section in its empty state, so the only buttons
  // on the page are the event countdown and the one workout cell.
  vi.mocked(window.kickr.workout.listCompletedSessions).mockResolvedValue([]);
  const previewWorkoutForDay = vi.fn(async () => {});
  const result = render(
    <HomePage
      dashboard={null}
      currentFtp={240}
      eventDate="2099-01-01"
      weeks={[thisWeek()]}
      previewWorkoutForDay={previewWorkoutForDay}
      onNavigateToPlan={vi.fn()}
    />
  );
  return { ...result, previewWorkoutForDay };
};

const workoutCell = (): HTMLElement => screen.getByRole("button", { name: /Threshold 2x20/ });

describe("HomePage this-week calendar", () => {
  it("renders a day with a workout as a focusable button", async () => {
    renderPage();
    await screen.findByText("No completed workouts recorded yet.");

    const cell = workoutCell();
    expect(cell.tagName).toBe("BUTTON");

    // A <div onClick> has no tabIndex and is never focused directly.
    cell.focus();
    expect(cell).toHaveFocus();
  });

  it("opens the preview when a workout cell is activated from the keyboard", async () => {
    const user = userEvent.setup();
    const { previewWorkoutForDay } = renderPage();
    await screen.findByText("No completed workouts recorded yet.");

    workoutCell().focus();
    await user.keyboard("{Enter}");
    expect(previewWorkoutForDay).toHaveBeenCalledWith("workout-7", "Threshold 2x20", "threshold");

    await user.keyboard(" ");
    expect(previewWorkoutForDay).toHaveBeenCalledTimes(2);
  });

  it("gives the workout cell an accessible name covering the day and the workout", async () => {
    renderPage();
    await screen.findByText("No completed workouts recorded yet.");

    // The cell's own text runs the four lines together; the explicit label
    // spells the day out and says what activating the button does.
    expect(workoutCell()).toHaveAccessibleName(
      /^Tue .+: Threshold 2x20, 60 min, IF 0\.88\. Preview workout\.$/
    );
  });

  it("leaves rest days non-interactive and out of the tab order", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("No completed workouts recorded yet.");

    const restCells = screen.getAllByText("Rest").map((label) => label.parentElement as HTMLElement);
    expect(restCells).toHaveLength(6);
    for (const cell of restCells) {
      expect(cell.tagName).toBe("DIV");
      expect(cell).not.toHaveAttribute("tabindex");
      // Focusing a non-focusable element is a no-op: focus stays on <body>.
      cell.focus();
      expect(cell).not.toHaveFocus();
    }

    // Tab reaches the countdown link, then skips the two rest days that
    // precede the workout cell in DOM order.
    await user.tab();
    expect(screen.getByRole("button", { name: /to event/ })).toHaveFocus();
    await user.tab();
    expect(workoutCell()).toHaveFocus();
  });

  it("puts exactly one interactive control in each workout cell", async () => {
    renderPage();
    await screen.findByText("No completed workouts recorded yet.");

    expect(workoutCell().querySelector("button, a, [role='button'], [tabindex]")).toBeNull();
  });
});
