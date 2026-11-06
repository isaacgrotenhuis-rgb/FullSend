import { afterEach, describe, expect, it, vi } from "vitest";
import { BleService } from "@main/ble/BleService";
import { BleRoleServiceNotFoundError, type BleAdapter, type BleDeviceStore } from "@main/ble/types";
import type {
  BleDevice,
  BleFtmsProfile,
  BleHeartRateSample,
  BleLiveTelemetry,
  BleRememberedDevice,
  BleRole
} from "@shared/ipc/contracts";

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
  private adapterStateListener: ((poweredOn: boolean, state: string) => void) | null = null;
  private liveTelemetryListener: ((deviceId: string, sample: BleLiveTelemetry) => void) | null = null;
  private heartRateTelemetryListener: ((deviceId: string, sample: BleHeartRateSample) => void) | null = null;

  scanCalls = { start: 0, stop: 0 };
  initializeCalls = 0;
  startScanError: Error | null = null;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }
  async startScan(): Promise<void> {
    this.scanCalls.start += 1;
    if (this.startScanError) throw this.startScanError;
  }
  async stopScan(): Promise<void> {
    this.scanCalls.stop += 1;
  }
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

  onAdapterStateChange(listener: (poweredOn: boolean, state: string) => void): void {
    this.adapterStateListener = listener;
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

  emitAdapterState(state: string): void {
    this.adapterStateListener?.(state === "poweredOn", state);
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

  it("sets the heart rate connection lifecycle to error and clears connectedDeviceId when the adapter errors while only the heart rate device is connected", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });

    await service.connect(HR_ID, "heart_rate");

    adapter.emitError(new Error("adapter lost"));

    const state = service.getState();
    expect(state.connections.heart_rate.lifecycle).toBe("error");
    expect(state.connections.heart_rate.lastError).toBe("adapter lost");
    expect(state.connections.heart_rate.connectedDeviceId).toBeNull();
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

describe("BleService adapter power transitions and stuck connects", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a failed connect as an error and lets the next attempt through", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    adapter.connect = async () => {
      throw new Error("Timed out connecting to trainer");
    };

    await expect(service.connect(TRAINER_ID, "power")).rejects.toThrow("Timed out");
    expect(service.getState().lifecycle).toBe("error");
    expect(service.getState().lastError).toBe("Timed out connecting to trainer");

    adapter.connect = async () => {};
    await service.connect(TRAINER_ID, "power");
    expect(service.getState().lifecycle).toBe("connected");
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
  });

  it("disconnects every active role when the adapter powers off", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });
    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    adapter.emitAdapterState("poweredOff");

    const state = service.getState();
    expect(state.lifecycle).toBe("disconnected");
    expect(state.connectedDeviceId).toBeNull();
    expect(state.lastError).toBe("Bluetooth is off");
    expect(state.connections.heart_rate).toEqual({
      lifecycle: "disconnected",
      connectedDeviceId: null,
      lastError: "Bluetooth is off"
    });
  });

  it("clears the power-off message and reconnects the trainer once the adapter is back on", async () => {
    vi.useFakeTimers();
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });
    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    adapter.emitAdapterState("poweredOff");
    adapter.emitAdapterState("poweredOn");

    expect(service.getState().lastError).toBeNull();
    expect(service.getState().connections.heart_rate.lastError).toBeNull();

    await vi.runOnlyPendingTimersAsync();
    expect(service.getState().lifecycle).toBe("connected");
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
    // Heart rate reconnection stays manual.
    expect(service.getState().connections.heart_rate.connectedDeviceId).toBeNull();
  });

  it("does not leave a connect that was in flight at power-off blocking the next attempt", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    const hung = createDeferred<void>();
    adapter.connectDelays.set(TRAINER_ID, hung.promise);

    const firstAttempt = service.connect(TRAINER_ID, "power");
    await vi.waitFor(() => expect(service.getState().lifecycle).toBe("connecting"));

    adapter.emitAdapterState("poweredOff");
    expect(service.getState().lifecycle).toBe("disconnected");

    adapter.emitAdapterState("poweredOn");
    adapter.connectDelays.delete(TRAINER_ID);
    await service.connect(TRAINER_ID, "power");
    expect(service.getState().lifecycle).toBe("connected");

    // The stale attempt settling late must not clobber the new connection.
    hung.resolve();
    await firstAttempt;
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
  });
});

