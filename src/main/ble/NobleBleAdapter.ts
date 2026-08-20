import type { BleAdapter } from "@main/ble/types";
import {
  FTMS_CONTROL_POINT_UUID,
  FTMS_INDOOR_BIKE_DATA_UUID,
  FTMS_SERVICE_UUID,
  buildFtmsProfile,
  parseControlPointResponse,
  parseIndoorBikeData
} from "@main/ble/ftms";
import type { BleDevice, BleFtmsProfile, BleLiveTelemetry } from "@shared/ipc/contracts";

type NobleLike = {
  state?: string;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  startScanningAsync?: (serviceUuids?: string[], allowDuplicates?: boolean) => Promise<void>;
  stopScanningAsync?: () => Promise<void>;
};

type NobleCharacteristicLike = {
  uuid?: string;
  properties?: string[];
  writeAsync?: (data: Buffer, withoutResponse?: boolean) => Promise<void>;
  subscribeAsync?: () => Promise<void>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type NoblePeripheralLike = {
  id: string;
  rssi?: number;
  state?: string;
  advertisement?: {
    localName?: string;
  };
  connectAsync?: () => Promise<void>;
  disconnectAsync?: () => Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync?: (
    serviceUuids: string[],
    characteristicUuids: string[]
  ) => Promise<{
    characteristics?: NobleCharacteristicLike[];
  }>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export class NobleBleAdapter implements BleAdapter {
  private noble: NobleLike | null = null;
  private peripherals = new Map<string, NoblePeripheralLike>();
  private ftmsControlPoints = new Map<string, (data: Buffer) => Promise<void>>();
  private onDeviceDiscoveredListener: ((device: BleDevice) => void) | null = null;
  private onDisconnectedListener: ((deviceId: string) => void) | null = null;
  private onErrorListener: ((error: Error) => void) | null = null;
  private onLiveTelemetryListener: ((deviceId: string, sample: BleLiveTelemetry) => void) | null = null;
  private disconnectSubscribed = new Set<string>();
  private indoorBikeDataSubscribed = new Set<string>();
  private controlPointResponseSubscribed = new Set<string>();

  async initialize(): Promise<void> {
    if (this.noble) {
      return;
    }

    const mod: unknown = await import("@abandonware/noble");
    const noble = (mod as { default?: NobleLike }).default ?? (mod as NobleLike);
    this.noble = noble;

    this.noble.on("stateChange", (...args: unknown[]) => {
      const state = args[0] as string | undefined;
      if (state && state !== "poweredOn") {
        this.onErrorListener?.(new Error(`Bluetooth adapter state: ${state}`));
      }
    });

    this.noble.on("warning", (...args: unknown[]) => {
      const message = args[0] as string | undefined;
      this.onErrorListener?.(new Error(message ?? "Unknown BLE adapter warning"));
    });

    this.noble.on("error", (...args: unknown[]) => {
      const error = args[0];
      this.onErrorListener?.(error instanceof Error ? error : new Error(String(error)));
    });

    this.noble.on("discover", (...args: unknown[]) => {
      const peripheral = args[0] as NoblePeripheralLike;
      this.peripherals.set(peripheral.id, peripheral);
      if (!this.disconnectSubscribed.has(peripheral.id)) {
        peripheral.on?.("disconnect", () => {
          this.ftmsControlPoints.delete(peripheral.id);
          this.indoorBikeDataSubscribed.delete(peripheral.id);
          this.controlPointResponseSubscribed.delete(peripheral.id);
          this.onDisconnectedListener?.(peripheral.id);
        });
        this.disconnectSubscribed.add(peripheral.id);
      }
      this.onDeviceDiscoveredListener?.({
        id: peripheral.id,
        name: peripheral.advertisement?.localName,
        localName: peripheral.advertisement?.localName,
        rssi: peripheral.rssi
      });
    });
  }

  async startScan(): Promise<void> {
    if (!this.noble) {
      throw new Error("BLE adapter is not initialized");
    }
    await this.noble.startScanningAsync?.([FTMS_SERVICE_UUID], true);
  }

  async stopScan(): Promise<void> {
    await this.noble?.stopScanningAsync?.();
  }

  async connect(deviceId: string): Promise<void> {
    const peripheral = this.peripherals.get(deviceId);
    if (!peripheral) {
      throw new Error(`Device not discovered: ${deviceId}`);
    }
    if (peripheral.state === "connected") {
      return;
    }
    await peripheral.connectAsync?.();
  }

  listDiscoveredDevices(): BleDevice[] {
    return Array.from(this.peripherals.values()).map((peripheral) => ({
      id: peripheral.id,
      name: peripheral.advertisement?.localName,
      localName: peripheral.advertisement?.localName,
      rssi: peripheral.rssi
    }));
  }

  async discoverFtmsCharacteristics(deviceId: string): Promise<BleFtmsProfile> {
    const peripheral = this.peripherals.get(deviceId);
    if (!peripheral) {
      throw new Error(`Device not discovered: ${deviceId}`);
    }

    const discovery = await peripheral.discoverSomeServicesAndCharacteristicsAsync?.([FTMS_SERVICE_UUID], []);
    const characteristicUuids = discovery?.characteristics?.flatMap((item) => {
      if (!item.uuid) {
        return [];
      }
      const normalized = item.uuid.toLowerCase();
      if (normalized === FTMS_CONTROL_POINT_UUID) {
        if (item.writeAsync) {
          this.ftmsControlPoints.set(deviceId, async (data: Buffer) => {
            await item.writeAsync?.(data, false);
          });
        }
        if (
          (item.properties?.includes("indicate") || item.properties?.includes("notify")) &&
          !this.controlPointResponseSubscribed.has(deviceId)
        ) {
          this.controlPointResponseSubscribed.add(deviceId);
          void this.subscribeControlPointResponses(deviceId, item);
        }
      }
      if (
        normalized === FTMS_INDOOR_BIKE_DATA_UUID &&
        item.properties?.includes("notify") &&
        !this.indoorBikeDataSubscribed.has(deviceId)
      ) {
        this.indoorBikeDataSubscribed.add(deviceId);
        void this.subscribeIndoorBikeData(deviceId, item);
      }
      return [item.uuid];
    }) ?? [];
    return buildFtmsProfile(deviceId, characteristicUuids);
  }

  private async subscribeIndoorBikeData(deviceId: string, characteristic: NobleCharacteristicLike): Promise<void> {
    try {
      characteristic.on?.("data", (...args: unknown[]) => {
        const data = args[0] as Buffer;
        const isNotification = args[1] as boolean | undefined;
        if (!isNotification || !Buffer.isBuffer(data)) {
          return;
        }
        const sample = parseIndoorBikeData(data);
        this.onLiveTelemetryListener?.(deviceId, {
          powerWatts: sample.powerWatts,
          cadenceRpm: sample.cadenceRpm,
          timestamp: new Date().toISOString()
        });
      });
      await characteristic.subscribeAsync?.();
    } catch (error) {
      this.indoorBikeDataSubscribed.delete(deviceId);
      console.error(`[NobleBleAdapter] indoor bike data subscribe failed for device ${deviceId}:`, error);
    }
  }

  private async subscribeControlPointResponses(deviceId: string, characteristic: NobleCharacteristicLike): Promise<void> {
    try {
      characteristic.on?.("data", (...args: unknown[]) => {
        const data = args[0] as Buffer;
        const isNotification = args[1] as boolean | undefined;
        if (!isNotification || !Buffer.isBuffer(data)) {
          return;
        }
        const response = parseControlPointResponse(data);
        if (!response) {
          console.warn(
            `[NobleBleAdapter] unrecognized FTMS control point response for device ${deviceId}: ${data.toString("hex")}`
          );
          return;
        }
        if (response.resultCode !== 0x01) {
          console.error(
            `[NobleBleAdapter] FTMS control point response for device ${deviceId}: ${response.requestOpCodeName} -> ${response.resultCodeName}`
          );
        }
      });
      await characteristic.subscribeAsync?.();
    } catch (error) {
      this.controlPointResponseSubscribed.delete(deviceId);
      console.error(`[NobleBleAdapter] control point response subscribe failed for device ${deviceId}:`, error);
    }
  }

  private async writeControlPoint(deviceId: string, payload: Buffer): Promise<void> {
    const writeControl = this.ftmsControlPoints.get(deviceId);
    if (!writeControl) {
      throw new Error("FTMS control point is unavailable; run FTMS discovery after connecting.");
    }
    await writeControl(payload);
  }

  async applyErgTarget(
    deviceId: string,
    input: { targetPowerWatts: number | null; targetResistancePercent: number | null }
  ): Promise<void> {
    if (input.targetPowerWatts !== null) {
      const targetPower = Math.max(0, Math.round(input.targetPowerWatts));
      await this.writeControlPoint(deviceId, Buffer.from([0x05, targetPower & 0xff, (targetPower >> 8) & 0xff]));
      return;
    }
    if (input.targetResistancePercent !== null) {
      // FTMS Set Target Resistance Level (0x04): sint16, resolution 0.1 (unitless level).
      const targetResistance = Math.round(Math.min(100, Math.max(0, input.targetResistancePercent)) * 10);
      await this.writeControlPoint(
        deviceId,
        Buffer.from([0x04, targetResistance & 0xff, (targetResistance >> 8) & 0xff])
      );
      return;
    }
    await this.writeControlPoint(deviceId, Buffer.from([0x05, 0x00, 0x00]));
  }

  async safeErgStop(deviceId: string): Promise<void> {
    await this.stopOrPause(deviceId, "stop");
  }

  async requestControl(deviceId: string): Promise<void> {
    await this.writeControlPoint(deviceId, Buffer.from([0x00]));
  }

  async startOrResume(deviceId: string): Promise<void> {
    await this.writeControlPoint(deviceId, Buffer.from([0x07]));
  }

  async stopOrPause(deviceId: string, mode: "stop" | "pause"): Promise<void> {
    await this.writeControlPoint(deviceId, Buffer.from([0x08, mode === "stop" ? 0x01 : 0x02]));
  }

  async disconnect(deviceId?: string): Promise<void> {
    if (deviceId) {
      const peripheral = this.peripherals.get(deviceId);
      await peripheral?.disconnectAsync?.();
      this.ftmsControlPoints.delete(deviceId);
      this.indoorBikeDataSubscribed.delete(deviceId);
      this.controlPointResponseSubscribed.delete(deviceId);
      this.onDisconnectedListener?.(deviceId);
      return;
    }

    await Promise.all(
      Array.from(this.peripherals.values()).map(async (peripheral) => {
        await peripheral.disconnectAsync?.();
        this.ftmsControlPoints.delete(peripheral.id);
        this.indoorBikeDataSubscribed.delete(peripheral.id);
        this.controlPointResponseSubscribed.delete(peripheral.id);
        this.onDisconnectedListener?.(peripheral.id);
      })
    );
  }

  onDeviceDiscovered(listener: (device: BleDevice) => void): void {
    this.onDeviceDiscoveredListener = listener;
  }

  onDisconnected(listener: (deviceId: string) => void): void {
    this.onDisconnectedListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.onErrorListener = listener;
  }

  onLiveTelemetry(listener: (deviceId: string, sample: BleLiveTelemetry) => void): void {
    this.onLiveTelemetryListener = listener;
  }
}
