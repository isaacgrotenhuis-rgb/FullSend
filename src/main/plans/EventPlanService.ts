import { randomUUID } from "node:crypto";
import type { Repositories } from "@main/database/repositories";
import type { AdaptationDecision, PlanAdaptationService } from "@main/plans/PlanAdaptationService";
import type { WorkoutBankService } from "@main/workout/WorkoutBankService";
import type {
  AddPlanDayWorkoutRequest,
  AdaptEventPlanRequest,
  AdaptEventPlanResult,
  DayAvailability,
  EventPlanAuditEntry,
  EventPlanInput,
  EventPlanVersion,
  EventPlanWeek,
  EventType,
  GenerateEventPlanRequest,
  GenerateEventPlanResult,
  GetCurrentEventPlanResult,
  LoadTag,
  PlanDayMutationResult,
  RemovePlanDayWorkoutRequest,
  SessionType,
  TrainingPhase,
  TrainingZone,
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
  zone: TrainingZone | null;
  durationMin: number;
  targetIF: number | null;
};

type WeekDraft = {
  weekIndex: number;
  startDate: string;
  phase: TrainingPhase;
  loadTag: LoadTag;
  targetMinutes: number;
  targetIF: number;
  notes: string | null;
  days: DayDraft[];
};

/**
 * The generator's prescription for one day, as stored in the version snapshot.
 * Equal to the historical `EventPlanDay` shape; the contract `EventPlanDay` now
 * additionally carries the override layer (entries / completed / plannedReplaced),
 * which `hydrateWeeks` attaches at read time.
 */
type SnapshotDay = {
  dayIndex: number;
  workoutId: string | null;
  workoutName: string | null;
  sessionType: SessionType | null;
  durationMin: number;
  targetIF: number | null;
};

type SnapshotWeek = {
  weekId: string;
  weekIndex: number;
  startDate: string;
  loadTag: LoadTag;
  targetMinutes: number;
  targetIF: number;
  notes: string | null;
  days: SnapshotDay[];
};

