import type { ReactElement } from "react";
import type { DashboardMetrics, EventPlanWeek, SessionType } from "@shared/ipc/contracts";
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
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h1 style={{ margin: "0 0 var(--space-2)" }}>{greetingForNow()}</h1>
        {countdownLabel ? (
          <button
            onClick={onNavigateToPlan}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-accent-700)",
              font: "inherit"
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>{countdownLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="8,3 18,12 8,21" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="card" style={{ borderRadius: 0, marginBottom: "var(--space-8)" }}>
        <h6 style={{ marginBottom: "var(--space-2)" }}>Training status</h6>
        <div className="hr" style={{ margin: "0 0 var(--space-3)" }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              padding: "var(--space-2) 0",
              borderBottom: "1px solid var(--color-divider)"
            }}
          >
            <span className="card-meta">Current FTP</span>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>{currentFtp} W</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              padding: "var(--space-2) 0",
              borderBottom: "1px solid var(--color-divider)"
            }}
          >
            <span className="card-meta">Plan compliance</span>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>
              {dashboard?.planCompliancePercent != null ? `${dashboard.planCompliancePercent}%` : "—"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "var(--space-2) 0" }}>
            <span className="card-meta">Training block</span>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>
              {currentWeek ? `Week ${currentWeekIndex + 1} / ${weeks.length}` : "—"}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)" }}>
        <h2 style={{ margin: 0 }}>This week</h2>
      </div>
      <div className="hr" />
      {currentWeek ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 0, border: "2px solid var(--color-divider)", marginBottom: "var(--space-8)" }}>
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
                style={{
                  padding: "var(--space-3)",
                  borderRight: index < 6 ? "1px solid var(--color-divider)" : undefined,
                  background: isToday ? "var(--color-accent-100)" : "var(--color-bg)",
                  cursor: hasWorkout ? "pointer" : "default",
                  minHeight: 96,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}
              >
                <h6 style={{ margin: 0, color: isToday ? "var(--color-accent-700)" : undefined }}>
                  {dayLabels[day.dayIndex]} · {formatShortDate(cellDate)}
                </h6>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, overflowWrap: "break-word" }}>
                  {day.workoutName ?? "Rest"}
                </div>
                {hasWorkout ? (
                  <div className="card-meta">
                    {day.durationMin} min{day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted" style={{ marginBottom: "var(--space-8)" }}>
          No workouts scheduled for the current week.
        </p>
      )}

      <RecentWorkoutsSection />
    </main>
  );
};
