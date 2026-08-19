import type { BleFtmsCharacteristic, BleFtmsProfile } from "@shared/ipc/contracts";

export const FTMS_SERVICE_UUID = "1826";
export const FTMS_CONTROL_POINT_UUID = "2ad9";
export const FTMS_INDOOR_BIKE_DATA_UUID = "2ad2";

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
};

export const parseIndoorBikeData = (data: Buffer): IndoorBikeSample => {
  const sample: IndoorBikeSample = { speedKmh: null, cadenceRpm: null, powerWatts: null };
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
