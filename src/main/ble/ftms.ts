import type { BleFtmsCharacteristic, BleFtmsProfile } from "@shared/ipc/contracts";

export const FTMS_SERVICE_UUID = "1826";
export const FTMS_CONTROL_POINT_UUID = "2ad9";

type FtmsCharacteristicDescriptor = {
  key: BleFtmsCharacteristic["key"];
  uuid: string;
};

const ftmsCharacteristicDescriptors: FtmsCharacteristicDescriptor[] = [
  { key: "ftmsControlPoint", uuid: FTMS_CONTROL_POINT_UUID },
  { key: "indoorBikeData", uuid: "2ad2" },
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
