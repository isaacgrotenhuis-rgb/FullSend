import { z } from "zod";
import { ZONE_KEYS } from "@shared/zones";

export const ipcChannels = {
  app: {
    ping: "app:ping"
  },
  ble: {
    startScan: "ble:start-scan",
    stopScan: "ble:stop-scan",
    listDevices: "ble:list-devices",
    connect: "ble:connect",
    disconnect: "ble:disconnect",
    getState: "ble:get-state",
    getCapabilities: "ble:get-capabilities",
    discoverFtms: "ble:discover-ftms",
    subscribeState: "ble:subscribe-state",
    unsubscribeState: "ble:unsubscribe-state",
    stateChangedEvent: "ble:state-changed"
  },
  workout: {
    startSession: "workout:start-session",
    pauseSession: "workout:pause-session",
    resumeSession: "workout:resume-session",
    stopSession: "workout:stop-session",
    saveSession: "workout:save-session",
    discardSession: "workout:discard-session",
    setIntensity: "workout:set-intensity",
    setRampDuration: "workout:set-ramp-duration",
    getSessionState: "workout:get-session-state",
    subscribeSession: "workout:subscribe-session",
    unsubscribeSession: "workout:unsubscribe-session",
    sessionStateChangedEvent: "workout:session-state-changed"
  },
  workoutLibrary: {
    createWorkout: "workout-library:create-workout",
    updateWorkout: "workout-library:update-workout",
    deleteWorkout: "workout-library:delete-workout",
    listWorkouts: "workout-library:list-workouts",
    getWorkoutDetail: "workout-library:get-workout-detail",
    createInterval: "workout-library:create-interval",
    updateInterval: "workout-library:update-interval",
    reorderIntervals: "workout-library:reorder-intervals",
    deleteInterval: "workout-library:delete-interval",
    assignWorkoutToPlanDay: "workout-library:assign-workout-to-plan-day",
    unassignWorkoutFromPlanDay: "workout-library:unassign-workout-from-plan-day",
    listPlanWeeks: "workout-library:list-plan-weeks"
  },
  workoutBank: {
    list: "workout-bank:list",
    get: "workout-bank:get",
    create: "workout-bank:create",
    update: "workout-bank:update",
    archive: "workout-bank:archive",
    startAdhoc: "workout-bank:start-adhoc"
  },
  eventPlan: {
    generate: "event-plan:generate",
    adapt: "event-plan:adapt",
    delete: "event-plan:delete",
    listVersions: "event-plan:list-versions",
    listAuditEntries: "event-plan:list-audit-entries",
    getCurrent: "event-plan:get-current"
  },
  dashboard: {
    getMetrics: "dashboard:get-metrics"
  },
  strava: {
    connect: "strava:connect",
    disconnect: "strava:disconnect",
    sync: "strava:sync",
    retry: "strava:retry",
    getStatus: "strava:get-status"
  }
} as const;

export const bleLifecycleSchema = z.enum([
  "idle",
  "initializing",
  "powered_off",
  "scanning",
  "connecting",
  "connected",
  "disconnected",
  "disconnecting",
  "error"
]);

export const bleRoleSchema = z.enum(["power", "heart_rate", "cadence"]);
export const bleRoles: readonly z.infer<typeof bleRoleSchema>[] = ["power", "heart_rate", "cadence"] as const;

export const bleDeviceRolesSchema = z.array(bleRoleSchema);

export const bleDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  rssi: z.number().int().optional(),
  localName: z.string().optional(),
  roles: bleDeviceRolesSchema.default([])
});

export const bleCapabilitiesSchema = z.object({
  canScan: z.boolean(),
  canConnect: z.boolean(),
  canDisconnect: z.boolean(),
  supportsFtmsDiscovery: z.boolean(),
  supportsHeartRateDiscovery: z.boolean(),
  supportsBackgroundReconnect: z.boolean(),
  knownLimitations: z.array(z.string())
});

export const bleConnectionLifecycleSchema = z.enum([
  "idle",
  "connecting",
  "connected",
  "disconnecting",
  "disconnected",
  "error"
]);

export const bleConnectionEntrySchema = z.object({
  lifecycle: bleConnectionLifecycleSchema,
  connectedDeviceId: z.string().nullable(),
  lastError: z.string().nullable()
});

