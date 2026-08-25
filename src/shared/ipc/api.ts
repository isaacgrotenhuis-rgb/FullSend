import type {
  BleCapabilities,
  BleDevice,
  BleDeviceRequest,
  BleConnectRequest,
  BleDisconnectRequest,
  BleFtmsProfile,
  BleScanRequest,
  BleState,
  CreateIntervalRequest,
  CreateWorkoutRequest,
  DeleteIntervalRequest,
  DeleteWorkoutRequest,
  IntervalIdResult,
  OkResult,
  PlanWeekSummary,
  GenerateEventPlanRequest,
  GenerateEventPlanResult,
  GetCurrentEventPlanResult,
  AdaptEventPlanRequest,
  AdaptEventPlanResult,
  DeleteEventPlanRequest,
  PlanVersionsRequest,
  EventPlanVersion,
  PlanAuditEntriesRequest,
  EventPlanAuditEntry,
  DashboardMetricsRequest,
  DashboardMetrics,
  StravaConnectRequest,
  StravaConnectResult,
  StravaSyncRequest,
  StravaSyncResult,
  StravaRetryRequest,
  StravaStatus,
  PingResult,
  ReorderIntervalsRequest,
  StartWorkoutSessionRequest,
  UpdateIntervalRequest,
  UpdateWorkoutRequest,
  WorkoutDetail,
  WorkoutDetailRequest,
  WorkoutIdResult,
  WorkoutSummary,
  WorkoutSessionControlRequest,
  WorkoutSessionSetIntensityRequest,
  WorkoutSessionSetRampDurationRequest,
  WorkoutSessionStartResult,
  WorkoutSessionState,
  WorkoutSessionSummary,
  AssignWorkoutToPlanDayRequest,
  UnassignWorkoutFromPlanDayRequest
} from "@shared/ipc/contracts";

export interface KickrDesktopApi {
  ping: () => Promise<PingResult>;
  ble: {
    startScan: (request?: Partial<BleScanRequest>) => Promise<OkResult>;
    stopScan: () => Promise<OkResult>;
    listDevices: () => Promise<BleDevice[]>;
    connect: (request: BleConnectRequest) => Promise<OkResult>;
    disconnect: (request?: BleDisconnectRequest) => Promise<OkResult>;
    getState: () => Promise<BleState>;
    getCapabilities: () => Promise<BleCapabilities>;
    discoverFtms: (request: BleDeviceRequest) => Promise<BleFtmsProfile>;
    subscribeState: (listener: (state: BleState) => void) => () => void;
  };
  workout: {
    startSession: (request: StartWorkoutSessionRequest) => Promise<WorkoutSessionStartResult>;
    pauseSession: (request: WorkoutSessionControlRequest) => Promise<OkResult>;
    resumeSession: (request: WorkoutSessionControlRequest) => Promise<OkResult>;
    stopSession: (request: WorkoutSessionControlRequest) => Promise<OkResult>;
    saveSession: (request: WorkoutSessionControlRequest) => Promise<WorkoutSessionSummary>;
    discardSession: (request: WorkoutSessionControlRequest) => Promise<OkResult>;
    setIntensity: (request: WorkoutSessionSetIntensityRequest) => Promise<OkResult>;
    setRampDuration: (request: WorkoutSessionSetRampDurationRequest) => Promise<OkResult>;
    getSessionState: () => Promise<WorkoutSessionState>;
    subscribeSession: (listener: (state: WorkoutSessionState) => void) => () => void;
  };
  workoutLibrary: {
    createWorkout: (request: CreateWorkoutRequest) => Promise<WorkoutIdResult>;
    updateWorkout: (request: UpdateWorkoutRequest) => Promise<OkResult>;
    deleteWorkout: (request: DeleteWorkoutRequest) => Promise<OkResult>;
    listWorkouts: () => Promise<WorkoutSummary[]>;
    getWorkoutDetail: (request: WorkoutDetailRequest) => Promise<WorkoutDetail>;
    createInterval: (request: CreateIntervalRequest) => Promise<IntervalIdResult>;
    updateInterval: (request: UpdateIntervalRequest) => Promise<OkResult>;
    reorderIntervals: (request: ReorderIntervalsRequest) => Promise<OkResult>;
    deleteInterval: (request: DeleteIntervalRequest) => Promise<OkResult>;
    assignWorkoutToPlanDay: (request: AssignWorkoutToPlanDayRequest) => Promise<OkResult>;
    unassignWorkoutFromPlanDay: (request: UnassignWorkoutFromPlanDayRequest) => Promise<OkResult>;
    listPlanWeeks: () => Promise<PlanWeekSummary[]>;
  };
  eventPlan: {
    generate: (request: GenerateEventPlanRequest) => Promise<GenerateEventPlanResult>;
    adapt: (request: AdaptEventPlanRequest) => Promise<AdaptEventPlanResult>;
    delete: (request: DeleteEventPlanRequest) => Promise<OkResult>;
    listVersions: (request: PlanVersionsRequest) => Promise<EventPlanVersion[]>;
    listAuditEntries: (request: PlanAuditEntriesRequest) => Promise<EventPlanAuditEntry[]>;
    getCurrent: () => Promise<GetCurrentEventPlanResult>;
  };
  dashboard: {
    getMetrics: (request?: Partial<DashboardMetricsRequest>) => Promise<DashboardMetrics>;
  };
  strava: {
    connect: (request?: Partial<StravaConnectRequest>) => Promise<StravaConnectResult>;
    disconnect: () => Promise<OkResult>;
    sync: (request?: Partial<StravaSyncRequest>) => Promise<StravaSyncResult>;
    retry: (request: StravaRetryRequest) => Promise<StravaSyncResult>;
    getStatus: () => Promise<StravaStatus>;
  };
}
