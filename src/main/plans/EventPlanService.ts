import { randomUUID } from "node:crypto";
import type { Repositories } from "@main/database/repositories";
import type { AdaptationDecision, PlanAdaptationService } from "@main/plans/PlanAdaptationService";
import type {
  AdaptEventPlanRequest,
  AdaptEventPlanResult,
  DayAvailability,
  EventPlanAuditEntry,
  EventPlanDay,
  EventPlanInput,
  EventPlanVersion,
  EventPlanWeek,
  EventType,
  GenerateEventPlanRequest,
  GenerateEventPlanResult,
  GetCurrentEventPlanResult,
  LoadTag,
  SessionType,
  WorkoutInterval
} from "@shared/ipc/contracts";

type PlanRow = {
  id: string;
  name: string;
  notes: string | null;
};

type PlanVersionRow = {
  id: string;
  plan_id: string;
  version_number: number;
  source: string;
  reason: string;
  input_json: string;
  snapshot_json: string;
  created_at: string;
};

type AuditEntryRow = {
  id: string;
  plan_id: string;
  plan_version_id: string | null;
  action_type: "generated" | "adapted";
  source: "user" | "ai" | "system";
  reason: string;
  metadata_json: string;
  created_at: string;
};

type DayDraft = {
  dayIndex: number;
  sessionType: SessionType | null;
  durationMin: number;
  targetIF: number | null;
};

type WeekDraft = {
  weekIndex: number;
  startDate: string;
  loadTag: LoadTag;
  targetMinutes: number;
  targetIF: number;
  notes: string | null;
  days: DayDraft[];
};

type PlanSnapshot = {
  input: EventPlanInput;
  weeks: Array<{
    weekIndex: number;
    startDate: string;
    loadTag: LoadTag;
    targetMinutes: number;
    targetIF: number;
    notes: string | null;
    days: EventPlanDay[];
  }>;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toIsoDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseIsoDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const addDays = (isoDate: string, days: number): string => {
  const date = parseIsoDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
};

const startOfWeekSunday = (isoDate: string): string => {
  const date = parseIsoDate(isoDate);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return toIsoDate(date);
};

const sessionTypeForEvent = (eventType: EventType): SessionType => {
  switch (eventType) {
    case "time-trial":
      return "threshold";
    case "criterium":
      return "vo2";
    case "road-race":
      return "threshold";
    case "gran-fondo":
      return "tempo";
  }
};

const sanitizeAvailability = (weeklyAvailability: DayAvailability[]): DayAvailability[] => {
  const byDay = new Map<number, DayAvailability>();
  for (const item of weeklyAvailability) {
    byDay.set(item.dayIndex, item);
  }
  const normalized: DayAvailability[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    normalized.push(byDay.get(dayIndex) ?? { dayIndex, canTrain: false, maxDurationMin: null });
  }
  return normalized;
};

const templateIntervals = (
  sessionType: SessionType,
  ftp: number,
  durationMin: number,
  targetIF: number
): WorkoutInterval[] => {
  const warmup = Math.min(10, Math.max(5, Math.round(durationMin * 0.15)));
  const cooldown = Math.min(8, Math.max(4, Math.round(durationMin * 0.1)));
  const mainMin = Math.max(durationMin - warmup - cooldown, 10);
  const watts = (multiplier: number): number => Math.round(ftp * multiplier);

  if (sessionType === "recovery") {
    return [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.45), targetResistancePercent: null },
      { kind: "work", durationSec: mainMin * 60, targetPowerWatts: watts(0.55), targetResistancePercent: null },
      { kind: "cooldown", durationSec: cooldown * 60, targetPowerWatts: watts(0.45), targetResistancePercent: null }
    ];
  }

  if (sessionType === "endurance") {
    return [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.55), targetResistancePercent: null },
      { kind: "work", durationSec: mainMin * 60, targetPowerWatts: watts(targetIF), targetResistancePercent: null },
      { kind: "cooldown", durationSec: cooldown * 60, targetPowerWatts: watts(0.5), targetResistancePercent: null }
    ];
  }

  if (sessionType === "tempo") {
    const rep = Math.max(8, Math.floor((mainMin - 5) / 2));
    const recover = Math.max(mainMin - rep * 2, 5);
    return [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.55), targetResistancePercent: null },
      { kind: "work", durationSec: rep * 60, targetPowerWatts: watts(targetIF), targetResistancePercent: null },
      { kind: "recovery", durationSec: recover * 60, targetPowerWatts: watts(0.6), targetResistancePercent: null },
      { kind: "work", durationSec: rep * 60, targetPowerWatts: watts(targetIF), targetResistancePercent: null },
      { kind: "cooldown", durationSec: cooldown * 60, targetPowerWatts: watts(0.5), targetResistancePercent: null }
    ];
  }

  if (sessionType === "threshold") {
    const reps = 3;
    const recover = 4;
    const totalRecover = recover * (reps - 1);
    const rep = Math.max(6, Math.floor((mainMin - totalRecover) / reps));
    const intervals: WorkoutInterval[] = [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.6), targetResistancePercent: null }
    ];
    for (let i = 0; i < reps; i += 1) {
      intervals.push({
        kind: "work",
        durationSec: rep * 60,
        targetPowerWatts: watts(clamp(targetIF, 0.9, 1)),
        targetResistancePercent: null
      });
      if (i < reps - 1) {
        intervals.push({
          kind: "recovery",
          durationSec: recover * 60,
          targetPowerWatts: watts(0.55),
          targetResistancePercent: null
        });
      }
    }
    intervals.push({
      kind: "cooldown",
      durationSec: cooldown * 60,
      targetPowerWatts: watts(0.5),
      targetResistancePercent: null
    });
    return intervals;
  }

  const hardRep = 3;
  const hardRecover = 3;
  const repeats = Math.max(4, Math.min(6, Math.floor(mainMin / (hardRep + hardRecover))));
  const vo2Intervals: WorkoutInterval[] = [
    { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.6), targetResistancePercent: null }
  ];
  for (let i = 0; i < repeats; i += 1) {
    vo2Intervals.push({
      kind: "work",
      durationSec: hardRep * 60,
      targetPowerWatts: watts(1.08),
      targetResistancePercent: null
    });
    if (i < repeats - 1) {
      vo2Intervals.push({
        kind: "recovery",
        durationSec: hardRecover * 60,
        targetPowerWatts: watts(0.5),
        targetResistancePercent: null
      });
    }
  }
  vo2Intervals.push({
    kind: "cooldown",
    durationSec: cooldown * 60,
    targetPowerWatts: watts(0.5),
    targetResistancePercent: null
  });
  return vo2Intervals;
};

