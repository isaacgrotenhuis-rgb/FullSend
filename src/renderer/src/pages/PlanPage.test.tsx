import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DayAvailability, EventPlanWeek } from "@shared/ipc/contracts";
import { PlanPage, type AdaptPlanSectionProps, type GeneratePlanSectionProps } from "./PlanPage";

/* PlanPage converts three stacked dialogs (wizard, adapt, delete-confirm) in
   one PR because the delete confirmation can open on top of either of the
   other two. These tests cover the behaviour the legacy `.dialog-backdrop`
   markup never had: Escape, an accessible `alertdialog` role for the
   destructive confirmation, and that cancelling it never deletes. */

const defaultAvailability = (): DayAvailability[] =>
  Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    canTrain: dayIndex === 2 || dayIndex === 4,
    maxDurationMin: 90
  }));

const buildGenerate = (overrides: Partial<GeneratePlanSectionProps> = {}): GeneratePlanSectionProps => ({
  planName: "",
  setPlanName: vi.fn(),
  eventType: "road-race",
  setEventType: vi.fn(),
  eventDate: "2026-12-01",
  setEventDate: vi.fn(),
  planLengthWeeks: 8,
  setPlanLengthWeeks: vi.fn(),
  currentFtp: 220,
  setCurrentFtp: vi.fn(),
  weeklyAvailability: defaultAvailability(),
  updateAvailability: vi.fn(),
  canGenerate: true,
  generatePlan: vi.fn(async () => {}),
  ...overrides
});

const buildAdapt = (overrides: Partial<AdaptPlanSectionProps> = {}): AdaptPlanSectionProps => ({
  adaptReason: "",
  setAdaptReason: vi.fn(),
  adaptationPrompt: "",
  setAdaptationPrompt: vi.fn(),
  overrideFtp: "",
  setOverrideFtp: vi.fn(),
  overrideDate: "",
  setOverrideDate: vi.fn(),
  planId: "plan-1",
  adaptPlan: vi.fn(async () => {}),
  ...overrides
});

const oneWeek: EventPlanWeek = {
  weekId: "week-1",
  weekIndex: 0,
  startDate: "2026-09-14",
  loadTag: "build",
  targetMinutes: 300,
  targetIF: 0.7,
  notes: null,
  days: Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    workoutId: null,
    workoutName: null,
    sessionType: null,
    durationMin: 0,
    targetIF: null
  }))
};

const renderPage = (props: Partial<Parameters<typeof PlanPage>[0]> = {}) => {
  const onDeletePlan = vi.fn(async () => {});
  const onOpenWorkoutBank = vi.fn();
  const previewWorkoutForDay = vi.fn(async () => {});
  const result = render(
    <PlanPage
      generate={buildGenerate()}
      adapt={buildAdapt()}
      weeks={[]}
      eventDate={null}
      currentPlanName={null}
      liveWorkoutBusy={false}
      isWorkoutSessionActive={false}
      previewWorkoutForDay={previewWorkoutForDay}
      onDeletePlan={onDeletePlan}
      onOpenWorkoutBank={onOpenWorkoutBank}
      {...props}
    />
  );
  return { ...result, onDeletePlan, onOpenWorkoutBank, previewWorkoutForDay };
};

