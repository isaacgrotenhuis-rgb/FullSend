import type {
  BleCapabilities,
  BleDevice,
  BleFtmsProfile,
  BleLifecycle,
  BleLiveTelemetry,
  BleState
} from "@shared/ipc/contracts";

export interface BleAdapter {
  initialize: () => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  listDiscoveredDevices: () => BleDevice[];
  connect: (deviceId: string) => Promise<void>;
  disconnect: (deviceId?: string) => Promise<void>;
  discoverFtmsCharacteristics: (deviceId: string) => Promise<BleFtmsProfile>;
  applyErgTarget: (
    deviceId: string,
    input: { targetPowerWatts: number | null; targetResistancePercent: number | null }
  ) => Promise<void>;
  safeErgStop: (deviceId: string) => Promise<void>;
  requestControl: (deviceId: string) => Promise<void>;
  startOrResume: (deviceId: string) => Promise<void>;
  stopOrPause: (deviceId: string, mode: "stop" | "pause") => Promise<void>;
  onDeviceDiscovered: (listener: (device: BleDevice) => void) => void;
  onDisconnected: (listener: (deviceId: string) => void) => void;
  onError: (listener: (error: Error) => void) => void;
  onLiveTelemetry: (listener: (deviceId: string, sample: BleLiveTelemetry) => void) => void;
}

export interface BleTransitionStore {
  recordTransition: (input: {
    fromState: BleLifecycle;
    toState: BleLifecycle;
    reason: string;
    deviceId: string | null;
  }) => void;
}

export interface BleDeviceStore {
  upsert: (input: { id: string; name: string | null }) => void;
}

export interface BleService {
  startScan: (timeoutMs: number) => Promise<void>;
  stopScan: () => Promise<void>;
  listDevices: () => BleDevice[];
  connect: (deviceId: string) => Promise<void>;
  disconnect: (deviceId?: string) => Promise<void>;
  getState: () => BleState;
  getCapabilities: () => BleCapabilities;
  discoverFtms: (deviceId: string) => Promise<BleFtmsProfile>;
  applyErgTarget: (
    deviceId: string,
    input: { targetPowerWatts: number | null; targetResistancePercent: number | null }
  ) => Promise<void>;
  safeErgStop: (deviceId: string) => Promise<void>;
  startOrResume: (deviceId: string) => Promise<void>;
  stopOrPause: (deviceId: string, mode: "stop" | "pause") => Promise<void>;
  subscribeState: (listener: (state: BleState) => void) => () => void;
}

export const createInitialBleState = (): BleState => ({
  lifecycle: "idle" satisfies BleLifecycle,
  scanning: false,
  connectedDeviceId: null,
  lastError: null,
  discoveredDevices: [],
  ftmsProfile: null,
  liveTelemetry: null
});
