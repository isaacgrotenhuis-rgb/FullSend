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

export const connectedCount = (state: BleState | null): number =>
  state
    ? [
        state.connectedDeviceId !== null,
        state.connections.heart_rate.connectedDeviceId !== null,
        state.connections.cadence.connectedDeviceId !== null
      ].filter(Boolean).length
    : 0;

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
    .filter((device) => device.roles.includes(role))
    // An FTMS trainer already streams cadence over its power connection (Indoor
    // Bike Data) — offering it again as a standalone cadence candidate invites
    // connecting the same device twice, which tears down the working power
    // connection when its standalone CSC service (if any) doesn't verify.
    .filter((device) => !(role === "cadence" && device.roles.includes("power")))
    .sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity));
  return matches[0] ?? null;
};

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
  useEffect(() => {
    if (!scanning) return;
    const id = setInterval(() => forceTick((tick) => tick + 1), 200);
    return () => clearInterval(id);
  }, [scanning]);

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
          {scanning ? (
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void stopScanning()}>
              Stop
            </button>
          ) : null}
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
          // The power connection already streams cadence for FTMS trainers (Indoor
          // Bike Data), so a bare cadence role never needs its own connection there.
          const cadenceProvidedByPower =
            role === "cadence" && !isConnected && bleState?.liveTelemetry?.cadenceRpm != null;
          const candidate = !isConnected && !cadenceProvidedByPower && bleState ? candidateForRole(bleState, role) : null;
          const rowError = lastErrorForRole(role);
          const Icon = roleIcons[role];
          const iconColor = isConnected
            ? "var(--color-text)"
            : required
              ? "var(--color-accent)"
              : "var(--color-neutral-500)";
          const actionVariant = required ? "btn-primary" : "btn-secondary";

          let statusLabel: string;
          let action: ReactElement | null;

          if (isConnected) {
            statusLabel = `${connectedDevice ? deviceLabel(connectedDevice) : connectedDeviceId}${
              role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
            }`;
            action = (
              <button className="btn btn-ghost btn-block" disabled={actionPending} onClick={() => void disconnectForRole[role]()}>
                Forget
              </button>
            );
          } else if (cadenceProvidedByPower) {
            statusLabel = "Provided by trainer connection";
            action = null;
          } else if (isConnecting) {
            statusLabel = "Connecting…";
            action = (
              <button className={`btn btn-block ${actionVariant}`} disabled>
                Connecting
              </button>
            );
          } else if (candidate) {
            statusLabel = `${deviceLabel(candidate)} found`;
            action = (
              <button
                className={`btn btn-block ${actionVariant}`}
                disabled={actionPending}
                onClick={() => void connectToDevice(candidate.id, role)}
              >
                Pair
              </button>
            );
          } else if (scanning) {
            statusLabel = "Scanning…";
            action = (
              <button className={`btn btn-block ${actionVariant}`} disabled>
                Scanning
              </button>
            );
          } else {
            statusLabel = hasScannedOnce ? "No devices found · check it's awake" : `${required ? "Required" : "Optional"} · not connected`;
            action = (
              <button className={`btn btn-block ${actionVariant}`} disabled={actionPending} onClick={() => void scanForDevices()}>
                Scan
              </button>
            );
          }

          const showProgress = scanning && !isConnected && !cadenceProvidedByPower && !candidate;

          return (
            <div key={role} className="device-cell">
              <Icon size={30} strokeWidth={2} style={{ color: iconColor }} strokeLinecap="square" />
              <div className="device-cell-name">{roleLabel(role)}</div>
              <div className="device-cell-status">{statusLabel}</div>
              {rowError ? <div className="device-cell-status" style={{ color: "var(--color-accent-700)" }}>{rowError}</div> : null}
              {showProgress ? (
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
