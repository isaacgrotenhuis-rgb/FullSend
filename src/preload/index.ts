import { contextBridge, ipcRenderer } from "electron";
import {
  bleStateSchema,
  ipcChannels,
  workoutSessionStateSchema,
  type BleState,
  type WorkoutSessionState
} from "@shared/ipc/contracts";
import type { KickrDesktopApi } from "@shared/ipc/api";

const api: KickrDesktopApi = {
  ping: async () => ipcRenderer.invoke(ipcChannels.app.ping, {}),
  ble: {
    startScan: async (request) => ipcRenderer.invoke(ipcChannels.ble.startScan, request ?? {}),
    stopScan: async () => ipcRenderer.invoke(ipcChannels.ble.stopScan, {}),
    listDevices: async () => ipcRenderer.invoke(ipcChannels.ble.listDevices, {}),
    connect: async (request) => ipcRenderer.invoke(ipcChannels.ble.connect, request),
    disconnect: async (request) => ipcRenderer.invoke(ipcChannels.ble.disconnect, request ?? {}),
    getState: async () => ipcRenderer.invoke(ipcChannels.ble.getState, {}),
    getCapabilities: async () => ipcRenderer.invoke(ipcChannels.ble.getCapabilities, {}),
    discoverFtms: async (request) => ipcRenderer.invoke(ipcChannels.ble.discoverFtms, request),
    subscribeState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, rawState: BleState) => {
        listener(bleStateSchema.parse(rawState));
      };
      ipcRenderer.send(ipcChannels.ble.subscribeState);
      ipcRenderer.on(ipcChannels.ble.stateChangedEvent, wrapped);
      return () => {
        ipcRenderer.removeListener(ipcChannels.ble.stateChangedEvent, wrapped);
        ipcRenderer.send(ipcChannels.ble.unsubscribeState);
      };
    }
  },
  workout: {
    startSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.startSession, request),
    pauseSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.pauseSession, request),
    resumeSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.resumeSession, request),
    stopSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.stopSession, request),
    saveSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.saveSession, request),
    discardSession: async (request) => ipcRenderer.invoke(ipcChannels.workout.discardSession, request),
    setIntensity: async (request) => ipcRenderer.invoke(ipcChannels.workout.setIntensity, request),
    setRampDuration: async (request) => ipcRenderer.invoke(ipcChannels.workout.setRampDuration, request),
    getSessionState: async () => ipcRenderer.invoke(ipcChannels.workout.getSessionState, {}),
    getSessionTelemetry: async (request) => ipcRenderer.invoke(ipcChannels.workout.getSessionTelemetry, request),
    subscribeSession: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, rawState: WorkoutSessionState) => {
        listener(workoutSessionStateSchema.parse(rawState));
      };
      ipcRenderer.send(ipcChannels.workout.subscribeSession);
      ipcRenderer.on(ipcChannels.workout.sessionStateChangedEvent, wrapped);
      return () => {
        ipcRenderer.removeListener(ipcChannels.workout.sessionStateChangedEvent, wrapped);
        ipcRenderer.send(ipcChannels.workout.unsubscribeSession);
      };
    }
  },
  workoutLibrary: {
    createWorkout: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.createWorkout, request),
    updateWorkout: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.updateWorkout, request),
    deleteWorkout: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.deleteWorkout, request),
    listWorkouts: async () => ipcRenderer.invoke(ipcChannels.workoutLibrary.listWorkouts, {}),
    getWorkoutDetail: async (request) =>
      ipcRenderer.invoke(ipcChannels.workoutLibrary.getWorkoutDetail, request),
    createInterval: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.createInterval, request),
    updateInterval: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.updateInterval, request),
    reorderIntervals: async (request) =>
      ipcRenderer.invoke(ipcChannels.workoutLibrary.reorderIntervals, request),
    deleteInterval: async (request) => ipcRenderer.invoke(ipcChannels.workoutLibrary.deleteInterval, request),
    assignWorkoutToPlanDay: async (request) =>
      ipcRenderer.invoke(ipcChannels.workoutLibrary.assignWorkoutToPlanDay, request),
    unassignWorkoutFromPlanDay: async (request) =>
      ipcRenderer.invoke(ipcChannels.workoutLibrary.unassignWorkoutFromPlanDay, request),
    listPlanWeeks: async () => ipcRenderer.invoke(ipcChannels.workoutLibrary.listPlanWeeks, {})
  },
  workoutBank: {
    list: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.list, request ?? {}),
    get: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.get, request),
    create: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.create, request),
    update: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.update, request),
    archive: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.archive, request),
    startAdhoc: async (request) => ipcRenderer.invoke(ipcChannels.workoutBank.startAdhoc, request)
  },
  eventPlan: {
    generate: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.generate, request),
    adapt: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.adapt, request),
    delete: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.delete, request),
    listVersions: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.listVersions, request),
    listAuditEntries: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.listAuditEntries, request),
    getCurrent: async () => ipcRenderer.invoke(ipcChannels.eventPlan.getCurrent, {})
  },
  dashboard: {
    getMetrics: async (request) => ipcRenderer.invoke(ipcChannels.dashboard.getMetrics, request ?? {})
  },
  strava: {
    connect: async (request) => ipcRenderer.invoke(ipcChannels.strava.connect, request ?? {}),
    disconnect: async () => ipcRenderer.invoke(ipcChannels.strava.disconnect, {}),
    sync: async (request) => ipcRenderer.invoke(ipcChannels.strava.sync, request ?? {}),
    retry: async (request) => ipcRenderer.invoke(ipcChannels.strava.retry, request),
    getStatus: async () => ipcRenderer.invoke(ipcChannels.strava.getStatus, {})
  }
};

contextBridge.exposeInMainWorld("kickr", api);
