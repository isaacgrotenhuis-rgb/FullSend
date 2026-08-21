import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  BleState,
  DashboardMetrics,
  DayAvailability,
  EventPlanAuditEntry,
  EventPlanVersion,
  EventPlanWeek,
  EventType,
  PlanLengthWeeks,
  StravaStatus,
  StravaSyncEventSummary,
  WorkoutInterval,
  WorkoutSessionState
} from "@shared/ipc/contracts";
import { formatClock, WorkoutTimelineChart } from "./WorkoutTimelineChart";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type SmokeCheck = {
  name: string;
  status: "pending" | "passed" | "failed" | "warning";
  detail: string;
};

const defaultAvailability = (): DayAvailability[] =>
  dayLabels.map((_label, dayIndex) => ({
    dayIndex,
    canTrain: dayIndex === 2 || dayIndex === 4 || dayIndex === 6,
    maxDurationMin: dayIndex === 6 ? 150 : 90
  }));

const todayIso = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const App = (): ReactElement => {
  const [eventType, setEventType] = useState<EventType>("road-race");
  const [eventDate, setEventDate] = useState(todayIso());
  const [planLengthWeeks, setPlanLengthWeeks] = useState<PlanLengthWeeks>(12);
  const [currentFtp, setCurrentFtp] = useState(250);
  const [weeklyAvailability, setWeeklyAvailability] = useState<DayAvailability[]>(defaultAvailability());
  const [reason, setReason] = useState("Initial event plan generation");
  const [status, setStatus] = useState("");
  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [stravaStatus, setStravaStatus] = useState<StravaStatus | null>(null);
  const [stravaAuthCode, setStravaAuthCode] = useState("");
  const [stravaAuthState, setStravaAuthState] = useState("");
  const [stravaAuthUrl, setStravaAuthUrl] = useState("");
  const [smokeChecks, setSmokeChecks] = useState<SmokeCheck[]>([]);
  const [runningSmoke, setRunningSmoke] = useState(false);

  const [bleState, setBleState] = useState<BleState | null>(null);
  const [bleActionPending, setBleActionPending] = useState(false);
  const [bleActionError, setBleActionError] = useState<string | null>(null);

  const [workoutSessionState, setWorkoutSessionState] = useState<WorkoutSessionState | null>(null);
  const [activeIntervals, setActiveIntervals] = useState<WorkoutInterval[] | null>(null);
  const [activeWorkoutName, setActiveWorkoutName] = useState<string | null>(null);
  const [liveWorkoutBusy, setLiveWorkoutBusy] = useState(false);
  const [liveWorkoutError, setLiveWorkoutError] = useState<string | null>(null);
  const [rampDurationInput, setRampDurationInput] = useState("15");

  const [planId, setPlanId] = useState("");
  const [weeks, setWeeks] = useState<EventPlanWeek[]>([]);
  const [versions, setVersions] = useState<EventPlanVersion[]>([]);
  const [auditEntries, setAuditEntries] = useState<EventPlanAuditEntry[]>([]);

  const [adaptReason, setAdaptReason] = useState("Adapt plan based on latest constraints");
  const [adaptationPrompt, setAdaptationPrompt] = useState("");
  const [overrideFtp, setOverrideFtp] = useState<string>("");
  const [overrideDate, setOverrideDate] = useState("");

  const canGenerate = useMemo(
    () => weeklyAvailability.filter((day) => day.canTrain).length >= 2,
    [weeklyAvailability]
  );

  useEffect(() => {
    const unsubscribe = window.kickr.ble.subscribeState((nextState) => {
      setBleState(nextState);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void (async () => {
      const current = await window.kickr.eventPlan.getCurrent();
      if (current) {
        setPlanId(current.planId);
        setWeeks(current.weeks);
        await refreshHistory(current.planId);
      }
    })();
  }, []);

  const connectedDevice = useMemo(
    () => bleState?.discoveredDevices.find((device) => device.id === bleState.connectedDeviceId) ?? null,
    [bleState]
  );

  const connectedHrDevice = useMemo(
    () => bleState?.discoveredDevices.find((device) => device.id === bleState.connectedHrDeviceId) ?? null,
    [bleState]
  );

  const runBleAction = async (action: () => Promise<unknown>): Promise<void> => {
    setBleActionPending(true);
    setBleActionError(null);
    try {
      await action();
    } catch (error) {
      console.error("[ble action]", error);
      setBleActionError(error instanceof Error ? error.message : "Unknown BLE error");
    } finally {
      setBleActionPending(false);
    }
  };

  const scanForDevices = (): Promise<void> =>
    runBleAction(() => window.kickr.ble.startScan({ timeoutMs: 8000 }));

  const stopScanning = (): Promise<void> => runBleAction(() => window.kickr.ble.stopScan());

  const connectToDevice = (deviceId: string): Promise<void> =>
    runBleAction(() => window.kickr.ble.connect({ deviceId }));

  const disconnectDevice = (): Promise<void> =>
    runBleAction(() =>
      window.kickr.ble.disconnect(
        bleState?.connectedDeviceId ? { deviceId: bleState.connectedDeviceId } : {}
      )
    );

  const disconnectHrDevice = (): Promise<void> =>
    runBleAction(() =>
      window.kickr.ble.disconnect(
        bleState?.connectedHrDeviceId ? { deviceId: bleState.connectedHrDeviceId } : {}
      )
    );

  useEffect(() => {
    const unsubscribe = window.kickr.workout.subscribeSession((nextState) => {
      setWorkoutSessionState(nextState);
      setRampDurationInput(String(nextState.rampDurationSec));
    });
    return unsubscribe;
  }, []);

  const isWorkoutSessionActive =
    workoutSessionState?.lifecycle === "running" || workoutSessionState?.lifecycle === "paused";

  const runWorkoutAction = async (action: () => Promise<unknown>): Promise<void> => {
    setLiveWorkoutBusy(true);
    setLiveWorkoutError(null);
    try {
      await action();
    } catch (error) {
      console.error("[workout action]", error);
      setLiveWorkoutError(error instanceof Error ? error.message : "Unknown workout error");
    } finally {
      setLiveWorkoutBusy(false);
    }
  };

  const startWorkoutForDay = async (workoutId: string, workoutName: string): Promise<void> => {
    if (!bleState?.connectedDeviceId) {
      setLiveWorkoutError("Connect a trainer before starting a workout.");
      return;
    }
    const deviceId = bleState.connectedDeviceId;
    await runWorkoutAction(async () => {
      const detail = await window.kickr.workoutLibrary.getWorkoutDetail({ workoutId });
      setActiveIntervals(detail.intervals);
      setActiveWorkoutName(workoutName);
      await window.kickr.workout.startSession({
        deviceId,
        workoutId,
        intervals: detail.intervals,
        metadata: { source: "plan" }
      });
    });
  };

  const pauseWorkout = async (): Promise<void> => {
    const sessionId = workoutSessionState?.sessionId;
    if (!sessionId) {
      return;
    }
    await runWorkoutAction(() => window.kickr.workout.pauseSession({ sessionId }));
  };

  const resumeWorkout = async (): Promise<void> => {
    const sessionId = workoutSessionState?.sessionId;
    if (!sessionId) {
      return;
    }
    await runWorkoutAction(() => window.kickr.workout.resumeSession({ sessionId }));
  };

  const stopWorkout = async (): Promise<void> => {
    const sessionId = workoutSessionState?.sessionId;
    if (!sessionId) {
      return;
    }
    await runWorkoutAction(() => window.kickr.workout.stopSession({ sessionId }));
  };

  const adjustIntensity = async (deltaFraction: number): Promise<void> => {
    const sessionId = workoutSessionState?.sessionId;
    if (!sessionId) {
      return;
    }
    const current = workoutSessionState.intensityMultiplier;
    const next = Math.min(1.5, Math.max(0.5, Math.round((current + deltaFraction) * 100) / 100));
    await runWorkoutAction(() => window.kickr.workout.setIntensity({ sessionId, intensityMultiplier: next }));
  };

  const applyRampDuration = async (): Promise<void> => {
    const sessionId = workoutSessionState?.sessionId;
    if (!sessionId) {
      return;
    }
    const parsed = Number(rampDurationInput);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const clamped = Math.min(60, Math.max(0, Math.round(parsed)));
    await runWorkoutAction(() => window.kickr.workout.setRampDuration({ sessionId, rampDurationSec: clamped }));
  };

  const closeLiveWorkout = (): void => {
    setActiveIntervals(null);
    setActiveWorkoutName(null);
    setLiveWorkoutError(null);
  };

  const refreshHistory = async (activePlanId: string): Promise<void> => {
    const [nextVersions, nextAudits] = await Promise.all([
      window.kickr.eventPlan.listVersions({ planId: activePlanId }),
      window.kickr.eventPlan.listAuditEntries({ planId: activePlanId })
    ]);
    setVersions(nextVersions);
    setAuditEntries(nextAudits);
  };

  const generatePlan = async (): Promise<void> => {
    setStatus("Generating event plan...");
    const result = await window.kickr.eventPlan.generate({
      eventType,
      eventDate,
      planLengthWeeks,
      currentFtp,
      weeklyAvailability,
      reason,
      source: "user"
    });
    setPlanId(result.planId);
    setWeeks(result.weeks);
    await refreshHistory(result.planId);
    setStatus(`Generated plan ${result.planId}, version ${result.versionNumber}`);
  };

  const adaptPlan = async (): Promise<void> => {
    if (!planId) {
      setStatus("Generate a plan first.");
      return;
    }
    setStatus("Adapting plan...");
    const result = await window.kickr.eventPlan.adapt({
      planId,
      reason: adaptReason,
      source: "user",
      adaptationPrompt: adaptationPrompt.trim() || undefined,
      overrides:
        overrideFtp || overrideDate
          ? {
              currentFtp: overrideFtp ? Number(overrideFtp) : undefined,
              eventDate: overrideDate || undefined
            }
          : undefined
    });
    setWeeks(result.weeks);
    await refreshHistory(planId);
    setStatus(`Adapted to version ${result.versionNumber} using ${result.appliedStrategy}`);
  };

  const updateAvailability = (dayIndex: number, patch: Partial<DayAvailability>): void => {
    setWeeklyAvailability((prev) => prev.map((day) => (day.dayIndex === dayIndex ? { ...day, ...patch } : day)));
  };

  const refreshDashboard = async (): Promise<void> => {
    const metrics = await window.kickr.dashboard.getMetrics({ weeksBack: 12 });
    setDashboard(metrics);
  };

  const refreshStravaStatus = async (): Promise<void> => {
    const nextStatus = await window.kickr.strava.getStatus();
    setStravaStatus(nextStatus);
  };

  const startStravaConnect = async (): Promise<void> => {
    setStatus("Starting Strava authorization...");
    const result = await window.kickr.strava.connect();
    setStravaAuthState(result.state ?? "");
    setStravaAuthUrl(result.authorizationUrl ?? "");
    setStatus(result.requiresAuthorizationCode ? "Authorize in browser, then paste the code below." : "Connected.");
    await refreshStravaStatus();
  };

  const completeStravaConnect = async (): Promise<void> => {
    if (!stravaAuthCode || !stravaAuthState) {
      setStatus("Start authorization and paste the returned Strava code.");
      return;
    }
    setStatus("Completing Strava authorization...");
    await window.kickr.strava.connect({
      authorizationCode: stravaAuthCode.trim(),
      state: stravaAuthState
    });
    setStravaAuthCode("");
    setStravaAuthState("");
    setStatus("Strava connected.");
    await refreshStravaStatus();
  };

  const disconnectStrava = async (): Promise<void> => {
    await window.kickr.strava.disconnect();
    setStravaAuthCode("");
    setStravaAuthState("");
    setStatus("Strava disconnected.");
    await refreshStravaStatus();
  };

  const syncStrava = async (): Promise<void> => {
    setStatus("Syncing completed workouts to Strava...");
    const result = await window.kickr.strava.sync({ limit: 10 });
    setStatus(
      `Strava sync: processed ${result.processedCount}, success ${result.successCount}, failed ${result.failedCount}`
    );
    await refreshStravaStatus();
  };

  const retryStrava = async (event: StravaSyncEventSummary): Promise<void> => {
    setStatus(`Retrying sync for event ${event.id}...`);
    const result = await window.kickr.strava.retry({ eventId: event.id });
    setStatus(`Retry result: success ${result.successCount}, failed ${result.failedCount}`);
    await refreshStravaStatus();
  };

  const runSmokeWorkflow = async (): Promise<void> => {
    if (runningSmoke) {
      return;
    }
    setRunningSmoke(true);
    setStatus("Running release smoke workflow...");
    const checks: SmokeCheck[] = [];
    const pushCheck = (check: SmokeCheck): void => {
      checks.push(check);
      setSmokeChecks([...checks]);
    };

    try {
      await window.kickr.ble.startScan({ timeoutMs: 4000 });
      await sleep(4500);
      const devices = await window.kickr.ble.listDevices();
      const trainer = devices.find((device) => device.kind === "trainer");
      if (!trainer) {
        pushCheck({
          name: "Connect trainer",
          status: "warning",
          detail: "No trainer discovered in scan window."
        });
      } else {
        await window.kickr.ble.connect({ deviceId: trainer.id });
        await window.kickr.ble.discoverFtms({ deviceId: trainer.id });
        pushCheck({
          name: "Connect trainer",
          status: "passed",
          detail: `Connected and discovered FTMS on ${trainer.id}.`
        });
      }
    } catch (error) {
      pushCheck({
        name: "Connect trainer",
        status: "failed",
        detail: error instanceof Error ? error.message : "Unknown BLE error"
      });
    }

    try {
      const ble = await window.kickr.ble.getState();
      if (!ble.connectedDeviceId) {
        pushCheck({
          name: "Run workout session",
          status: "warning",
          detail: "Skipped: no connected trainer."
        });
      } else {
        const session = await window.kickr.workout.startSession({
          deviceId: ble.connectedDeviceId,
          workoutId: null,
          intervals: [
            { kind: "warmup", durationSec: 2, targetPowerWatts: 120, targetResistancePercent: null },
            { kind: "work", durationSec: 2, targetPowerWatts: 160, targetResistancePercent: null },
            { kind: "cooldown", durationSec: 2, targetPowerWatts: 100, targetResistancePercent: null }
          ],
          metadata: { smoke: true }
        });
        await sleep(7000);
        await window.kickr.workout.stopSession({ sessionId: session.sessionId });
        pushCheck({
          name: "Run workout session",
          status: "passed",
          detail: "Workout session start/stop flow completed."
        });
      }
    } catch (error) {
      pushCheck({
        name: "Run workout session",
        status: "failed",
        detail: error instanceof Error ? error.message : "Unknown workout session error"
      });
    }

    try {
      const generated = await window.kickr.eventPlan.generate({
        eventType: "road-race",
        eventDate,
        planLengthWeeks: 8,
        currentFtp,
        weeklyAvailability,
        reason: "smoke-generate",
        source: "system"
      });
      await window.kickr.eventPlan.adapt({
        planId: generated.planId,
        reason: "smoke-adapt",
        source: "system",
        adaptationPrompt: "verify adaptation path"
      });
      pushCheck({
        name: "Generate/adapt plan",
        status: "passed",
        detail: "Generate and adapt operations succeeded."
      });
    } catch (error) {
      pushCheck({
        name: "Generate/adapt plan",
        status: "failed",
        detail: error instanceof Error ? error.message : "Unknown event plan error"
      });
    }

    try {
      const statusBefore = await window.kickr.strava.getStatus();
      if (!statusBefore.connected) {
        pushCheck({
          name: "Complete workout + Strava status",
          status: "warning",
          detail: "Strava not connected; reported status only."
        });
      } else {
        const syncResult = await window.kickr.strava.sync({ limit: 1 });
        pushCheck({
          name: "Complete workout + Strava status",
          status: syncResult.failedCount > 0 ? "warning" : "passed",
          detail: `Sync processed ${syncResult.processedCount} (success ${syncResult.successCount}, failed ${syncResult.failedCount}).`
        });
      }
      await refreshStravaStatus();
    } catch (error) {
      pushCheck({
        name: "Complete workout + Strava status",
        status: "failed",
        detail: error instanceof Error ? error.message : "Unknown Strava error"
      });
    }

    setStatus("Release smoke workflow completed.");
    setRunningSmoke(false);
  };

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
          Heart rate: {bleState?.hrLifecycle ?? "unknown"}
          {connectedHrDevice
            ? ` — connected to ${connectedHrDevice.name ?? connectedHrDevice.localName ?? connectedHrDevice.id}`
            : ""}
          {bleState?.heartRate?.bpm != null ? ` — HR: ${bleState.heartRate.bpm} bpm` : ""}
        </p>
        {bleState?.hrLastError ? <p>Heart rate error: {bleState.hrLastError}</p> : null}
        {bleActionError ? <p>Action error: {bleActionError}</p> : null}
        <div className="row">
          <button onClick={() => void scanForDevices()} disabled={bleActionPending || bleState?.scanning}>
            {bleState?.scanning ? "Scanning..." : "Scan for devices"}
          </button>
          {bleState?.scanning ? (
            <button onClick={() => void stopScanning()} disabled={bleActionPending}>
              Stop scan
            </button>
          ) : null}
          <button
            onClick={() => void disconnectDevice()}
            disabled={bleActionPending || !bleState?.connectedDeviceId}
          >
            Disconnect trainer
          </button>
          <button
            onClick={() => void disconnectHrDevice()}
            disabled={bleActionPending || !bleState?.connectedHrDeviceId}
          >
            Disconnect heart rate
          </button>
        </div>
        {!bleState || bleState.discoveredDevices.length === 0 ? (
          <p>No devices discovered yet. Click "Scan for devices".</p>
        ) : (
          <ul>
            {bleState.discoveredDevices.map((device) => {
              const isHeartRate = device.kind === "heart_rate";
              const isConnected = isHeartRate
                ? bleState.connectedHrDeviceId === device.id
                : bleState.connectedDeviceId === device.id;
              const connectDisabled = isHeartRate
                ? bleActionPending ||
                  isConnected ||
                  bleState.hrLifecycle === "connecting" ||
                  (bleState.connectedHrDeviceId !== null && !isConnected)
                : bleActionPending ||
                  isConnected ||
                  bleState.lifecycle === "connecting" ||
                  (bleState.connectedDeviceId !== null && !isConnected);
              return (
                <li key={device.id}>
                  {device.name ?? device.localName ?? "Unknown device"} ({device.id})
                  {device.kind ? ` — ${device.kind}` : ""}
                  {typeof device.rssi === "number" ? ` — RSSI ${device.rssi}` : ""}
                  {isConnected ? " — connected" : ""}{" "}
                  <button onClick={() => void connectToDevice(device.id)} disabled={connectDisabled}>
                    {isConnected ? "Connected" : "Connect"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activeIntervals ? (
        <section>
          <h2>Live workout{activeWorkoutName ? `: ${activeWorkoutName}` : ""}</h2>
          <p>
            Status: {workoutSessionState?.lifecycle ?? "idle"} — elapsed{" "}
            {formatClock(workoutSessionState?.elapsedSec ?? 0)} /{" "}
            {formatClock(activeIntervals.reduce((sum, interval) => sum + interval.durationSec, 0))}
          </p>
          {workoutSessionState?.liveMetrics ? (
            <p>
              Current block: {workoutSessionState.liveMetrics.blockKind} — target{" "}
              {workoutSessionState.liveMetrics.targetPowerWatts ?? "-"} W
              {" · actual "}
              {workoutSessionState.liveMetrics.actualPowerWatts ?? "-"} W
              {workoutSessionState.liveMetrics.actualCadenceRpm !== null
                ? ` · ${Math.round(workoutSessionState.liveMetrics.actualCadenceRpm)} rpm`
                : ""}
              {workoutSessionState.liveMetrics.targetResistancePercent !== null
                ? ` / ${workoutSessionState.liveMetrics.targetResistancePercent}% resistance`
                : ""}
            </p>
          ) : null}
          {liveWorkoutError ? <p>Error: {liveWorkoutError}</p> : null}
          {workoutSessionState?.lastError ? <p>Session error: {workoutSessionState.lastError}</p> : null}

          <WorkoutTimelineChart
            intervals={activeIntervals}
            elapsedSec={workoutSessionState?.elapsedSec ?? 0}
            currentIndex={workoutSessionState?.currentIntervalIndex ?? null}
            actualPowerWatts={workoutSessionState?.liveMetrics?.actualPowerWatts ?? null}
          />

          <div className="row">
            {workoutSessionState?.lifecycle === "running" ? (
              <button onClick={() => void pauseWorkout()} disabled={liveWorkoutBusy}>
                Pause
              </button>
            ) : null}
            {workoutSessionState?.lifecycle === "paused" ? (
              <button onClick={() => void resumeWorkout()} disabled={liveWorkoutBusy}>
                Resume
              </button>
            ) : null}
            {isWorkoutSessionActive ? (
              <button onClick={() => void stopWorkout()} disabled={liveWorkoutBusy}>
                End workout
              </button>
            ) : (
              <button onClick={closeLiveWorkout} disabled={liveWorkoutBusy}>
                Close
              </button>
            )}
          </div>

          <div className="row">
            <span>Intensity: {Math.round((workoutSessionState?.intensityMultiplier ?? 1) * 100)}%</span>
            <button onClick={() => void adjustIntensity(-0.05)} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
              -5%
            </button>
            <button onClick={() => void adjustIntensity(0.05)} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
              +5%
            </button>
          </div>

          <div className="row">
            <label>
              Ramp-in duration (sec){" "}
              <input
                type="number"
                min={0}
                max={60}
                value={rampDurationInput}
                onChange={(event) => setRampDurationInput(event.target.value)}
                disabled={liveWorkoutBusy || !isWorkoutSessionActive}
              />
            </label>
            <button onClick={() => void applyRampDuration()} disabled={liveWorkoutBusy || !isWorkoutSessionActive}>
              Apply
            </button>
          </div>
        </section>
      ) : null}

      <section>
        <h2>Release smoke workflow</h2>
        <button onClick={() => void runSmokeWorkflow()} disabled={runningSmoke}>
          {runningSmoke ? "Running..." : "Run smoke workflow"}
        </button>
        {smokeChecks.length === 0 ? (
          <p>No smoke run yet.</p>
        ) : (
          <ul>
            {smokeChecks.map((check) => (
              <li key={check.name}>
                [{check.status}] {check.name}: {check.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Strava sync</h2>
        <div className="row">
          <button onClick={() => void refreshStravaStatus()}>Refresh Strava status</button>
          <button onClick={() => void startStravaConnect()}>Connect Strava</button>
          <button onClick={() => void disconnectStrava()}>Disconnect Strava</button>
          <button onClick={() => void syncStrava()}>Sync completed workouts</button>
        </div>
        {stravaStatus ? (
          <>
            <p>
              Connected: {stravaStatus.connected ? "yes" : "no"} | Configured:{" "}
              {stravaStatus.hasConfig ? "yes" : "no"} | Athlete ID: {stravaStatus.athleteId ?? "N/A"}
            </p>
            <p>
              Counts — pending {stravaStatus.counts.pending}, success {stravaStatus.counts.success}, failed{" "}
              {stravaStatus.counts.failed}
            </p>
            <p>Token expiry: {stravaStatus.tokenExpiresAt ?? "N/A"}</p>
          </>
        ) : (
          <p>No Strava status loaded yet.</p>
        )}
        <div className="row">
          <label>
            OAuth state <input value={stravaAuthState} onChange={(event) => setStravaAuthState(event.target.value)} />
          </label>
          <label>
            Authorization code{" "}
            <input value={stravaAuthCode} onChange={(event) => setStravaAuthCode(event.target.value)} />
          </label>
          <button onClick={() => void completeStravaConnect()}>Complete connect</button>
        </div>
        {stravaAuthUrl ? <p>Auth URL: {stravaAuthUrl}</p> : null}
        {stravaStatus && stravaStatus.recentEvents.length > 0 ? (
          <ul>
            {stravaStatus.recentEvents.map((event) => (
              <li key={event.id}>
                [{event.syncStatus}] {event.eventType} / session {event.sessionId ?? "N/A"} / {event.message ?? "No message"}{" "}
                {event.syncStatus === "failed" ? (
                  <button onClick={() => void retryStrava(event)}>Retry</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No sync events yet.</p>
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

      <section>
        <h2>Generate plan</h2>
        <div className="row">
          <label>
            Event type{" "}
            <select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}>
              <option value="road-race">road-race</option>
              <option value="time-trial">time-trial</option>
              <option value="criterium">criterium</option>
              <option value="gran-fondo">gran-fondo</option>
            </select>
          </label>
          <label>
            Event date <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
          </label>
          <label>
            Plan length{" "}
            <select
              value={planLengthWeeks}
              onChange={(event) => setPlanLengthWeeks(Number(event.target.value) as PlanLengthWeeks)}
            >
              <option value={8}>8 weeks</option>
              <option value={12}>12 weeks</option>
              <option value={16}>16 weeks</option>
            </select>
          </label>
          <label>
            FTP{" "}
            <input
              type="number"
              min={100}
              max={600}
              value={currentFtp}
              onChange={(event) => setCurrentFtp(Number(event.target.value))}
            />
          </label>
        </div>
        <label>
          Generation reason{" "}
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <h3>Weekly availability</h3>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Train</th>
              <th>Max min</th>
            </tr>
          </thead>
          <tbody>
            {weeklyAvailability.map((day) => (
              <tr key={day.dayIndex}>
                <td>{dayLabels[day.dayIndex]}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={day.canTrain}
                    onChange={(event) => updateAvailability(day.dayIndex, { canTrain: event.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={20}
                    max={360}
                    value={day.maxDurationMin ?? ""}
                    onChange={(event) =>
                      updateAvailability(day.dayIndex, {
                        maxDurationMin: event.target.value ? Number(event.target.value) : null
                      })
                    }
                    disabled={!day.canTrain}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button disabled={!canGenerate} onClick={() => void generatePlan()}>
          Generate event plan
        </button>
      </section>

      <section>
        <h2>Adapt plan</h2>
        <div className="row">
          <label>
            Adapt reason{" "}
            <input value={adaptReason} onChange={(event) => setAdaptReason(event.target.value)} />
          </label>
          <label>
            Prompt{" "}
            <input
              placeholder="e.g. fatigue this week, reduce load"
              value={adaptationPrompt}
              onChange={(event) => setAdaptationPrompt(event.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label>
            Override FTP{" "}
            <input value={overrideFtp} onChange={(event) => setOverrideFtp(event.target.value)} placeholder="optional" />
          </label>
          <label>
            Override event date{" "}
            <input
              type="date"
              value={overrideDate}
              onChange={(event) => setOverrideDate(event.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
        <button disabled={!planId} onClick={() => void adaptPlan()}>
          Adapt current plan
        </button>
      </section>

      <section>
        <h2>Current weeks</h2>
        {weeks.length === 0 ? (
          <p>No generated plan yet.</p>
        ) : (
          weeks.map((week) => (
            <article key={week.weekId}>
              <h3>
                Week {week.weekIndex + 1} ({week.startDate}) — {week.loadTag}
              </h3>
              <p>
                Target {week.targetMinutes} min @ IF {week.targetIF}
              </p>
              <ul>
                {week.days.map((day) => {
                  const workoutId = day.workoutId;
                  return (
                    <li key={`${week.weekId}-${day.dayIndex}`}>
                      {dayLabels[day.dayIndex]}:{" "}
                      {day.workoutName
                        ? `${day.workoutName} (${day.durationMin} min, IF ${day.targetIF ?? "-"})`
                        : "Rest"}{" "}
                      {workoutId ? (
                        <button
                          onClick={() => void startWorkoutForDay(workoutId, day.workoutName ?? "Workout")}
                          disabled={liveWorkoutBusy || isWorkoutSessionActive || !bleState?.connectedDeviceId}
                        >
                          Start workout
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))
        )}
      </section>

      <section>
        <h2>Version history</h2>
        {versions.length === 0 ? (
          <p>No versions yet.</p>
        ) : (
          <ul>
            {versions.map((version) => (
              <li key={version.id}>
                v{version.versionNumber} {version.isCurrent ? "(current)" : ""} — {version.source} —{" "}
                {version.reason} — {version.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Audit entries</h2>
        {auditEntries.length === 0 ? (
          <p>No audit entries yet.</p>
        ) : (
          <ul>
            {auditEntries.map((entry) => (
              <li key={entry.id}>
                [{entry.action}] {entry.reason} ({entry.source}) — {entry.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
