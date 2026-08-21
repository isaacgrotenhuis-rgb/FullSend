import { NobleBleAdapter } from "@main/ble/NobleBleAdapter";
import {
  createInitialBleState,
  type BleAdapter,
  type BleDeviceStore,
  type BleService as BleServicePort,
  type BleTransitionStore
} from "@main/ble/types";
import type { BleCapabilities, BleDevice, BleDeviceKind, BleFtmsProfile, BleState } from "@shared/ipc/contracts";

export class BleService implements BleServicePort {
  private state: BleState = createInitialBleState();
  private readonly adapter: BleAdapter;
  private readonly transitionStore?: BleTransitionStore;
  private readonly deviceStore?: BleDeviceStore;
  private scanTimeout: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private listeners = new Set<(state: BleState) => void>();
  private initialized = false;
  private scanOperationSeq = 0;
  private trainerConnectionOpSeq = 0;
  private hrConnectionOpSeq = 0;
  private manualDisconnectDeviceIds = new Set<string>();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 2;
  private readonly reconnectDelayMs = 1800;
  private lastConnectedDeviceId: string | null = null;

  constructor(options?: {
    adapter?: BleAdapter;
    transitionStore?: BleTransitionStore;
    deviceStore?: BleDeviceStore;
  }) {
    this.adapter = options?.adapter ?? new NobleBleAdapter();
    this.transitionStore = options?.transitionStore;
    this.deviceStore = options?.deviceStore;
    this.bindAdapterEvents();
  }

  private bindAdapterEvents(): void {
    this.adapter.onDeviceDiscovered((device) => {
      this.upsertDevice(device);
    });

    this.adapter.onDisconnected((deviceId) => {
      const wasManualDisconnect = this.manualDisconnectDeviceIds.delete(deviceId);

      if (this.state.connectedDeviceId === deviceId) {
        const droppedDeviceId = deviceId;
        this.setState({
          lifecycle: "disconnected",
          connectedDeviceId: null,
          ftmsProfile: null,
          liveTelemetry: null,
          scanning: false,
          lastError: wasManualDisconnect ? null : "BLE signal lost; disconnected"
        }, "adapter-disconnected");
        if (!wasManualDisconnect) {
          this.scheduleReconnect(droppedDeviceId);
        }
        return;
      }

      if (this.state.connectedHrDeviceId === deviceId) {
        this.setState({
          hrLifecycle: "disconnected",
          connectedHrDeviceId: null,
          heartRate: null,
          hrLastError: wasManualDisconnect ? null : "BLE signal lost; disconnected"
        }, "hr-adapter-disconnected");
      }
    });

    this.adapter.onError((error) => {
      console.error("[BleService] adapter error:", error);
      const hrUpdate = this.state.connectedHrDeviceId
        ? { hrLifecycle: "error" as const, hrLastError: error.message }
        : {};
      this.setState({
        lifecycle: "error",
        lastError: error.message,
        ...hrUpdate
      }, "adapter-error");
    });

    this.adapter.onLiveTelemetry((deviceId, sample) => {
      if (this.state.connectedDeviceId !== deviceId) {
        return;
      }
      this.setState({ liveTelemetry: sample });
    });

    this.adapter.onHeartRateTelemetry((deviceId, sample) => {
      if (this.state.connectedHrDeviceId !== deviceId) {
        return;
      }
      this.setState({ heartRate: sample });
    });
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private scheduleReconnect(deviceId: string): void {
    if (!deviceId || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    this.clearReconnectTimeout();
    const reconnectAttempt = this.reconnectAttempts + 1;
    this.reconnectTimeout = setTimeout(() => {
      if (this.state.connectedDeviceId || this.state.lifecycle === "connecting") {
        return;
      }
      this.reconnectAttempts = reconnectAttempt;
      void this.connectTrainerInternal(deviceId, "auto-reconnect").catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown reconnect error";
        console.error(`[BleService] auto-reconnect failed for device ${deviceId}:`, error);
        this.setState({ lastError: message }, "reconnect-failed");
        this.scheduleReconnect(deviceId);
      });
    }, this.reconnectDelayMs);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.setState({ lifecycle: "initializing" }, "initializing-adapter");
    await this.adapter.initialize();
    this.initialized = true;
    this.setState({ lifecycle: "idle", lastError: null }, "adapter-ready");
  }

