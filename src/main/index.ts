import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "@main/ipc/registerIpcHandlers";
import { BleService } from "@main/ble/BleService";
import { DatabaseService } from "@main/database/DatabaseService";
import { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import { WorkoutLibraryService } from "@main/workout/WorkoutLibraryService";
import { createPlanAdaptationService } from "@main/plans/PlanAdaptationService";
import { EventPlanService } from "@main/plans/EventPlanService";
import { ProgressDashboardService } from "@main/dashboard/ProgressDashboardService";
import { StravaService } from "@main/strava/StravaService";

const createWindow = async (): Promise<void> => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const bootstrap = async (): Promise<void> => {
  await app.whenReady();

  const databaseService = new DatabaseService();
  const bleService = new BleService({
    transitionStore: databaseService.repositories.bleStateTransitions
  });
  const workoutEngine = new ErgWorkoutEngine(bleService, {
    workoutSessions: databaseService.repositories.workoutSessions,
    workoutSessionEvents: databaseService.repositories.workoutSessionEvents,
    workoutSessionTelemetry: databaseService.repositories.workoutSessionTelemetry
  });
  const workoutLibraryService = new WorkoutLibraryService(databaseService.repositories);
  const adaptationService = createPlanAdaptationService();
  const eventPlanService = new EventPlanService(databaseService.repositories, adaptationService);
  const progressDashboardService = new ProgressDashboardService(databaseService.repositories);
  const stravaService = new StravaService(databaseService.repositories);
  const cleanupIpcHandlers = registerIpcHandlers(
    bleService,
    workoutEngine,
    workoutLibraryService,
    eventPlanService,
    progressDashboardService,
    stravaService
  );

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });

  app.on("before-quit", () => {
    cleanupIpcHandlers();
    databaseService.close();
  });
};

void bootstrap();
