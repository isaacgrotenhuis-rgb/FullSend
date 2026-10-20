/**
 * Form model for the Workout Builder (create + edit a bank workout).
 *
 * The builder edits a `WorkoutDraft` — every number is kept as the string the
 * rider typed, so half-typed input ("1:", "9") never fights the form — and
 * only becomes an `.fsw` document through `draftToDocument`, after
 * `validateDraft` has passed. The final gate is the same `fswDocumentSchema`
 * the main process applies on save, so a draft the builder accepts is one the
 * bank accepts.
 *
 * Riders type power as percent of FTP and time as m:ss; the document stores
 * FTP fractions and whole seconds.
 *
 * Pure module, no React: the dialog owns the state, this owns the rules.
 */
import {
  deriveFswMetrics,
  expandFswTimeline,
  fswDocumentSchema,
  type FswDocument,
  type FswPhase,
  type FswPrimaryZone,
  type FswSegment
} from "@shared/fsw";
import { ZONES, zoneForFraction } from "@shared/zones";

export type BlockType = FswSegment["type"];

export type BlockDraft = {
  /** Stable React key; never written to the document. */
  key: string;
  type: BlockType;
  /** warmup / cooldown / ramp / steady / freeride */
  duration: string;
  /** warmup / cooldown / ramp, percent of FTP */
  powerLow: string;
  powerHigh: string;
  /** steady, percent of FTP */
  power: string;
  /** Every type but intervals; intervals use onCadence/offCadence. */
  cadence: string;
  /** intervals */
  repeat: string;
  onDuration: string;
  onPower: string;
  offDuration: string;
  offPower: string;
  onCadence: string;
  offCadence: string;
  trailingRecovery: boolean;
  /**
   * Fields the builder can't edit yet (surges, onPattern, textEvents, an
   * intervals block's fallback cadence). Carried through untouched so editing
   * or duplicating a workout that has them doesn't silently strip them.
   */
  preserved: Partial<Record<string, unknown>>;
  /** A block whose shape the builder can't edit (an onPattern intervals block): moved/deleted only. */
  locked: FswSegment | null;
};

export type AboutDraft = {
  name: string;
  description: string;
  primaryZone: FswPrimaryZone | "";
  phases: FswPhase[];
  tags: string[];
};

export type WorkoutDraft = {
  about: AboutDraft;
  blocks: BlockDraft[];
  /** Document-level fields the builder doesn't expose (author, discipline, textEvents). */
  preserved: Pick<Partial<FswDocument>, "author" | "discipline" | "textEvents">;
};

export type AboutField = keyof AboutDraft;
export type BlockField = Exclude<keyof BlockDraft, "key" | "type" | "preserved" | "locked" | "trailingRecovery">;

export type DraftErrors = {
  about: Partial<Record<AboutField, string>>;
  blocks: Record<string, Partial<Record<BlockField, string>>>;
  /** Problems with the workout as a whole (no blocks, too long, …). */
  form: string[];
};

// ---------------------------------------------------------------------------
// Limits — the friendly bounds the form enforces. All are inside what the
// .fsw schema accepts; the schema itself only demands "positive".
// ---------------------------------------------------------------------------

export const LIMITS = {
  nameMin: 3,
  nameMax: 60,
  descriptionMax: 500,
  tagsMax: 8,
  tagMax: 24,
  blocksMax: 30,
  blockMinSec: 5,
  blockMaxSec: 4 * 3600,
  offMaxSec: 3600,
  powerMinPct: 20,
  powerMaxPct: 300,
  repeatMax: 50,
  cadenceMin: 40,
  cadenceMax: 140,
  totalMinSec: 5 * 60,
  totalMaxSec: 6 * 3600
} as const;

export const BLOCK_LABELS: Record<BlockType, string> = {
  warmup: "Warm-up",
  steady: "Steady",
  intervals: "Intervals",
  ramp: "Ramp",
  freeride: "Free ride",
  cooldown: "Cool-down"
};

export const PHASE_LABELS: Record<FswPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper"
};

// ---------------------------------------------------------------------------
// Parsing + formatting
// ---------------------------------------------------------------------------

/**
 * Parse a duration the way riders write one: "m:ss", "h:mm:ss", or a bare
 * number of minutes ("10" → 600). Returns null for anything else.
 */
export const parseDuration = (input: string): number | null => {
  const text = input.trim();
  if (text === "") {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const minutes = Number(text);
    return Number.isFinite(minutes) ? Math.round(minutes * 60) : null;
  }
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  const [seconds, minutes, hours = 0] = [...numbers].reverse();
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
};