// Only heart_rate and cadence live here; the "power" role's connection status stays
// on BleState's flat lifecycle/connectedDeviceId/lastError fields (see bleStateSchema
// below) because that lifecycle enum is already dual-purpose as the adapter's global
// status, and splitting that apart is out of scope for the role-model change.
export const bleConnectionsSchema = z.object({
  heart_rate: bleConnectionEntrySchema,
  cadence: bleConnectionEntrySchema
});

export const bleHeartRateSampleSchema = z.object({
  bpm: z.number().nullable(),
  timestamp: z.string()
});

export const bleFtmsCharacteristicSchema = z.object({
  key: z.enum(["ftmsControlPoint", "indoorBikeData", "fitnessMachineStatus", "supportedPowerRange"]),
  uuid: z.string(),
  discovered: z.boolean()
});

export const bleFtmsProfileSchema = z.object({
  deviceId: z.string().min(1),
  serviceUuid: z.string(),
  characteristics: z.array(bleFtmsCharacteristicSchema),
  ergControlAvailable: z.boolean(),
  discoveredAt: z.string()
});

export const bleLiveTelemetrySchema = z.object({
  powerWatts: z.number().nullable(),
  cadenceRpm: z.number().nullable(),
  speedKmh: z.number().nullable(),
  timestamp: z.string()
});

export const bleStateSchema = z.object({
  // These four fields double as the "power" role's connection status (see
  // bleConnectionsSchema above for why power isn't folded into `connections`).
  lifecycle: bleLifecycleSchema,
  connectedDeviceId: z.string().nullable(),
  lastError: z.string().nullable(),
  ftmsProfile: bleFtmsProfileSchema.nullable(),
  scanning: z.boolean(),
  discoveredDevices: z.array(bleDeviceSchema),
  liveTelemetry: bleLiveTelemetrySchema.nullable(),
  connections: bleConnectionsSchema,
  heartRate: bleHeartRateSampleSchema.nullable()
});

export const bleScanRequestSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(60000).default(10000)
});

export const bleConnectRequestSchema = z.object({
  deviceId: z.string().min(1),
  role: bleRoleSchema
});

export const bleDisconnectRequestSchema = z.object({
  deviceId: z.string().min(1).optional()
});

export const bleDeviceRequestSchema = z.object({
  deviceId: z.string().min(1)
});

export const workoutIntervalKindSchema = z.enum(["warmup", "work", "recovery", "cooldown"]);

export const workoutIntervalSchema = z.object({
  kind: workoutIntervalKindSchema,
  durationSec: z.number().int().min(1),
  targetPowerWatts: z.number().min(0).nullable(),
  targetResistancePercent: z.number().min(0).max(100).nullable(),
  // Ramp support: when non-null the interval linearly interpolates from
  // targetPowerWatts (start) to targetPowerWattsEnd over its duration. null/undefined
  // = flat block (unchanged behavior).
  targetPowerWattsEnd: z.number().min(0).nullable().optional(),
  // Display-only cadence target (no control-point write). null/undefined = none.
  targetCadenceRpm: z.number().min(0).nullable().optional()
});

export const workoutBuilderIntervalSchema = workoutIntervalSchema.extend({
  id: z.string().min(1).optional()
});

// ---------------------------------------------------------------------------
// Workout Bank — .fsw (Full Send Workout) document format (doc §3, §12)
// ---------------------------------------------------------------------------

export const trainingZoneSchema = z.enum(ZONE_KEYS);
export const trainingPhaseSchema = z.enum(["base", "build", "peak", "taper"]);

/** Power is always a fraction of FTP (never watts), strictly > 0. */
export const fswPowerFractionSchema = z.number().positive();

export const fswTextEventSchema = z.object({
  atSec: z.number().min(0),
  message: z.string().min(1)
});

export const fswSurgesSchema = z.object({
  everySec: z.number().int().min(1),
  durationSec: z.number().int().min(1),
  power: fswPowerFractionSchema
});

export const fswOnPatternStepSchema = z.object({
  durationSec: z.number().int().min(1),
  power: fswPowerFractionSchema,
  cadence: z.number().min(0).optional()
});

