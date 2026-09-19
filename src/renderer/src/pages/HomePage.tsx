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
    <main className="app">
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
        {/* `margin: 0` stays inline: styles.css's bare `h2` rule is unlayered
            (see index.css), so it always beats a Tailwind `m-0` utility. */}
        <h2 style={{ margin: 0 }}>This week</h2>
      </div>
      <Separator className={cn(dividerClass, "my-4")} />
      {currentWeek ? (
        <div className="mb-8 grid grid-cols-7 gap-0 border-2 border-[color:var(--color-divider)]">
          {currentWeek.days.map((day, index) => {
            const cellDate = addDaysToDate(parseIsoDate(currentWeek.startDate), day.dayIndex);
            const isToday = cellDate.getTime() === today.getTime();
            const hasWorkout = day.workoutId !== null;
            return (
              <div
                key={day.dayIndex}
                onClick={
                  hasWorkout
                    ? () =>
                        void previewWorkoutForDay(
                          day.workoutId as string,
                          day.workoutName ?? "Workout",
                          day.sessionType
                        )
                    : undefined
                }
                className={cn(
                  "flex min-h-24 flex-col gap-1 p-3",
                  index < 6 && "border-r border-[color:var(--color-divider)]",
                  isToday ? "bg-[var(--color-accent-100)]" : "bg-background",
                  hasWorkout ? "cursor-pointer" : "cursor-default"
                )}
              >
                {/* `margin: 0` stays inline for the same unlayered-`h6`
                    reason as the `h2` above. */}
                <h6 style={{ margin: 0, color: isToday ? "var(--color-accent-700)" : undefined }}>
                  {dayLabels[day.dayIndex]} · {formatShortDate(cellDate)}
                </h6>
                <div className="flex-1 text-[13px] font-semibold [overflow-wrap:break-word]">
                  {day.workoutName ?? "Rest"}
                </div>
                {hasWorkout ? (
                  <div className={cardMetaClass}>
                    {day.durationMin} min{day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        /* `marginBottom` stays inline: styles.css's bare `p` rule is
           unlayered, so it always beats a Tailwind margin utility. */
        <p className="text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]" style={{ marginBottom: "var(--space-8)" }}>
          No workouts scheduled for the current week.
        </p>
      )}

      <RecentWorkoutsSection />
    </main>
  );
};