/** Seconds → "m:ss" (or "h:mm:ss" from an hour up), the format parseDuration reads back. */
export const formatDuration = (totalSec: number): string => {
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
};

/** "90", "90%", " 87.5 " → the number; null when it isn't one. */
export const parsePercent = (input: string): number | null => {
  const text = input.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return null;
  }
  return Number(text);
};

const parseWholeNumber = (input: string): number | null => {
  const text = input.trim();
  return /^\d+$/.test(text) ? Number(text) : null;
};

/** FTP fraction → the percent string the form shows (0.875 → "87.5"). */
const toPercentText = (fraction: number): string => String(Number((fraction * 100).toFixed(1)));

const optionalText = (value: number | undefined): string => (value === undefined ? "" : String(value));

/** Lowercase slug for document ids and tags: "Sweet Spot 3×12" → "sweet-spot-3-12". */
export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The slug for `name`, suffixed -2, -3, … until it isn't one of `takenIds`. */
export const uniqueWorkoutId = (name: string, takenIds: Iterable<string>): string => {
  const taken = new Set(takenIds);
  const base = slugify(name) || "workout";
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
};

/** Normalise a typed tag the way the bank's filter chips expect: "Over Unders" → "over-unders". */
export const normalizeTag = (input: string): string => slugify(input).slice(0, LIMITS.tagMax);

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

let keySeq = 0;
const nextKey = (): string => {
  keySeq += 1;
  return `block-${keySeq}`;
};

const emptyBlock = (type: BlockType): BlockDraft => ({
  key: nextKey(),
  type,
  duration: "",
  powerLow: "",
  powerHigh: "",
  power: "",
  cadence: "",
  repeat: "",
  onDuration: "",
  onPower: "",
  offDuration: "",
  offPower: "",
  onCadence: "",
  offCadence: "",
  trailingRecovery: false,
  preserved: {},
  locked: null
});

/** A new block of `type` with sensible starting values, so adding one never starts blank. */
export const createBlock = (type: BlockType): BlockDraft => {
  const block = emptyBlock(type);
  switch (type) {
    case "warmup":
      return { ...block, duration: "10:00", powerLow: "50", powerHigh: "75" };
    case "cooldown":
      return { ...block, duration: "8:00", powerLow: "65", powerHigh: "45" };
    case "ramp":
      return { ...block, duration: "5:00", powerLow: "60", powerHigh: "90" };
    case "steady":
      return { ...block, duration: "10:00", power: "70" };
    case "freeride":
      return { ...block, duration: "5:00" };
    case "intervals":
      return {
        ...block,
        repeat: "3",
        onDuration: "8:00",
        onPower: "90",
        offDuration: "4:00",
        offPower: "55"
      };
  }
};

/** A copy of `block` with a fresh key, for the Duplicate action. */
export const duplicateBlock = (block: BlockDraft): BlockDraft => ({ ...block, key: nextKey() });

/** The starting point for a new workout: most workouts are warm-up → intervals → cool-down. */
export const createEmptyDraft = (): WorkoutDraft => ({
  about: { name: "", description: "", primaryZone: "", phases: [], tags: [] },
  blocks: [createBlock("warmup"), createBlock("intervals"), createBlock("cooldown")],
  preserved: {}
});

const segmentToBlock = (segment: FswSegment): BlockDraft => {
  const block = emptyBlock(segment.type);
  const { textEvents } = segment;
  const preserved: BlockDraft["preserved"] = textEvents ? { textEvents } : {};
  switch (segment.type) {
    case "warmup":
    case "cooldown":
    case "ramp":
      return {
        ...block,
        duration: formatDuration(segment.durationSec),
        powerLow: toPercentText(segment.powerLow),
        powerHigh: toPercentText(segment.powerHigh),
        cadence: optionalText(segment.cadence),
        preserved
      };
    case "steady":
      return {
        ...block,
        duration: formatDuration(segment.durationSec),
        power: toPercentText(segment.power),
        cadence: optionalText(segment.cadence),
        preserved: segment.surges ? { ...preserved, surges: segment.surges } : preserved
      };
    case "freeride":
      return {
        ...block,
        duration: formatDuration(segment.durationSec),
        cadence: optionalText(segment.cadence),
        preserved
      };
    case "intervals": {
      if (segment.onPattern) {
        return { ...block, locked: segment };
      }
      return {
        ...block,
        repeat: String(segment.repeat),
        onDuration: formatDuration(segment.onDurationSec ?? 0),
        onPower: toPercentText(segment.onPower ?? 0),
        offDuration: formatDuration(segment.offDurationSec),
        offPower: toPercentText(segment.offPower),
        onCadence: optionalText(segment.onCadence),
        offCadence: optionalText(segment.offCadence),
        trailingRecovery: segment.trailingRecovery === true,
        preserved: {
          ...preserved,
          ...(segment.surges ? { surges: segment.surges } : {}),
          ...(segment.cadence !== undefined ? { cadence: segment.cadence } : {})
        }
      };
    }
  }
};