const fswWarmupSegmentSchema = z.object({
  type: z.literal("warmup"),
  durationSec: z.number().int().min(1),
  powerLow: fswPowerFractionSchema,
  powerHigh: fswPowerFractionSchema,
  cadence: z.number().min(0).optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

const fswCooldownSegmentSchema = z.object({
  type: z.literal("cooldown"),
  durationSec: z.number().int().min(1),
  powerLow: fswPowerFractionSchema,
  powerHigh: fswPowerFractionSchema,
  cadence: z.number().min(0).optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

const fswRampSegmentSchema = z.object({
  type: z.literal("ramp"),
  durationSec: z.number().int().min(1),
  powerLow: fswPowerFractionSchema,
  powerHigh: fswPowerFractionSchema,
  cadence: z.number().min(0).optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

const fswSteadySegmentSchema = z.object({
  type: z.literal("steady"),
  durationSec: z.number().int().min(1),
  power: fswPowerFractionSchema,
  cadence: z.number().min(0).optional(),
  surges: fswSurgesSchema.optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

const fswFreerideSegmentSchema = z.object({
  type: z.literal("freeride"),
  durationSec: z.number().int().min(1),
  cadence: z.number().min(0).optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

const fswIntervalsSegmentSchema = z.object({
  type: z.literal("intervals"),
  repeat: z.number().int().min(1),
  onDurationSec: z.number().int().min(1).optional(),
  onPower: fswPowerFractionSchema.optional(),
  /** Over-under / multi-level rep: sub-steps that replace the scalar on-step. */
  onPattern: z.array(fswOnPatternStepSchema).min(1).optional(),
  offDurationSec: z.number().int().min(0),
  offPower: fswPowerFractionSchema,
  onCadence: z.number().min(0).optional(),
  offCadence: z.number().min(0).optional(),
  cadence: z.number().min(0).optional(),
  /** Keep the recovery after the final rep (default: dropped). */
  trailingRecovery: z.boolean().optional(),
  surges: fswSurgesSchema.optional(),
  textEvents: z.array(fswTextEventSchema).optional()
});

export const fswSegmentSchema = z.discriminatedUnion("type", [
  fswWarmupSegmentSchema,
  fswCooldownSegmentSchema,
  fswRampSegmentSchema,
  fswSteadySegmentSchema,
  fswFreerideSegmentSchema,
  fswIntervalsSegmentSchema
]);

export const fswDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    author: z.string().optional(),
    discipline: z.string().min(1).default("cycling"),
    primaryZone: trainingZoneSchema,
    tags: z.array(z.string()).default([]),
    phases: z.array(trainingPhaseSchema).default([]),
    // Cached / derived — optional on input, recomputed on save.
    durationSec: z.number().int().min(1).optional(),
    estIF: z.number().min(0).optional(),
    estTSS: z.number().min(0).optional(),
    segments: z.array(fswSegmentSchema).min(1),
    textEvents: z.array(fswTextEventSchema).optional()
  })
  .superRefine((doc, ctx) => {
    doc.segments.forEach((segment, index) => {
      if (
        segment.type === "intervals" &&
        segment.onPattern == null &&
        (segment.onDurationSec == null || segment.onPower == null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["segments", index],
          message: "intervals segment needs onPattern, or both onDurationSec and onPower"
        });
      }
    });
  });

export type TrainingZone = z.infer<typeof trainingZoneSchema>;
export type TrainingPhase = z.infer<typeof trainingPhaseSchema>;
export type FswTextEvent = z.infer<typeof fswTextEventSchema>;
export type FswSurges = z.infer<typeof fswSurgesSchema>;
export type FswOnPatternStep = z.infer<typeof fswOnPatternStepSchema>;
export type FswSegment = z.infer<typeof fswSegmentSchema>;
export type FswDocument = z.infer<typeof fswDocumentSchema>;

export const bankWorkoutSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primaryZone: trainingZoneSchema,
  discipline: z.string().min(1),
  tags: z.array(z.string()),
  phases: z.array(trainingPhaseSchema),
  durationSec: z.number().int().min(0),
  estIF: z.number().nullable(),
  estTSS: z.number().nullable(),
  source: z.string().min(1),
  archived: z.boolean()
});

export const bankWorkoutDetailSchema = bankWorkoutSummarySchema.extend({
  document: fswDocumentSchema
});

export const bankWorkoutFilterSchema = z.object({
  zone: trainingZoneSchema.optional(),
  phase: trainingPhaseSchema.optional(),
  discipline: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  maxDurationMin: z.number().int().min(1).optional(),
  includeArchived: z.boolean().optional()
});

export const listBankWorkoutsRequestSchema = bankWorkoutFilterSchema;
export const getBankWorkoutRequestSchema = z.object({ id: z.string().min(1) });
export const createBankWorkoutRequestSchema = z.object({ document: fswDocumentSchema });
export const updateBankWorkoutRequestSchema = z.object({
  id: z.string().min(1),
  document: fswDocumentSchema
});
export const archiveBankWorkoutRequestSchema = z.object({ id: z.string().min(1) });
export const startAdhocBankWorkoutRequestSchema = z.object({
  bankWorkoutId: z.string().min(1),
  deviceId: z.string().min(1),
  ftp: z.number().int().min(100).max(600),
  name: z.string().min(1).optional()
});
export const bankWorkoutSummariesSchema = z.array(bankWorkoutSummarySchema);
export const bankWorkoutIdResultSchema = z.object({ ok: z.literal(true), id: z.string().min(1) });

export type BankWorkoutSummary = z.infer<typeof bankWorkoutSummarySchema>;
export type BankWorkoutDetail = z.infer<typeof bankWorkoutDetailSchema>;
export type BankWorkoutFilter = z.infer<typeof bankWorkoutFilterSchema>;
export type ListBankWorkoutsRequest = z.infer<typeof listBankWorkoutsRequestSchema>;
export type GetBankWorkoutRequest = z.infer<typeof getBankWorkoutRequestSchema>;
export type CreateBankWorkoutRequest = z.infer<typeof createBankWorkoutRequestSchema>;
export type UpdateBankWorkoutRequest = z.infer<typeof updateBankWorkoutRequestSchema>;
export type ArchiveBankWorkoutRequest = z.infer<typeof archiveBankWorkoutRequestSchema>;
export type StartAdhocBankWorkoutRequest = z.infer<typeof startAdhocBankWorkoutRequestSchema>;
export type BankWorkoutIdResult = z.infer<typeof bankWorkoutIdResultSchema>;

export const startWorkoutSessionRequestSchema = z.object({
  workoutId: z.string().min(1).nullable().optional(),
  deviceId: z.string().min(1),
  intervals: z.array(workoutIntervalSchema).min(1),
  metadata: z.record(z.unknown()).optional()
});

export const workoutSessionControlRequestSchema = z.object({
  sessionId: z.string().min(1)
});

export const intensityMultiplierSchema = z.number().min(0.5).max(1.5);

export const workoutSessionSetIntensityRequestSchema = z.object({
  sessionId: z.string().min(1),
  intensityMultiplier: intensityMultiplierSchema
});

export const rampDurationSecSchema = z.number().min(0).max(60);

export const workoutSessionSetRampDurationRequestSchema = z.object({
  sessionId: z.string().min(1),
  rampDurationSec: rampDurationSecSchema
});

export const workoutSessionLifecycleSchema = z.enum([
  "idle",
  "running",
  "paused",
  "stopped",
  "completed",
  "degraded",
  "error"
]);

export const workoutLiveMetricsSchema = z.object({
  timestamp: z.string(),
  elapsedSec: z.number().int().min(0),
  blockIndex: z.number().int().min(0),
  blockKind: workoutIntervalKindSchema,
  targetPowerWatts: z.number().nullable(),
  targetResistancePercent: z.number().nullable(),
  targetCadenceRpm: z.number().nullable(),
  actualPowerWatts: z.number().nullable(),
  actualCadenceRpm: z.number().nullable(),
  actualHeartRateBpm: z.number().nullable(),
  actualSpeedKmh: z.number().nullable()
});

export const workoutSessionStateSchema = z.object({
  sessionId: z.string().nullable(),
  workoutId: z.string().nullable(),
  deviceId: z.string().nullable(),
  lifecycle: workoutSessionLifecycleSchema,
  startedAt: z.string().nullable(),
  pausedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  elapsedSec: z.number().int().min(0),
  currentIntervalIndex: z.number().int().min(0).nullable(),
  intervalsTotal: z.number().int().min(0),
  lastError: z.string().nullable(),
  liveMetrics: workoutLiveMetricsSchema.nullable(),
  intensityMultiplier: intensityMultiplierSchema,
  rampDurationSec: rampDurationSecSchema
});

export const workoutSessionStartResultSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string().min(1)
});

export const workoutSessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  durationSec: z.number().int().min(0),
  avgPowerWatts: z.number().nullable(),
  avgCadenceRpm: z.number().nullable(),
  avgHeartRateBpm: z.number().nullable()
});

export const workoutSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  durationSec: z.number().int().min(0),
  intensityFactor: z.number().nullable()
});

