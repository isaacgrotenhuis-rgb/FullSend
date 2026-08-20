export const HR_SERVICE_UUID = "180d";
export const HR_MEASUREMENT_UUID = "2a37";

export type HeartRateSample = {
  bpm: number | null;
};

export const parseHeartRateMeasurement = (data: Buffer): HeartRateSample => {
  if (data.length < 2) {
    return { bpm: null };
  }

  const flags = data.readUInt8(0);
  const bpmIsUint16 = (flags & 0x01) !== 0;

  if (bpmIsUint16) {
    if (data.length < 3) {
      return { bpm: null };
    }
    return { bpm: data.readUInt16LE(1) };
  }

  return { bpm: data.readUInt8(1) };
};