const summarizeChanges = (beforeWeeks: EventPlanWeek[], afterWeeks: EventPlanWeek[]): Record<string, unknown> => {
  const beforeByWeek = new Map<number, EventPlanWeek>(beforeWeeks.map((week) => [week.weekIndex, week]));
  let changedWeeks = 0;
  let changedDays = 0;
  for (const nextWeek of afterWeeks) {
    const prevWeek = beforeByWeek.get(nextWeek.weekIndex);
    if (!prevWeek) {
      changedWeeks += 1;
      changedDays += nextWeek.days.filter((day) => day.workoutId).length;
      continue;
    }
    let weekChanged = prevWeek.targetIF !== nextWeek.targetIF || prevWeek.targetMinutes !== nextWeek.targetMinutes;
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const prevDay = prevWeek.days[dayIndex];
      const nextDay = nextWeek.days[dayIndex];
      if (
        prevDay.workoutName !== nextDay.workoutName ||
        prevDay.durationMin !== nextDay.durationMin ||
        prevDay.sessionType !== nextDay.sessionType ||
        prevDay.targetIF !== nextDay.targetIF
      ) {
        weekChanged = true;
        changedDays += 1;
      }
    }
    if (weekChanged) {
      changedWeeks += 1;
    }
  }
  return {
    changedWeeks,
    changedDays,
    totalWeeks: afterWeeks.length
  };
};

export class EventPlanService {
  constructor(
    private readonly repositories: Repositories,
    private readonly adaptationService: PlanAdaptationService
  ) {}

