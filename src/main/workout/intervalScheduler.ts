import type { WorkoutInterval } from "@shared/ipc/contracts";

export type IntervalCursor = {
  index: number;
  interval: WorkoutInterval;
  elapsedInIntervalSec: number;
  remainingInIntervalSec: number;
};

export class IntervalScheduler {
  private readonly intervals: WorkoutInterval[];
  private readonly cumulativeDurations: number[];
  private readonly totalDurationSec: number;

  constructor(intervals: WorkoutInterval[]) {
    this.intervals = intervals;
    this.cumulativeDurations = [];
    let total = 0;
    for (const interval of intervals) {
      total += interval.durationSec;
      this.cumulativeDurations.push(total);
    }
    this.totalDurationSec = total;
  }

  getTotalDurationSec(): number {
    return this.totalDurationSec;
  }

  locate(elapsedSec: number): IntervalCursor | null {
    if (elapsedSec < 0 || elapsedSec >= this.totalDurationSec) {
      return null;
    }

    for (let index = 0; index < this.cumulativeDurations.length; index += 1) {
      const rangeEnd = this.cumulativeDurations[index];
      if (elapsedSec < rangeEnd) {
        const interval = this.intervals[index];
        const rangeStart = rangeEnd - interval.durationSec;
        const elapsedInIntervalSec = elapsedSec - rangeStart;
        return {
          index,
          interval,
          elapsedInIntervalSec,
          remainingInIntervalSec: interval.durationSec - elapsedInIntervalSec
        };
      }
    }

    return null;
  }
}
