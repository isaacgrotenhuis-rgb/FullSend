import { describe, expect, it } from "vitest";
import { parseIndoorBikeData } from "@main/ble/ftms";

describe("parseIndoorBikeData", () => {
  it("returns all-null fields for an empty/too-short buffer", () => {
    expect(parseIndoorBikeData(Buffer.alloc(0))).toEqual({
      speedKmh: null,
      cadenceRpm: null,
      powerWatts: null,
      distanceMeters: null
    });
  });

  it("parses speed, cadence, and power when only those flags are set", () => {
    // flags: instCadencePresent (bit2) + instPowerPresent (bit6) = 0x0044; speed present by default (bit0 unset)
    const data = Buffer.from([
      0x44, 0x00, // flags
      0xc4, 0x09, // speed: 2500 * 0.01 = 25.00 km/h
      0xaa, 0x00, // cadence: 170 * 0.5 = 85 rpm
      0xbb, 0x00 // power: 187 W
    ]);
    expect(parseIndoorBikeData(data)).toEqual({
      speedKmh: 25,
      cadenceRpm: 85,
      powerWatts: 187,
      distanceMeters: null
    });
  });

  it("parses total distance when the totalDistancePresent flag is set", () => {
    // flags: instCadencePresent (bit2) + totalDistancePresent (bit4) + instPowerPresent (bit6) = 0x0054
    const data = Buffer.from([
      0x54, 0x00, // flags
      0xc4, 0x09, // speed: 25.00 km/h
      0xaa, 0x00, // cadence: 85 rpm
      0xd2, 0x04, 0x00, // distance: 1234 meters (uint24 LE)
      0xbb, 0x00 // power: 187 W
    ]);
    expect(parseIndoorBikeData(data)).toEqual({
      speedKmh: 25,
      cadenceRpm: 85,
      powerWatts: 187,
      distanceMeters: 1234
    });
  });

  it("leaves distanceMeters null when the buffer is truncated mid-distance-field", () => {
    // flags claim totalDistancePresent, but only 1 of the 3 distance bytes actually follows
    const data = Buffer.from([0x10, 0x00, 0xff]);
    expect(parseIndoorBikeData(data).distanceMeters).toBeNull();
  });
});
