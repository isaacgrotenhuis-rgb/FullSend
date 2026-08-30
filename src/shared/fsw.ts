/**
 * Canonical `.fsw` (Full Send Workout) document schema.
 *
 * Framework-free: this module only depends on `zod` so it can be imported from
 * both the Electron main process and the renderer. See
 * `docs/workout-bank-plan.md` §3 for the format definition and
 * `docs/iceman-2026-training-plan.md` Part 5 for the seed library.
 *
 * Power values are always fractions of FTP (e.g. `0.90` = 90% FTP), never watts.
 */
import { z } from "zod";

/** FTP-fraction training zones. Boundaries live in `src/shared/zones.ts` (separate PR). */
export const FSW_PRIMARY_ZONES = [
  "recovery",
  "endurance",
  "tempo",
  "sweet-spot",
  "threshold",
  "vo2",
  "anaerobic",
  "neuromuscular"
] as const;

export const FSW_PHASES = ["base", "build", "peak", "taper"] as const;

export const fswPrimaryZoneSchema = z.enum(FSW_PRIMARY_ZONES);
export const fswPhaseSchema = z.enum(FSW_PHASES);

/** Power as a fraction of FTP. */
const powerFractionSchema = z.number().positive();
/** Whole-rpm cadence target. */
const cadenceSchema = z.number().int().positive();
/** Seconds. */
const secondsSchema = z.number().int().positive();

export const fswSurgeSchema = z.object({
  everySec: secondsSchema,
  durationSec: secondsSchema,
  power: powerFractionSchema
});

export const fswTextEventSchema = z.object({
  atSec: z.number().int().min(0),
  message: z.string().min(1)
});

const fswTextEventsSchema = z.array(fswTextEventSchema);

const rampLikeFields = {
  durationSec: secondsSchema,
  powerLow: powerFractionSchema,
  powerHigh: powerFractionSchema,
  cadence: cadenceSchema.optional(),
  textEvents: fswTextEventsSchema.optional()
};

export const fswWarmupSegmentSchema = z.object({
  type: z.literal("warmup"),
  ...rampLikeFields
});

export const fswCooldownSegmentSchema = z.object({
  type: z.literal("cooldown"),
  ...rampLikeFields
});

export const fswRampSegmentSchema = z.object({
  type: z.literal("ramp"),
  ...rampLikeFields
});

export const fswSteadySegmentSchema = z.object({
  type: z.literal("steady"),
  durationSec: secondsSchema,
  power: powerFractionSchema,
  cadence: cadenceSchema.optional(),
  surges: fswSurgeSchema.optional(),
  textEvents: fswTextEventsSchema.optional()
});

export const fswIntervalStepSchema = z.object({
  durationSec: secondsSchema,
  power: powerFractionSchema
});

export const fswIntervalsSegmentSchema = z.object({
  type: z.literal("intervals"),
  repeat: z.number().int().positive(),
  onDurationSec: secondsSchema.optional(),
  onPower: powerFractionSchema.optional(),
  onPattern: z.array(fswIntervalStepSchema).min(1).optional(),
  offDurationSec: secondsSchema,
  offPower: powerFractionSchema,
  onCadence: cadenceSchema.optional(),
  offCadence: cadenceSchema.optional(),
  surges: fswSurgeSchema.optional(),
  trailingRecovery: z.boolean().optional(),
  textEvents: fswTextEventsSchema.optional()
});

export const fswFreerideSegmentSchema = z.object({
  type: z.literal("freeride"),
  durationSec: secondsSchema,
  cadence: cadenceSchema.optional(),
  textEvents: fswTextEventsSchema.optional()
});

/**
 * A single workout segment. Discriminated on `type`; an `intervals` segment must
 * define its work interval as EITHER `onDurationSec` + `onPower` OR `onPattern`.
 */
export const fswSegmentSchema = z
  .discriminatedUnion("type", [
    fswWarmupSegmentSchema,
    fswCooldownSegmentSchema,
    fswSteadySegmentSchema,
    fswRampSegmentSchema,
    fswIntervalsSegmentSchema,
    fswFreerideSegmentSchema
  ])
  .superRefine((segment, ctx) => {
    if (segment.type !== "intervals") {
      return;
    }
    const hasScalarOn = segment.onDurationSec !== undefined && segment.onPower !== undefined;
    const hasPattern = segment.onPattern !== undefined;
    if (hasScalarOn === hasPattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "intervals segment must define exactly one of: (onDurationSec + onPower) or onPattern"
      });
    }
  });

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "id must be a lowercase slug (a-z, 0-9, hyphen)");

export const fswDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: slugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  discipline: z.string().min(1).default("cycling"),
  primaryZone: fswPrimaryZoneSchema,
  tags: z.array(z.string()),
  phases: z.array(fswPhaseSchema),
  durationSec: secondsSchema.optional(),
  estIF: z.number().positive().optional(),
  estTSS: z.number().nonnegative().optional(),
  segments: z.array(fswSegmentSchema).min(1),
  textEvents: fswTextEventsSchema.optional()
});

