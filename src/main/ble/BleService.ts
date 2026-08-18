import { NobleBleAdapter } from "@main/ble/NobleBleAdapter";
import {
  createInitialBleState,
  type BleAdapter,
  type BleService as BleServicePort,
  type BleTransitionStore
} from "@main/ble/types";
import type { BleCapabilities, BleDevice, BleFtmsProfile, BleState } from "@shared/ipc/contracts";

export class BleService implements BleServicePort {
  private state: BleState = createInitialBleState();
  private readonly adapter: BleAdapter;
  private readonly transitionStore?: BleTransitionStore;
  private scanTimeout: NodeJS.Timeout | null = null;
  private listeners = new Set<(state: BleState) => void>();
  private initialized = false;

  constructor(options?: { adapter?: BleAdapter; transitionStore?: BleTransitionStore }) {
    this.adapter = options?.adapter ?? new NobleBleAdapter();
    this.transitionStore = options?.transitionStore;
    this.bindAdapterEvents();
  }

  private bindAdapterEvents(): void {
    this.adapter.onDeviceDiscovered((device) => {
      this.upsertDevice(device);
    });

    this.adapter.onDisconnected((deviceId) => {
      if (this.state.connectedDeviceId === deviceId) {
        this.setState({
          lifecycle: "disconnected",
          connectedDeviceId: null
        }, "adapter-disconnected");
      }
    });

    this.adapter.onError((error) => {
      this.setState({
        lifecycle: "error",
        lastError: error.message
      }, "adapter-error");
    });
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
    await this.ensureInitialized();
    this.setState({
      lifecycle: "scanning",
      scanning: true,
      lastError: null,
      discoveredDevices: []
    }, "scan-started");
    await this.adapter.startScan();
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
    this.scanTimeout = setTimeout(() => {
      void this.stopScan();
    }, timeoutMs);
  }

  async stopScan(): Promise<void> {
    await this.adapter.stopScan();
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
    this.setState({
      scanning: false,
      lifecycle: this.state.connectedDeviceId ? "connected" : "disconnected"
    }, "scan-stopped");
  }

  async connect(deviceId: string): Promise<void> {
    await this.ensureInitialized();
    this.setState({
      lifecycle: "connecting",
      lastError: null
    }, "connect-requested");
    await this.adapter.connect(deviceId);
    this.setState({
      lifecycle: "connected",
      connectedDeviceId: deviceId,
      ftmsProfile: null
    }, "connected");
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

  async disconnect(deviceId?: string): Promise<void> {
    this.setState({ lifecycle: "disconnecting", lastError: null }, "disconnect-requested");
    await this.adapter.disconnect(deviceId);
    this.setState({
      lifecycle: "disconnected",
      connectedDeviceId: null,
      ftmsProfile: null
    }, "disconnected");
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
      supportsBackgroundReconnect: false,
      knownLimitations: [
        "ERG execution is intentionally out of scope in this scaffold.",
        "BLE behavior may vary by macOS version and device firmware.",
        "No reconnect policy implemented yet."
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
