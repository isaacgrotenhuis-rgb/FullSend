import { describe, expect, it } from "vitest";
import { BleService } from "@main/ble/BleService";
import type { BleAdapter } from "@main/ble/types";
import type { BleDevice, BleFtmsProfile, BleHeartRateSample, BleLiveTelemetry } from "@shared/ipc/contracts";

const createDeferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

class FakeBleAdapter implements BleAdapter {
  connectDelays = new Map<string, Promise<void>>();

  private deviceDiscoveredListener: ((device: BleDevice) => void) | null = null;
  private disconnectedListener: ((deviceId: string) => void) | null = null;
  private liveTelemetryListener: ((deviceId: string, sample: BleLiveTelemetry) => void) | null = null;
  private heartRateTelemetryListener: ((deviceId: string, sample: BleHeartRateSample) => void) | null = null;

  async initialize(): Promise<void> {}
  async startScan(): Promise<void> {}
  async stopScan(): Promise<void> {}
  listDiscoveredDevices(): BleDevice[] {
    return [];
  }

  connect(deviceId: string): Promise<void> {
    return this.connectDelays.get(deviceId) ?? Promise.resolve();
  }

  async disconnect(): Promise<void> {}

  async discoverFtmsCharacteristics(deviceId: string): Promise<BleFtmsProfile> {
    return {
      deviceId,
      serviceUuid: "1826",
      characteristics: [],
      ergControlAvailable: false,
      discoveredAt: new Date().toISOString()
    };
  }

  async applyErgTarget(): Promise<void> {}
  async safeErgStop(): Promise<void> {}
  async requestControl(): Promise<void> {}
  async startOrResume(): Promise<void> {}
  async stopOrPause(): Promise<void> {}
  async discoverHeartRateCharacteristics(): Promise<void> {}

  onDeviceDiscovered(listener: (device: BleDevice) => void): void {
    this.deviceDiscoveredListener = listener;
  }

  onDisconnected(listener: (deviceId: string) => void): void {
    this.disconnectedListener = listener;
  }

  onError(): void {}

  onLiveTelemetry(listener: (deviceId: string, sample: BleLiveTelemetry) => void): void {
    this.liveTelemetryListener = listener;
  }

  onHeartRateTelemetry(listener: (deviceId: string, sample: BleHeartRateSample) => void): void {
    this.heartRateTelemetryListener = listener;
  }

  emitDiscovered(device: BleDevice): void {
    this.deviceDiscoveredListener?.(device);
  }

  emitDisconnected(deviceId: string): void {
    this.disconnectedListener?.(deviceId);
  }

  emitLiveTelemetry(deviceId: string, sample: BleLiveTelemetry): void {
    this.liveTelemetryListener?.(deviceId, sample);
  }

  emitHeartRateTelemetry(deviceId: string, sample: BleHeartRateSample): void {
    this.heartRateTelemetryListener?.(deviceId, sample);
  }
}

const TRAINER_ID = "trainer-1";
const HR_ID = "hr-1";

describe("BleService concurrent trainer + heart rate connections", () => {
  it("does not strand either device when connects overlap in flight", async () => {
    const adapter = new FakeBleAdapter();
    const trainerDeferred = createDeferred<void>();
    const hrDeferred = createDeferred<void>();
    adapter.connectDelays.set(TRAINER_ID, trainerDeferred.promise);
    adapter.connectDelays.set(HR_ID, hrDeferred.promise);

    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, kind: "trainer" });
    adapter.emitDiscovered({ id: HR_ID, kind: "heart_rate" });

    const trainerConnect = service.connect(TRAINER_ID);
    const hrConnect = service.connect(HR_ID);

    hrDeferred.resolve();
    trainerDeferred.resolve();
    await Promise.all([trainerConnect, hrConnect]);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.hrLifecycle).toBe("connected");
    expect(state.connectedHrDeviceId).toBe(HR_ID);
  });

  it("leaves the trainer connection and live telemetry untouched when only the heart rate device disconnects", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, kind: "trainer" });
    adapter.emitDiscovered({ id: HR_ID, kind: "heart_rate" });

    await service.connect(TRAINER_ID);
    await service.connect(HR_ID);

    const telemetry: BleLiveTelemetry = { powerWatts: 220, cadenceRpm: 90, timestamp: new Date().toISOString() };
    adapter.emitLiveTelemetry(TRAINER_ID, telemetry);

    await service.disconnect(HR_ID);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.liveTelemetry).toEqual(telemetry);
    expect(state.hrLifecycle).toBe("disconnected");
    expect(state.connectedHrDeviceId).toBeNull();
  });

  it("does not let heart rate telemetry clobber the trainer's live telemetry", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, kind: "trainer" });
    adapter.emitDiscovered({ id: HR_ID, kind: "heart_rate" });

    await service.connect(TRAINER_ID);
    await service.connect(HR_ID);

    const telemetry: BleLiveTelemetry = { powerWatts: 180, cadenceRpm: 85, timestamp: new Date().toISOString() };
    adapter.emitLiveTelemetry(TRAINER_ID, telemetry);
    adapter.emitHeartRateTelemetry(HR_ID, { bpm: 142, timestamp: new Date().toISOString() });

    const state = service.getState();
    expect(state.liveTelemetry).toEqual(telemetry);
    expect(state.heartRate?.bpm).toBe(142);
  });

  it("does not trip the trainer's disconnect handling when the heart rate device drops unexpectedly", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, kind: "trainer" });
    adapter.emitDiscovered({ id: HR_ID, kind: "heart_rate" });

    await service.connect(TRAINER_ID);
    await service.connect(HR_ID);

    adapter.emitDisconnected(HR_ID);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.hrLifecycle).toBe("disconnected");
    expect(state.connectedHrDeviceId).toBeNull();
    expect(state.hrLastError).toBe("BLE signal lost; disconnected");
  });
});
