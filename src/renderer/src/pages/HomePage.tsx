import type { ReactElement } from "react";
import type { DashboardMetrics, EventPlanWeek, SessionType } from "@shared/ipc/contracts";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { RecentWorkoutsSection } from "./RecentWorkoutsSection";

type Props = {
  dashboard: DashboardMetrics | null;
  currentFtp: number;
  eventDate: string;
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

  const daysUntilEvent = Math.round((parseIsoDate(eventDate).getTime() - today.getTime()) / 86400000);
  const countdownLabel =
    weeks.length === 0
      ? null
      : daysUntilEvent > 0
        ? `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} to event`
        : daysUntilEvent === 0
          ? "Event day"
          : "Event completed";

  return (
    <main className="mx-auto max-w-[960px] p-6">
      <div className="mb-6">
        <h1>{greetingForNow()}</h1>
        {countdownLabel ? (
          <button
            type="button"
            onClick={onNavigateToPlan}
            className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[var(--color-accent-700)]"
          >
            <span className="text-sm font-bold">{countdownLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="8,3 18,12 8,21" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Deliberate visual change: this card used to override its radius to
          0 (a square corner surviving PR 1's token flip). Removed so it picks
          up the hybrid theme's rounded-md, matching every other surface. */}
      <Card className="mb-8 gap-2 rounded-md border-0 bg-muted p-3 shadow-none">
        <h6>Training status</h6>
        <Separator className={cn(dividerClass, "mb-3")} />
        <div className="flex flex-col">
          <div className="flex items-baseline justify-between border-b border-[color:var(--color-divider)] py-2">
            <span className={cardMetaClass}>Current FTP</span>
            <span className="text-[22px] font-extrabold">{currentFtp} W</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-[color:var(--color-divider)] py-2">
            <span className={cardMetaClass}>Plan compliance</span>
            <span className="text-[22px] font-extrabold">
              {dashboard?.planCompliancePercent != null ? `${dashboard.planCompliancePercent}%` : "—"}
            </span>
          </div>
          <div className="flex items-baseline justify-between py-2">
            <span className={cardMetaClass}>Training block</span>
            <span className="text-[22px] font-extrabold">
              {currentWeek ? `Week ${currentWeekIndex + 1} / ${weeks.length}` : "—"}
            </span>
          </div>
        </div>
      </Card>

      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0">This week</h2>
      </div>
      <Separator className={cn(dividerClass, "my-4")} />
      {currentWeek ? (
        <div className="mb-8 grid grid-cols-7 gap-0 border-2 border-[color:var(--color-divider)]">
          {currentWeek.days.map((day, index) => {
            const cellDate = addDaysToDate(parseIsoDate(currentWeek.startDate), day.dayIndex);
            const isToday = cellDate.getTime() === today.getTime();
            const hasWorkout = day.workoutId !== null;
            const durationLabel = `${day.durationMin} min${day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}`;

            /* One class list for both variants so the interactive and rest
               cells stay pixel-identical. `text-left` is the only addition a
               button needs over a div: the UA centers button text, everything
               else (font, color, background) Preflight already inherits. */
            const cellClass = cn(
              "flex min-h-24 flex-col gap-1 p-3 text-left",
              index < 6 && "border-r border-[color:var(--color-divider)]",
              isToday ? "bg-[var(--color-accent-100)]" : "bg-background"
            );

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
                <div key={day.dayIndex} className={cn(cellClass, "cursor-default")}>
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
                aria-label={ariaLabel}
                onClick={() =>
                  void previewWorkoutForDay(day.workoutId as string, workoutName, day.sessionType)
                }
                className={cn(cellClass, "cursor-pointer appearance-none")}
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
    </main>
  );
};
