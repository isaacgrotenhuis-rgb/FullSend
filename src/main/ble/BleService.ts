import { NobleBleAdapter } from "@main/ble/NobleBleAdapter";
import {
  BleRoleServiceNotFoundError,
  createInitialBleState,
  type BleAdapter,
  type BleDeviceStore,
  type BleService as BleServicePort,
  type BleTransitionStore
} from "@main/ble/types";
import {
  bleRoles,
  type BleCapabilities,
  type BleConnectionEntry,
  type BleDevice,
  type BleFtmsProfile,
  type BleRole,
  type BleState
} from "@shared/ipc/contracts";

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
  private connectionOpSeq: Record<BleRole, number> = { power: 0, heart_rate: 0, cadence: 0 };
  private manualDisconnectDeviceIds = new Set<string>();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 2;
  private readonly reconnectDelayMs = 1800;
  private lastConnectedDeviceId: string | null = null;
  // Trainer that was connected when the adapter powered off (e.g. the Mac
  // slept), reconnected automatically once it's back on.
  private resumeDeviceIdOnPowerOn: string | null = null;
  private adapterOffMessage: string | null = null;

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
      for (const role of bleRoles) {
        if (this.getConnection(role).connectedDeviceId !== deviceId) {
          continue;
        }
        const resetExtra: Partial<BleState> | undefined =
          role === "power"
            ? { ftmsProfile: null, liveTelemetry: null, scanning: false }
            : role === "heart_rate"
              ? { heartRate: null }
              : undefined;
        this.patchConnection(
          role,
          {
            lifecycle: "disconnected",
            connectedDeviceId: null,
            lastError: wasManualDisconnect ? null : "BLE signal lost; disconnected"
          },
          `${role}-adapter-disconnected`,
          resetExtra
        );
        if (role === "power" && !wasManualDisconnect) {
          this.scheduleReconnect(deviceId);
        }
      }
    });

    this.adapter.onError((error) => {
      console.error("[BleService] adapter error:", error);
      this.setState({ lifecycle: "error", connectedDeviceId: null, lastError: error.message }, "adapter-error");
      for (const role of bleRoles) {
        if (role === "power") {
          continue; // already covered by the setState above (power is mirrored at top level)
        }
        if (this.getConnection(role).connectedDeviceId === null) {
          continue;
        }
        this.patchConnection(role, { lifecycle: "error", connectedDeviceId: null, lastError: error.message }, "adapter-error");
      }
    });

    this.adapter.onAdapterStateChange((poweredOn, state) => {
      if (poweredOn) {
        this.handleAdapterPoweredOn();
      } else {
        this.handleAdapterPoweredOff(state);
      }
    });

    this.adapter.onLiveTelemetry((deviceId, sample) => {
      if (this.state.connectedDeviceId !== deviceId) {
        return;
      }
      this.setState({ liveTelemetry: sample });
    });

    this.adapter.onHeartRateTelemetry((deviceId, sample) => {
      if (this.state.connections.heart_rate.connectedDeviceId !== deviceId) {
        return;
      }
      this.setState({ heartRate: sample });
    });
  }

  // The radio going away drops every link, so settle each role into a plain
  // disconnected state (aborting any in-flight connect) instead of leaving it
  // "connected" or "connecting" against peripherals that no longer exist.
  private handleAdapterPoweredOff(state: string): void {
    const message = `Bluetooth is ${state === "poweredOff" ? "off" : `unavailable (${state})`}`;
    this.adapterOffMessage = message;
    this.clearReconnectTimeout();
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
    const powerDeviceId = this.state.connectedDeviceId;
    if (powerDeviceId && !this.manualDisconnectDeviceIds.has(powerDeviceId)) {
      this.resumeDeviceIdOnPowerOn = powerDeviceId;
    }
    for (const role of bleRoles) {
      const current = this.getConnection(role);
      const wasActive = current.connectedDeviceId !== null || current.lifecycle === "connecting";
      if (role !== "power" && !wasActive) {
        continue;
      }
      this.connectionOpSeq[role] += 1;
      const resetExtra: Partial<BleState> | undefined =
        role === "power"
          ? { ftmsProfile: null, liveTelemetry: null, scanning: false }
          : role === "heart_rate"
            ? { heartRate: null }
            : undefined;
      this.patchConnection(
        role,
        { lifecycle: "disconnected", connectedDeviceId: null, lastError: message },
        `${role}-adapter-powered-off`,
        resetExtra
      );
    }
  }

  private handleAdapterPoweredOn(): void {
    const offMessage = this.adapterOffMessage;
    this.adapterOffMessage = null;
    if (offMessage) {
      for (const role of bleRoles) {
        if (this.getConnection(role).lastError === offMessage) {
          this.patchConnection(role, { lastError: null }, `${role}-adapter-powered-on`);
        }
      }
    }
    const resumeDeviceId = this.resumeDeviceIdOnPowerOn;
    this.resumeDeviceIdOnPowerOn = null;
    if (resumeDeviceId && !this.state.connectedDeviceId) {
      this.reconnectAttempts = 0;
      this.scheduleReconnect(resumeDeviceId);
    }
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
      void this.connectInternal(deviceId, "power", "auto-reconnect").catch((error: unknown) => {
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
    try {
      await this.adapter.initialize();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bluetooth adapter failed to initialize";
      this.setState({ lifecycle: "error", lastError: message }, "adapter-init-failed");
      throw error;
    }
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
    const existing = devices.get(device.id);
    const mergedRoles = Array.from(new Set([...(existing?.roles ?? []), ...(device.roles ?? [])]));
    devices.set(device.id, {
      ...existing,
      ...device,
      roles: mergedRoles
    });
    this.setState({
      discoveredDevices: Array.from(devices.values())
    });
  }

  // Read-only structural view of a role's connection status. For "power" this is a
  // superset (BleLifecycle) of the 6-state BleConnectionLifecycle; nothing writes a
  // power-only value (e.g. "initializing") through patchConnection for another role.
  private getConnection(role: BleRole): BleConnectionEntry {
    if (role === "power") {
      return {
        lifecycle: this.state.lifecycle as BleConnectionEntry["lifecycle"],
        connectedDeviceId: this.state.connectedDeviceId,
        lastError: this.state.lastError
      };
    }
    return this.state.connections[role];
  }

  private patchConnection(
    role: BleRole,
    patch: Partial<BleConnectionEntry>,
    reason: string,
    extraTopLevel?: Partial<BleState>
  ): void {
    if (role === "power") {
      this.setState({ ...patch, ...extraTopLevel }, reason);
      return;
    }
    this.setState(
      {
        connections: { ...this.state.connections, [role]: { ...this.state.connections[role], ...patch } },
        ...extraTopLevel
      },
      reason
    );
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
    try {
      await this.adapter.startScan();
    } catch (error) {
      if (opId === this.scanOperationSeq) {
        const message = error instanceof Error ? error.message : "Unknown scan error";
        this.setState(
          { scanning: false, lifecycle: this.state.connectedDeviceId ? "connected" : "error", lastError: message },
          "scan-failed"
        );
      }
      throw error;
    }
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

  // Preserves today's graceful degradation: an ordinary discovery error (a real
  // trainer/HR/cadence device with a characteristic-level hiccup) still reports
  // "connected" with the error stashed in lastError. Only a BleRoleServiceNotFoundError
  // (the requested role's GATT service isn't present at all) propagates to the caller,
  // which treats it as a hard failure rather than a fake "connected".
  private async runRoleDiscovery(
    deviceId: string,
    role: BleRole
  ): Promise<{ error: string | null; extra?: Partial<BleState> }> {
    if (role === "power") {
      let ftmsProfile: BleFtmsProfile | null = null;
      try {
        ftmsProfile = await this.adapter.discoverFtmsCharacteristics(deviceId);
      } catch (error) {
        if (error instanceof BleRoleServiceNotFoundError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : "Unknown FTMS discovery error";
        console.error(`[BleService] FTMS discovery failed for device ${deviceId}:`, error);
        return { error: message, extra: { ftmsProfile: null } };
      }
      if (ftmsProfile.ergControlAvailable) {
        try {
          await this.adapter.requestControl(deviceId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown FTMS request-control error";
          console.error(`[BleService] FTMS request control failed for device ${deviceId}:`, error);
          return { error: message, extra: { ftmsProfile } };
        }
      }
      return { error: null, extra: { ftmsProfile } };
    }
    if (role === "heart_rate") {
      try {
        await this.adapter.discoverHeartRateCharacteristics(deviceId);
      } catch (error) {
        if (error instanceof BleRoleServiceNotFoundError) {
          throw error;
        }
        console.error(`[BleService] heart rate discovery failed for device ${deviceId}:`, error);
        return { error: error instanceof Error ? error.message : "Unknown heart rate discovery error" };
      }
      return { error: null };
    }
    try {
      await this.adapter.discoverCadenceCharacteristics(deviceId);
    } catch (error) {
      if (error instanceof BleRoleServiceNotFoundError) {
        throw error;
      }
      console.error(`[BleService] cadence discovery failed for device ${deviceId}:`, error);
      return { error: error instanceof Error ? error.message : "Unknown cadence discovery error" };
    }
    return { error: null };
  }

  private async connectInternal(deviceId: string, role: BleRole, reason = "connect-requested"): Promise<void> {
    const current = this.getConnection(role);
    if (current.lifecycle === "connecting" || (current.lifecycle === "connected" && current.connectedDeviceId === deviceId)) {
      return;
    }
    const opId = ++this.connectionOpSeq[role];
    await this.ensureInitialized();
    if (role === "power") {
      this.clearReconnectTimeout();
    }
    this.patchConnection(role, { lifecycle: "connecting", lastError: null }, reason);

    try {
      await this.adapter.connect(deviceId);
    } catch (error) {
      // Without this the role stays "connecting" and every later attempt
      // bails at the guard above, so the user can never retry.
      if (opId === this.connectionOpSeq[role]) {
        const message = error instanceof Error ? error.message : "Unknown connect error";
        this.patchConnection(role, { lifecycle: "error", connectedDeviceId: null, lastError: message }, `${role}-connect-failed`);
      }
      throw error;
    }
    if (opId !== this.connectionOpSeq[role]) {
      return;
    }

    if (role === "power") {
      const discoveredDevice = this.state.discoveredDevices.find((item) => item.id === deviceId);
      this.deviceStore?.upsert({
        id: deviceId,
        name: discoveredDevice?.name ?? discoveredDevice?.localName ?? null
      });
      this.reconnectAttempts = 0;
      this.lastConnectedDeviceId = deviceId;
    }
    this.manualDisconnectDeviceIds.delete(deviceId);

    let outcome: { error: string | null; extra?: Partial<BleState> };
    try {
      outcome = await this.runRoleDiscovery(deviceId, role);
    } catch (error) {
      if (opId !== this.connectionOpSeq[role]) {
        return;
      }
      if (error instanceof BleRoleServiceNotFoundError) {
        // Bug fix: the requested role's GATT service isn't actually present -> fail
        // cleanly instead of reporting "connected". Advertisement-time role hints
        // (device.roles) are just a UI hint, not authoritative.
        //
        // Only tear down the physical peripheral if no other role is still relying
        // on it -- a single deviceId's connection can now be shared across roles
        // (e.g. a trainer connected for "power" that a user also tries as
        // "cadence"), and disconnecting it here would kill that other role's
        // already-working connection too.
        const otherRoleStillConnected = bleRoles.some(
          (otherRole) => otherRole !== role && this.getConnection(otherRole).connectedDeviceId === deviceId
        );
        if (!otherRoleStillConnected) {
          await this.adapter.disconnect(deviceId).catch(() => {});
        }
        this.patchConnection(
          role,
          { lifecycle: "error", connectedDeviceId: null, lastError: error.message },
          `${role}-role-not-verified`
        );
        return;
      }
      throw error;
    }
    if (opId !== this.connectionOpSeq[role]) {
      return;
    }

    const resetExtra: Partial<BleState> | undefined =
      role === "power"
        ? { ftmsProfile: outcome.extra?.ftmsProfile ?? null, liveTelemetry: null }
        : role === "heart_rate"
          ? { heartRate: null }
          : undefined;

    this.patchConnection(
      role,
      { lifecycle: "connected", connectedDeviceId: deviceId, lastError: outcome.error },
      `${role}-connected`,
      resetExtra
    );
  }

  async connect(deviceId: string, role: BleRole): Promise<void> {
    await this.connectInternal(deviceId, role, "connect-requested");
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

  private async disconnectInternal(deviceId: string, role: BleRole): Promise<void> {
    const opId = ++this.connectionOpSeq[role];
    this.manualDisconnectDeviceIds.add(deviceId);
    if (role === "power") {
      this.clearReconnectTimeout();
    }
    this.patchConnection(role, { lifecycle: "disconnecting", lastError: null }, `${role}-disconnect-requested`);

    await this.adapter.disconnect(deviceId);
    if (opId !== this.connectionOpSeq[role]) {
      return;
    }

    if (role === "power") {
      this.reconnectAttempts = 0;
    }
    const resetExtra: Partial<BleState> | undefined =
      role === "power" ? { ftmsProfile: null, liveTelemetry: null } : role === "heart_rate" ? { heartRate: null } : undefined;
    this.patchConnection(
      role,
      { lifecycle: "disconnected", connectedDeviceId: null, lastError: null },
      `${role}-disconnected`,
      resetExtra
    );
  }

  async disconnect(deviceId?: string): Promise<void> {
    if (deviceId) {
      const roles = bleRoles.filter((role) => this.getConnection(role).connectedDeviceId === deviceId);
      await Promise.all(roles.map((role) => this.disconnectInternal(deviceId, role)));
      return;
    }

    const active = bleRoles
      .map((role) => ({ role, id: this.getConnection(role).connectedDeviceId }))
      .filter((entry): entry is { role: BleRole; id: string } => entry.id !== null);
    await Promise.all(active.map(({ role, id }) => this.disconnectInternal(id, role)));
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