export const createWorkoutRequestSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1).default("manual-builder"),
  intensityFactor: z.number().nullable().optional(),
  intervals: z.array(workoutIntervalSchema).min(1)
});

export const updateWorkoutRequestSchema = z.object({
  workoutId: z.string().min(1),
  name: z.string().min(1),
  intensityFactor: z.number().nullable().optional()
});

export const deleteWorkoutRequestSchema = z.object({
  workoutId: z.string().min(1)
});

export const workoutDetailRequestSchema = z.object({
  workoutId: z.string().min(1)
});

export const workoutDetailSchema = z.object({
  workout: workoutSummarySchema,
  intervals: z.array(workoutBuilderIntervalSchema)
});

export const createIntervalRequestSchema = z.object({
  workoutId: z.string().min(1),
  interval: workoutIntervalSchema,
  index: z.number().int().min(0).nullable().optional()
});

export const updateIntervalRequestSchema = z.object({
  intervalId: z.string().min(1),
  interval: workoutIntervalSchema
});

export const deleteIntervalRequestSchema = z.object({
  workoutId: z.string().min(1),
  intervalId: z.string().min(1)
});

export const reorderIntervalsRequestSchema = z.object({
  workoutId: z.string().min(1),
  orderedIntervalIds: z.array(z.string().min(1)).min(1)
});

