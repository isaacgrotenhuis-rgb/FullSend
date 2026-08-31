import { describe, expect, it } from "vitest";
import { BleService } from "@main/ble/BleService";
import { BleRoleServiceNotFoundError, type BleAdapter } from "@main/ble/types";
import type { BleDevice, BleFtmsProfile, BleHeartRateSample, BleLiveTelemetry, BleRole } from "@shared/ipc/contracts";

const createDeferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

class FakeBleAdapter implements BleAdapter {
  connectDelays = new Map<string, Promise<void>>();
  disconnectDelays = new Map<string, Promise<void>>();
  missingRoleServices = new Map<string, BleRole[]>();
  disconnectedDeviceIds: string[] = [];

  private deviceDiscoveredListener: ((device: BleDevice) => void) | null = null;
  private disconnectedListener: ((deviceId: string) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;
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

  async disconnect(deviceId?: string): Promise<void> {
    if (deviceId) {
      this.disconnectedDeviceIds.push(deviceId);
      await (this.disconnectDelays.get(deviceId) ?? Promise.resolve());
    }
  }

  private async checkRoleService(deviceId: string, role: BleRole): Promise<void> {
    if (this.missingRoleServices.get(deviceId)?.includes(role)) {
      throw new BleRoleServiceNotFoundError(deviceId, role);
    }
  }

  async discoverFtmsCharacteristics(deviceId: string): Promise<BleFtmsProfile> {
    await this.checkRoleService(deviceId, "power");
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

  async discoverHeartRateCharacteristics(deviceId: string): Promise<void> {
    await this.checkRoleService(deviceId, "heart_rate");
  }

  async discoverCadenceCharacteristics(deviceId: string): Promise<void> {
    await this.checkRoleService(deviceId, "cadence");
  }

  onDeviceDiscovered(listener: (device: BleDevice) => void): void {
    this.deviceDiscoveredListener = listener;
  }

  onDisconnected(listener: (deviceId: string) => void): void {
    this.disconnectedListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

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

  emitError(error: Error): void {
    this.errorListener?.(error);
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
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power", "cadence"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    const trainerConnect = service.connect(TRAINER_ID, "power");
    const hrConnect = service.connect(HR_ID, "heart_rate");

    hrDeferred.resolve();
    trainerDeferred.resolve();
    await Promise.all([trainerConnect, hrConnect]);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.connections.heart_rate.lifecycle).toBe("connected");
    expect(state.connections.heart_rate.connectedDeviceId).toBe(HR_ID);
  });

  it("leaves the trainer connection and live telemetry untouched when only the heart rate device disconnects", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power", "cadence"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    const telemetry: BleLiveTelemetry = { powerWatts: 220, cadenceRpm: 90, speedKmh: 32, distanceMeters: null, timestamp: new Date().toISOString() };
    adapter.emitLiveTelemetry(TRAINER_ID, telemetry);

    await service.disconnect(HR_ID);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.liveTelemetry).toEqual(telemetry);
    expect(state.connections.heart_rate.lifecycle).toBe("disconnected");
    expect(state.connections.heart_rate.connectedDeviceId).toBeNull();
  });

  it("does not let heart rate telemetry clobber the trainer's live telemetry", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power", "cadence"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    const telemetry: BleLiveTelemetry = { powerWatts: 180, cadenceRpm: 85, speedKmh: 28, distanceMeters: null, timestamp: new Date().toISOString() };
    adapter.emitLiveTelemetry(TRAINER_ID, telemetry);
    adapter.emitHeartRateTelemetry(HR_ID, { bpm: 142, timestamp: new Date().toISOString() });

    const state = service.getState();
    expect(state.liveTelemetry).toEqual(telemetry);
    expect(state.heartRate?.bpm).toBe(142);
  });

  it("does not trip the trainer's disconnect handling when the heart rate device drops unexpectedly", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power", "cadence"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    adapter.emitDisconnected(HR_ID);

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.connections.heart_rate.lifecycle).toBe("disconnected");
    expect(state.connections.heart_rate.connectedDeviceId).toBeNull();
    expect(state.connections.heart_rate.lastError).toBe("BLE signal lost; disconnected");
  });

  it("sets the heart rate connection lifecycle to error when the adapter errors while only the heart rate device is connected", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    await service.connect(HR_ID, "heart_rate");

    adapter.emitError(new Error("adapter lost"));

    const state = service.getState();
    expect(state.connections.heart_rate.lifecycle).toBe("error");
    expect(state.connections.heart_rate.lastError).toBe("adapter lost");
    expect(state.connections.heart_rate.connectedDeviceId).toBe(HR_ID);
  });
});

