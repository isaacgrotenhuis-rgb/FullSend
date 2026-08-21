import type { ReactElement } from "react";
import { bleRoles, type BleConnectionEntry, type BleDevice, type BleRole, type BleState, type DashboardMetrics } from "@shared/ipc/contracts";

export type BleSectionProps = {
  bleState: BleState | null;
  connectedDevice: BleDevice | null;
  connectedHrDevice: BleDevice | null;
  connectedCadenceDevice: BleDevice | null;
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
  status: string;
  ble: BleSectionProps;
  dashboard: DashboardMetrics | null;
  refreshDashboard: () => Promise<void>;
};

export const HomePage = ({ status, ble, dashboard, refreshDashboard }: Props): ReactElement => {
  const {
    bleState,
    connectedDevice,
    connectedHrDevice,
    connectedCadenceDevice,
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

  return (
    <main className="app">
      <h1>Event Plan Generator</h1>
      <p>{status}</p>

      <section>
        <h2>Trainer connection</h2>
        <p>
          Status: {bleState?.lifecycle ?? "unknown"}
          {connectedDevice
            ? ` — connected to ${connectedDevice.name ?? connectedDevice.localName ?? connectedDevice.id}`
            : ""}
        </p>
        {bleState?.lastError ? <p>Last error: {bleState.lastError}</p> : null}
        <p>
          Heart rate: {bleState?.connections.heart_rate.lifecycle ?? "unknown"}
          {connectedHrDevice
            ? ` — connected to ${connectedHrDevice.name ?? connectedHrDevice.localName ?? connectedHrDevice.id}`
            : ""}
          {bleState?.heartRate?.bpm != null ? ` — HR: ${bleState.heartRate.bpm} bpm` : ""}
        </p>
        {bleState?.connections.heart_rate.lastError ? (
          <p>Heart rate error: {bleState.connections.heart_rate.lastError}</p>
        ) : null}
        <p>
          Cadence: {bleState?.connections.cadence.lifecycle ?? "unknown"}
          {connectedCadenceDevice
            ? ` — connected to ${connectedCadenceDevice.name ?? connectedCadenceDevice.localName ?? connectedCadenceDevice.id}`
            : ""}
        </p>
        {bleState?.connections.cadence.lastError ? (
          <p>Cadence error: {bleState.connections.cadence.lastError}</p>
        ) : null}
        {actionError ? <p>Action error: {actionError}</p> : null}
        <div className="row">
          <button onClick={() => void scanForDevices()} disabled={actionPending || bleState?.scanning}>
            {bleState?.scanning ? "Scanning..." : "Scan for devices"}
          </button>
          {bleState?.scanning ? (
            <button onClick={() => void stopScanning()} disabled={actionPending}>
              Stop scan
            </button>
          ) : null}
          <button onClick={() => void disconnectDevice()} disabled={actionPending || !bleState?.connectedDeviceId}>
            Disconnect trainer
          </button>
          <button
            onClick={() => void disconnectHrDevice()}
            disabled={actionPending || !bleState?.connections.heart_rate.connectedDeviceId}
          >
            Disconnect heart rate
          </button>
          <button
            onClick={() => void disconnectCadenceDevice()}
            disabled={actionPending || !bleState?.connections.cadence.connectedDeviceId}
          >
            Disconnect cadence
          </button>
        </div>
        {!bleState || bleState.discoveredDevices.length === 0 ? (
          <p>No devices discovered yet. Click "Scan for devices".</p>
        ) : (
          <ul>
            {bleState.discoveredDevices.map((device) => {
              const rolesToOffer = device.roles.length > 0 ? device.roles : bleRoles;
              return (
                <li key={device.id}>
                  {device.name ?? device.localName ?? "Unknown device"} ({device.id})
                  {device.roles.length > 0 ? ` — ${device.roles.join(", ")}` : ""}
                  {typeof device.rssi === "number" ? ` — RSSI ${device.rssi}` : ""}{" "}
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
                        onClick={() => void connectToDevice(device.id, role)}
                        disabled={connectDisabled}
                      >
                        {isConnected ? `${roleLabel(role)}: connected` : `Connect as ${roleLabel(role)}`}
                      </button>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Progress dashboard</h2>
        <button onClick={() => void refreshDashboard()}>Refresh metrics</button>
        {!dashboard ? (
          <p>No metrics loaded yet.</p>
        ) : (
          <>
            <p>{dashboard.trendSummary}</p>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Completed workouts</td>
                  <td>{dashboard.completedWorkoutsCount}</td>
                </tr>
                <tr>
                  <td>Plan compliance %</td>
                  <td>{dashboard.planCompliancePercent ?? "N/A"}</td>
                </tr>
                <tr>
                  <td>Planned vs actual load variance %</td>
                  <td>{dashboard.plannedVsActualLoadVariancePercent ?? "N/A"}</td>
                </tr>
              </tbody>
            </table>
            <h3>FTP trend</h3>
            {dashboard.ftpTrend.length === 0 ? (
              <p>No FTP snapshots yet.</p>
            ) : (
              <ul>
                {dashboard.ftpTrend.map((point) => (
                  <li key={point.capturedAt}>
                    {point.capturedAt}: {point.ftpWatts ?? "N/A"} W
                  </li>
                ))}
              </ul>
            )}
            <h3>Weekly load</h3>
            <table>
              <thead>
                <tr>
                  <th>Week start</th>
                  <th>Planned</th>
                  <th>Actual</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.weeklyLoad.map((row) => (
                  <tr key={row.weekStart}>
                    <td>{row.weekStart}</td>
                    <td>{row.plannedLoad}</td>
                    <td>{row.actualLoad}</td>
                    <td>{row.variance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
};