export const assignWorkoutToPlanDayRequestSchema = z.object({
  planWeekId: z.string().min(1),
  dayIndex: z.number().int().min(0).max(6),
  workoutId: z.string().min(1)
});

export const unassignWorkoutFromPlanDayRequestSchema = z.object({
  planWeekId: z.string().min(1),
  dayIndex: z.number().int().min(0).max(6)
});

export const workoutIdResultSchema = z.object({
  ok: z.literal(true),
  workoutId: z.string().min(1)
});

export const intervalIdResultSchema = z.object({
  ok: z.literal(true),
  intervalId: z.string().min(1)
});

export const planWeekAssignmentSchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  workoutId: z.string().min(1),
  workoutName: z.string().min(1)
});

export const planWeekSummarySchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  weekIndex: z.number().int(),
  startDate: z.string(),
  notes: z.string().nullable(),
  assignments: z.array(planWeekAssignmentSchema)
});

export const dayAvailabilitySchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  canTrain: z.boolean(),
  maxDurationMin: z.number().int().min(20).max(360).nullable().optional()
});
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const planLengthWeeksSchema = z.number().int().min(4).max(24);
export const eventTypeSchema = z.enum([
  "road-race",
  "time-trial",
  "criterium",
  "gran-fondo",
  "xc-mtb",
  "marathon-mtb"
]);
export const adaptationSourceSchema = z.enum(["user", "ai", "system"]);
export const adaptationActionSchema = z.enum(["generated", "adapted"]);
export const loadTagSchema = z.enum(["build", "recovery", "taper"]);
export const sessionTypeSchema = z.enum([
  "endurance",
  "tempo",
  "threshold",
  "vo2",
  "recovery",
  "sweet-spot",
  "anaerobic",
  "neuromuscular"
]);

export const eventPlanDaySchema = z.object({
  dayIndex: z.number().int().min(0).max(6),
  workoutId: z.string().min(1).nullable(),
  workoutName: z.string().min(1).nullable(),
  sessionType: sessionTypeSchema.nullable(),
  durationMin: z.number().int().min(0),
  targetIF: z.number().min(0).max(1).nullable()
});

export const eventPlanWeekSchema = z.object({
  weekId: z.string().min(1),
  weekIndex: z.number().int().min(0),
  startDate: z.string(),
  loadTag: loadTagSchema,
  targetMinutes: z.number().int().min(0),
  targetIF: z.number().min(0).max(1),
  notes: z.string().nullable(),
  days: z.array(eventPlanDaySchema).length(7)
});

