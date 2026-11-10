import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DayAvailability, EventPlanSummary, EventPlanWeek } from "@shared/ipc/contracts";
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

const lifecycleProps = () => ({
  wizardRequested: false,
  onWizardRequestHandled: vi.fn(),
  onStartNextEvent: vi.fn(),
  onArchivePlan: vi.fn(async () => {}),
  archivedPlans: [] as EventPlanSummary[],
  onRestorePlan: vi.fn(async (_planId: string) => {}),
  onDeleteArchivedPlan: vi.fn(async (_planId: string) => {})
});

const renderPage = (props: Partial<Parameters<typeof PlanPage>[0]> = {}) => {
  const lifecycle = { ...lifecycleProps(), ...props };
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
      {...lifecycle}
    />
  );
  return { ...result, ...lifecycle, onDeletePlan, onOpenWorkoutBank, previewWorkoutForDay };
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
        {...lifecycleProps()}
      />
    );
    for (const button of screen.getAllByRole("button", { name: "Preview" })) {
      expect(button).toBeDisabled();
    }
  });
});

const pastEvent = (overrides: Partial<EventPlanSummary> = {}): EventPlanSummary => ({
  planId: "old-plan",
  name: "Iceman 2025",
  status: "archived",
  archivedAt: "2025-11-20 10:00:00",
  eventType: "xc-mtb",
  eventDate: "2025-11-01",
  startDate: "2025-08-10",
  weekCount: 12,
  plannedRides: 40,
  completedRides: 31,
  rideSeconds: 27 * 3600,
  startFtp: 230,
  ...overrides
});

describe("PlanPage plan lifecycle", () => {
  it("opens the wizard when the app requests it, noting the current plan gets archived", async () => {
    const onWizardRequestHandled = vi.fn();
    const { rerender } = renderPage({ weeks: [oneWeek], currentPlanName: "Iceman 2026" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <PlanPage
        generate={buildGenerate()}
        adapt={buildAdapt()}
        weeks={[oneWeek]}
        eventDate={null}
        currentPlanName="Iceman 2026"
        liveWorkoutBusy={false}
        isWorkoutSessionActive={false}
        previewWorkoutForDay={vi.fn(async () => {})}
        onDeletePlan={vi.fn(async () => {})}
        onOpenWorkoutBank={vi.fn()}
        {...lifecycleProps()}
        wizardRequested
        onWizardRequestHandled={onWizardRequestHandled}
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "New training plan" });
    expect(within(dialog).getByText(/moves .Iceman 2026. to Past events/)).toBeInTheDocument();
    expect(onWizardRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("does not reopen the wizard after leaving the page and coming back", async () => {
    const user = userEvent.setup();
    /* Mirrors App: it owns the request flag, and navigating away unmounts
       PlanPage. A request left standing used to reopen the wizard on every
       return to the page. */
    const Harness = (): ReactElement => {
      const [requested, setRequested] = useState(true);
      const [onPlanPage, setOnPlanPage] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOnPlanPage((value) => !value)}>
            toggle page
          </button>
          {onPlanPage ? (
            <PlanPage
              generate={buildGenerate()}
              adapt={buildAdapt()}
              weeks={[oneWeek]}
              eventDate={null}
              currentPlanName="Iceman 2026"
              liveWorkoutBusy={false}
              isWorkoutSessionActive={false}
              previewWorkoutForDay={vi.fn(async () => {})}
              onDeletePlan={vi.fn(async () => {})}
              onOpenWorkoutBank={vi.fn()}
              {...lifecycleProps()}
              wizardRequested={requested}
              onWizardRequestHandled={() => setRequested(false)}
            />
          ) : null}
        </>
      );
    };
    render(<Harness />);

    const dialog = await screen.findByRole("dialog", { name: "New training plan" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "toggle page" })); // leave
    await user.click(screen.getByRole("button", { name: "toggle page" })); // come back
    expect(screen.getByRole("heading", { name: "Iceman 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers archive and next-event actions once the event has passed", async () => {
    const user = userEvent.setup();
    const { onArchivePlan, onStartNextEvent } = renderPage({
      weeks: [oneWeek],
      eventDate: "2020-01-01",
      currentPlanName: "Iceman 2026"
    });

    expect(screen.getByText("Event completed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive plan" }));
    expect(onArchivePlan).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Plan your next event" }));
    expect(onStartNextEvent).toHaveBeenCalledTimes(1);
  });

  it("lets a finished past event be viewed but not restored, and deletes only after confirming", async () => {
    const user = userEvent.setup();
    vi.mocked(window.kickr.eventPlan.getReport).mockResolvedValue({
      summary: pastEvent(),
      endFtp: 248,
      weeks: [
        { weekIndex: 0, startDate: "2025-08-10", loadTag: "build", plannedRides: 4, completedRides: 3, rideSeconds: 3 * 3600 }
      ],
      rides: [
        {
          sessionId: "ride-1",
          workoutId: null,
          workoutName: "Sweet spot 3x15",
          startedAt: "2025-08-12T17:00:00.000Z",
          durationSec: 3600,
          avgPowerWatts: 201,
          distanceMeters: null,
          plannedIntervals: []
        }
      ]
    });
    const { onRestorePlan, onDeleteArchivedPlan } = renderPage({ archivedPlans: [pastEvent()] });

    const section = screen.getByRole("region", { name: "Past events" });
    expect(within(section).getByText("Iceman 2025")).toBeInTheDocument();
    expect(within(section).getByText(/31 of 40 rides · 27 h/)).toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "View summary" }));
    const summary = await screen.findByRole("dialog", { name: "Iceman 2025" });
    expect(window.kickr.eventPlan.getReport).toHaveBeenCalledWith({ planId: "old-plan" });
    expect(await within(summary).findByText("230 → 248 W")).toBeInTheDocument();
    expect(within(summary).getByText("78% of planned")).toBeInTheDocument();
    expect(within(summary).getByText("3/4 rides")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: /Sweet spot 3x15/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onRestorePlan).not.toHaveBeenCalled();

    await user.click(within(section).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete past event?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(onDeleteArchivedPlan).not.toHaveBeenCalled();

    await user.click(within(section).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Delete past event?" })).getByRole("button", {
        name: "Delete"
      })
    );
    await waitFor(() => expect(onDeleteArchivedPlan).toHaveBeenCalledWith("old-plan"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("offers Restore for an archived plan whose event is still ahead", async () => {
    const user = userEvent.setup();
    const { onRestorePlan } = renderPage({
      archivedPlans: [pastEvent({ planId: "spring", name: "Spring gravel", eventDate: "2099-04-10" })]
    });

    const section = screen.getByRole("region", { name: "Past events" });
    expect(within(section).queryByRole("button", { name: "View summary" })).not.toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Restore" }));
    expect(onRestorePlan).toHaveBeenCalledWith("spring");
  });
});