  private createPlanTitle(input: EventPlanInput): string {
    return `${input.eventType} ${input.eventDate} (${input.planLengthWeeks}w)`;
  }

  private distributeMinutes(
    targetMinutes: number,
    dayIndices: number[],
    weeklyAvailability: DayAvailability[]
  ): number[] {
    const fractionsByCount: Record<number, number[]> = {
      2: [0.42, 0.58],
      3: [0.26, 0.28, 0.46],
      4: [0.2, 0.22, 0.23, 0.35],
      5: [0.18, 0.18, 0.19, 0.2, 0.25]
    };
    const fractions = fractionsByCount[dayIndices.length] ?? new Array(dayIndices.length).fill(1 / dayIndices.length);
    const limits = dayIndices.map((dayIndex) => {
      const constraint = weeklyAvailability[dayIndex];
      return constraint.maxDurationMin ?? 180;
    });
    const minutes = dayIndices.map((_, idx) => Math.max(30, Math.round(targetMinutes * fractions[idx])));

    let total = minutes.reduce((sum, value) => sum + value, 0);
    if (total > targetMinutes) {
      let toTrim = total - targetMinutes;
      while (toTrim > 0) {
        let changed = false;
        for (let idx = 0; idx < minutes.length && toTrim > 0; idx += 1) {
          if (minutes[idx] > 30) {
            minutes[idx] -= 1;
            toTrim -= 1;
            changed = true;
          }
        }
        if (!changed) {
          break;
        }
      }
    } else if (total < targetMinutes) {
      let remaining = targetMinutes - total;
      while (remaining > 0) {
        let changed = false;
        for (let idx = 0; idx < minutes.length && remaining > 0; idx += 1) {
          if (minutes[idx] < limits[idx]) {
            minutes[idx] += 1;
            remaining -= 1;
            changed = true;
          }
        }
        if (!changed) {
          break;
        }
      }
    }

    for (let idx = 0; idx < minutes.length; idx += 1) {
      minutes[idx] = Math.min(minutes[idx], limits[idx]);
    }

    total = minutes.reduce((sum, value) => sum + value, 0);
    if (total < targetMinutes) {
      const difference = targetMinutes - total;
      const finalIdx = minutes.length - 1;
      minutes[finalIdx] = Math.min(minutes[finalIdx] + difference, limits[finalIdx]);
    }
    return minutes;
  }