export type FswPrimaryZone = z.infer<typeof fswPrimaryZoneSchema>;
export type FswPhase = z.infer<typeof fswPhaseSchema>;
export type FswSurge = z.infer<typeof fswSurgeSchema>;
export type FswTextEvent = z.infer<typeof fswTextEventSchema>;
export type FswSegment = z.infer<typeof fswSegmentSchema>;
export type FswDocument = z.infer<typeof fswDocumentSchema>;

/** Parse + validate an unknown value as a `.fsw` document. Throws `ZodError` on invalid input. */
export function parseFswDocument(input: unknown): FswDocument {
  return fswDocumentSchema.parse(input);
}

export type FswDerivedMetrics = {
  durationSec: number;
  estIF: number;
  estTSS: number;
};

type TimelinePiece = {
  durationSec: number;
  /** `null` for free-ride time, which has no power target. */
  powerFraction: number | null;
};

function midpoint(low: number, high: number): number {
  return (low + high) / 2;
}

/**
 * Slice a parent block into base / surge sub-pieces. Surges overlay the block —
 * they never add time — so the emitted pieces always sum back to `totalSec`.
 */
function* expandWithSurges(
  totalSec: number,
  basePower: number,
  surges: FswSurge | undefined
): Generator<TimelinePiece> {
  if (!surges) {
    yield { durationSec: totalSec, powerFraction: basePower };
    return;
  }
  const baseChunkSec = Math.max(0, surges.everySec - surges.durationSec);
  let remainingSec = totalSec;
  while (remainingSec >= surges.everySec) {
    if (baseChunkSec > 0) {
      yield { durationSec: baseChunkSec, powerFraction: basePower };
    }
    yield { durationSec: surges.durationSec, powerFraction: surges.power };
    remainingSec -= surges.everySec;
  }
  if (remainingSec > 0) {
    yield { durationSec: remainingSec, powerFraction: basePower };
  }
}

function* expandSegment(segment: FswSegment): Generator<TimelinePiece> {
  switch (segment.type) {
    case "warmup":
    case "cooldown":
    case "ramp":
      yield {
        durationSec: segment.durationSec,
        powerFraction: midpoint(segment.powerLow, segment.powerHigh)
      };
      return;
    case "freeride":
      yield { durationSec: segment.durationSec, powerFraction: null };
      return;
    case "steady":
      yield* expandWithSurges(segment.durationSec, segment.power, segment.surges);
      return;
    case "intervals": {
      for (let rep = 0; rep < segment.repeat; rep += 1) {
        if (segment.onPattern) {
          for (const step of segment.onPattern) {
            yield { durationSec: step.durationSec, powerFraction: step.power };
          }
        } else if (segment.onDurationSec !== undefined && segment.onPower !== undefined) {
          yield* expandWithSurges(segment.onDurationSec, segment.onPower, segment.surges);
        }
        const isFinalRep = rep === segment.repeat - 1;
        if (!isFinalRep || segment.trailingRecovery === true) {
          yield { durationSec: segment.offDurationSec, powerFraction: segment.offPower };
        }
      }
      return;
    }
  }
}

/** Fully expand a document into a flat second-accurate timeline (intervals unrolled, surges overlaid). */
export function expandFswTimeline(doc: FswDocument): TimelinePiece[] {
  const pieces: TimelinePiece[] = [];
  for (const segment of doc.segments) {
    for (const piece of expandSegment(segment)) {
      pieces.push(piece);
    }
  }
  return pieces;
}

/**
 * Derive cached metrics from a document's segments.
 *
 * - `durationSec`: total time across every segment. `intervals` expand to
 *   `repeat * (onTotal + offDurationSec)`, dropping the final recovery unless
 *   `trailingRecovery` is `true`. Surges overlay and add no time.
 * - `estIF`: sqrt of the duration-weighted mean of `powerFraction^2` over the
 *   expanded timeline (surges included, ramps use their midpoint, free-ride time
 *   excluded as it carries no power target).
 * - `estTSS`: `durationSec / 3600 * estIF^2 * 100`, rounded.
 */
export function deriveFswMetrics(doc: FswDocument): FswDerivedMetrics {
  let durationSec = 0;
  let weightedSquareSum = 0;
  let poweredDurationSec = 0;
  for (const piece of expandFswTimeline(doc)) {
    durationSec += piece.durationSec;
    if (piece.powerFraction !== null) {
      weightedSquareSum += piece.durationSec * piece.powerFraction * piece.powerFraction;
      poweredDurationSec += piece.durationSec;
    }
  }
  const estIF = poweredDurationSec > 0 ? Math.sqrt(weightedSquareSum / poweredDurationSec) : 0;
  const estTSS = Math.round((durationSec / 3600) * estIF * estIF * 100);
  return { durationSec, estIF, estTSS };
}