type PlanSnapshot = {
  input: EventPlanInput;
  weeks: SnapshotWeek[];
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

type EventProfile = { zone: TrainingZone; tags: string[]; sessionType: SessionType };

// Event type -> peak-phase target zone + tag set (doc §7.1).
const EVENT_PROFILE: Record<EventType, EventProfile> = {
  "road-race": { zone: "threshold", tags: ["variable", "race-sim"], sessionType: "threshold" },
  "time-trial": { zone: "threshold", tags: ["sustained", "pacing"], sessionType: "threshold" },
  criterium: { zone: "anaerobic", tags: ["repeated-surge"], sessionType: "anaerobic" },
  "gran-fondo": { zone: "tempo", tags: ["long", "climbing"], sessionType: "tempo" },
  "xc-mtb": { zone: "threshold", tags: ["xc-mtb", "race-specific", "surges"], sessionType: "threshold" },
  "marathon-mtb": {
    zone: "tempo",
    tags: ["marathon-mtb", "long", "race-specific"],
    sessionType: "tempo"
  }
};

// Phase from position in the plan (doc §7.1): taper = last 2 wk, peak = the 1-2 wk
// immediately before the taper, base = first ~1/3 of what's left, build = the middle.
// Peak is carved out of the pre-taper weeks (not an independent 0.75*L threshold) so
// it can never collapse into the taper — short plans previously got no peak phase at
// all, so the event-specific key session was never scheduled.
const derivePhase = (weekIndex: number, planLengthWeeks: number): TrainingPhase => {
  const taperStart = planLengthWeeks - 2;
  if (weekIndex >= taperStart) {
    return "taper";
  }
  const peakWeeks = clamp(Math.round(planLengthWeeks * 0.15), 1, 2);
  const peakStart = taperStart - peakWeeks;
  if (weekIndex >= peakStart) {
    return "peak";
  }
  if (weekIndex < peakStart / 3) {
    return "base";
  }
  return "build";
};

type DayRole = "key" | "secondary" | "long";

// Phase-aware session matrix (doc §7.1): (phase, dayRole) -> session type + zone.
const phaseMatrix = (
  phase: TrainingPhase,
  role: DayRole,
  event: EventProfile,
  weekIndex: number
): { sessionType: SessionType; zone: TrainingZone } => {
  if (role === "long") {
    return { sessionType: "endurance", zone: "endurance" };
  }
  switch (phase) {
    case "base":
      return role === "key"
        ? { sessionType: "sweet-spot", zone: "sweet-spot" }
        : { sessionType: "tempo", zone: "tempo" };
    case "build":
      if (role === "key") {
        return weekIndex % 2 === 0
          ? { sessionType: "threshold", zone: "threshold" }
          : { sessionType: "vo2", zone: "vo2" };
      }
      return { sessionType: "sweet-spot", zone: "sweet-spot" };
    case "peak":
      return role === "key"
        ? { sessionType: event.sessionType, zone: event.zone }
        : { sessionType: "anaerobic", zone: "anaerobic" };
    case "taper":
    default:
      return role === "key"
        ? { sessionType: "threshold", zone: "threshold" }
        : { sessionType: "neuromuscular", zone: "neuromuscular" };
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

  if (sessionType === "sweet-spot") {
    const reps = 3;
    const recover = 4;
    const rep = Math.max(8, Math.floor((mainMin - recover * (reps - 1)) / reps));
    const intervals: WorkoutInterval[] = [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.55), targetResistancePercent: null }
    ];
    for (let i = 0; i < reps; i += 1) {
      intervals.push({
        kind: "work",
        durationSec: rep * 60,
        targetPowerWatts: watts(clamp(targetIF, 0.86, 0.94)),
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

  if (sessionType === "anaerobic" || sessionType === "neuromuscular") {
    const isNeuro = sessionType === "neuromuscular";
    const onSec = isNeuro ? 15 : 40;
    const offSec = isNeuro ? 225 : 60;
    const power = isNeuro ? 1.6 : 1.2;
    const repeats = Math.max(6, Math.min(12, Math.floor((mainMin * 60) / (onSec + offSec))));
    const intervals: WorkoutInterval[] = [
      { kind: "warmup", durationSec: warmup * 60, targetPowerWatts: watts(0.6), targetResistancePercent: null }
    ];
    for (let i = 0; i < repeats; i += 1) {
      intervals.push({ kind: "work", durationSec: onSec, targetPowerWatts: watts(power), targetResistancePercent: null });
      if (i < repeats - 1) {
        intervals.push({ kind: "recovery", durationSec: offSec, targetPowerWatts: watts(0.5), targetResistancePercent: null });
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

const summarizeChanges = (beforeWeeks: SnapshotWeek[], afterWeeks: SnapshotWeek[]): Record<string, unknown> => {
  const beforeByWeek = new Map<number, SnapshotWeek>(beforeWeeks.map((week) => [week.weekIndex, week]));
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
    private readonly adaptationService: PlanAdaptationService,
    private readonly workoutBankService: WorkoutBankService
  ) {}

  private createPlanTitle(input: EventPlanInput): string {
    return input.name?.trim() || `${input.eventType} ${input.eventDate} (${input.planLengthWeeks}w)`;
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
    const eventProfile = EVENT_PROFILE[input.eventType];
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
      const isTaper = weekIndex >= input.planLengthWeeks - 2;
      // A scheduled 4-week recovery week must not land on (and override) a taper
      // week — otherwise the final week of any plan length divisible by 4 becomes
      // all easy sessions and the taper phase's sharpening work never runs.
      const isRecovery = !isTaper && (weekIndex + 1) % 4 === 0;
      const phase = derivePhase(weekIndex, input.planLengthWeeks);
      const loadTag: LoadTag = isTaper ? "taper" : isRecovery ? "recovery" : "build";
      if (weekIndex > 0 && !isRecovery && !isTaper) {
        const growth = weekIndex % 4 === 0 ? 1.04 : 1.07;
        baseMinutes = Math.round(baseMinutes * growth);
      }

      const tunedMinutes = baseMinutes * (1 + tuning.volumeBias);
      // Taper fix (doc §7.3): cut volume 40-70%, hold targetIF (no intensity drop).
      const taperVolumeFactor = weekIndex === input.planLengthWeeks - 1 ? 0.45 : 0.6;
      const targetMinutes = clamp(
        Math.round(
          isRecovery ? tunedMinutes * 0.68 : isTaper ? tunedMinutes * taperVolumeFactor : tunedMinutes
        ),
        isTaper ? 60 : 120,
        weeklyMaxMinutes
      );

      const baseIF = 0.72 + Math.floor(weekIndex / 4) * 0.02 + (weekIndex % 4) * 0.01 + tuning.intensityBias;
      // Taper holds intensity (doc §7.3); it also overrides a coinciding recovery-week
      // IF cut so the last race-week keeps its sharpness while only volume drops.
      const targetIF = clamp(isTaper ? baseIF : isRecovery ? baseIF - 0.08 : baseIF, 0.55, 0.9);

      const weekStartDate = addDays(planStartWeek, weekIndex * 7);
      const weekDays: DayDraft[] = Array.from({ length: 7 }, (_, dayIndex) => ({
        dayIndex,
        sessionType: null,
        zone: null,
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
        let zone: TrainingZone = "endurance";
        let dayIF = clamp(targetIF * 0.92, 0.55, 0.78);
        if (isRecovery) {
          sessionType = dayIndex === longDay ? "endurance" : "recovery";
          zone = sessionType === "endurance" ? "endurance" : "recovery";
          dayIF = sessionType === "endurance" ? clamp(targetIF * 0.9, 0.58, 0.72) : clamp(targetIF * 0.82, 0.5, 0.62);
        } else {
          let role: DayRole | null = null;
          if (dayIndex === keyDay) {
            role = "key";
          } else if (dayIndex === longDay) {
            role = "long";
          } else if (dayIndex === secondaryDay) {
            role = "secondary";
          }
          if (role) {
            const matched = phaseMatrix(phase, role, eventProfile, weekIndex);
            sessionType = matched.sessionType;
            zone = matched.zone;
            if (role === "key") {
              dayIF =
                sessionType === "vo2" || sessionType === "anaerobic" || sessionType === "neuromuscular"
                  ? clamp(targetIF + 0.05, 0.82, 0.98)
                  : clamp(targetIF + 0.03, 0.78, 0.95);
            } else if (role === "secondary") {
              dayIF = clamp(targetIF, 0.72, 0.9);
            } else {
              dayIF = clamp(targetIF * 0.9, 0.62, 0.78);
            }
          }
        }
        weekDays[dayIndex] = {
          dayIndex,
          sessionType,
          zone,
          durationMin: durationByDay.get(dayIndex) ?? 0,
          targetIF: Number(dayIF.toFixed(2))
        };
      }

      drafts.push({
        weekIndex,
        startDate: weekStartDate,
        phase,
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
  ): SnapshotWeek[] {
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
    const persistedWeeks: SnapshotWeek[] = [];
    // Bank-workout rotation: id -> weeks it was used for a zone, so a workout isn't
    // repeated within 2 weeks for the same zone (doc §7.2).
    const bankUsage: Array<{ weekIndex: number; zone: TrainingZone; id: string }> = [];

    for (const week of weeks) {
      const weekId = randomUUID();
      this.repositories.planWeeks.create({
        id: weekId,
        planId,
        weekIndex: week.weekIndex,
        startDate: week.startDate,
        notes: week.notes
      });

      const days: SnapshotDay[] = week.days.map((day) => ({
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
        const label = `W${week.weekIndex + 1} ${DAY_LABELS[day.dayIndex]} ${day.sessionType}`;

        // 1. Try to select a bank workout for (zone, phase, duration) with rotation.
        const excludeIds = day.zone
          ? bankUsage
              .filter((usage) => usage.zone === day.zone && usage.weekIndex >= week.weekIndex - 2)
              .map((usage) => usage.id)
          : [];
        const selected = day.zone
          ? this.workoutBankService.selectForPlanDay({
              zone: day.zone,
              phase: week.phase,
              targetDurationMin: day.durationMin,
              discipline: "cycling",
              excludeIds
            })
          : null;

        let workoutId: string;
        let workoutName: string;

        if (selected) {
          const compiled = this.workoutBankService.compileAndPersist({
            bankWorkoutId: selected.id,
            ftp: currentFtp,
            name: label
          });
          workoutId = compiled.workoutId;
          workoutName = `${label} — ${selected.name}`;
          if (day.zone) {
            bankUsage.push({ weekIndex: week.weekIndex, zone: day.zone, id: selected.id });
          }
        } else {
          // 2. Fallback: synthesize from the private template (doc §7.3).
          workoutId = randomUUID();
          workoutName = label;
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
              phase: week.phase,
              zone: day.zone,
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
              targetPowerWattsEnd: interval.targetPowerWattsEnd ?? null,
              targetResistancePercent: interval.targetResistancePercent,
              durationSeconds: interval.durationSec,
              notes: null
            });
          });
        }

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
      const planTitle = this.createPlanTitle(request);
      const draftWeeks = this.buildWeekDrafts(request, { intensityBias: 0, volumeBias: 0 });
      const weeks = this.upsertPlanProjection(
        planId,
        request.currentFtp,
        planTitle,
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
          strategy: "phase-matrix-v1",
          weeks: weeks.length
        }
      });
      return {
        ok: true,
        planId,
        name: planTitle,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        weeks: this.hydrateWeeks(planId, weeks)
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
      const planTitle = this.createPlanTitle(adaptation.nextInput);
      const draftWeeks = this.buildWeekDrafts(adaptation.nextInput, adaptation.tuning);
      const weeks = this.upsertPlanProjection(
        request.planId,
        adaptation.nextInput.currentFtp,
        planTitle,
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
          ...summarizeChanges(latestSnapshot.weeks, weeks)
        }
      });
      return {
        ok: true,
        planId: request.planId,
        name: planTitle,
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        weeks: this.hydrateWeeks(request.planId, weeks),
        appliedStrategy: adaptation.strategy
      };
    });
  }

  deletePlan(planId: string): void {
    this.repositories.transaction(() => {
      const existing = this.repositories.trainingPlans.getById(planId) as PlanRow | undefined;
      if (!existing) {
        throw new Error(`Plan ${planId} not found`);
      }
      this.repositories.trainingPlans.delete(planId);
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
      name: latestPlan.name,
      weeks: this.hydrateWeeks(latestPlan.id, snapshot.weeks)
    };
  }

  /**
   * Overlay the user's plan-day override layer (`plan_day_workouts`) and any
   * completed sessions back-pointed at a day onto the generator's snapshot weeks.
   */
  private hydrateWeeks(planId: string, weeks: SnapshotWeek[]): EventPlanWeek[] {
    const overridesByCell = new Map<string, Array<Record<string, unknown>>>();
    for (const row of this.repositories.planDayWorkouts.listForPlan(planId)) {
      const key = `${row.week_index}:${row.day_index}`;
      const list = overridesByCell.get(key) ?? [];
      list.push(row);
      overridesByCell.set(key, list);
    }

    const completedByCell = new Map<string, Array<Record<string, unknown>>>();
    for (const row of this.repositories.workoutSessions.listPlanCompletions(planId)) {
      if (row.plan_week_index === null || row.plan_day_index === null) {
        continue;
      }
      const key = `${row.plan_week_index}:${row.plan_day_index}`;
      const list = completedByCell.get(key) ?? [];
      list.push(row);
      completedByCell.set(key, list);
    }

    return weeks.map((week) => ({
      weekId: week.weekId,
      weekIndex: week.weekIndex,
      startDate: week.startDate,
      loadTag: week.loadTag,
      targetMinutes: week.targetMinutes,
      targetIF: week.targetIF,
      notes: week.notes,
      days: week.days.map((day) => {
        const key = `${week.weekIndex}:${day.dayIndex}`;
        const entries = (overridesByCell.get(key) ?? []).map((row) => ({
          id: String(row.id),
          workoutId: String(row.workout_id),
          workoutName: String(row.workout_name),
          sessionType: (row.session_type as SessionType | null) ?? null,
          durationMin: Math.round(Number(row.duration_seconds) / 60),
          targetIF: row.intensity_factor === null ? null : Number(row.intensity_factor),
          bankWorkoutId: row.bank_workout_id === null ? null : String(row.bank_workout_id),
          mode: row.mode === "swap" ? ("swap" as const) : ("add" as const)
        }));
        const completed = (completedByCell.get(key) ?? []).map((row) => ({
          sessionId: String(row.id),
          workoutId: row.workout_id == null ? null : String(row.workout_id),
          workoutName: row.workout_name == null ? null : String(row.workout_name),
          startedAt: String(row.started_at),
          status: String(row.status)
        }));
        return {
          dayIndex: day.dayIndex,
          workoutId: day.workoutId,
          workoutName: day.workoutName,
          sessionType: day.sessionType,
          durationMin: day.durationMin,
          targetIF: day.targetIF,
          plannedReplaced: entries.some((entry) => entry.mode === "swap"),
          entries,
          completed
        };
      })
    }));
  }

  addDayWorkout(request: AddPlanDayWorkoutRequest): PlanDayMutationResult {
    return this.repositories.transaction(() => {
      const plan = this.repositories.trainingPlans.getById(request.planId) as PlanRow | undefined;
      const latestVersion = this.repositories.planVersions.getLatestByPlan(
        request.planId
      ) as PlanVersionRow | undefined;
      if (!plan || !latestVersion) {
        throw new Error(`Plan ${request.planId} not found`);
      }
      const snapshot = JSON.parse(latestVersion.snapshot_json) as PlanSnapshot;
      const week = snapshot.weeks.find((entry) => entry.weekIndex === request.weekIndex);
      if (!week || !week.days.some((day) => day.dayIndex === request.dayIndex)) {
        throw new Error(`Day ${request.weekIndex}/${request.dayIndex} is not part of plan ${request.planId}`);
      }

      const bank = this.workoutBankService.getBankWorkout(request.bankWorkoutId);
      const compiled = this.workoutBankService.compileAndPersist({
        bankWorkoutId: request.bankWorkoutId,
        ftp: request.ftp,
        name: bank.name
      });
      const durationSeconds = compiled.intervals.reduce((sum, interval) => sum + interval.durationSec, 0);
      const sortOrder = this.repositories.planDayWorkouts.countForCell(
        request.planId,
        request.weekIndex,
        request.dayIndex
      );

      this.repositories.planDayWorkouts.create({
        id: randomUUID(),
        planId: request.planId,
        weekIndex: request.weekIndex,
        dayIndex: request.dayIndex,
        workoutId: compiled.workoutId,
        bankWorkoutId: request.bankWorkoutId,
        workoutName: bank.name,
        // The bank's primaryZone enum is a superset-equal of sessionType.
        sessionType: bank.primaryZone,
        durationSeconds,
        intensityFactor: bank.estIF,
        mode: request.mode,
        sortOrder
      });

      return {
        planId: request.planId,
        name: plan.name,
        weeks: this.hydrateWeeks(request.planId, snapshot.weeks)
      };
    });
  }

  removeDayWorkout(request: RemovePlanDayWorkoutRequest): PlanDayMutationResult {
    return this.repositories.transaction(() => {
      const row = this.repositories.planDayWorkouts.getById(request.id);
      if (!row) {
        throw new Error(`Plan-day workout ${request.id} not found`);
      }
      const planId = String(row.plan_id);
      const workoutId = String(row.workout_id);
      this.repositories.planDayWorkouts.deleteById(request.id);

      // Drop the compiled workout unless a session already references it (ride history).
      const referenced = (this.repositories.workoutSessions.list() as Array<Record<string, unknown>>).some(
        (session) => session.workout_id === workoutId
      );
      if (!referenced) {
        this.repositories.workouts.delete(workoutId);
      }

      const plan = this.repositories.trainingPlans.getById(planId) as PlanRow | undefined;
      const latestVersion = this.repositories.planVersions.getLatestByPlan(planId) as PlanVersionRow | undefined;
      if (!plan || !latestVersion) {
        throw new Error(`Plan ${planId} not found`);
      }
      const snapshot = JSON.parse(latestVersion.snapshot_json) as PlanSnapshot;
      return {
        planId,
        name: plan.name,
        weeks: this.hydrateWeeks(planId, snapshot.weeks)
      };
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