describe("BleService cadence role", () => {
  const CADENCE_ID = "cadence-1";
  const DUAL_ID = "dual-1";
  const AMBIGUOUS_ID = "ambiguous-1";

  it("connects a cadence-only device under the cadence role", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: CADENCE_ID, roles: ["cadence"] });

    await service.connect(CADENCE_ID, "cadence");

    const state = service.getState();
    expect(state.connections.cadence).toEqual({
      lifecycle: "connected",
      connectedDeviceId: CADENCE_ID,
      lastError: null
    });
  });

  it("does not auto-attach the cadence role when a dual power+cadence peripheral connects as power, but both roles can coexist", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: DUAL_ID, roles: ["power", "cadence"] });

    await service.connect(DUAL_ID, "power");

    let state = service.getState();
    expect(state.connectedDeviceId).toBe(DUAL_ID);
    expect(state.connections.cadence.connectedDeviceId).toBeNull();

    const telemetry: BleLiveTelemetry = { powerWatts: 200, cadenceRpm: 88, speedKmh: 30, distanceMeters: null, timestamp: new Date().toISOString() };
    adapter.emitLiveTelemetry(DUAL_ID, telemetry);
    expect(service.getState().liveTelemetry?.cadenceRpm).toBe(88);

    await service.connect(DUAL_ID, "cadence");
    state = service.getState();
    expect(state.connectedDeviceId).toBe(DUAL_ID);
    expect(state.connections.cadence.connectedDeviceId).toBe(DUAL_ID);
  });

  it("fails cleanly and disconnects when a role is requested but its GATT service isn't actually present", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: AMBIGUOUS_ID, roles: ["heart_rate"] });
    adapter.missingRoleServices.set(AMBIGUOUS_ID, ["power"]);

    await service.connect(AMBIGUOUS_ID, "power");

    const state = service.getState();
    expect(state.lifecycle).toBe("error");
    expect(state.connectedDeviceId).toBeNull();
    expect(state.lastError).toContain(AMBIGUOUS_ID);
    expect(adapter.disconnectedDeviceIds).toContain(AMBIGUOUS_ID);
  });

  it("does not disconnect an already-connected power role when a second role on the same device fails verification", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: DUAL_ID, roles: ["power", "cadence"] });
    adapter.missingRoleServices.set(DUAL_ID, ["cadence"]);

    await service.connect(DUAL_ID, "power");
    expect(service.getState().connectedDeviceId).toBe(DUAL_ID);

    await service.connect(DUAL_ID, "cadence");

    const state = service.getState();
    expect(state.connections.cadence).toEqual({
      lifecycle: "error",
      connectedDeviceId: null,
      lastError: expect.stringContaining(DUAL_ID)
    });
    // The power role is still using this physical connection -> must not be torn down.
    expect(state.connectedDeviceId).toBe(DUAL_ID);
    expect(state.lifecycle).toBe("connected");
    expect(adapter.disconnectedDeviceIds).not.toContain(DUAL_ID);
  });

  it("still reports connected with a stashed error when discovery fails for a reason other than a missing service", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    adapter.discoverFtmsCharacteristics = async () => {
      throw new Error("characteristic read failed");
    };

    await service.connect(TRAINER_ID, "power");

    const state = service.getState();
    expect(state.lifecycle).toBe("connected");
    expect(state.connectedDeviceId).toBe(TRAINER_ID);
    expect(state.lastError).toBe("characteristic read failed");
  });

  it("gives the heart rate role the same disconnecting transitional state the power role has", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });
    await service.connect(HR_ID, "heart_rate");

    const disconnectDeferred = createDeferred<void>();
    adapter.disconnectDelays.set(HR_ID, disconnectDeferred.promise);

    const disconnectPromise = service.disconnect(HR_ID);
    expect(service.getState().connections.heart_rate.lifecycle).toBe("disconnecting");

    disconnectDeferred.resolve();
    await disconnectPromise;
    expect(service.getState().connections.heart_rate.lifecycle).toBe("disconnected");
  });
});
