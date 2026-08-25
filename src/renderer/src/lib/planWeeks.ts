import type { EventPlanWeek } from "@shared/ipc/contracts";

export const parseIsoDate = (iso: string): Date => new Date(`${iso}T00:00:00`);

export const addDaysToDate = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const formatShortDate = (date: Date): string => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const findCurrentWeekIndex = (weeks: EventPlanWeek[], today: Date): number => {
  let currentWeekIndex = -1;
  weeks.find((week, index) => {
    const start = parseIsoDate(week.startDate);
    const end = addDaysToDate(start, 7);
    const match = today >= start && today < end;
    if (match) currentWeekIndex = index;
    return match;
  });
  return currentWeekIndex;
};
