import type {
  FswDocument,
  FswOnPatternStep,
  FswSegment,
  FswSurges,
  WorkoutInterval
} from "@shared/ipc/contracts";

/**
 * WorkoutCompiler — resolves a portable, FTP-relative `.fsw` document into the flat
 * `WorkoutInterval[]` runtime representation the engine executes (doc §4).
 *
 * Pure, no DB. Every `power` fraction is resolved to `Math.round(fraction * ftp)`.
 */

const flat = (
  kind: WorkoutInterval["kind"],
  durationSec: number,
  targetPowerWatts: number | null,
  cadence?: number | null
): WorkoutInterval => ({
  kind,
  durationSec,
  targetPowerWatts,
  targetPowerWattsEnd: null,
  targetResistancePercent: null,
  targetCadenceRpm: cadence ?? null
});

const ramp = (
  kind: WorkoutInterval["kind"],
  durationSec: number,
  startWatts: number,
  endWatts: number,
  cadence?: number | null
): WorkoutInterval => ({
  kind,
  durationSec,
  targetPowerWatts: startWatts,
  targetPowerWattsEnd: endWatts,
  targetResistancePercent: null,
  targetCadenceRpm: cadence ?? null
});

/**
 * Slice a constant-power block into base / surge sub-intervals (doc §3.2, §4).
 * Each full window of `everySec` is [base for (everySec - surge.durationSec)] then
 * [surge for surge.durationSec] at `surge.power`. A trailing partial window
 * (< everySec) is all base. Total duration is preserved exactly.
 *
 * Mirrors `expandWithSurges` in `@shared/fsw` so the compiled workout and the
 * derived estIF/estTSS agree. The schema guarantees `everySec >= durationSec`.
 */
const applySurges = (
  blockDurationSec: number,
  basePowerWatts: number,
  baseCadence: number | null,
  surge: FswSurges,
  toWatts: (fraction: number) => number
): WorkoutInterval[] => {
  const out: WorkoutInterval[] = [];
  const surgeWatts = toWatts(surge.power);
  const baseChunkSec = Math.max(0, surge.everySec - surge.durationSec);
  let remaining = blockDurationSec;
  while (remaining >= surge.everySec) {
    if (baseChunkSec > 0) {
      out.push(flat("work", baseChunkSec, basePowerWatts, baseCadence));
    }
    out.push(flat("work", surge.durationSec, surgeWatts, baseCadence));
    remaining -= surge.everySec;
  }
  if (remaining > 0) {
    out.push(flat("work", remaining, basePowerWatts, baseCadence));
  }
  return out;
};

const onPatternDurationSec = (steps: FswOnPatternStep[]): number =>
  steps.reduce((sum, step) => sum + step.durationSec, 0);

const segmentDurationSec = (segment: FswSegment): number => {
  if (segment.type === "intervals") {
    const onSec = segment.onPattern
      ? onPatternDurationSec(segment.onPattern)
      : segment.onDurationSec ?? 0;
    const perRep = onSec + segment.offDurationSec;
    const total = perRep * segment.repeat;
    return segment.trailingRecovery ? total : total - segment.offDurationSec;
  }
  return segment.durationSec;
};

const compileSegment = (
  segment: FswSegment,
  toWatts: (fraction: number) => number
): WorkoutInterval[] => {
  switch (segment.type) {
    case "warmup":
      return [
        ramp("warmup", segment.durationSec, toWatts(segment.powerLow), toWatts(segment.powerHigh), segment.cadence)
      ];
    case "cooldown":
      return [
        ramp("cooldown", segment.durationSec, toWatts(segment.powerLow), toWatts(segment.powerHigh), segment.cadence)
      ];
    case "ramp":
      return [
        ramp("work", segment.durationSec, toWatts(segment.powerLow), toWatts(segment.powerHigh), segment.cadence)
      ];
    case "freeride":
      return [
        {
          kind: "work",
          durationSec: segment.durationSec,
          targetPowerWatts: null,
          targetPowerWattsEnd: null,
          targetResistancePercent: 0,
          targetCadenceRpm: segment.cadence ?? null
        }
      ];
    case "steady": {
      const cadence = segment.cadence ?? null;
      if (segment.surges) {
        return applySurges(segment.durationSec, toWatts(segment.power), cadence, segment.surges, toWatts);
      }
      return [flat("work", segment.durationSec, toWatts(segment.power), cadence)];
    }
    case "intervals": {
      const out: WorkoutInterval[] = [];
      const onCadence = segment.onCadence ?? segment.cadence ?? null;
      const offCadence = segment.offCadence ?? null;
      for (let rep = 0; rep < segment.repeat; rep += 1) {
        if (segment.onPattern) {
          for (const step of segment.onPattern) {
            out.push(flat("work", step.durationSec, toWatts(step.power), step.cadence ?? onCadence));
          }
        } else if (segment.surges && segment.onDurationSec != null && segment.onPower != null) {
          out.push(
            ...applySurges(
              segment.onDurationSec,
              toWatts(segment.onPower),
              onCadence,
              segment.surges,
              toWatts
            )
          );
        } else {
          // Guaranteed present by fswDocumentSchema.superRefine.
          out.push(flat("work", segment.onDurationSec ?? 0, toWatts(segment.onPower ?? 0), onCadence));
        }
        const isLastRep = rep === segment.repeat - 1;
        if (segment.offDurationSec > 0 && (!isLastRep || segment.trailingRecovery)) {
          out.push(flat("recovery", segment.offDurationSec, toWatts(segment.offPower), offCadence));
        }
      }
      return out;
    }
    default: {
      const exhaustive: never = segment;
      throw new Error(`Unknown segment type: ${JSON.stringify(exhaustive)}`);
    }
  }
};

export const compile = (document: FswDocument, ftp: number): WorkoutInterval[] => {
  if (!Number.isFinite(ftp) || ftp <= 0) {
    throw new Error(`WorkoutCompiler: ftp must be a positive number, got ${ftp}`);
  }
  const toWatts = (fraction: number): number => Math.round(fraction * ftp);

  const intervals = document.segments.flatMap((segment) => compileSegment(segment, toWatts));

  const compiledDuration = intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
  const expectedDuration = document.segments.reduce((sum, segment) => sum + segmentDurationSec(segment), 0);
  if (compiledDuration !== expectedDuration) {
    throw new Error(
      `WorkoutCompiler: compiled duration ${compiledDuration}s != sum of segment durations ${expectedDuration}s for "${document.id}"`
    );
  }

  return intervals;
};

/** Total planned duration of a document's segments, in seconds. */
export const documentDurationSec = (document: FswDocument): number =>
  document.segments.reduce((sum, segment) => sum + segmentDurationSec(segment), 0);

export { segmentDurationSec };