export const eventPlanInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  eventType: eventTypeSchema,
  eventDate: isoDateSchema,
  planLengthWeeks: planLengthWeeksSchema,
  currentFtp: z.number().int().min(100).max(600),
  weeklyAvailability: z.array(dayAvailabilitySchema).length(7)
});

export const generateEventPlanRequestSchema = eventPlanInputSchema.extend({
  reason: z.string().min(1).default("Initial event plan generation"),
  source: adaptationSourceSchema.default("user")
});

export const adaptEventPlanRequestSchema = z.object({
  planId: z.string().min(1),
  reason: z.string().min(1),
  source: adaptationSourceSchema.default("user"),
  adaptationPrompt: z.string().min(1).optional(),
  overrides: z
    .object({
      currentFtp: z.number().int().min(100).max(600).optional(),
      eventDate: isoDateSchema.optional(),
      weeklyAvailability: z.array(dayAvailabilitySchema).length(7).optional()
    })
    .optional()
});

export const deleteEventPlanRequestSchema = z.object({
  planId: z.string().min(1)
});

export const planVersionsRequestSchema = z.object({
  planId: z.string().min(1)
});

export const planAuditEntriesRequestSchema = z.object({
  planId: z.string().min(1)
});

export const eventPlanVersionSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  versionNumber: z.number().int().min(1),
  source: adaptationSourceSchema,
  reason: z.string().min(1),
  createdAt: z.string(),
  isCurrent: z.boolean()
});

export const eventPlanAuditEntrySchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  planVersionId: z.string().min(1).nullable(),
  action: adaptationActionSchema,
  source: adaptationSourceSchema,
  reason: z.string().min(1),
  metadata: z.record(z.unknown()),
  createdAt: z.string()
});

export const generateEventPlanResultSchema = z.object({
  ok: z.literal(true),
  planId: z.string().min(1),
  name: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().min(1),
  weeks: z.array(eventPlanWeekSchema)
});

export const getCurrentEventPlanResultSchema = z
  .object({
    planId: z.string().min(1),
    name: z.string().min(1),
    weeks: z.array(eventPlanWeekSchema)
  })
  .nullable();

export const adaptEventPlanResultSchema = z.object({
  ok: z.literal(true),
  planId: z.string().min(1),
  name: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().min(1),
  weeks: z.array(eventPlanWeekSchema),
  appliedStrategy: z.string().min(1)
});

export const dashboardMetricsRequestSchema = z.object({
  weeksBack: z.number().int().min(4).max(26).default(12)
});

export const ftpTrendPointSchema = z.object({
  capturedAt: z.string(),
  ftpWatts: z.number().nullable()
});

export const weeklyLoadPointSchema = z.object({
  weekStart: z.string(),
  plannedLoad: z.number(),
  actualLoad: z.number(),
  variance: z.number()
});

export const dashboardMetricsSchema = z.object({
  generatedAt: z.string(),
  ftpTrend: z.array(ftpTrendPointSchema),
  completedWorkoutsCount: z.number().int().min(0),
  planCompliancePercent: z.number().min(0).max(100).nullable(),
  weeklyLoad: z.array(weeklyLoadPointSchema),
  plannedVsActualLoadVariancePercent: z.number().nullable(),
  trendSummary: z.string().min(1)
});

export const stravaSyncStatusSchema = z.enum(["pending", "success", "failed"]);

export const stravaConnectRequestSchema = z.object({
  authorizationCode: z.string().min(1).optional(),
  state: z.string().min(1).optional()
});

export const stravaConnectResultSchema = z.object({
  ok: z.literal(true),
  connected: z.boolean(),
  requiresAuthorizationCode: z.boolean(),
  authorizationUrl: z.string().url().optional(),
  state: z.string().optional()
});

export const stravaDisconnectRequestSchema = z.object({});

export const stravaSyncRequestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(25).default(10)
});

export const stravaRetryRequestSchema = z.object({
  eventId: z.string().min(1)
});

export const stravaSyncEventSummarySchema = z.object({
  id: z.string().min(1),
  eventType: z.string().min(1),
  syncStatus: stravaSyncStatusSchema,
  stravaActivityId: z.string().nullable(),
  sessionId: z.string().nullable(),
  attemptedAt: z.string(),
  message: z.string().nullable()
});