  private buildWeekDrafts(input: EventPlanInput, tuning: AdaptationDecision["tuning"]): WeekDraft[] {
    const availability = sanitizeAvailability(input.weeklyAvailability);
    const availableDays = availability.filter((item) => item.canTrain).map((item) => item.dayIndex);
    if (availableDays.length < 2) {
      throw new Error("At least two training days are required to generate a plan.");
    }

    const planEndWeek = startOfWeekSunday(input.eventDate);
    const planStartWeek = addDays(planEndWeek, -7 * (input.planLengthWeeks - 1));
    const eventSpecificKey = sessionTypeForEvent(input.eventType);
    const preferredOrder = [2, 4, 6, 0, 3, 1, 5];
    const selectedDays = preferredOrder.filter((day) => availableDays.includes(day)).slice(0, 5);
    const sessionsPerWeek = clamp(selectedDays.length, 2, 5);
    const daySlots = selectedDays.slice(0, sessionsPerWeek);

    const weeklyMaxMinutes = availability
      .filter((item) => item.canTrain)
      .reduce((sum, item) => sum + (item.maxDurationMin ?? 180), 0);

    let baseMinutes = clamp(150 + sessionsPerWeek * 35, 150, weeklyMaxMinutes);
    const drafts: WeekDraft[] = [];

    for (let weekIndex = 0; weekIndex < input.planLengthWeeks; weekIndex += 1) {
      const isRecovery = (weekIndex + 1) % 4 === 0;
      const isTaper = weekIndex >= input.planLengthWeeks - 2;
      const loadTag: LoadTag = isTaper ? "taper" : isRecovery ? "recovery" : "build";
      if (weekIndex > 0 && !isRecovery && !isTaper) {
        const growth = weekIndex % 4 === 0 ? 1.04 : 1.07;
        baseMinutes = Math.round(baseMinutes * growth);
      }

      const tunedMinutes = baseMinutes * (1 + tuning.volumeBias);
      const targetMinutes = clamp(
        Math.round(
          isRecovery ? tunedMinutes * 0.68 : isTaper ? tunedMinutes * (weekIndex === input.planLengthWeeks - 1 ? 0.62 : 0.78) : tunedMinutes
        ),
        120,
        weeklyMaxMinutes
      );

      const baseIF = 0.72 + Math.floor(weekIndex / 4) * 0.02 + (weekIndex % 4) * 0.01 + tuning.intensityBias;
      const targetIF = clamp(
        isRecovery ? baseIF - 0.08 : isTaper ? baseIF - 0.05 : baseIF,
        0.55,
        0.9
      );

      const weekStartDate = addDays(planStartWeek, weekIndex * 7);
      const weekDays: DayDraft[] = Array.from({ length: 7 }, (_, dayIndex) => ({
        dayIndex,
        sessionType: null,
        durationMin: 0,
        targetIF: null
      }));

      const longDay = daySlots.find((day) => day === 6 || day === 0) ?? daySlots[daySlots.length - 1];
      const keyDay = daySlots.find((day) => day === 2 || day === 3 || day === 4) ?? daySlots[0];
      const secondaryCandidates = daySlots.filter((day) => day !== longDay && day !== keyDay);
      const secondaryDay = secondaryCandidates.find((day) => Math.abs(day - keyDay) > 1) ?? secondaryCandidates[0] ?? longDay;

      const workoutDays = daySlots.slice().sort((a, b) => a - b);
      const durations = this.distributeMinutes(targetMinutes, workoutDays, availability);
      const durationByDay = new Map<number, number>();
      workoutDays.forEach((day, idx) => {
        durationByDay.set(day, durations[idx]);
      });

      for (const dayIndex of workoutDays) {
        let sessionType: SessionType = "endurance";
        let dayIF = clamp(targetIF * 0.92, 0.55, 0.78);
        if (isRecovery) {
          sessionType = dayIndex === longDay ? "endurance" : "recovery";
          dayIF = sessionType === "endurance" ? clamp(targetIF * 0.9, 0.58, 0.72) : clamp(targetIF * 0.82, 0.5, 0.62);
        } else if (dayIndex === keyDay) {
          sessionType = eventSpecificKey;
          dayIF = eventSpecificKey === "vo2" ? clamp(targetIF + 0.05, 0.82, 0.95) : clamp(targetIF + 0.03, 0.78, 0.93);
        } else if (dayIndex === secondaryDay && eventSpecificKey !== "tempo") {
          sessionType = "tempo";
          dayIF = clamp(targetIF, 0.72, 0.88);
        } else if (dayIndex === longDay) {
          sessionType = "endurance";
          dayIF = clamp(targetIF * 0.9, 0.62, 0.78);
        }
        if (isTaper && sessionType !== "recovery") {
          dayIF = clamp(dayIF - 0.03, 0.55, 0.88);
        }
        weekDays[dayIndex] = {
          dayIndex,
          sessionType,
          durationMin: durationByDay.get(dayIndex) ?? 0,
          targetIF: Number(dayIF.toFixed(2))
        };
      }

      drafts.push({
        weekIndex,
        startDate: weekStartDate,
        loadTag,
        targetMinutes,
        targetIF: Number(targetIF.toFixed(2)),
        notes:
          loadTag === "recovery"
            ? "Recovery week to absorb prior load."
            : loadTag === "taper"
              ? "Taper week to freshen for event."
              : "Build week with progressive load.",
        days: weekDays
      });
    }
    return drafts;
  }

