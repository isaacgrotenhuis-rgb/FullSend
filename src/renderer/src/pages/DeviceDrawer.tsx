import type { ReactElement } from "react";
import { Heart, RefreshCw, Zap, type LucideIcon } from "lucide-react";
import {
  bleRoles,
  type BleConnectionEntry,
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
// connection's Indoor Bike Data. Shared so the nav cluster and the drawer
// can't drift into disagreeing about it.
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

  const count = connectedCount(bleState);
  const summary = bleState?.scanning ? "Scanning…" : `${count} of 3 connected`;

  return (
    <div id="device-drawer" className="device-drawer" role="region" aria-label="Devices">
      <div className="device-drawer-header">
        <span className="device-drawer-title">Devices</span>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <span className="card-meta">{summary}</span>
          <button
            className="btn btn-secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            disabled={actionPending}
            onClick={() => void (bleState?.scanning ? stopScanning() : scanForDevices())}
          >
            {bleState?.scanning ? "Stop scan" : "Scan"}
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
          const device = connectedDeviceId
            ? (bleState?.discoveredDevices.find((candidate) => candidate.id === connectedDeviceId) ?? null)
            : null;
          const isConnected = connectedDeviceId !== null;
          // The power connection already streams cadence for FTMS trainers (Indoor
          // Bike Data), so a bare cadence role never needs its own connection there.
          const cadenceProvidedByPower =
            role === "cadence" && !isConnected && bleState?.liveTelemetry?.cadenceRpm != null;
          const statusLabel = isConnected
            ? `${device?.name ?? device?.localName ?? connectedDeviceId}${
                role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
              }`
            : cadenceProvidedByPower
              ? "Provided by trainer connection"
              : conn?.lifecycle === "connecting"
                ? "Connecting…"
                : bleState?.scanning
                  ? "Scanning…"
                  : isRequiredRole(role)
                    ? "Required · not connected"
                    : "Optional · not connected";
          const rowError = lastErrorForRole(role);
          const Icon = roleIcons[role];
          const iconColor = isRoleConnected(bleState, role)
            ? "var(--color-text)"
            : isRequiredRole(role)
              ? "var(--color-accent)"
              : "var(--color-neutral-500)";

          return (
            <div key={role} className="device-cell">
              <Icon size={30} strokeWidth={2} style={{ color: iconColor }} strokeLinecap="square" />
              <div className="device-cell-name">{roleLabel(role)}</div>
              <div className="device-cell-status">{statusLabel}</div>
              {rowError ? <div className="device-cell-status" style={{ color: "var(--color-accent-700)" }}>{rowError}</div> : null}
              {isConnected ? (
                <button className="btn btn-ghost btn-block" disabled={actionPending} onClick={() => void disconnectForRole[role]()}>
                  Forget
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {bleState && bleState.discoveredDevices.length > 0 ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <div className="card-meta" style={{ marginBottom: 6 }}>
            Available devices
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bleState.discoveredDevices.map((device) => {
              // A device that serves the power role over FTMS already streams cadence
              // on that same connection (Indoor Bike Data) -- offering a separate
              // "Cadence" connect button for it invites connecting the same device
              // twice, which tears down the working power connection when the
              // device's standalone CSC cadence service (if any) doesn't verify.
              const rolesToOffer = (device.roles.length > 0 ? device.roles : bleRoles).filter(
                (role) => !(role === "cadence" && device.roles.includes("power"))
              );
              return (
                <div
                  key={device.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)", fontSize: 12 }}
                >
                  <span>
                    {device.name ?? device.localName ?? "Unknown device"}
                    {typeof device.rssi === "number" ? ` · RSSI ${device.rssi}` : ""}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {rolesToOffer.map((role) => {
                      const conn = getRoleConnection(bleState, role);
                      const isConnected = conn.connectedDeviceId === device.id;
                      const connectDisabled =
                        actionPending ||
                        isConnected ||
                        conn.lifecycle === "connecting" ||
                        (conn.connectedDeviceId !== null && !isConnected);
                      return (
                        <button
                          key={role}
                          className="btn btn-secondary"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => void connectToDevice(device.id, role)}
                          disabled={connectDisabled}
                        >
                          {isConnected ? `${roleLabel(role)} ✓` : `+ ${roleLabel(role)}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};
