import { useEffect, useState, type ReactElement } from "react";
import { Heart, RefreshCw, Zap, type LucideIcon } from "lucide-react";
import {
  bleRoles,
  type BleConnectionEntry,
  type BleDevice,
  type BleRole,
  type BleState
} from "@shared/ipc/contracts";

export type BleSectionProps = {
  bleState: BleState | null;
  actionError: string | null;
  actionPending: boolean;
  scanForDevices: () => Promise<void>;
  stopScanning: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  disconnectHrDevice: () => Promise<void>;
  disconnectCadenceDevice: () => Promise<void>;
  getRoleConnection: (state: BleState, role: BleRole) => BleConnectionEntry;
  roleLabel: (role: BleRole) => string;
  connectToDevice: (deviceId: string, role: BleRole) => Promise<void>;
};

type Props = {
  ble: BleSectionProps;
  open: boolean;
  onClose: () => void;
};

// Power/trainer is the only device anything in this app gates on today
// (see App.confirmStartWorkout) — treat it as the sole "required" role rather
// than adding a schema field for a distinction that has exactly one member.
export const isRequiredRole = (role: BleRole): boolean => role === "power";

export const requiredMissing = (state: BleState | null): boolean =>
  state ? state.connectedDeviceId === null : true;

// "Connected" for a role means either its own BLE connection is live, or —
// cadence only — an FTMS trainer is already streaming it over the power
// connection's Indoor Bike Data (see the cadence-cell comment below). Shared
// so the nav cluster and the drawer can't drift into disagreeing about it
// the way they did before this was a single function.
export const isRoleConnected = (state: BleState | null, role: BleRole): boolean => {
  if (!state) return false;
  const ownConnection = role === "power" ? state.connectedDeviceId !== null : state.connections[role].connectedDeviceId !== null;
  if (ownConnection) return true;
  return role === "cadence" && state.liveTelemetry?.cadenceRpm != null;
};

export const connectedCount = (state: BleState | null): number =>
  bleRoles.filter((role) => isRoleConnected(state, role)).length;

export const roleIcons: Record<BleRole, LucideIcon> = {
  power: Zap,
  heart_rate: Heart,
  cadence: RefreshCw
};

// Must match the timeout App.scanForDevices passes to window.kickr.ble.startScan —
// there's no scan-progress field on BleState, so the drawer times its own progress
// bar/countdown against this shared constant rather than the real BLE stack state.
export const SCAN_TIMEOUT_MS = 8000;

const deviceLabel = (device: BleDevice): string => device.name ?? device.localName ?? "Unknown device";

// Only one physical BLE scan can run at a time regardless of which cell's "Scan"
// was clicked, so every cell reads from the same discoveredDevices list — this
// picks, per cell, the strongest candidate that advertises that role.
const candidateForRole = (state: BleState, role: BleRole): BleDevice | null => {
  const matches = state.discoveredDevices
    // An empty roles array means the adapter couldn't classify the advertisement
    // (BleService: advertised roles are "a UI hint, not authoritative") — offer
    // such a device to every cell rather than making it unpairable everywhere.
    .filter((device) => device.roles.length === 0 || device.roles.includes(role))
    // An FTMS trainer already streams cadence over its power connection (Indoor
    // Bike Data) — offering it again as a standalone cadence candidate invites
    // connecting the same device twice, which tears down the working power
    // connection when its standalone CSC service (if any) doesn't verify.
    .filter((device) => !(role === "cadence" && device.roles.includes("power")))
    .sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity));
  return matches[0] ?? null;
};

type CellPhase =
  | { kind: "connected" }
  | { kind: "provided-by-power" }
  | { kind: "connecting" }
  | { kind: "candidate"; device: BleDevice }
  | { kind: "scanning" }
  | { kind: "idle" };