/** Load an existing document into the builder (Edit / Duplicate). */
export const documentToDraft = (document: FswDocument): WorkoutDraft => ({
  about: {
    name: document.name,
    description: document.description ?? "",
    primaryZone: document.primaryZone,
    phases: [...document.phases],
    tags: [...document.tags]
  },
  blocks: document.segments.map(segmentToBlock),
  preserved: {
    ...(document.author !== undefined ? { author: document.author } : {}),
    discipline: document.discipline,
    ...(document.textEvents ? { textEvents: document.textEvents } : {})
  }
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type FieldCheck = { value: number | null; error: string | null };

const checkDuration = (input: string, minSec: number, maxSec: number): FieldCheck => {
  const value = parseDuration(input);
  if (input.trim() === "") {
    return { value: null, error: "Enter a time" };
  }
  if (value === null) {
    return { value: null, error: "Use m:ss, like 4:30" };
  }
  if (value < minSec) {
    return { value, error: minSec === 0 ? "Can't be negative" : `At least ${formatDuration(minSec)}` };
  }
  if (value > maxSec) {
    return { value, error: `At most ${formatDuration(maxSec)}` };
  }
  return { value, error: null };
};

const checkPower = (input: string): FieldCheck => {
  if (input.trim() === "") {
    return { value: null, error: "Enter a % of FTP" };
  }
  const value = parsePercent(input);
  if (value === null) {
    return { value: null, error: "Enter a number, like 90" };
  }
  if (value < LIMITS.powerMinPct || value > LIMITS.powerMaxPct) {
    return { value, error: `Between ${LIMITS.powerMinPct}% and ${LIMITS.powerMaxPct}%` };
  }
  return { value, error: null };
};

/** Cadence is optional: blank is fine, anything typed must be a sensible whole rpm. */
const checkCadence = (input: string): FieldCheck => {
  if (input.trim() === "") {
    return { value: null, error: null };
  }
  const value = parseWholeNumber(input);
  if (value === null || value < LIMITS.cadenceMin || value > LIMITS.cadenceMax) {
    return { value: null, error: `Whole rpm, ${LIMITS.cadenceMin}–${LIMITS.cadenceMax}` };
  }
  return { value, error: null };
};

const blockErrors = (block: BlockDraft): Partial<Record<BlockField, string>> => {
  if (block.locked) {
    return {};
  }
  const errors: Partial<Record<BlockField, string>> = {};
  const record = (field: BlockField, check: FieldCheck): void => {
    if (check.error) {
      errors[field] = check.error;
    }
  };
  if (block.type === "intervals") {
    const repeat = parseWholeNumber(block.repeat);
    if (repeat === null || repeat < 1 || repeat > LIMITS.repeatMax) {
      errors.repeat = `Whole number, 1–${LIMITS.repeatMax}`;
    }
    record("onDuration", checkDuration(block.onDuration, LIMITS.blockMinSec, LIMITS.offMaxSec));
    record("onPower", checkPower(block.onPower));
    // 0:00 recovery is allowed: reps run back to back.
    record("offDuration", checkDuration(block.offDuration, 0, LIMITS.offMaxSec));
    record("offPower", checkPower(block.offPower));
    record("onCadence", checkCadence(block.onCadence));
    record("offCadence", checkCadence(block.offCadence));
    return errors;
  }
  record("duration", checkDuration(block.duration, LIMITS.blockMinSec, LIMITS.blockMaxSec));
  record("cadence", checkCadence(block.cadence));
  if (block.type === "steady") {
    record("power", checkPower(block.power));
  }
  if (block.type === "warmup" || block.type === "cooldown" || block.type === "ramp") {
    record("powerLow", checkPower(block.powerLow));
    record("powerHigh", checkPower(block.powerHigh));
  }
  return errors;
};

/** Field-level errors for step 1. */
export const validateAbout = (about: AboutDraft): Partial<Record<AboutField, string>> => {
  const errors: Partial<Record<AboutField, string>> = {};
  const name = about.name.trim();
  if (name.length < LIMITS.nameMin) {
    errors.name = name === "" ? "Give the workout a name" : `At least ${LIMITS.nameMin} characters`;
  } else if (name.length > LIMITS.nameMax) {
    errors.name = `At most ${LIMITS.nameMax} characters`;
  } else if (slugify(name) === "") {
    errors.name = "Include at least one letter or number";
  }
  if (about.description.trim().length > LIMITS.descriptionMax) {
    errors.description = `At most ${LIMITS.descriptionMax} characters`;
  }
  if (about.primaryZone === "") {
    errors.primaryZone = "Pick the zone this workout targets";
  }
  if (about.tags.length > LIMITS.tagsMax) {
    errors.tags = `At most ${LIMITS.tagsMax} tags`;
  }
  return errors;
};

/** Every error in the draft. `isDraftValid` is the one-line check. */
export const validateDraft = (draft: WorkoutDraft): DraftErrors => {
  const blocks: DraftErrors["blocks"] = {};
  for (const block of draft.blocks) {
    const errors = blockErrors(block);
    if (Object.keys(errors).length > 0) {
      blocks[block.key] = errors;
    }
  }
  const form: string[] = [];
  if (draft.blocks.length === 0) {
    form.push("Add at least one block");
  } else if (draft.blocks.length > LIMITS.blocksMax) {
    form.push(`At most ${LIMITS.blocksMax} blocks`);
  }
  // Total length only means something once every block parses.
  if (Object.keys(blocks).length === 0 && draft.blocks.length > 0) {
    const totalSec = deriveFswMetrics(buildDocument(draft, "draft")).durationSec;
    if (totalSec < LIMITS.totalMinSec) {
      form.push(`The workout is ${formatDuration(totalSec)}; make it at least ${formatDuration(LIMITS.totalMinSec)}`);
    } else if (totalSec > LIMITS.totalMaxSec) {
      form.push(`The workout is ${formatDuration(totalSec)}; keep it under ${formatDuration(LIMITS.totalMaxSec)}`);
    }
  }
  return { about: validateAbout(draft.about), blocks, form };
};

export const hasErrors = (errors: DraftErrors): boolean =>
  Object.keys(errors.about).length > 0 || Object.keys(errors.blocks).length > 0 || errors.form.length > 0;

// ---------------------------------------------------------------------------
// Draft → document
// ---------------------------------------------------------------------------

const fraction = (percentText: string): number => (parsePercent(percentText) ?? 0) / 100;
const seconds = (durationText: string): number => parseDuration(durationText) ?? 0;
const cadenceOrUndefined = (text: string): number | undefined => parseWholeNumber(text) ?? undefined;

/** Drop undefined keys so the stored JSON has no `"cadence": undefined` noise. */
const compact = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const blockToSegment = (block: BlockDraft): FswSegment => {
  if (block.locked) {
    return block.locked;
  }
  const preserved = block.preserved as Record<string, unknown>;
  switch (block.type) {
    case "warmup":
    case "cooldown":
    case "ramp":
      return compact({
        type: block.type,
        durationSec: seconds(block.duration),
        powerLow: fraction(block.powerLow),
        powerHigh: fraction(block.powerHigh),
        cadence: cadenceOrUndefined(block.cadence),
        ...preserved
      }) as FswSegment;
    case "steady":
      return compact({
        type: "steady",
        durationSec: seconds(block.duration),
        power: fraction(block.power),
        cadence: cadenceOrUndefined(block.cadence),
        ...preserved
      }) as FswSegment;
    case "freeride":
      return compact({
        type: "freeride",
        durationSec: seconds(block.duration),
        cadence: cadenceOrUndefined(block.cadence),
        ...preserved
      }) as FswSegment;
    case "intervals":
      return compact({
        type: "intervals",
        repeat: parseWholeNumber(block.repeat) ?? 1,
        onDurationSec: seconds(block.onDuration),
        onPower: fraction(block.onPower),
        offDurationSec: seconds(block.offDuration),
        offPower: fraction(block.offPower),
        onCadence: cadenceOrUndefined(block.onCadence),
        offCadence: cadenceOrUndefined(block.offCadence),
        trailingRecovery: block.trailingRecovery ? true : undefined,
        ...preserved
      }) as FswSegment;
  }
};

/** Assemble the document without the final schema gate. Used for live previews of a valid draft. */
const buildDocument = (draft: WorkoutDraft, id: string): FswDocument => {
  const description = draft.about.description.trim();
  return compact({
    schemaVersion: 1 as const,
    id,
    name: draft.about.name.trim(),
    description: description === "" ? undefined : description,
    author: draft.preserved.author,
    discipline: draft.preserved.discipline ?? "cycling",
    // Step 2 can run before a zone is picked; the preview doesn't care which.
    primaryZone: draft.about.primaryZone === "" ? ("endurance" as const) : draft.about.primaryZone,
    tags: draft.about.tags,
    phases: draft.about.phases,
    segments: draft.blocks.map(blockToSegment),
    textEvents: draft.preserved.textEvents
  });
};

/**
 * The document for just the blocks, for the live chart and metrics while
 * step 2 is being edited. null while any block has an error.
 */
export const previewDocument = (draft: WorkoutDraft): FswDocument | null => {
  if (draft.blocks.length === 0 || draft.blocks.some((block) => Object.keys(blockErrors(block)).length > 0)) {
    return null;
  }
  const result = fswDocumentSchema.safeParse(buildDocument(draft, "preview"));
  return result.success ? result.data : null;
};

export type DocumentResult = { ok: true; document: FswDocument } | { ok: false; errors: DraftErrors };

/**
 * The save gate: field validation first, then the exact schema the main
 * process applies. A schema issue the field checks didn't anticipate is
 * mapped back onto the block it came from where possible.
 */
export const draftToDocument = (draft: WorkoutDraft, id: string): DocumentResult => {
  const errors = validateDraft(draft);
  if (hasErrors(errors)) {
    return { ok: false, errors };
  }
  const result = fswDocumentSchema.safeParse(buildDocument(draft, id));
  if (result.success) {
    return { ok: true, document: result.data };
  }
  const schemaErrors: DraftErrors = { about: {}, blocks: {}, form: [] };
  for (const issue of result.error.issues) {
    const [root, index] = issue.path;
    const block = root === "segments" && typeof index === "number" ? draft.blocks[index] : undefined;
    if (block) {
      const label = `${BLOCK_LABELS[block.type]} (block ${Number(index) + 1})`;
      schemaErrors.form.push(`${label}: ${issue.message}`);
    } else {
      schemaErrors.form.push(issue.message);
    }
  }
  return { ok: false, errors: schemaErrors };
};

// ---------------------------------------------------------------------------
// Guidance: suggested zone + soft warnings
// ---------------------------------------------------------------------------

/** Tempo and up counts as "work" when deciding what a workout trains. */
const WORK_FLOOR = ZONES.tempo.min;

/**
 * The zone a workout trains, judged by where its hard time is spent: the zone
 * with the most time at tempo or above, or — for an all-easy ride — the zone
 * with the most time overall.
 */
export const suggestZone = (document: FswDocument): FswPrimaryZone | null => {
  const workSec = new Map<FswPrimaryZone, number>();
  const allSec = new Map<FswPrimaryZone, number>();
  for (const piece of expandFswTimeline(document)) {
    if (piece.powerFraction === null) {
      continue;
    }
    const zone = zoneForFraction(piece.powerFraction);
    allSec.set(zone, (allSec.get(zone) ?? 0) + piece.durationSec);
    if (piece.powerFraction >= WORK_FLOOR) {
      workSec.set(zone, (workSec.get(zone) ?? 0) + piece.durationSec);
    }
  }
  const pool = workSec.size > 0 ? workSec : allSec;
  let best: FswPrimaryZone | null = null;
  let bestSec = -1;
  for (const [zone, sec] of pool) {
    if (sec > bestSec) {
      best = zone;
      bestSec = sec;
    }
  }
  return best;
};

/** Non-blocking advice shown above Save. */
export const draftWarnings = (draft: WorkoutDraft, document: FswDocument): string[] => {
  const warnings: string[] = [];
  const { durationSec } = deriveFswMetrics(document);
  if (!draft.blocks.some((block) => block.type === "warmup")) {
    warnings.push("There's no warm-up. Starting hard is tough on the legs.");
  }
  if (durationSec > 3 * 3600) {
    warnings.push(`At ${formatDuration(durationSec)} this is a long session for the trainer.`);
  }
  const overreach = draft.blocks.some((block) => {
    if (block.locked || block.type !== "intervals") return false;
    return (parsePercent(block.onPower) ?? 0) > 150 && (parseDuration(block.onDuration) ?? 0) > 120;
  });
  if (overreach) {
    warnings.push("Efforts above 150% FTP rarely last more than 2 minutes. Check the interval lengths.");
  }
  const suggested = suggestZone(document);
  if (suggested && draft.about.primaryZone !== "" && suggested !== draft.about.primaryZone) {
    warnings.push(
      `Most of the work is in ${ZONES[suggested].label}, but the workout is filed under ${ZONES[draft.about.primaryZone].label}.`
    );
  }
  return warnings;
};
