import { useState, type ReactElement } from "react";
import {
  bleRoles,
  type BleConnectionEntry,
  type BleRole,
  type BleState,
  type DashboardMetrics,
  type EventPlanWeek
} from "@shared/ipc/contracts";
import { addDaysToDate, findCurrentWeekIndex, formatShortDate, parseIsoDate } from "../lib/planWeeks";

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
  dashboard: DashboardMetrics | null;
  currentFtp: number;
  eventDate: string;
  weeks: EventPlanWeek[];
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  startWorkoutForDay: (workoutId: string, workoutName: string) => Promise<void>;
  onNavigateToPlan: () => void;
};

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const greetingForNow = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export const HomePage = ({
  ble,
  dashboard,
  currentFtp,
  eventDate,
  weeks,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  startWorkoutForDay,
  onNavigateToPlan
}: Props): ReactElement => {
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

  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  const disconnectForRole: Record<BleRole, () => Promise<void>> = {
    power: disconnectDevice,
    heart_rate: disconnectHrDevice,
    cadence: disconnectCadenceDevice
  };

  const lastErrorForRole = (role: BleRole): string | null => {
    if (!bleState) return null;
    return role === "power" ? bleState.lastError : bleState.connections[role].lastError;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const currentWeekIndex = findCurrentWeekIndex(weeks, today);
  const currentWeek = currentWeekIndex >= 0 ? weeks[currentWeekIndex] : null;

  const daysUntilEvent = Math.round((parseIsoDate(eventDate).getTime() - today.getTime()) / 86400000);
  const countdownLabel =
    weeks.length === 0
      ? null
      : daysUntilEvent > 0
        ? `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} to event`
        : daysUntilEvent === 0
          ? "Event day"
          : "Event completed";

  const connectedTrainerDeviceId = bleState?.connectedDeviceId ?? null;
  const selectedDay = currentWeek?.days.find((day) => day.dayIndex === selectedDayIndex) ?? null;

  return (
    <main className="app">
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h1 style={{ margin: "0 0 var(--space-2)" }}>{greetingForNow()}</h1>
        {countdownLabel ? (
          <button
            onClick={onNavigateToPlan}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--color-accent-700)",
              font: "inherit"
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>{countdownLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="8,3 18,12 8,21" />
            </svg>
          </button>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 2,
          background: "var(--color-divider)",
          border: "2px solid var(--color-divider)",
          marginBottom: "var(--space-8)"
        }}
      >
        <div className="card" style={{ borderRadius: 0 }}>
          <h6 style={{ marginBottom: "var(--space-2)" }}>Training status</h6>
          <div className="hr" style={{ margin: "0 0 var(--space-3)" }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                padding: "var(--space-2) 0",
                borderBottom: "1px solid var(--color-divider)"
              }}
            >
              <span className="card-meta">Current FTP</span>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>{currentFtp} W</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                padding: "var(--space-2) 0",
                borderBottom: "1px solid var(--color-divider)"
              }}
            >
              <span className="card-meta">Plan compliance</span>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>
                {dashboard?.planCompliancePercent != null ? `${dashboard.planCompliancePercent}%` : "—"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "var(--space-2) 0" }}>
              <span className="card-meta">Training block</span>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 22 }}>
                {currentWeek ? `Week ${currentWeekIndex + 1} / ${weeks.length}` : "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="card" style={{ borderRadius: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
            <h6 style={{ margin: 0 }}>Devices</h6>
            <button
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: 12 }}
              disabled={actionPending}
              onClick={() => void (bleState?.scanning ? stopScanning() : scanForDevices())}
            >
              {bleState?.scanning ? "Stop scan" : "Scan"}
            </button>
          </div>
          <div className="hr" style={{ margin: "0 0 var(--space-3)" }} />
          {actionError ? (
            <p style={{ color: "var(--color-accent-700)", fontSize: 12, marginBottom: "var(--space-2)" }}>{actionError}</p>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "var(--color-divider)", border: "2px solid var(--color-divider)" }}>
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
                ? `Connected — ${device?.name ?? device?.localName ?? connectedDeviceId}${
                    role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
                  }`
                : cadenceProvidedByPower
                  ? "Provided by trainer connection"
                  : conn?.lifecycle === "connecting"
                    ? "Connecting…"
                    : bleState?.scanning
                      ? "Scanning…"
                      : "Not connected";
              const rowError = lastErrorForRole(role);
              return (
                <div
                  key={role}
                  style={{
                    background: "var(--color-bg)",
                    padding: "var(--space-3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-3)"
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{roleLabel(role)}</div>
                    <div className="card-meta">{statusLabel}</div>
                    {rowError ? (
                      <div className="card-meta" style={{ color: "var(--color-accent-700)" }}>
                        {rowError}
                      </div>
                    ) : null}
                  </div>
                  {isConnected ? (
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      disabled={actionPending}
                      onClick={() => void disconnectForRole[role]()}
                    >
                      Disconnect
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
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)" }}>
        <h2 style={{ margin: 0 }}>This week</h2>
      </div>
      <div className="hr" />
      {currentWeek ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 0, border: "2px solid var(--color-divider)", marginBottom: "var(--space-8)" }}>
          {currentWeek.days.map((day, index) => {
            const cellDate = addDaysToDate(parseIsoDate(currentWeek.startDate), day.dayIndex);
            const isToday = cellDate.getTime() === today.getTime();
            const hasWorkout = day.workoutId !== null;
            return (
              <div
                key={day.dayIndex}
                onClick={hasWorkout ? () => setSelectedDayIndex(day.dayIndex) : undefined}
                style={{
                  padding: "var(--space-3)",
                  borderRight: index < 6 ? "1px solid var(--color-divider)" : undefined,
                  background: isToday ? "var(--color-accent-100)" : "var(--color-bg)",
                  cursor: hasWorkout ? "pointer" : "default",
                  minHeight: 96,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}
              >
                <h6 style={{ margin: 0, color: isToday ? "var(--color-accent-700)" : undefined }}>
                  {dayLabels[day.dayIndex]} · {formatShortDate(cellDate)}
                </h6>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600, overflowWrap: "break-word" }}>
                  {day.workoutName ?? "Rest"}
                </div>
                {hasWorkout ? (
                  <div className="card-meta">
                    {day.durationMin} min{day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-muted" style={{ marginBottom: "var(--space-8)" }}>
          No workouts scheduled for the current week.
        </p>
      )}

      <h2>Recent activity</h2>
      <div className="hr" />
      <table className="table" style={{ marginBottom: "var(--space-8)" }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Workout</th>
            <th>Duration</th>
            <th>Avg power</th>
            <th>Compliance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={5} className="text-muted">
              No completed workouts recorded yet.
            </td>
          </tr>
        </tbody>
      </table>

      {dashboard ? (
        <>
          <h2>Training detail</h2>
          <div className="hr" />
          <p className="card-meta">{dashboard.trendSummary}</p>
          <table className="table">
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
                <td>Planned vs actual load variance %</td>
                <td>{dashboard.plannedVsActualLoadVariancePercent ?? "N/A"}</td>
              </tr>
            </tbody>
          </table>
          {dashboard.ftpTrend.length > 0 ? (
            <>
              <h3>FTP trend</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Captured</th>
                    <th>FTP</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.ftpTrend.map((point) => (
                    <tr key={point.capturedAt}>
                      <td>{point.capturedAt}</td>
                      <td>{point.ftpWatts ?? "N/A"} W</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {dashboard.weeklyLoad.length > 0 ? (
            <>
              <h3>Weekly load</h3>
              <table className="table">
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
          ) : null}
        </>
      ) : null}

      {selectedDay && selectedDay.workoutId ? (
        <div className="dialog-backdrop" onClick={() => setSelectedDayIndex(null)} style={{ zIndex: 100 }}>
          <div className="dialog" onClick={(event) => event.stopPropagation()} style={{ width: "min(480px, 100%)" }}>
            <div className="dialog-title">{selectedDay.workoutName}</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 2,
                background: "var(--color-divider)",
                border: "2px solid var(--color-divider)"
              }}
            >
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6 style={{ fontSize: 11 }}>Duration</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 18 }}>{selectedDay.durationMin} min</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6 style={{ fontSize: 11 }}>IF</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 18 }}>{selectedDay.targetIF ?? "—"}</div>
              </div>
              <div style={{ background: "var(--color-bg)", padding: "var(--space-3)" }}>
                <h6 style={{ fontSize: 11 }}>TSS</h6>
                <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 18, opacity: 0.4 }}>—</div>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedDayIndex(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                disabled={liveWorkoutBusy || isWorkoutSessionActive || !connectedTrainerDeviceId}
                onClick={() => {
                  const workoutId = selectedDay.workoutId as string;
                  const workoutName = selectedDay.workoutName ?? "Workout";
                  setSelectedDayIndex(null);
                  void startWorkoutForDay(workoutId, workoutName);
                }}
              >
                Start ride
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};