export const DeviceDrawer = ({ ble, open, onClose }: Props): ReactElement | null => {
  const {
    bleState,
    actionError,
    actionPending,
    scanForDevices,
    stopScanning,
    disconnectDevice,
    disconnectHrDevice,
    disconnectCadenceDevice,
    getRoleConnection,
    roleLabel,
    connectToDevice
  } = ble;

  const scanning = bleState?.scanning ?? false;
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [hasScannedOnce, setHasScannedOnce] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (scanning) {
      setHasScannedOnce(true);
      setScanStartedAt((prev) => prev ?? Date.now());
    } else {
      setScanStartedAt(null);
    }
  }, [scanning]);

  // The countdown/progress bar are purely cosmetic — a plain interval re-render
  // is enough to move them without hauling in a request-animation-frame loop.
  // Gated on `open` too so a scan left running after the drawer is closed
  // doesn't keep re-rendering a hidden component 5 times a second.
  useEffect(() => {
    if (!open || !scanning) return;
    const id = setInterval(() => forceTick((tick) => tick + 1), 200);
    return () => clearInterval(id);
  }, [open, scanning]);

  if (!open) return null;

  const disconnectForRole: Record<BleRole, () => Promise<void>> = {
    power: disconnectDevice,
    heart_rate: disconnectHrDevice,
    cadence: disconnectCadenceDevice
  };

  const lastErrorForRole = (role: BleRole): string | null => {
    if (!bleState) return null;
    return role === "power" ? bleState.lastError : bleState.connections[role].lastError;
  };

  const elapsedMs = scanStartedAt ? Date.now() - scanStartedAt : 0;
  const remainingSec = Math.max(0, Math.ceil((SCAN_TIMEOUT_MS - elapsedMs) / 1000));
  const progressPercent = Math.min(100, (elapsedMs / SCAN_TIMEOUT_MS) * 100);

  const count = connectedCount(bleState);
  const summary = scanning ? `Scanning… ${remainingSec}s remaining` : `${count} of 3 connected`;

  return (
    <div id="device-drawer" className="device-drawer" role="region" aria-label="Devices">
      <div className="device-drawer-header">
        <span className="device-drawer-title">Devices</span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span className="card-meta">{summary}</span>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            disabled={!scanning && actionPending}
            onClick={() => void (scanning ? stopScanning() : scanForDevices())}
          >
            {scanning ? "Stop" : "Scan"}
          </button>
          <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {actionError ? (
        <p style={{ color: "var(--color-accent-700)", fontSize: 12, margin: "var(--space-2) 0 0" }}>{actionError}</p>
      ) : null}

      <div className="device-grid">
        {bleRoles.map((role) => {
          const conn = bleState ? getRoleConnection(bleState, role) : null;
          const connectedDeviceId = conn?.connectedDeviceId ?? null;
          const isConnected = connectedDeviceId !== null;
          const connectedDevice = connectedDeviceId
            ? (bleState?.discoveredDevices.find((d) => d.id === connectedDeviceId) ?? null)
            : null;
          const isConnecting = conn?.lifecycle === "connecting";
          const required = isRequiredRole(role);
          // Only ever true for cadence today (a trainer's power connection already
          // streams it over Indoor Bike Data), expressed generically off the same
          // isRoleConnected() the nav cluster uses rather than a second hand-rolled
          // liveTelemetry check that could drift from it.
          const providedByPower = !isConnected && isRoleConnected(bleState, role);
          const candidate = !isConnected && !providedByPower && bleState ? candidateForRole(bleState, role) : null;
          const rowError = lastErrorForRole(role);
          const Icon = roleIcons[role];
          const iconColor = isRoleConnected(bleState, role)
            ? "var(--color-text)"
            : required
              ? "var(--color-accent)"
              : "var(--color-neutral-500)";
          const actionVariant = required ? "btn-primary" : "btn-secondary";

          const phase: CellPhase = isConnected
            ? { kind: "connected" }
            : providedByPower
              ? { kind: "provided-by-power" }
              : isConnecting
                ? { kind: "connecting" }
                : candidate
                  ? { kind: "candidate", device: candidate }
                  : scanning
                    ? { kind: "scanning" }
                    : { kind: "idle" };

          // Single source for both the label/button below AND whether the scan
          // progress bar shows, so the two can't independently disagree about
          // which state a cell is actually in.
          const actionButton = (label: string, onClick: (() => void) | null, disabled: boolean): ReactElement => (
            <button
              className={`btn btn-block ${actionVariant}`}
              disabled={disabled}
              onClick={onClick ? () => void onClick() : undefined}
            >
              {label}
            </button>
          );

          let statusLabel: string;
          let action: ReactElement | null;

          switch (phase.kind) {
            case "connected":
              statusLabel = `${connectedDevice ? deviceLabel(connectedDevice) : connectedDeviceId}${
                role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
              }`;
              action = (
                <button className="btn btn-ghost btn-block" disabled={actionPending} onClick={() => void disconnectForRole[role]()}>
                  Forget
                </button>
              );
              break;
            case "provided-by-power":
              statusLabel = "Provided by trainer connection";
              action = null;
              break;
            case "connecting":
              statusLabel = "Connecting…";
              action = actionButton("Connecting", null, true);
              break;
            case "candidate":
              statusLabel = `${deviceLabel(phase.device)} found${typeof phase.device.rssi === "number" ? ` · RSSI ${phase.device.rssi}` : ""}`;
              action = actionButton("Pair", () => connectToDevice(phase.device.id, role), actionPending);
              break;
            case "scanning":
              statusLabel = "Scanning…";
              action = actionButton("Scanning", null, true);
              break;
            case "idle":
              statusLabel = hasScannedOnce ? "No devices found · check it's awake" : `${required ? "Required" : "Optional"} · not connected`;
              action = actionButton("Scan", () => scanForDevices(), actionPending);
              break;
          }

          return (
            <div key={role} className="device-cell">
              <Icon size={30} strokeWidth={2} style={{ color: iconColor }} strokeLinecap="square" />
              <div className="device-cell-name">{roleLabel(role)}</div>
              <div className="device-cell-status">{statusLabel}</div>
              {rowError ? <div className="device-cell-status" style={{ color: "var(--color-accent-700)" }}>{rowError}</div> : null}
              {phase.kind === "scanning" ? (
                <div className="device-progress">
                  <div className="device-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
              ) : null}
              {action}
            </div>
          );
        })}
      </div>
    </div>
  );
};
