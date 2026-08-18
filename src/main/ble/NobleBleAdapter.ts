import type { BleAdapter } from "@main/ble/types";
import { FTMS_CONTROL_POINT_UUID, FTMS_SERVICE_UUID, buildFtmsProfile } from "@main/ble/ftms";
import type { BleDevice, BleFtmsProfile } from "@shared/ipc/contracts";

type NobleLike = {
  state?: string;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  startScanningAsync?: (serviceUuids?: string[], allowDuplicates?: boolean) => Promise<void>;
  stopScanningAsync?: () => Promise<void>;
};

type NoblePeripheralLike = {
  id: string;
  rssi?: number;
  advertisement?: {
    localName?: string;
  };
  connectAsync?: () => Promise<void>;
  disconnectAsync?: () => Promise<void>;
  discoverSomeServicesAndCharacteristicsAsync?: (
    serviceUuids: string[],
    characteristicUuids: string[]
  ) => Promise<{
    characteristics?: Array<{
      uuid?: string;
      writeAsync?: (data: Buffer, withoutResponse?: boolean) => Promise<void>;
    }>;
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
  private disconnectSubscribed = new Set<string>();

  async initialize(): Promise<void> {
    if (this.noble) {
      return;
    }

    const mod: unknown = await import("@abandonware/noble");
    const noble = (mod as { default?: NobleLike }).default ?? (mod as NobleLike);
    this.noble = noble;

    this.noble.on("discover", (...args: unknown[]) => {
      const peripheral = args[0] as NoblePeripheralLike;
      this.peripherals.set(peripheral.id, peripheral);
      if (!this.disconnectSubscribed.has(peripheral.id)) {
        peripheral.on?.("disconnect", () => {
          this.ftmsControlPoints.delete(peripheral.id);
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
    await this.noble.startScanningAsync?.([], true);
  }

  async stopScan(): Promise<void> {
    await this.noble?.stopScanningAsync?.();
  }

  async connect(deviceId: string): Promise<void> {
    const peripheral = this.peripherals.get(deviceId);
    if (!peripheral) {
      throw new Error(`Device not discovered: ${deviceId}`);
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
      if (normalized === FTMS_CONTROL_POINT_UUID && item.writeAsync) {
        this.ftmsControlPoints.set(deviceId, async (data: Buffer) => {
          await item.writeAsync?.(data, true);
        });
      }
      return [item.uuid];
    }) ?? [];
    return buildFtmsProfile(deviceId, characteristicUuids);
  }

  async applyErgTarget(
    deviceId: string,
    input: { targetPowerWatts: number | null; targetResistancePercent: number | null }
  ): Promise<void> {
    const writeControl = this.ftmsControlPoints.get(deviceId);
    if (!writeControl) {
      throw new Error("FTMS control point is unavailable; run FTMS discovery after connecting.");
    }
    const targetPower = Math.max(0, Math.round(input.targetPowerWatts ?? 0));
    const payload = Buffer.from([0x05, targetPower & 0xff, (targetPower >> 8) & 0xff]);
    await writeControl(payload);
  }

  async safeErgStop(deviceId: string): Promise<void> {
    await this.applyErgTarget(deviceId, { targetPowerWatts: 0, targetResistancePercent: null });
  }

  async disconnect(deviceId?: string): Promise<void> {
    if (deviceId) {
      const peripheral = this.peripherals.get(deviceId);
      await peripheral?.disconnectAsync?.();
      this.ftmsControlPoints.delete(deviceId);
      this.onDisconnectedListener?.(deviceId);
      return;
    }

    await Promise.all(
      Array.from(this.peripherals.values()).map(async (peripheral) => {
        await peripheral.disconnectAsync?.();
        this.ftmsControlPoints.delete(peripheral.id);
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
}