  private upsertPlanProjection(
    planId: string,
    currentFtp: number,
    planTitle: string,
    planNotes: string,
    weeks: WeekDraft[]
  ): EventPlanWeek[] {
    const existing = this.repositories.trainingPlans.getById(planId) as PlanRow | undefined;
    if (!existing) {
      this.repositories.trainingPlans.create({
        id: planId,
        name: planTitle,
        source: "event-plan-generator",
        notes: planNotes
      });
    } else {
      this.repositories.trainingPlans.update({
        id: planId,
        name: planTitle,
        notes: planNotes
      });
    }

    this.repositories.planWeeks.deleteByPlan(planId);
    const persistedWeeks: EventPlanWeek[] = [];

    for (const week of weeks) {
      const weekId = randomUUID();
      this.repositories.planWeeks.create({
        id: weekId,
        planId,
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        notes: week.notes
      });

      const days: EventPlanDay[] = week.days.map((day) => ({
        dayIndex: day.dayIndex,
        workoutId: null,
        workoutName: null,
        sessionType: null,
        durationMin: day.durationMin,
        targetIF: day.targetIF
      }));

      for (const day of week.days) {
        if (!day.sessionType || day.durationMin <= 0 || day.targetIF === null) {
          continue;
        }
        const workoutId = randomUUID();
        const workoutName = `W${week.weekIndex + 1} ${DAY_LABELS[day.dayIndex]} ${day.sessionType}`;
        const intervals = templateIntervals(day.sessionType, currentFtp, day.durationMin, day.targetIF);
        const durationSeconds = intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
        this.repositories.workouts.create({
          id: workoutId,
          name: workoutName,
          source: "event-plan-generator",
          intensityFactor: day.targetIF,
          durationSeconds,
          metadataJson: JSON.stringify({
            generatedBy: "event-plan-generator",
            planId,
            weekIndex: week.weekIndex,
            dayIndex: day.dayIndex,
            sessionType: day.sessionType
          })
        });
        intervals.forEach((interval, intervalIndex) => {
          this.repositories.workoutIntervals.create({
            id: randomUUID(),
            workoutId,
            intervalIndex,
            kind: interval.kind,
            targetPowerWatts: interval.targetPowerWatts,
            targetResistancePercent: interval.targetResistancePercent,
            durationSeconds: interval.durationSec,
            notes: null
          });
        });
        this.repositories.planWeekWorkouts.assignWorkout({
          id: randomUUID(),
          planWeekId: weekId,
          dayIndex: day.dayIndex,
          workoutId
        });
        days[day.dayIndex] = {
          dayIndex: day.dayIndex,
          workoutId,
          workoutName,
          sessionType: day.sessionType,
          durationMin: day.durationMin,
          targetIF: day.targetIF
        };
      }

      persistedWeeks.push({
        weekId,
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        loadTag: week.loadTag,
        targetMinutes: week.targetMinutes,
        targetIF: week.targetIF,
        notes: week.notes,
        days
      });
    }

    return persistedWeeks;
  }

  private createVersion(input: {
    planId: string;
    source: "user" | "ai" | "system";
    reason: string;
    requestInput: Record<string, unknown>;
    snapshot: PlanSnapshot;
  }): { versionId: string; versionNumber: number } {
    const latest = this.repositories.planVersions.getLatestByPlan(input.planId) as PlanVersionRow | undefined;
    const versionNumber = latest ? latest.version_number + 1 : 1;
    const versionId = randomUUID();
    this.repositories.planVersions.create({
      id: versionId,
      planId: input.planId,
      versionNumber,
      source: input.source,
      reason: input.reason,
      inputJson: JSON.stringify(input.requestInput),
      snapshotJson: JSON.stringify(input.snapshot)
    });
    return { versionId, versionNumber };
  }

  private writeAuditEntry(input: {
    planId: string;
    planVersionId: string;
    actionType: "generated" | "adapted";
    source: "user" | "ai" | "system";
    reason: string;
    metadata: Record<string, unknown>;
  }): void {
    this.repositories.planAuditEntries.create({
      id: randomUUID(),
      planId: input.planId,
      planVersionId: input.planVersionId,
      actionType: input.actionType,
      source: input.source,
      reason: input.reason,
      metadataJson: JSON.stringify(input.metadata)
    });
  }

