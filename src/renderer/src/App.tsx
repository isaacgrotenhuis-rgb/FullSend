import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  type BleConnectionEntry,
  type BleRole,
  type BleState,
  type DashboardMetrics,
  type DayAvailability,
  type EventPlanAuditEntry,
  type EventPlanVersion,
  type EventPlanWeek,
  type EventType,
  type PlanLengthWeeks,
  type StravaStatus,
  type StravaSyncEventSummary,
  type WorkoutInterval,
  type WorkoutSessionState
} from "@shared/ipc/contracts";
import { Nav } from "./pages/Nav";
import { HomePage } from "./pages/HomePage";
import { PlanPage } from "./pages/PlanPage";
import { RidePage } from "./pages/RidePage";
import { ProfilePage, type SmokeCheck } from "./pages/ProfilePage";

export type Page = "home" | "plan" | "profile";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [page, setPage] = useState<Page>("home");

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
        setEventType(current.input.eventType);
        setEventDate(current.input.eventDate);
        setPlanLengthWeeks(current.input.planLengthWeeks);
        setCurrentFtp(current.input.currentFtp);
        setWeeklyAvailability(current.input.weeklyAvailability);
        await refreshHistory(current.planId);
      }
    })();
  }, []);

  const getRoleConnection = (state: BleState, role: BleRole): BleConnectionEntry =>
    role === "power"
      ? {
          lifecycle: state.lifecycle as BleConnectionEntry["lifecycle"],
          connectedDeviceId: state.connectedDeviceId,
          lastError: state.lastError
        }
      : state.connections[role];

  const roleLabel = (role: BleRole): string =>
    role === "power" ? "Power/Trainer" : role === "heart_rate" ? "Heart rate" : "Cadence";

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

  const connectToDevice = (deviceId: string, role: BleRole): Promise<void> =>
    runBleAction(() => window.kickr.ble.connect({ deviceId, role }));

  const disconnectDevice = (): Promise<void> =>
    runBleAction(() =>
      window.kickr.ble.disconnect(
        bleState?.connectedDeviceId ? { deviceId: bleState.connectedDeviceId } : {}
      )
    );

  const disconnectHrDevice = (): Promise<void> =>
    runBleAction(() =>
      window.kickr.ble.disconnect(
        bleState?.connections.heart_rate.connectedDeviceId
          ? { deviceId: bleState.connections.heart_rate.connectedDeviceId }
          : {}
      )
    );

  const disconnectCadenceDevice = (): Promise<void> =>
    runBleAction(() =>
      window.kickr.ble.disconnect(
        bleState?.connections.cadence.connectedDeviceId
          ? { deviceId: bleState.connections.cadence.connectedDeviceId }
          : {}
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

  const deletePlan = async (): Promise<void> => {
    if (!planId) {
      return;
    }
    setStatus("Deleting plan...");
    await window.kickr.eventPlan.delete({ planId });
    setPlanId("");
    setWeeks([]);
    setVersions([]);
    setAuditEntries([]);
    setStatus("Plan deleted");
  };

  const updateAvailability = (dayIndex: number, patch: Partial<DayAvailability>): void => {
    setWeeklyAvailability((prev) => prev.map((day) => (day.dayIndex === dayIndex ? { ...day, ...patch } : day)));
  };

  const refreshDashboard = async (): Promise<void> => {
    const metrics = await window.kickr.dashboard.getMetrics({ weeksBack: 12 });
    setDashboard(metrics);
  };

  useEffect(() => {
    void refreshDashboard();
  }, []);

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

  const finishRide = async (postToStrava: boolean): Promise<void> => {
    if (postToStrava) {
      await syncStrava();
    }
    closeLiveWorkout();
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
      const trainer = devices.find((device) => device.roles.includes("power"));
      if (!trainer) {
        pushCheck({
          name: "Connect trainer",
          status: "warning",
          detail: "No trainer discovered in scan window."
        });
      } else {
        await window.kickr.ble.connect({ deviceId: trainer.id, role: "power" });
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
    <>
      {activeIntervals === null ? <Nav page={page} onNavigate={setPage} /> : null}

      {status && activeIntervals === null ? (
        <div
          style={{
            padding: "var(--space-2) var(--space-4)",
            fontSize: 13,
            color: "var(--color-accent-700)",
            background: "var(--color-accent-100)",
            borderBottom: "2px solid var(--color-divider)"
          }}
        >
          {status}
        </div>
      ) : null}

      {activeIntervals !== null ? (
        <RidePage
          activeIntervals={activeIntervals}
          activeWorkoutName={activeWorkoutName}
          workoutSessionState={workoutSessionState}
          liveWorkoutError={liveWorkoutError}
          liveWorkoutBusy={liveWorkoutBusy}
          isWorkoutSessionActive={isWorkoutSessionActive}
          pauseWorkout={pauseWorkout}
          resumeWorkout={resumeWorkout}
          stopWorkout={stopWorkout}
          finishRide={finishRide}
          adjustIntensity={adjustIntensity}
          rampDurationInput={rampDurationInput}
          setRampDurationInput={setRampDurationInput}
          applyRampDuration={applyRampDuration}
        />
      ) : page === "plan" ? (
        <PlanPage
          generate={{
            eventType,
            setEventType,
            eventDate,
            setEventDate,
            planLengthWeeks,
            setPlanLengthWeeks,
            currentFtp,
            setCurrentFtp,
            weeklyAvailability,
            updateAvailability,
            canGenerate,
            generatePlan
          }}
          weeks={weeks}
          liveWorkoutBusy={liveWorkoutBusy}
          isWorkoutSessionActive={isWorkoutSessionActive}
          connectedTrainerDeviceId={bleState?.connectedDeviceId ?? null}
          startWorkoutForDay={startWorkoutForDay}
          onDeletePlan={deletePlan}
        />
      ) : page === "profile" ? (
        <ProfilePage
          currentFtp={currentFtp}
          smokeChecks={smokeChecks}
          runningSmoke={runningSmoke}
          runSmokeWorkflow={runSmokeWorkflow}
          strava={{
            stravaStatus,
            stravaAuthCode,
            setStravaAuthCode,
            stravaAuthState,
            setStravaAuthState,
            stravaAuthUrl,
            refreshStravaStatus,
            startStravaConnect,
            completeStravaConnect,
            disconnectStrava,
            syncStrava,
            retryStrava
          }}
          versions={versions}
          auditEntries={auditEntries}
        />
      ) : (
        <HomePage
          ble={{
            bleState,
            actionError: bleActionError,
            actionPending: bleActionPending,
            scanForDevices,
            stopScanning,
            disconnectDevice,
            disconnectHrDevice,
            disconnectCadenceDevice,
            getRoleConnection,
            roleLabel,
            connectToDevice
          }}
          dashboard={dashboard}
          currentFtp={currentFtp}
          eventDate={eventDate}
          weeks={weeks}
          liveWorkoutBusy={liveWorkoutBusy}
          isWorkoutSessionActive={isWorkoutSessionActive}
          startWorkoutForDay={startWorkoutForDay}
          onNavigateToPlan={() => setPage("plan")}
        />
      )}
    </>
  );
};