describe("PlanPage wizard dialog", () => {
  it("opens from Create a plan and closes on Escape", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Create a plan" }));
    const dialog = await screen.findByRole("dialog", { name: "New training plan" });
    expect(dialog).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("PlanPage hours-per-week slider", () => {
  const openHoursStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Create a plan" }));
    await screen.findByRole("dialog", { name: "New training plan" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    return screen.getByRole("slider");
  };

  it("starts at the initial value and steps by 0.5", async () => {
    const user = userEvent.setup();
    renderPage();
    const slider = await openHoursStep(user);

    expect(slider).toHaveAttribute("aria-valuenow", "8");
    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuenow", "8.5");
  });

  it("clamps to the min (3) and max (14) bounds", async () => {
    const user = userEvent.setup();
    renderPage();
    const slider = await openHoursStep(user);

    slider.focus();
    await user.keyboard("{End}");
    expect(slider).toHaveAttribute("aria-valuenow", "14");

    await user.keyboard("{Home}");
    expect(slider).toHaveAttribute("aria-valuenow", "3");
  });
});

describe("PlanPage delete confirmation", () => {
  const openDeleteConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Edit plan" }));
    await screen.findByRole("dialog", { name: "Edit plan" });
    await user.click(screen.getByRole("button", { name: "Delete plan" }));
    return screen.findByRole("alertdialog");
  };

  it("is an alertdialog stacked above the adapt dialog", async () => {
    const user = userEvent.setup();
    renderPage({ weeks: [oneWeek], currentPlanName: "Fall build" });

    const alert = await openDeleteConfirm(user);
    expect(alert).toHaveAccessibleName("Delete plan?");
    // The adapt dialog underneath is still mounted — Radix marks it
    // aria-hidden while the alert dialog is on top (which also makes its
    // accessible name unresolvable), so presence is checked directly rather
    // than through an accessibility query.
    expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(1);
  });

  it("is keyboard-operable and cancelling does not delete", async () => {
    const user = userEvent.setup();
    const { onDeletePlan } = renderPage({ weeks: [oneWeek], currentPlanName: "Fall build" });

    const alert = await openDeleteConfirm(user);
    const cancel = within(alert).getByRole("button", { name: "Cancel" });
    cancel.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDeletePlan).not.toHaveBeenCalled();
    // The adapt dialog is still open behind it.
    expect(screen.getByRole("dialog", { name: "Edit plan" })).toBeInTheDocument();
  });



  it("deletes when the destructive action is confirmed", async () => {
    const user = userEvent.setup();
    const { onDeletePlan } = renderPage({ weeks: [oneWeek], currentPlanName: "Fall build" });

    const alert = await openDeleteConfirm(user);
    await user.click(within(alert).getByRole("button", { name: "Delete plan" }));

    await waitFor(() => expect(onDeletePlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});

const isoDaysFromToday = (days: number): string => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
};

/* App keeps the wizard's event-date field at today until the wizard is used,
   and the countdown used to read that field — so after a restart a saved plan
   always showed "Event day". The countdown now reads the saved plan's date. */
describe("PlanPage event countdown", () => {
  it("counts down to the saved plan's future event, ignoring the wizard's date", () => {
    renderPage({
      generate: buildGenerate({ eventDate: isoDaysFromToday(0) }),
      weeks: [oneWeek],
      eventDate: isoDaysFromToday(42),
      currentPlanName: "road-race 2026-11-21 (12w)"
    });

    expect(screen.getByText("42 days to event")).toBeInTheDocument();
    expect(screen.queryByText("Event day")).not.toBeInTheDocument();
  });

  it("shows Event completed once the saved plan's event has passed", () => {
    renderPage({ weeks: [oneWeek], eventDate: isoDaysFromToday(-3), currentPlanName: "Spring race" });

    expect(screen.getByText("Event completed")).toBeInTheDocument();
  });

  it("shows no countdown without a saved plan", () => {
    renderPage({ eventDate: isoDaysFromToday(42) });

    expect(screen.queryByText(/to event|Event day|Event completed/)).not.toBeInTheDocument();
  });
});

/* The week list is anchored to the real current date (no fake timers): week
   offsets are relative to the week containing today, so the fixture always
   has two finished weeks, the current one, and one still to come. */
const isoDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const weekAt = (offset: number, weekIndex: number): EventPlanWeek => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + offset * 7);
  return { ...oneWeek, weekId: `week-${weekIndex}`, weekIndex, startDate: isoDate(start) };
};

describe("PlanPage week list", () => {
  const weeks = [weekAt(-2, 0), weekAt(-1, 1), weekAt(0, 2), weekAt(1, 3)];

  const trainingWeek = (): EventPlanWeek => {
    const week = weekAt(0, 0);
    const days = week.days.map((day) => ({ ...day }));
    days[2] = { ...days[2], workoutId: "w-1", workoutName: "Threshold 2x20", sessionType: null, durationMin: 60, targetIF: 0.9 };
    days[6] = { ...days[6], workoutId: "w-2", workoutName: "Endurance", sessionType: null, durationMin: 120, targetIF: 0.6 };
    return { ...week, days };
  };

  it("lists every week in order, past weeks included, inside one scroll area", () => {
    const { container } = renderPage({ weeks, currentPlanName: "Test plan" });

    const headings = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Week 1", "Week 2", "Week 3", "Week 4"]);
    expect(container.querySelectorAll('[data-slot="scroll-area"] section')).toHaveLength(4);
  });

  it("marks the week containing today as current", () => {
    renderPage({ weeks, currentPlanName: "Test plan" });

    const current = screen.getByRole("region", { name: "Week 3" });
    expect(current).toHaveAttribute("aria-current", "date");
    expect(within(current).getByText("This week")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Week 2" })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByText("This week")).toHaveLength(1);
  });

  it("marks no week as current when none contains today", () => {
    renderPage({ weeks: [weekAt(2, 0), weekAt(3, 1)], currentPlanName: "Test plan" });

    expect(screen.queryByText("This week")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
  });

  it("summarises each week's workouts and scheduled time", () => {
    renderPage({ weeks: [trainingWeek()], currentPlanName: "Test plan" });

    expect(screen.getByText("2 workouts · 3h")).toBeInTheDocument();
  });

  it("previews a day's workout, and disables preview during a ride", async () => {
    const user = userEvent.setup();
    const { previewWorkoutForDay, rerender } = renderPage({ weeks: [trainingWeek()], currentPlanName: "Test plan" });

    const [firstPreview] = screen.getAllByRole("button", { name: "Preview" });
    await user.click(firstPreview);
    expect(previewWorkoutForDay).toHaveBeenCalledWith("w-1", "Threshold 2x20", null);

    rerender(
      <PlanPage
        generate={buildGenerate()}
        adapt={buildAdapt()}
        weeks={[trainingWeek()]}
        eventDate={null}
        currentPlanName="Test plan"
        liveWorkoutBusy={false}
        isWorkoutSessionActive
        previewWorkoutForDay={previewWorkoutForDay}
        onDeletePlan={vi.fn(async () => {})}
        onOpenWorkoutBank={vi.fn()}
      />
    );
    for (const button of screen.getAllByRole("button", { name: "Preview" })) {
      expect(button).toBeDisabled();
    }
  });
});