  generatePlan(request: GenerateEventPlanRequest): GenerateEventPlanResult {
    return this.repositories.transaction(() => {
      const planId = randomUUID();
      const draftWeeks = this.buildWeekDrafts(request, { intensityBias: 0, volumeBias: 0 });
      const weeks = this.upsertPlanProjection(
        planId,
        request.currentFtp,
        this.createPlanTitle(request),
        `Event ${request.eventType} on ${request.eventDate}`,
        draftWeeks
      );
      const version = this.createVersion({
        planId,
        source: request.source,
        reason: request.reason,
        requestInput: {
          type: "generate",
          input: request
        },
        snapshot: {
          input: request,
          weeks
        }
      });
      this.writeAuditEntry({
        planId,
        planVersionId: version.versionId,
        actionType: "generated",
        source: request.source,
        reason: request.reason,
        metadata: {
          strategy: "template-v1",
          weeks: weeks.length
        }
      });
      return {
        ok: true,
        planId,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        weeks
      };
    });
  }

  adaptPlan(request: AdaptEventPlanRequest): AdaptEventPlanResult {
    return this.repositories.transaction(() => {
      const latest = this.repositories.planVersions.getLatestByPlan(request.planId) as PlanVersionRow | undefined;
      if (!latest) {
        throw new Error(`No plan versions found for plan ${request.planId}`);
      }
      const latestSnapshot = JSON.parse(latest.snapshot_json) as PlanSnapshot;
      const baseInput = latestSnapshot.input;
      const adaptation = this.adaptationService.adapt(baseInput, request);
      const draftWeeks = this.buildWeekDrafts(adaptation.nextInput, adaptation.tuning);
      const weeks = this.upsertPlanProjection(
        request.planId,
        adaptation.nextInput.currentFtp,
        this.createPlanTitle(adaptation.nextInput),
        `Event ${adaptation.nextInput.eventType} on ${adaptation.nextInput.eventDate}`,
        draftWeeks
      );
      const version = this.createVersion({
        planId: request.planId,
        source: request.source,
        reason: request.reason,
        requestInput: {
          type: "adapt",
          request,
          decision: {
            strategy: adaptation.strategy,
            tuning: adaptation.tuning
          }
        },
        snapshot: {
          input: adaptation.nextInput,
          weeks
        }
      });
      this.writeAuditEntry({
        planId: request.planId,
        planVersionId: version.versionId,
        actionType: "adapted",
        source: request.source,
        reason: request.reason,
        metadata: {
          strategy: adaptation.strategy,
          tuning: adaptation.tuning,
          ...adaptation.metadata,
          ...summarizeChanges(latestSnapshot.weeks as EventPlanWeek[], weeks)
        }
      });
      return {
        ok: true,
        planId: request.planId,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        weeks,
        appliedStrategy: adaptation.strategy
      };
    });
  }

  getCurrentPlan(): GetCurrentEventPlanResult {
    const [latestPlan] = this.repositories.trainingPlans.list() as PlanRow[];
    if (!latestPlan) {
      return null;
    }
    const latestVersion = this.repositories.planVersions.getLatestByPlan(latestPlan.id) as PlanVersionRow | undefined;
    if (!latestVersion) {
      return null;
    }
    const snapshot = JSON.parse(latestVersion.snapshot_json) as PlanSnapshot;
    return {
      planId: latestPlan.id,
      weeks: snapshot.weeks as EventPlanWeek[],
      input: snapshot.input
    };
  }

  deletePlan(planId: string): void {
    this.repositories.transaction(() => {
      const plan = this.repositories.trainingPlans.getById(planId);
      if (!plan) {
        throw new Error(`Plan ${planId} not found`);
      }
      this.repositories.trainingPlans.delete(planId);
    });
  }

  listPlanVersions(planId: string): EventPlanVersion[] {
    const rows = this.repositories.planVersions.listByPlan(planId) as PlanVersionRow[];
    const latest = rows[0]?.id;
    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      versionNumber: row.version_number,
      source: row.source as "user" | "ai" | "system",
      reason: row.reason,
      createdAt: row.created_at,
      isCurrent: row.id === latest
    }));
  }

  listPlanAuditEntries(planId: string): EventPlanAuditEntry[] {
    const rows = this.repositories.planAuditEntries.listByPlan(planId) as AuditEntryRow[];
    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      planVersionId: row.plan_version_id,
      action: row.action_type,
      source: row.source,
      reason: row.reason,
      metadata: JSON.parse(row.metadata_json),
      createdAt: row.created_at
    }));
  }
}