class MemoryDeviceStore implements BleDeviceStore {
  constructor(public remembered: BleRememberedDevice[] = []) {}
  upsert(): void {}
  listRemembered(): BleRememberedDevice[] {
    return [...this.remembered];
  }
  remember(input: BleRememberedDevice): void {
    this.remembered = [input, ...this.remembered.filter((device) => device.role !== input.role)];
  }
  forget(role: BleRole): void {
    this.remembered = this.remembered.filter((device) => device.role !== role);
  }
  setAutoConnect(role: BleRole, enabled: boolean): void {
    this.remembered = this.remembered.map((device) => (device.role === role ? { ...device, autoConnect: enabled } : device));
  }
}

const rememberedTrainer: BleRememberedDevice = { role: "power", deviceId: TRAINER_ID, name: "KICKR CORE", autoConnect: true };
const rememberedStrap: BleRememberedDevice = { role: "heart_rate", deviceId: HR_ID, name: "HRM-Pro", autoConnect: true };

// Lets the fire-and-forget connects started from discovery events settle.
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("BleService remembered devices and auto-connect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("remembers the device connected for each role", async () => {
    const adapter = new FakeBleAdapter();
    const store = new MemoryDeviceStore();
    const service = new BleService({ adapter, deviceStore: store });
    adapter.emitDiscovered({ id: TRAINER_ID, name: "KICKR CORE", roles: ["power"] });
    adapter.emitDiscovered({ id: HR_ID, name: "HRM-Pro", roles: ["heart_rate"] });

    await service.connect(TRAINER_ID, "power");
    await service.connect(HR_ID, "heart_rate");

    expect(store.remembered).toEqual([rememberedStrap, rememberedTrainer]);
    expect(service.getState().remembered).toEqual(store.remembered);
  });

  it("doesn't touch the radio at launch when nothing is remembered", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore() });
    await service.startAutoConnect();
    expect(adapter.initializeCalls).toBe(0);
    expect(adapter.scanCalls.start).toBe(0);
    expect(service.getState().autoConnect).toEqual({ status: "idle", roles: [] });
  });

  it("connects remembered devices as they show up, then stops scanning", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore([rememberedTrainer, rememberedStrap]) });

    await service.startAutoConnect();
    expect(service.getState().autoConnect).toEqual({ status: "searching", roles: ["power", "heart_rate"] });
    expect(adapter.scanCalls.start).toBe(1);

    adapter.emitDiscovered({ id: "someone-elses-trainer", roles: ["power"] });
    adapter.emitDiscovered({ id: TRAINER_ID, name: "KICKR CORE", roles: ["power"] });
    await flush();
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
    expect(service.getState().autoConnect).toEqual({ status: "searching", roles: ["heart_rate"] });
    expect(adapter.scanCalls.stop).toBe(0);

    adapter.emitDiscovered({ id: HR_ID, name: "HRM-Pro", roles: ["heart_rate"] });
    await flush();
    expect(service.getState().connections.heart_rate.connectedDeviceId).toBe(HR_ID);
    expect(service.getState().autoConnect).toEqual({ status: "idle", roles: [] });
    expect(adapter.scanCalls.stop).toBe(1);
  });

  it("gives up after the search window and reports what wasn't found; Reconnect searches again", async () => {
    vi.useFakeTimers();
    const adapter = new FakeBleAdapter();
    const service = new BleService({
      adapter,
      deviceStore: new MemoryDeviceStore([rememberedTrainer]),
      autoConnectWindowMs: 60_000
    });

    await service.startAutoConnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.getState().autoConnect).toEqual({ status: "not-found", roles: ["power"] });
    expect(adapter.scanCalls.stop).toBe(1);

    await service.reconnectRemembered("power");
    expect(service.getState().autoConnect.status).toBe("searching");
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
    expect(service.getState().autoConnect.status).toBe("idle");
  });

  it("doesn't auto-connect a role the rider disconnected until they ask", async () => {
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore([rememberedTrainer, rememberedStrap]) });
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });
    await service.connect(HR_ID, "heart_rate");
    await service.disconnect(HR_ID);

    await service.startAutoConnect();
    await flush();
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
    expect(service.getState().connections.heart_rate.connectedDeviceId).toBeNull();
    expect(service.getState().autoConnect.status).toBe("idle");

    await service.reconnectRemembered("heart_rate");
    await flush();
    expect(service.getState().connections.heart_rate.connectedDeviceId).toBe(HR_ID);
  });

  it("skips a device with auto-connect off, and keeps that choice when it's paired again", async () => {
    const adapter = new FakeBleAdapter();
    const store = new MemoryDeviceStore([rememberedTrainer, rememberedStrap]);
    const service = new BleService({ adapter, deviceStore: store });
    service.setAutoConnect("heart_rate", false);

    await service.startAutoConnect();
    expect(service.getState().autoConnect.roles).toEqual(["power"]);

    adapter.emitDiscovered({ id: HR_ID, roles: ["heart_rate"] });
    await flush();
    expect(service.getState().connections.heart_rate.connectedDeviceId).toBeNull();

    await service.connect(HR_ID, "heart_rate");
    expect(store.remembered.find((device) => device.role === "heart_rate")?.autoConnect).toBe(false);
  });

  it("forgets a device", async () => {
    const adapter = new FakeBleAdapter();
    const store = new MemoryDeviceStore([rememberedTrainer]);
    const service = new BleService({ adapter, deviceStore: store });
    await service.startAutoConnect();

    service.forgetDevice("power");
    expect(store.remembered).toEqual([]);
    expect(service.getState().remembered).toEqual([]);
    expect(service.getState().autoConnect).toEqual({ status: "idle", roles: [] });
    expect(adapter.scanCalls.stop).toBe(1);
  });

  it("keeps searching when a manual scan ends", async () => {
    vi.useFakeTimers();
    const adapter = new FakeBleAdapter();
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore([rememberedTrainer]) });
    await service.startAutoConnect();

    await service.startScan(8000);
    await vi.advanceTimersByTimeAsync(8000);
    expect(service.getState().scanning).toBe(false);
    expect(adapter.scanCalls.stop).toBe(0);

    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
  });

  it("waits for Bluetooth to come on when it's off at launch", async () => {
    const adapter = new FakeBleAdapter();
    adapter.startScanError = new Error("Bluetooth is off");
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore([rememberedTrainer]) });

    await service.startAutoConnect();
    expect(service.getState().autoConnect).toEqual({ status: "not-found", roles: ["power"] });

    adapter.startScanError = null;
    adapter.emitAdapterState("poweredOn");
    await flush();
    expect(service.getState().autoConnect.status).toBe("searching");
    adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
    await flush();
    expect(service.getState().connectedDeviceId).toBe(TRAINER_ID);
  });

  it("doesn't retry a device that just refused, on every advertisement", async () => {
    const adapter = new FakeBleAdapter();
    const connect = vi.spyOn(adapter, "connect").mockRejectedValue(new Error("busy"));
    const service = new BleService({ adapter, deviceStore: new MemoryDeviceStore([rememberedTrainer]) });
    await service.startAutoConnect();

    for (let i = 0; i < 5; i += 1) {
      adapter.emitDiscovered({ id: TRAINER_ID, roles: ["power"] });
      await flush();
    }
    expect(connect).toHaveBeenCalledTimes(1);
    expect(service.getState().autoConnect.status).toBe("searching");
  });
});
