import { app, BrowserWindow, powerSaveBlocker } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "@main/ipc/registerIpcHandlers";
import { DisplaySleepGuard } from "@main/power/DisplaySleepGuard";
import { BleService } from "@main/ble/BleService";
import { DatabaseService } from "@main/database/DatabaseService";
import { ErgWorkoutEngine } from "@main/workout/ErgWorkoutEngine";
import { WorkoutLibraryService } from "@main/workout/WorkoutLibraryService";
import { WorkoutRecapService } from "@main/workout/WorkoutRecapService";
import { WorkoutBankService } from "@main/workout/WorkoutBankService";
import { seedWorkoutBankIfEmpty } from "@main/workout/seedWorkoutBank";
import { createPlanAdaptationService } from "@main/plans/PlanAdaptationService";
import { EventPlanService } from "@main/plans/EventPlanService";
import { ProgressDashboardService } from "@main/dashboard/ProgressDashboardService";
import { StravaService } from "@main/strava/StravaService";

const createWindow = async (): Promise<void> => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Full Send",
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
  app.setName("Full Send");
  await app.whenReady();

  const databaseService = new DatabaseService();
  const bleService = new BleService({
    transitionStore: databaseService.repositories.bleStateTransitions,
    deviceStore: databaseService.repositories.devices
  });
  const workoutEngine = new ErgWorkoutEngine(bleService, {
    workoutSessions: databaseService.repositories.workoutSessions,
    workoutSessionEvents: databaseService.repositories.workoutSessionEvents,
    workoutSessionTelemetry: databaseService.repositories.workoutSessionTelemetry
  });
  const workoutLibraryService = new WorkoutLibraryService(databaseService.repositories);
  const workoutRecapService = new WorkoutRecapService(databaseService.repositories);
  const workoutBankService = new WorkoutBankService(databaseService.repositories);
  seedWorkoutBankIfEmpty(workoutBankService);
  const adaptationService = createPlanAdaptationService();
  const eventPlanService = new EventPlanService(
    databaseService.repositories,
    adaptationService,
    workoutBankService
  );
  const progressDashboardService = new ProgressDashboardService(databaseService.repositories);
  const stravaService = new StravaService(databaseService.repositories);

  // Keep the Mac display awake while a workout is running or paused.
  const displaySleepGuard = new DisplaySleepGuard(powerSaveBlocker);
  const unsubscribeDisplaySleepGuard = workoutEngine.subscribe((state) => {
    displaySleepGuard.handleState(state);
  });
  const cleanupIpcHandlers = registerIpcHandlers(
    bleService,
    workoutEngine,
    workoutLibraryService,
    workoutBankService,
    eventPlanService,
    progressDashboardService,
    stravaService,
    workoutRecapService
  );

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });

  app.on("before-quit", () => {
    unsubscribeDisplaySleepGuard();
    displaySleepGuard.dispose();
    cleanupIpcHandlers();
    databaseService.close();
  });
};

void bootstrap();
