import type { BleFtmsCharacteristic, BleFtmsProfile } from "@shared/ipc/contracts";

export const FTMS_SERVICE_UUID = "1826";
export const FTMS_CONTROL_POINT_UUID = "2ad9";
export const FTMS_INDOOR_BIKE_DATA_UUID = "2ad2";
export const FTMS_CONTROL_POINT_RESPONSE_OPCODE = 0x80;

type FtmsCharacteristicDescriptor = {
  key: BleFtmsCharacteristic["key"];
  uuid: string;
};

const ftmsCharacteristicDescriptors: FtmsCharacteristicDescriptor[] = [
  { key: "ftmsControlPoint", uuid: FTMS_CONTROL_POINT_UUID },
  { key: "indoorBikeData", uuid: FTMS_INDOOR_BIKE_DATA_UUID },
  { key: "fitnessMachineStatus", uuid: "2ada" },
  { key: "supportedPowerRange", uuid: "2ad8" }
];

const normalizeUuid = (value: string): string => value.toLowerCase().replace(/-/g, "");

export const buildFtmsProfile = (deviceId: string, discoveredCharacteristicUuids: string[]): BleFtmsProfile => {
  const discovered = new Set(discoveredCharacteristicUuids.map(normalizeUuid));
  const characteristics: BleFtmsCharacteristic[] = ftmsCharacteristicDescriptors.map((descriptor) => ({
    key: descriptor.key,
    uuid: descriptor.uuid,
    discovered: discovered.has(normalizeUuid(descriptor.uuid))
  }));

  return {
    deviceId,
    serviceUuid: FTMS_SERVICE_UUID,
    characteristics,
    ergControlAvailable: characteristics.some((item) => item.key === "ftmsControlPoint" && item.discovered),
    discoveredAt: new Date().toISOString()
  };
};

export type IndoorBikeSample = {
  speedKmh: number | null;
  cadenceRpm: number | null;
  powerWatts: number | null;
  distanceMeters: number | null;
};

export const parseIndoorBikeData = (data: Buffer): IndoorBikeSample => {
  const sample: IndoorBikeSample = { speedKmh: null, cadenceRpm: null, powerWatts: null, distanceMeters: null };
  if (data.length < 2) {
    return sample;
  }

  const flags = data.readUInt16LE(0);
  let offset = 2;

  const speedAbsent = (flags & 0x0001) !== 0;
  const avgSpeedPresent = (flags & 0x0002) !== 0;
  const instCadencePresent = (flags & 0x0004) !== 0;
  const avgCadencePresent = (flags & 0x0008) !== 0;
  const totalDistancePresent = (flags & 0x0010) !== 0;
  const resistancePresent = (flags & 0x0020) !== 0;
  const instPowerPresent = (flags & 0x0040) !== 0;

  if (!speedAbsent) {
    if (offset + 2 <= data.length) {
      sample.speedKmh = data.readUInt16LE(offset) * 0.01;
    }
    offset += 2;
  }
  if (avgSpeedPresent) {
    offset += 2;
  }
  if (instCadencePresent) {
    if (offset + 2 <= data.length) {
      sample.cadenceRpm = data.readUInt16LE(offset) * 0.5;
    }
    offset += 2;
  }
  if (avgCadencePresent) {
    offset += 2;
  }
  if (totalDistancePresent) {
    if (offset + 3 <= data.length) {
      sample.distanceMeters = data.readUIntLE(offset, 3);
    }
    offset += 3;
  }
  if (resistancePresent) {
    offset += 2;
  }
  if (instPowerPresent && offset + 2 <= data.length) {
    sample.powerWatts = data.readInt16LE(offset);
  }

  return sample;
};

const controlPointOpcodeNames: Record<number, string> = {
  0x00: "Request Control",
  0x01: "Reset",
  0x04: "Set Target Resistance Level",
  0x05: "Set Target Power",
  0x07: "Start or Resume",
  0x08: "Stop or Pause"
};

const controlPointResultNames: Record<number, string> = {
  0x01: "Success",
  0x02: "Op Code Not Supported",
  0x03: "Invalid Parameter",
  0x04: "Operation Failed",
  0x05: "Control Not Permitted"
};

export type ControlPointResponse = {
  requestOpCode: number;
  requestOpCodeName: string;
  resultCode: number;
  resultCodeName: string;
};

export const parseControlPointResponse = (data: Buffer): ControlPointResponse | null => {
  if (data.length < 3 || data.readUInt8(0) !== FTMS_CONTROL_POINT_RESPONSE_OPCODE) {
    return null;
  }
  const requestOpCode = data.readUInt8(1);
  const resultCode = data.readUInt8(2);
  return {
    requestOpCode,
    requestOpCodeName: controlPointOpcodeNames[requestOpCode] ?? `Unknown (0x${requestOpCode.toString(16)})`,
    resultCode,
    resultCodeName: controlPointResultNames[resultCode] ?? `Unknown (0x${resultCode.toString(16)})`
  };
};
