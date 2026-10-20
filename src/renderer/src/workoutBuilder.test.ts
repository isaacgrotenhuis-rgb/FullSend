import { describe, expect, it } from "vitest";
import { deriveFswMetrics, fswDocumentSchema, type FswDocument } from "@shared/fsw";
import {
  createBlock,
  createEmptyDraft,
  documentToDraft,
  draftToDocument,
  draftWarnings,
  formatDuration,
  hasErrors,
  normalizeTag,
  parseDuration,
  parsePercent,
  previewDocument,
  slugify,
  suggestZone,
  uniqueWorkoutId,
  validateDraft,
  type WorkoutDraft
} from "./workoutBuilder";

const namedDraft = (patch: Partial<WorkoutDraft["about"]> = {}): WorkoutDraft => {
  const draft = createEmptyDraft();
  return { ...draft, about: { ...draft.about, name: "Sweet Spot 3×12", primaryZone: "sweet-spot", ...patch } };
};

describe("parseDuration / formatDuration", () => {
  it.each([
    ["4:30", 270],
    ["0:45", 45],
    ["1:05:00", 3900],
    ["10", 600],
    ["1.5", 90],
    [" 12:00 ", 720]
  ])("reads %s as %i seconds", (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(["", "abc", "4:75", "1:60:00", "1:2:3:4", "-5", "4:"])("rejects %j", (input) => {
    expect(parseDuration(input)).toBeNull();
  });

  it("round-trips through formatDuration", () => {
    for (const seconds of [5, 59, 600, 3599, 3600, 3905]) {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }
    expect(formatDuration(3905)).toBe("1:05:05");
    expect(formatDuration(270)).toBe("4:30");
  });
});

describe("parsePercent", () => {
  it("accepts plain and %-suffixed numbers", () => {
    expect(parsePercent("90")).toBe(90);
    expect(parsePercent(" 87.5% ")).toBe(87.5);
  });
  it("rejects anything else", () => {
    expect(parsePercent("")).toBeNull();
    expect(parsePercent("ninety")).toBeNull();
    expect(parsePercent("-10")).toBeNull();
  });
});

describe("ids and tags", () => {
  it("slugifies names into schema-legal ids", () => {
    expect(slugify("Sweet Spot 3×12")).toBe("sweet-spot-3-12");
    expect(slugify("  Café Over/Unders!! ")).toBe("cafe-over-unders");
  });

  it("suffixes an id that's already taken", () => {
    expect(uniqueWorkoutId("VO2 5x3", [])).toBe("vo2-5x3");
    expect(uniqueWorkoutId("VO2 5x3", ["vo2-5x3", "vo2-5x3-2"])).toBe("vo2-5x3-3");
  });

  it("normalises tags to the bank's filter format", () => {
    expect(normalizeTag("Over Unders")).toBe("over-unders");
    expect(normalizeTag("   ")).toBe("");
  });
});

describe("validateDraft", () => {
  it("accepts the starter draft once it has a name and zone", () => {
    expect(hasErrors(validateDraft(namedDraft()))).toBe(false);
  });

  it("asks for a name and a zone", () => {
    const errors = validateDraft(createEmptyDraft());
    expect(errors.about.name).toBe("Give the workout a name");
    expect(errors.about.primaryZone).toBeDefined();
  });

  it("flags bad block fields with readable messages, keyed by block", () => {
    const draft = namedDraft();
    const intervals = draft.blocks[1];
    draft.blocks[1] = { ...intervals, onPower: "900", onDuration: "4:75", repeat: "0" };
    const errors = validateDraft(draft).blocks[intervals.key];
    expect(errors).toEqual({
      onPower: "Between 20% and 300%",
      onDuration: "Use m:ss, like 4:30",
      repeat: "Whole number, 1–50"
    });
  });

  it("allows 0:00 recovery for back-to-back reps", () => {
    const draft = namedDraft();
    draft.blocks[1] = { ...draft.blocks[1], offDuration: "0:00" };
    expect(validateDraft(draft).blocks).toEqual({});
  });

  it("treats cadence as optional but checks it when given", () => {
    const draft = namedDraft();
    draft.blocks[0] = { ...draft.blocks[0], cadence: "300" };
    expect(validateDraft(draft).blocks[draft.blocks[0].key]?.cadence).toBe("Whole rpm, 40–140");
  });

  it("rejects an empty or too-short workout as a whole", () => {
    expect(validateDraft({ ...namedDraft(), blocks: [] }).form).toEqual(["Add at least one block"]);
    const short = { ...namedDraft(), blocks: [{ ...createBlock("steady"), duration: "1:00" }] };
    expect(validateDraft(short).form[0]).toMatch(/at least 5:00/);
  });
});

describe("draftToDocument", () => {
  it("builds a schema-valid document in FTP fractions and seconds", () => {
    const result = draftToDocument(namedDraft({ tags: ["ftp-builder"], phases: ["build"] }), "sweet-spot-3-12");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fswDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(result.document).toMatchObject({
      id: "sweet-spot-3-12",
      primaryZone: "sweet-spot",
      tags: ["ftp-builder"],
      phases: ["build"],
      segments: [
        { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.75 },
        { type: "intervals", repeat: 3, onDurationSec: 480, onPower: 0.9, offDurationSec: 240, offPower: 0.55 },
        { type: "cooldown", durationSec: 480, powerLow: 0.65, powerHigh: 0.45 }
      ]
    });
    // No `cadence: undefined` noise in what gets stored.
    expect(Object.keys(result.document.segments[0])).not.toContain("cadence");
  });

  it("refuses an invalid draft and returns the errors", () => {
    const result = draftToDocument(createEmptyDraft(), "x");
    expect(result.ok).toBe(false);
  });
});

describe("documentToDraft", () => {
  const seed: FswDocument = fswDocumentSchema.parse({
    schemaVersion: 1,
    id: "tempo-surges",
    name: "Tempo with surges",
    author: "Full Send",
    primaryZone: "tempo",
    tags: ["surges"],
    phases: ["base"],
    textEvents: [{ atSec: 0, message: "Settle in" }],
    segments: [
      { type: "warmup", durationSec: 600, powerLow: 0.5, powerHigh: 0.7, cadence: 90 },
      { type: "steady", durationSec: 1200, power: 0.8, surges: { everySec: 300, durationSec: 20, power: 1.2 } },
      {
        type: "intervals",
        repeat: 2,
        onPattern: [
          { durationSec: 60, power: 1.05 },
          { durationSec: 60, power: 0.9 }
        ],
        offDurationSec: 120,
        offPower: 0.5
      },
      { type: "cooldown", durationSec: 300, powerLow: 0.6, powerHigh: 0.4 }
    ]
  });

  it("round-trips a document, keeping what the builder can't edit", () => {
    const draft = documentToDraft(seed);
    expect(draft.about).toEqual({
      name: "Tempo with surges",
      description: "",
      primaryZone: "tempo",
      phases: ["base"],
      tags: ["surges"]
    });
    expect(draft.blocks[0].cadence).toBe("90");
    expect(draft.blocks[1].preserved.surges).toEqual(seed.segments[1].type === "steady" && seed.segments[1].surges);
    expect(draft.blocks[2].locked).not.toBeNull();

    const result = draftToDocument(draft, seed.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.segments).toEqual(seed.segments);
    expect(result.document.author).toBe("Full Send");
    expect(result.document.textEvents).toEqual(seed.textEvents);
    expect(deriveFswMetrics(result.document)).toEqual(deriveFswMetrics(seed));
  });
});

describe("guidance", () => {
  it("suggests the zone where the hard time is spent", () => {
    const document = previewDocument(namedDraft());
    expect(document).not.toBeNull();
    // 3 × 8:00 at 90% is sweet spot, despite more total time in the easy blocks.
    expect(suggestZone(document!)).toBe("sweet-spot");
  });

  it("has no preview while a block is invalid", () => {
    const draft = namedDraft();
    draft.blocks[0] = { ...draft.blocks[0], duration: "" };
    expect(previewDocument(draft)).toBeNull();
  });

  it("warns about a missing warm-up, an implausible effort and a zone mismatch", () => {
    const draft = namedDraft({ primaryZone: "endurance" });
    draft.blocks = draft.blocks.slice(1);
    draft.blocks[0] = { ...draft.blocks[0], onPower: "160", onDuration: "5:00" };
    const warnings = draftWarnings(draft, previewDocument(draft)!);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/no warm-up/);
    expect(warnings[1]).toMatch(/150% FTP/);
    expect(warnings[2]).toMatch(/Neuromuscular.*Endurance/);
  });
});
