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
  type BleRememberedDevice,
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

  // Auto-connect: at launch (and on "Reconnect") scan quietly and connect each
  // remembered device as it shows up, for up to autoConnectWindowMs.
  private readonly autoConnectWindowMs: number;
  private readonly autoConnectRetryMs = 5000;
  private autoConnectTimer: NodeJS.Timeout | null = null;
  private autoConnectRun = 0;
  // True while the adapter scan was started by auto-connect, so a manual
  // scan's timeout doesn't stop it out from under the search.
  private autoScanActive = false;
  private autoConnectAttemptAt = new Map<BleRole, number>();
  // Roles the rider disconnected this session: not auto-connected again until
  // they press Reconnect or pair something for that role.
  private autoConnectSuppressed = new Set<BleRole>();
  private resumeAutoConnectOnPowerOn = false;

  constructor(options?: {
    adapter?: BleAdapter;
    transitionStore?: BleTransitionStore;
    deviceStore?: BleDeviceStore;
    autoConnectWindowMs?: number;
  }) {
    this.adapter = options?.adapter ?? new NobleBleAdapter();
    this.transitionStore = options?.transitionStore;
    this.deviceStore = options?.deviceStore;
    this.autoConnectWindowMs = options?.autoConnectWindowMs ?? 120_000;
    this.state = { ...this.state, remembered: this.deviceStore?.listRemembered() ?? [] };
    this.bindAdapterEvents();
  }

  private bindAdapterEvents(): void {
    this.adapter.onDeviceDiscovered((device) => {
      this.upsertDevice(device);
      this.maybeAutoConnect(device.id);
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
    if (this.state.autoConnect.status === "searching") {
      // The scan died with the radio; pick the search back up when it returns.
      this.resumeAutoConnectOnPowerOn = true;
      this.endAutoConnectSearch("not-found", false);
    }
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
    if (this.resumeAutoConnectOnPowerOn) {
      this.resumeAutoConnectOnPowerOn = false;
      void this.startAutoConnect();
    }
  }

  /** Remembered devices that should be connected automatically right now. */
  private autoConnectTargets(): BleRememberedDevice[] {
    return this.state.remembered.filter(
      (device) =>
        device.autoConnect &&
        !this.autoConnectSuppressed.has(device.role) &&
        this.getConnection(device.role).connectedDeviceId === null
    );
  }

  async startAutoConnect(): Promise<void> {
    const targets = this.autoConnectTargets();
    if (targets.length === 0) {
      // Nothing remembered: don't touch the radio (or trigger the macOS
      // Bluetooth prompt) for a rider who hasn't paired anything yet.
      this.refreshAutoConnect();
      return;
    }
    const run = ++this.autoConnectRun;
    this.autoConnectAttemptAt.clear();
    this.setState({ autoConnect: { status: "searching", roles: targets.map((device) => device.role) } }, "auto-connect-started");
    try {
      await this.ensureInitialized();
      if (run !== this.autoConnectRun) return;
      await this.adapter.startScan();
      this.autoScanActive = true;
    } catch (error) {
      if (run !== this.autoConnectRun) return;
      // Usually Bluetooth being off at launch: search once it comes on.
      console.warn("[BleService] auto-connect couldn't start scanning:", error);
      this.resumeAutoConnectOnPowerOn = true;
      this.endAutoConnectSearch("not-found", false);
      return;
    }
    if (run !== this.autoConnectRun) return;
    this.clearAutoConnectTimer();
    this.autoConnectTimer = setTimeout(() => {
      this.endAutoConnectSearch("not-found");
    }, this.autoConnectWindowMs);
    // Already seen this session (a manual scan, or the scan that just started).
    for (const device of this.state.discoveredDevices) {
      this.maybeAutoConnect(device.id);
    }
  }

  async reconnectRemembered(role: BleRole): Promise<void> {
    this.autoConnectSuppressed.delete(role);
    await this.startAutoConnect();
  }

  forgetDevice(role: BleRole): void {
    this.deviceStore?.forget(role);
    this.autoConnectSuppressed.delete(role);
    this.setState({ remembered: this.state.remembered.filter((device) => device.role !== role) }, `${role}-forgotten`);
    this.refreshAutoConnect();
  }

  setAutoConnect(role: BleRole, enabled: boolean): void {
    if (!this.state.remembered.some((device) => device.role === role)) {
      throw new Error("No remembered device for that role");
    }
    this.deviceStore?.setAutoConnect(role, enabled);
    this.setState(
      {
        remembered: this.state.remembered.map((device) =>
          device.role === role ? { ...device, autoConnect: enabled } : device
        )
      },
      `${role}-auto-connect-${enabled ? "on" : "off"}`
    );
    this.refreshAutoConnect();
  }

  private maybeAutoConnect(deviceId: string): void {
    if (this.state.autoConnect.status !== "searching") return;
    for (const target of this.autoConnectTargets()) {
      if (target.deviceId !== deviceId || this.getConnection(target.role).lifecycle === "connecting") continue;
      // Advertisements repeat several times a second; don't hammer a device
      // that just refused a connect.
      const lastAttempt = this.autoConnectAttemptAt.get(target.role);
      if (lastAttempt !== undefined && Date.now() - lastAttempt < this.autoConnectRetryMs) continue;
      this.autoConnectAttemptAt.set(target.role, Date.now());
      void this.connectInternal(deviceId, target.role, "auto-connect").catch((error: unknown) => {
        // The row shows the error; keep searching and retry on a later advertisement.
        console.warn(`[BleService] auto-connect to ${deviceId} as ${target.role} failed:`, error);
      });
    }
  }

  /** Re-derive the search's roles after a connect, disconnect, forget or toggle; finish it once none are left. */
  private refreshAutoConnect(): void {
    const { status, roles: currentRoles } = this.state.autoConnect;
    if (status === "idle") return;
    const roles = this.autoConnectTargets()
      .map((device) => device.role)
      .filter((role) => status === "searching" || currentRoles.includes(role));
    if (roles.length === 0) {
      this.endAutoConnectSearch("idle");
      return;
    }
    if (roles.join() !== currentRoles.join()) {
      this.setState({ autoConnect: { status, roles } }, "auto-connect-updated");
    }
  }

  private endAutoConnectSearch(status: "idle" | "not-found", stopScan = true): void {
    this.autoConnectRun += 1;
    this.clearAutoConnectTimer();
    if (this.autoScanActive) {
      this.autoScanActive = false;
      // Leave a manual scan the rider started running.
      if (stopScan && !this.state.scanning) {
        void this.adapter.stopScan().catch(() => {});
      }
    }
    const roles = status === "not-found" ? this.autoConnectTargets().map((device) => device.role) : [];
    this.setState(
      { autoConnect: { status: roles.length > 0 ? status : "idle", roles } },
      `auto-connect-${roles.length > 0 ? status : "done"}`
    );
  }

  private clearAutoConnectTimer(): void {
    if (this.autoConnectTimer) {
      clearTimeout(this.autoConnectTimer);
      this.autoConnectTimer = null;
    }
  }

  private rememberDevice(deviceId: string, role: BleRole): void {
    const discovered = this.state.discoveredDevices.find((item) => item.id === deviceId);
    const existing = this.state.remembered.find((device) => device.role === role);
    const sameDevice = existing?.deviceId === deviceId;
    const remembered: BleRememberedDevice = {
      role,
      deviceId,
      name: discovered?.name ?? discovered?.localName ?? (sameDevice ? existing.name : null),
      // Keep the rider's auto-connect choice for a device they've paired before.
      autoConnect: sameDevice ? existing.autoConnect : true
    };
    this.deviceStore?.remember(remembered);
    this.setState(
      { remembered: [remembered, ...this.state.remembered.filter((device) => device.role !== role)] },
      `${role}-remembered`
    );
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
    if (!this.autoScanActive) {
      await this.adapter.stopScan();
    }
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
    this.rememberDevice(deviceId, role);
    this.refreshAutoConnect();
  }

  async connect(deviceId: string, role: BleRole): Promise<void> {
    this.autoConnectSuppressed.delete(role);
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
    this.autoConnectSuppressed.add(role);
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
        "Remembered devices connect automatically at launch. A Whoop can only connect to one app at a time, so turn auto-connect off for it if another app needs it."
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