  private setState(next: Partial<BleState>, reason = "state-update"): void {
    const previousLifecycle = this.state.lifecycle;
    this.state = {
      ...this.state,
      ...next
    };
    if (previousLifecycle !== this.state.lifecycle) {
      this.transitionStore?.recordTransition({
        fromState: previousLifecycle,
        toState: this.state.lifecycle,
        reason,
        deviceId: this.state.connectedDeviceId
      });
    }
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private upsertDevice(device: BleDevice): void {
    const devices = new Map(this.state.discoveredDevices.map((item) => [item.id, item]));
    devices.set(device.id, {
      ...devices.get(device.id),
      ...device
    });
    this.setState({
      discoveredDevices: Array.from(devices.values())
    });
  }

  async startScan(timeoutMs: number): Promise<void> {
    const opId = ++this.scanOperationSeq;
    await this.ensureInitialized();
    this.setState({
      lifecycle: "scanning",
      scanning: true,
      lastError: null,
      discoveredDevices: []
    }, "scan-started");
    await this.adapter.startScan();
    if (opId !== this.scanOperationSeq) {
      return;
    }
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
    this.scanTimeout = setTimeout(() => {
      void this.stopScan();
    }, timeoutMs);
  }

  async stopScan(): Promise<void> {
    const opId = ++this.scanOperationSeq;
    await this.adapter.stopScan();
    if (opId !== this.scanOperationSeq) {
      return;
    }
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
    this.setState({
      scanning: false,
      lifecycle: this.state.connectedDeviceId ? "connected" : "disconnected"
    }, "scan-stopped");
  }

  private deviceKind(deviceId: string): BleDeviceKind | undefined {
    return this.state.discoveredDevices.find((item) => item.id === deviceId)?.kind;
  }

  private async connectTrainerInternal(deviceId: string, reason = "connect-requested"): Promise<void> {
    if (
      this.state.lifecycle === "connecting" ||
      (this.state.lifecycle === "connected" && this.state.connectedDeviceId === deviceId)
    ) {
      return;
    }
    const opId = ++this.trainerConnectionOpSeq;
    await this.ensureInitialized();
    this.clearReconnectTimeout();
    this.setState({
      lifecycle: "connecting",
      lastError: null
    }, reason);
    await this.adapter.connect(deviceId);
    if (opId !== this.trainerConnectionOpSeq) {
      return;
    }
    const discoveredDevice = this.state.discoveredDevices.find((item) => item.id === deviceId);
    this.deviceStore?.upsert({
      id: deviceId,
      name: discoveredDevice?.name ?? discoveredDevice?.localName ?? null
    });
    this.reconnectAttempts = 0;
    this.lastConnectedDeviceId = deviceId;
    this.manualDisconnectDeviceIds.delete(deviceId);

    let ftmsProfile: BleFtmsProfile | null = null;
    let ftmsError: string | null = null;
    try {
      ftmsProfile = await this.adapter.discoverFtmsCharacteristics(deviceId);
    } catch (error) {
      ftmsError = error instanceof Error ? error.message : "Unknown FTMS discovery error";
      console.error(`[BleService] FTMS discovery failed for device ${deviceId}:`, error);
    }
    if (opId !== this.trainerConnectionOpSeq) {
      return;
    }

    if (ftmsProfile?.ergControlAvailable) {
      try {
        await this.adapter.requestControl(deviceId);
      } catch (error) {
        ftmsError = error instanceof Error ? error.message : "Unknown FTMS request-control error";
        console.error(`[BleService] FTMS request control failed for device ${deviceId}:`, error);
      }
    }
    if (opId !== this.trainerConnectionOpSeq) {
      return;
    }

    this.setState({
      lifecycle: "connected",
      connectedDeviceId: deviceId,
      ftmsProfile,
      liveTelemetry: null,
      lastError: ftmsError
    }, "connected");
  }

  private async connectHeartRateInternal(deviceId: string, reason = "connect-requested"): Promise<void> {
    if (
      this.state.hrLifecycle === "connecting" ||
      (this.state.hrLifecycle === "connected" && this.state.connectedHrDeviceId === deviceId)
    ) {
      return;
    }
    const opId = ++this.hrConnectionOpSeq;
    await this.ensureInitialized();
    this.setState({
      hrLifecycle: "connecting",
      hrLastError: null
    }, reason);
    await this.adapter.connect(deviceId);
    if (opId !== this.hrConnectionOpSeq) {
      return;
    }
    this.manualDisconnectDeviceIds.delete(deviceId);

    let hrError: string | null = null;
    try {
      await this.adapter.discoverHeartRateCharacteristics(deviceId);
    } catch (error) {
      hrError = error instanceof Error ? error.message : "Unknown heart rate discovery error";
      console.error(`[BleService] heart rate discovery failed for device ${deviceId}:`, error);
    }
    if (opId !== this.hrConnectionOpSeq) {
      return;
    }

    this.setState({
      hrLifecycle: "connected",
      connectedHrDeviceId: deviceId,
      heartRate: null,
      hrLastError: hrError
    }, "hr-connected");
  }

  async connect(deviceId: string): Promise<void> {
    if (this.deviceKind(deviceId) === "heart_rate") {
      await this.connectHeartRateInternal(deviceId, "connect-requested");
      return;
    }
    await this.connectTrainerInternal(deviceId, "connect-requested");
  }

  listDevices(): BleDevice[] {
    return this.adapter.listDiscoveredDevices();
  }

  async discoverFtms(deviceId: string): Promise<BleFtmsProfile> {
    await this.ensureInitialized();
    if (this.state.connectedDeviceId !== deviceId) {
      throw new Error(`Cannot discover FTMS on non-connected device: ${deviceId}`);
    }
    const profile = await this.adapter.discoverFtmsCharacteristics(deviceId);
    this.setState({ ftmsProfile: profile }, "ftms-discovered");
    return profile;
  }

  async applyErgTarget(
    deviceId: string,
    input: { targetPowerWatts: number | null; targetResistancePercent: number | null }
  ): Promise<void> {
    if (this.state.connectedDeviceId !== deviceId) {
      throw new Error(`Cannot apply ERG target to non-connected device: ${deviceId}`);
    }
    await this.adapter.applyErgTarget(deviceId, input);
  }

  async safeErgStop(deviceId: string): Promise<void> {
    if (this.state.connectedDeviceId !== deviceId) {
      return;
    }
    await this.adapter.safeErgStop(deviceId);
  }

  async startOrResume(deviceId: string): Promise<void> {
    if (this.state.connectedDeviceId !== deviceId) {
      throw new Error(`Cannot start/resume ERG on non-connected device: ${deviceId}`);
    }
    await this.adapter.startOrResume(deviceId);
  }

  async stopOrPause(deviceId: string, mode: "stop" | "pause"): Promise<void> {
    if (this.state.connectedDeviceId !== deviceId) {
      return;
    }
    await this.adapter.stopOrPause(deviceId, mode);
  }

  private async disconnectTrainerInternal(deviceId: string): Promise<void> {
    const opId = ++this.trainerConnectionOpSeq;
    this.manualDisconnectDeviceIds.add(deviceId);
    this.clearReconnectTimeout();
    this.setState({ lifecycle: "disconnecting", lastError: null }, "disconnect-requested");
    await this.adapter.disconnect(deviceId);
    if (opId !== this.trainerConnectionOpSeq) {
      return;
    }
    this.reconnectAttempts = 0;
    this.setState({
      lifecycle: "disconnected",
      connectedDeviceId: null,
      ftmsProfile: null,
      liveTelemetry: null
    }, "disconnected");
  }

  private async disconnectHeartRateInternal(deviceId: string): Promise<void> {
    const opId = ++this.hrConnectionOpSeq;
    this.manualDisconnectDeviceIds.add(deviceId);
    await this.adapter.disconnect(deviceId);
    if (opId !== this.hrConnectionOpSeq) {
      return;
    }
    this.setState({
      hrLifecycle: "disconnected",
      connectedHrDeviceId: null,
      heartRate: null,
      hrLastError: null
    }, "hr-disconnected");
  }

  async disconnect(deviceId?: string): Promise<void> {
    if (deviceId) {
      if (deviceId === this.state.connectedHrDeviceId) {
        await this.disconnectHeartRateInternal(deviceId);
        return;
      }
      await this.disconnectTrainerInternal(deviceId);
      return;
    }

    const trainerDeviceId = this.state.connectedDeviceId;
    const hrDeviceId = this.state.connectedHrDeviceId;
    await Promise.all([
      trainerDeviceId ? this.disconnectTrainerInternal(trainerDeviceId) : Promise.resolve(),
      hrDeviceId ? this.disconnectHeartRateInternal(hrDeviceId) : Promise.resolve()
    ]);
  }

  getState(): BleState {
    return this.state;
  }

  getCapabilities(): BleCapabilities {
    return {
      canScan: true,
      canConnect: true,
      canDisconnect: true,
      supportsFtmsDiscovery: true,
      supportsHeartRateDiscovery: true,
      supportsBackgroundReconnect: true,
      knownLimitations: [
        "ERG execution is intentionally out of scope in this scaffold.",
        "BLE behavior may vary by macOS version and device firmware.",
        "Reconnect policy is conservative (bounded retries) and does not guarantee recovery on all adapters.",
        "Heart rate reconnection is manual only; a Whoop device can broadcast to a single BLE central at a time."
      ]
    };
  }

  subscribeState(listener: (state: BleState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
