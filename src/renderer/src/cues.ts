import type { WorkoutInterval } from "@shared/ipc/contracts";
import { HR_CAP_TOKEN } from "@shared/fitnessTestProtocol";

/** How long a cue stays on screen after its moment. */
export const CUE_VISIBLE_SEC = 10;

/**
 * The interval cue showing at a workout position: the latest cue in the current
 * interval whose moment is at most CUE_VISIBLE_SEC behind. Positional rather
 * than event-driven, so it follows seeks and comes back after a pause.
 */
export const activeCueAt = (intervals: WorkoutInterval[], positionSec: number): string | null => {
  let startSec = 0;
  for (const interval of intervals) {
    const endSec = startSec + interval.durationSec;
    if (positionSec < endSec) {
      const intoSec = positionSec - startSec;
      const showing = (interval.cues ?? []).filter((cue) => intoSec >= cue.atSec && intoSec < cue.atSec + CUE_VISIBLE_SEC);
      return showing.length > 0 ? showing[showing.length - 1].message : null;
    }
    startSec = endSec;
  }
  return null;
};

/** Fill the live HR cap into a cue (before the ramp sets it, refer to it generically). */
export const fillCue = (message: string, hrCapBpm: number | null): string =>
  message.replaceAll(`${HR_CAP_TOKEN} bpm`, hrCapBpm !== null ? `${hrCapBpm} bpm` : "the cap set by your ramp");
