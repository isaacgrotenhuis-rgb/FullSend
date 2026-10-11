import type { CSSProperties, ReactElement } from "react";
import type { DashboardMetrics, EventPlanWeek, SessionType } from "@shared/ipc/contracts";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { RecentWorkoutsSection } from "./RecentWorkoutsSection";
import { TrainingStatusBar, TrainingStatusCards } from "./TrainingStatusCards";

type Props = {
  dashboard: DashboardMetrics | null;
  currentFtp: number;
  /** Profile weight, for the FTP card's W/kg; null when not entered. */
  weightKg?: number | null;
  eventDate: string | null;
  weeks: EventPlanWeek[];
  previewWorkoutForDay: (
    workoutId: string,
    workoutName: string,
    sessionType: SessionType | null
  ) => Promise<void>;
  onNavigateToPlan: () => void;
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Legacy `.card-meta`: small flex row of muted 11px text. */
const cardMetaClass = "flex items-center gap-1.5 text-[11px] text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]";

/** Legacy `.hr`: a 2px divider-colored rule. Margin is supplied per call site
    since shadcn's Separator carries none of its own (the bare `.hr` class did,
    via `margin: var(--space-4) 0`). */
const dividerClass = "h-[2px] bg-[var(--color-divider)]";

/** The base-layer `h6` rules (index.css), spelled out as utilities.
    A day cell with a workout is now a <button>, and a button may not contain
    flow content such as a heading — so the day-label line is a <span> in both
    cell variants, sharing this one class list so the two cannot drift apart.
    Nothing is lost semantically: index.css documents `h6` as the app's
    small-caps label style rather than a real heading level. */
const dayLabelClass = cn(
  "font-[family-name:var(--font-heading)] [font-weight:var(--font-heading-weight)]",
  "text-[13px] leading-[1.12] tracking-[0.08em] uppercase"
);

const parseIsoDate = (iso: string): Date => new Date(`${iso}T00:00:00`);

const addDaysToDate = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatShortDate = (date: Date): string => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const greetingForNow = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export const HomePage = ({
  dashboard,
  currentFtp,
  weightKg = null,
  eventDate,
  weeks,
  previewWorkoutForDay,
  onNavigateToPlan
}: Props): ReactElement => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let currentWeekIndex = -1;
  const currentWeek =
    weeks.find((week, index) => {
      const start = parseIsoDate(week.startDate);
      const end = addDaysToDate(start, 7);
      const match = today >= start && today < end;
      if (match) currentWeekIndex = index;
      return match;
    }) ?? null;

  const daysUntilEvent =
    eventDate === null ? null : Math.round((parseIsoDate(eventDate).getTime() - today.getTime()) / 86400000);
  const countdownLabel =
    weeks.length === 0 || daysUntilEvent === null
      ? null
      : daysUntilEvent > 0
        ? `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} to event`
        : daysUntilEvent === 0
          ? "Event day"
          : "Event completed";

  // Shared by the full cards and the pinned bar that replaces them on scroll.
  const statusProps = {
    dashboard,
    currentFtp,
    weightKg,
    eventDate: eventDate === null ? null : parseIsoDate(eventDate),
    daysUntilEvent: weeks.length === 0 ? null : daysUntilEvent,
    countdownLabel,
    weeks,
    currentWeek,
    currentWeekIndex,
    onNavigateToPlan
  };

  return (
    <main className="status-timeline-scope mx-auto max-w-[1040px] p-6">
      <div className="mb-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500">
        <h1 className="mb-1">{greetingForNow()}</h1>
        <p className="m-0 text-sm text-muted-foreground">
          {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <section aria-label="Training status" className="mb-10">
        <TrainingStatusCards {...statusProps} />
      </section>

      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0">This week</h2>
      </div>
      <Separator className={cn(dividerClass, "my-4")} />
      {currentWeek ? (
        <div className="mb-8 grid grid-cols-7 gap-2">
          {currentWeek.days.map((day) => {
            const cellDate = addDaysToDate(parseIsoDate(currentWeek.startDate), day.dayIndex);
            const isToday = cellDate.getTime() === today.getTime();
            const hasWorkout = day.workoutId !== null;
            const durationLabel = `${day.durationMin} min${day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}`;

            /* Each day is its own rounded tile rather than a cell in one
               square-bordered strip. One base class list for both variants so
               the interactive and rest tiles share their geometry; `text-left`
               is the only addition a button needs over a div: the UA centers
               button text, everything else Preflight already inherits.
               Workout days sit on the muted surface (the same fill as the
               status cards' muted surfaces — `bg-card` is the page colour in this
               theme, so it would read as an empty outline); rest days recede
               to a dashed outline; today is marked with the brand border on
               top of its accent tint. */
            const cellClass = cn(
              "scroll-reveal flex min-h-24 flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
              isToday
                ? "border-primary bg-[var(--color-accent-100)]"
                : hasWorkout
                  ? "border-foreground/15 bg-muted shadow-xs"
                  : "border-dashed border-foreground/30 text-muted-foreground"
            );

            // Tiles enter together, so each day trails the previous one slightly.
            const revealStyle = { "--reveal-offset": `${day.dayIndex * 3}%` } as CSSProperties;

            const cellContent = (
              <>
                <span className={cn(dayLabelClass, isToday && "text-[var(--color-accent-700)]")}>
                  {dayLabels[day.dayIndex]} · {formatShortDate(cellDate)}
                </span>
                <span className="flex-1 text-[13px] font-semibold [overflow-wrap:break-word]">
                  {day.workoutName ?? "Rest"}
                </span>
                {hasWorkout ? <span className={cardMetaClass}>{durationLabel}</span> : null}
              </>
            );

            /* Rest days carry no action, so they stay a plain <div> and out of
               the tab order entirely. Only days with a workout become real
               <button>s — previously every cell was a <div onClick>, which Tab
               never reaches and Enter/Space never activates. */
            if (!hasWorkout) {
              return (
                <div key={day.dayIndex} className={cn(cellClass, "cursor-default")} style={revealStyle}>
                  {cellContent}
                </div>
              );
            }

            /* The cell's own text would read as one run-on string ("Mon · Mar 3
               Threshold 2x20 60 min · IF 0.88"), so the button gets an explicit
               label instead: the day first for orientation within the week,
               then what activating it does. */
            const workoutName = day.workoutName ?? "Workout";
            const ariaLabel = `${dayLabels[day.dayIndex]} ${formatShortDate(cellDate)}${
              isToday ? ", today" : ""
            }: ${workoutName}, ${durationLabel.replace(" · ", ", ")}. Preview workout.`;

            return (
              <button
                key={day.dayIndex}
                type="button"
                style={revealStyle}
                aria-label={ariaLabel}
                onClick={() =>
                  void previewWorkoutForDay(day.workoutId as string, workoutName, day.sessionType)
                }
                className={cn(
                  cellClass,
                  "cursor-pointer appearance-none hover:border-primary/60"
                )}
              >
                {cellContent}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mb-8 text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
          No workouts scheduled for the current week.
        </p>
      )}

      <RecentWorkoutsSection />

      {/* Last in the DOM so it is last in the tab order; it is fixed-position. */}
      <TrainingStatusBar {...statusProps} />
    </main>
  );
};
