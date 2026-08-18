import { ipcMain, type WebContents } from "electron";
import { z } from "zod";
import type { BleService } from "@main/ble/types";
import type { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import type { WorkoutLibraryService } from "@main/workout/WorkoutLibraryService";
import type { EventPlanService } from "@main/plans/EventPlanService";
import {
  adaptEventPlanResultSchema,
  adaptEventPlanRequestSchema,
  assignWorkoutToPlanDayRequestSchema,
  bleDeviceListResultSchema,
  eventPlanAuditEntriesSchema,
  eventPlanVersionsSchema,
  generateEventPlanRequestSchema,
  generateEventPlanResultSchema,
  bleDeviceRequestSchema,
  bleCapabilitiesSchema,
  bleConnectRequestSchema,
  bleDisconnectRequestSchema,
  bleFtmsProfileSchema,
  bleScanRequestSchema,
  bleStateSchema,
  createIntervalRequestSchema,
  createWorkoutRequestSchema,
  deleteIntervalRequestSchema,
  deleteWorkoutRequestSchema,
  ipcChannels,
  intervalIdResultSchema,
  okResultSchema,
  planAuditEntriesRequestSchema,
  planWeekSummariesSchema,
  planVersionsRequestSchema,
  pingResultSchema,
  reorderIntervalsRequestSchema,
  startWorkoutSessionRequestSchema,
  unassignWorkoutFromPlanDayRequestSchema,
  updateIntervalRequestSchema,
  updateWorkoutRequestSchema,
  workoutDetailRequestSchema,
  workoutDetailSchema,
  workoutIdResultSchema,
  workoutSessionControlRequestSchema,
  workoutSessionStartResultSchema,
  workoutSessionStateSchema,
  workoutSummariesSchema
} from "@shared/ipc/contracts";
import { safeHandle } from "@main/ipc/safeHandle";
 
const emptySchema = z.object({}).passthrough();

export const registerIpcHandlers = (
  bleService: BleService,
  workoutEngine: ErgWorkoutEngine,
  workoutLibraryService: WorkoutLibraryService,
  eventPlanService: EventPlanService
): (() => void) => {
  const bleSubscribers = new Set<WebContents>();
  const workoutSubscribers = new Set<WebContents>();
  const unsubscribeBle = bleService.subscribeState((state) => {
    const payload = bleStateSchema.parse(state);
    for (const webContents of bleSubscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send(ipcChannels.ble.stateChangedEvent, payload);
      }
    }
  });
  const unsubscribeWorkout = workoutEngine.subscribe((state) => {
    const payload = workoutSessionStateSchema.parse(state);
    for (const webContents of workoutSubscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send(ipcChannels.workout.sessionStateChangedEvent, payload);
      }
    }
  });

  safeHandle(ipcChannels.app.ping, emptySchema, pingResultSchema, () => ({
    app: "kickr-desktop",
    ts: new Date().toISOString()
  }));

  safeHandle(
    ipcChannels.ble.startScan,
    bleScanRequestSchema.partial(),
    okResultSchema,
    async (_event, input) => {
      const parsed = bleScanRequestSchema.parse(input);
      await bleService.startScan(parsed.timeoutMs);
      return { ok: true };
    }
  );

  safeHandle(ipcChannels.ble.stopScan, emptySchema, okResultSchema, async () => {
    await bleService.stopScan();
    return { ok: true };
  });

  safeHandle(ipcChannels.ble.listDevices, emptySchema, bleDeviceListResultSchema, () =>
    bleService.listDevices()
  );

  safeHandle(
    ipcChannels.ble.connect,
    bleConnectRequestSchema,
    okResultSchema,
    async (_event, input) => {
      await bleService.connect(input.deviceId);
      return { ok: true };
    }
  );

  safeHandle(
    ipcChannels.ble.disconnect,
    bleDisconnectRequestSchema.partial(),
    okResultSchema,
    async (_event, input) => {
      const parsed = bleDisconnectRequestSchema.parse(input);
      await bleService.disconnect(parsed.deviceId);
      return { ok: true };
    }
  );

  safeHandle(ipcChannels.ble.getState, emptySchema, bleStateSchema, () => bleService.getState());
  safeHandle(ipcChannels.ble.getCapabilities, emptySchema, bleCapabilitiesSchema, () =>
    bleService.getCapabilities()
  );
  safeHandle(
    ipcChannels.ble.discoverFtms,
    bleDeviceRequestSchema,
    bleFtmsProfileSchema,
    async (_event, input) => bleService.discoverFtms(input.deviceId)
  );

  safeHandle(
    ipcChannels.workout.startSession,
    startWorkoutSessionRequestSchema,
    workoutSessionStartResultSchema,
    async (_event, input) => ({
      ok: true,
      sessionId: await workoutEngine.start(input)
    })
  );
  safeHandle(
    ipcChannels.workout.pauseSession,
    workoutSessionControlRequestSchema,
    okResultSchema,
    async (_event, input) => {
      await workoutEngine.pause(input.sessionId);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workout.resumeSession,
    workoutSessionControlRequestSchema,
    okResultSchema,
    async (_event, input) => {
      await workoutEngine.resume(input.sessionId);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workout.stopSession,
    workoutSessionControlRequestSchema,
    okResultSchema,
    async (_event, input) => {
      await workoutEngine.stop(input.sessionId);
      return { ok: true };
    }
  );
  safeHandle(ipcChannels.workout.getSessionState, emptySchema, workoutSessionStateSchema, () =>
    workoutEngine.getState()
  );

  safeHandle(
    ipcChannels.workoutLibrary.createWorkout,
    createWorkoutRequestSchema,
    workoutIdResultSchema,
    (_event, input) => ({
      ok: true,
      workoutId: workoutLibraryService.createWorkout({
        name: input.name,
        source: input.source ?? "manual-builder",
        intensityFactor: input.intensityFactor ?? null,
        intervals: input.intervals
      }).workoutId
    })
  );
  safeHandle(
    ipcChannels.workoutLibrary.updateWorkout,
    updateWorkoutRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.updateWorkout({
        workoutId: input.workoutId,
        name: input.name,
        intensityFactor: input.intensityFactor ?? null
      });
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workoutLibrary.deleteWorkout,
    deleteWorkoutRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.deleteWorkout(input.workoutId);
      return { ok: true };
    }
  );
  safeHandle(ipcChannels.workoutLibrary.listWorkouts, emptySchema, workoutSummariesSchema, () =>
    workoutLibraryService.listWorkouts()
  );
  safeHandle(
    ipcChannels.workoutLibrary.getWorkoutDetail,
    workoutDetailRequestSchema,
    workoutDetailSchema,
    (_event, input) => workoutLibraryService.getWorkoutDetail(input.workoutId)
  );
  safeHandle(
    ipcChannels.workoutLibrary.createInterval,
    createIntervalRequestSchema,
    intervalIdResultSchema,
    (_event, input) => ({
      ok: true,
      intervalId: workoutLibraryService.createInterval({
        workoutId: input.workoutId,
        interval: input.interval,
        index: input.index ?? null
      }).intervalId
    })
  );
  safeHandle(
    ipcChannels.workoutLibrary.updateInterval,
    updateIntervalRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.updateInterval(input);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workoutLibrary.reorderIntervals,
    reorderIntervalsRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.reorderIntervals(input);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workoutLibrary.deleteInterval,
    deleteIntervalRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.deleteInterval(input);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workoutLibrary.assignWorkoutToPlanDay,
    assignWorkoutToPlanDayRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.assignWorkoutToPlanDay(input);
      return { ok: true };
    }
  );
  safeHandle(
    ipcChannels.workoutLibrary.unassignWorkoutFromPlanDay,
    unassignWorkoutFromPlanDayRequestSchema,
    okResultSchema,
    (_event, input) => {
      workoutLibraryService.unassignWorkoutFromPlanDay(input);
      return { ok: true };
    }
  );
  safeHandle(ipcChannels.workoutLibrary.listPlanWeeks, emptySchema, planWeekSummariesSchema, () =>
    workoutLibraryService.listPlanWeeks()
  );
  safeHandle(
    ipcChannels.eventPlan.generate,
    generateEventPlanRequestSchema,
    generateEventPlanResultSchema,
    (_event, input) =>
      eventPlanService.generatePlan({
        ...input,
        source: input.source ?? "user",
        reason: input.reason ?? "Initial event plan generation"
      })
  );
  safeHandle(
    ipcChannels.eventPlan.adapt,
    adaptEventPlanRequestSchema,
    adaptEventPlanResultSchema,
    (_event, input) =>
      eventPlanService.adaptPlan({
        ...input,
        source: input.source ?? "user"
      })
  );
  safeHandle(
    ipcChannels.eventPlan.listVersions,
    planVersionsRequestSchema,
    eventPlanVersionsSchema,
    (_event, input) => eventPlanService.listPlanVersions(input.planId)
  );
  safeHandle(
    ipcChannels.eventPlan.listAuditEntries,
    planAuditEntriesRequestSchema,
    eventPlanAuditEntriesSchema,
    (_event, input) => eventPlanService.listPlanAuditEntries(input.planId)
  );

  ipcMain.on(ipcChannels.ble.subscribeState, (event) => {
    bleSubscribers.add(event.sender);
  });
  ipcMain.on(ipcChannels.ble.unsubscribeState, (event) => {
    bleSubscribers.delete(event.sender);
  });

  ipcMain.on(ipcChannels.workout.subscribeSession, (event) => {
    workoutSubscribers.add(event.sender);
  });
  ipcMain.on(ipcChannels.workout.unsubscribeSession, (event) => {
    workoutSubscribers.delete(event.sender);
  });

  return () => {
    unsubscribeBle();
    unsubscribeWorkout();
    bleSubscribers.clear();
    workoutSubscribers.clear();
  };
};