export const stravaSyncResultSchema = z.object({
  ok: z.literal(true),
  processedCount: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  events: z.array(stravaSyncEventSummarySchema)
});

export const stravaStatusSchema = z.object({
  connected: z.boolean(),
  hasConfig: z.boolean(),
  athleteId: z.number().int().nullable(),
  tokenExpiresAt: z.string().nullable(),
  counts: z.object({
    pending: z.number().int().min(0),
    success: z.number().int().min(0),
    failed: z.number().int().min(0)
  }),
  recentEvents: z.array(stravaSyncEventSummarySchema)
});

export const okResultSchema = z.object({
  ok: z.literal(true)
});

export const bleDeviceListResultSchema = z.array(bleDeviceSchema);
export const workoutSummariesSchema = z.array(workoutSummarySchema);
export const planWeekSummariesSchema = z.array(planWeekSummarySchema);
export const eventPlanVersionsSchema = z.array(eventPlanVersionSchema);
export const eventPlanAuditEntriesSchema = z.array(eventPlanAuditEntrySchema);
export const dashboardMetricsResultSchema = dashboardMetricsSchema;
export const stravaSyncEventsSchema = z.array(stravaSyncEventSummarySchema);

export const pingResultSchema = z.object({
  app: z.literal("full-send"),
  ts: z.string()
});

