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
    getSessionState: async () => ipcRenderer.invoke(ipcChannels.workout.getSessionState, {}),
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
  eventPlan: {
    generate: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.generate, request),
    adapt: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.adapt, request),
    listVersions: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.listVersions, request),
    listAuditEntries: async (request) => ipcRenderer.invoke(ipcChannels.eventPlan.listAuditEntries, request)
  },
  dashboard: {
    getMetrics: async (request) => ipcRenderer.invoke(ipcChannels.dashboard.getMetrics, request ?? {})
  }
};

contextBridge.exposeInMainWorld("kickr", api);
