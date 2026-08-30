import type { WorkoutInterval } from "@shared/ipc/contracts";

export type IntervalCursor = {
  index: number;
  interval: WorkoutInterval;
  elapsedInIntervalSec: number;
  remainingInIntervalSec: number;
  /**
   * Power target resolved for this instant. For a ramp interval
   * (`targetPowerWattsEnd != null`) this is the linear interpolation between
   * start and end across the interval; for a flat block it is `targetPowerWatts`.
   * `null` when the interval has no power target (e.g. free-ride).
   */
  targetPowerWatts: number | null;
};

const resolveTargetPowerWatts = (
  interval: WorkoutInterval,
  elapsedInIntervalSec: number
): number | null => {
  const start = interval.targetPowerWatts;
  if (start === null || start === undefined) {
    return null;
  }
  const end = interval.targetPowerWattsEnd;
  if (end === null || end === undefined) {
    return start;
  }
  const progress =
    interval.durationSec > 0
      ? Math.min(1, Math.max(0, elapsedInIntervalSec / interval.durationSec))
      : 0;
  return start + (end - start) * progress;
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
          remainingInIntervalSec: interval.durationSec - elapsedInIntervalSec,
          targetPowerWatts: resolveTargetPowerWatts(interval, elapsedInIntervalSec)
        };
      }
    }

    return null;
  }
}