export type BleLifecycle = z.infer<typeof bleLifecycleSchema>;
export type BleRole = z.infer<typeof bleRoleSchema>;
export type BleDevice = z.infer<typeof bleDeviceSchema>;
export type BleCapabilities = z.infer<typeof bleCapabilitiesSchema>;
export type BleConnectionLifecycle = z.infer<typeof bleConnectionLifecycleSchema>;
export type BleConnectionEntry = z.infer<typeof bleConnectionEntrySchema>;
export type BleConnections = z.infer<typeof bleConnectionsSchema>;
export type BleHeartRateSample = z.infer<typeof bleHeartRateSampleSchema>;
export type BleFtmsCharacteristic = z.infer<typeof bleFtmsCharacteristicSchema>;
export type BleFtmsProfile = z.infer<typeof bleFtmsProfileSchema>;
export type BleLiveTelemetry = z.infer<typeof bleLiveTelemetrySchema>;
export type BleState = z.infer<typeof bleStateSchema>;
export type BleScanRequest = z.infer<typeof bleScanRequestSchema>;
export type BleConnectRequest = z.infer<typeof bleConnectRequestSchema>;
export type BleDisconnectRequest = z.infer<typeof bleDisconnectRequestSchema>;
export type BleDeviceRequest = z.infer<typeof bleDeviceRequestSchema>;
export type BleDeviceListResult = z.infer<typeof bleDeviceListResultSchema>;
export type WorkoutIntervalKind = z.infer<typeof workoutIntervalKindSchema>;
export type WorkoutInterval = z.infer<typeof workoutIntervalSchema>;
export type WorkoutBuilderInterval = z.infer<typeof workoutBuilderIntervalSchema>;
export type StartWorkoutSessionRequest = z.infer<typeof startWorkoutSessionRequestSchema>;
export type WorkoutSessionControlRequest = z.infer<typeof workoutSessionControlRequestSchema>;
export type IntensityMultiplier = z.infer<typeof intensityMultiplierSchema>;
export type WorkoutSessionSetIntensityRequest = z.infer<typeof workoutSessionSetIntensityRequestSchema>;
export type RampDurationSec = z.infer<typeof rampDurationSecSchema>;
export type WorkoutSessionSetRampDurationRequest = z.infer<typeof workoutSessionSetRampDurationRequestSchema>;
export type WorkoutSessionLifecycle = z.infer<typeof workoutSessionLifecycleSchema>;
export type WorkoutLiveMetrics = z.infer<typeof workoutLiveMetricsSchema>;
export type WorkoutSessionState = z.infer<typeof workoutSessionStateSchema>;
export type WorkoutSessionStartResult = z.infer<typeof workoutSessionStartResultSchema>;
export type WorkoutSessionSummary = z.infer<typeof workoutSessionSummarySchema>;
export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;
export type CreateWorkoutRequest = z.infer<typeof createWorkoutRequestSchema>;
export type UpdateWorkoutRequest = z.infer<typeof updateWorkoutRequestSchema>;
export type DeleteWorkoutRequest = z.infer<typeof deleteWorkoutRequestSchema>;
export type WorkoutDetailRequest = z.infer<typeof workoutDetailRequestSchema>;
export type WorkoutDetail = z.infer<typeof workoutDetailSchema>;
export type CreateIntervalRequest = z.infer<typeof createIntervalRequestSchema>;
export type UpdateIntervalRequest = z.infer<typeof updateIntervalRequestSchema>;
export type DeleteIntervalRequest = z.infer<typeof deleteIntervalRequestSchema>;
export type ReorderIntervalsRequest = z.infer<typeof reorderIntervalsRequestSchema>;
export type AssignWorkoutToPlanDayRequest = z.infer<typeof assignWorkoutToPlanDayRequestSchema>;
export type UnassignWorkoutFromPlanDayRequest = z.infer<typeof unassignWorkoutFromPlanDayRequestSchema>;
export type WorkoutIdResult = z.infer<typeof workoutIdResultSchema>;
export type IntervalIdResult = z.infer<typeof intervalIdResultSchema>;
export type PlanWeekSummary = z.infer<typeof planWeekSummarySchema>;
export type DayAvailability = z.infer<typeof dayAvailabilitySchema>;
export type PlanLengthWeeks = z.infer<typeof planLengthWeeksSchema>;
export type EventType = z.infer<typeof eventTypeSchema>;
export type AdaptationSource = z.infer<typeof adaptationSourceSchema>;
export type AdaptationAction = z.infer<typeof adaptationActionSchema>;
export type LoadTag = z.infer<typeof loadTagSchema>;
export type SessionType = z.infer<typeof sessionTypeSchema>;
export type EventPlanDay = z.infer<typeof eventPlanDaySchema>;
export type EventPlanWeek = z.infer<typeof eventPlanWeekSchema>;
export type EventPlanInput = z.infer<typeof eventPlanInputSchema>;
export type GenerateEventPlanRequest = z.infer<typeof generateEventPlanRequestSchema>;
export type AdaptEventPlanRequest = z.infer<typeof adaptEventPlanRequestSchema>;
export type DeleteEventPlanRequest = z.infer<typeof deleteEventPlanRequestSchema>;
export type PlanVersionsRequest = z.infer<typeof planVersionsRequestSchema>;
export type PlanAuditEntriesRequest = z.infer<typeof planAuditEntriesRequestSchema>;
export type EventPlanVersion = z.infer<typeof eventPlanVersionSchema>;
export type EventPlanAuditEntry = z.infer<typeof eventPlanAuditEntrySchema>;
export type GenerateEventPlanResult = z.infer<typeof generateEventPlanResultSchema>;
export type AdaptEventPlanResult = z.infer<typeof adaptEventPlanResultSchema>;
export type GetCurrentEventPlanResult = z.infer<typeof getCurrentEventPlanResultSchema>;
export type DashboardMetricsRequest = z.infer<typeof dashboardMetricsRequestSchema>;
export type FtpTrendPoint = z.infer<typeof ftpTrendPointSchema>;
export type WeeklyLoadPoint = z.infer<typeof weeklyLoadPointSchema>;
export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>;
export type StravaSyncStatus = z.infer<typeof stravaSyncStatusSchema>;
export type StravaConnectRequest = z.infer<typeof stravaConnectRequestSchema>;
export type StravaConnectResult = z.infer<typeof stravaConnectResultSchema>;
export type StravaDisconnectRequest = z.infer<typeof stravaDisconnectRequestSchema>;
export type StravaSyncRequest = z.infer<typeof stravaSyncRequestSchema>;
export type StravaRetryRequest = z.infer<typeof stravaRetryRequestSchema>;
export type StravaSyncEventSummary = z.infer<typeof stravaSyncEventSummarySchema>;
export type StravaSyncResult = z.infer<typeof stravaSyncResultSchema>;
export type StravaStatus = z.infer<typeof stravaStatusSchema>;
export type OkResult = z.infer<typeof okResultSchema>;
export type PingResult = z.infer<typeof pingResultSchema>;
