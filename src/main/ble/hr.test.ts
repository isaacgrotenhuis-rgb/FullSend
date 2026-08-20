import { describe, expect, it } from "vitest";
import { parseHeartRateMeasurement } from "@main/ble/hr";

describe("parseHeartRateMeasurement", () => {
  it("parses a UINT8 bpm value when flags bit 0 is unset", () => {
    const data = Buffer.from([0x00, 72]);
    expect(parseHeartRateMeasurement(data)).toEqual({ bpm: 72 });
  });

  it("parses a UINT16LE bpm value when flags bit 0 is set", () => {
    const data = Buffer.from([0x01, 0xa0, 0x00]);
    expect(parseHeartRateMeasurement(data)).toEqual({ bpm: 160 });
  });

  it("returns null bpm for a buffer too short to contain flags and value", () => {
    expect(parseHeartRateMeasurement(Buffer.from([0x00]))).toEqual({ bpm: null });
    expect(parseHeartRateMeasurement(Buffer.alloc(0))).toEqual({ bpm: null });
  });

  it("returns null bpm for a truncated UINT16 value", () => {
    expect(parseHeartRateMeasurement(Buffer.from([0x01, 0xa0]))).toEqual({ bpm: null });
  });

  it("ignores extra bytes such as energy expended or RR-interval fields", () => {
    const data = Buffer.from([0x00, 65, 0xde, 0xad, 0xbe, 0xef]);
    expect(parseHeartRateMeasurement(data)).toEqual({ bpm: 65 });
  });
});
