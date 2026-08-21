import type { ReactElement } from "react";
import type { DayAvailability, EventPlanWeek, EventType, PlanLengthWeeks } from "@shared/ipc/contracts";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type GeneratePlanSectionProps = {
  eventType: EventType;
  setEventType: (value: EventType) => void;
  eventDate: string;
  setEventDate: (value: string) => void;
  planLengthWeeks: PlanLengthWeeks;
  setPlanLengthWeeks: (value: PlanLengthWeeks) => void;
  currentFtp: number;
  setCurrentFtp: (value: number) => void;
  reason: string;
  setReason: (value: string) => void;
  weeklyAvailability: DayAvailability[];
  updateAvailability: (dayIndex: number, patch: Partial<DayAvailability>) => void;
  canGenerate: boolean;
  generatePlan: () => Promise<void>;
};

export type AdaptPlanSectionProps = {
  adaptReason: string;
  setAdaptReason: (value: string) => void;
  adaptationPrompt: string;
  setAdaptationPrompt: (value: string) => void;
  overrideFtp: string;
  setOverrideFtp: (value: string) => void;
  overrideDate: string;
  setOverrideDate: (value: string) => void;
  planId: string;
  adaptPlan: () => Promise<void>;
};

type Props = {
  generate: GeneratePlanSectionProps;
  adapt: AdaptPlanSectionProps;
  weeks: EventPlanWeek[];
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  connectedTrainerDeviceId: string | null;
  startWorkoutForDay: (workoutId: string, workoutName: string) => Promise<void>;
};

export const PlanPage = ({
  generate,
  adapt,
  weeks,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  connectedTrainerDeviceId,
  startWorkoutForDay
}: Props): ReactElement => (
  <main className="app">
    <section>
      <h2>Generate plan</h2>
      <div className="row">
        <label>
          Event type{" "}
          <select value={generate.eventType} onChange={(event) => generate.setEventType(event.target.value as EventType)}>
            <option value="road-race">road-race</option>
            <option value="time-trial">time-trial</option>
            <option value="criterium">criterium</option>
            <option value="gran-fondo">gran-fondo</option>
          </select>
        </label>
        <label>
          Event date{" "}
          <input type="date" value={generate.eventDate} onChange={(event) => generate.setEventDate(event.target.value)} />
        </label>
        <label>
          Plan length{" "}
          <select
            value={generate.planLengthWeeks}
            onChange={(event) => generate.setPlanLengthWeeks(Number(event.target.value) as PlanLengthWeeks)}
          >
            <option value={8}>8 weeks</option>
            <option value={12}>12 weeks</option>
            <option value={16}>16 weeks</option>
          </select>
        </label>
        <label>
          FTP{" "}
          <input
            type="number"
            min={100}
            max={600}
            value={generate.currentFtp}
            onChange={(event) => generate.setCurrentFtp(Number(event.target.value))}
          />
        </label>
      </div>
      <label>
        Generation reason{" "}
        <input value={generate.reason} onChange={(event) => generate.setReason(event.target.value)} />
      </label>
      <h3>Weekly availability</h3>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Train</th>
            <th>Max min</th>
          </tr>
        </thead>
        <tbody>
          {generate.weeklyAvailability.map((day) => (
            <tr key={day.dayIndex}>
              <td>{dayLabels[day.dayIndex]}</td>
              <td>
                <input
                  type="checkbox"
                  checked={day.canTrain}
                  onChange={(event) => generate.updateAvailability(day.dayIndex, { canTrain: event.target.checked })}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={20}
                  max={360}
                  value={day.maxDurationMin ?? ""}
                  onChange={(event) =>
                    generate.updateAvailability(day.dayIndex, {
                      maxDurationMin: event.target.value ? Number(event.target.value) : null
                    })
                  }
                  disabled={!day.canTrain}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={!generate.canGenerate} onClick={() => void generate.generatePlan()}>
        Generate event plan
      </button>
    </section>

    <section>
      <h2>Adapt plan</h2>
      <div className="row">
        <label>
          Adapt reason{" "}
          <input value={adapt.adaptReason} onChange={(event) => adapt.setAdaptReason(event.target.value)} />
        </label>
        <label>
          Prompt{" "}
          <input
            placeholder="e.g. fatigue this week, reduce load"
            value={adapt.adaptationPrompt}
            onChange={(event) => adapt.setAdaptationPrompt(event.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Override FTP{" "}
          <input value={adapt.overrideFtp} onChange={(event) => adapt.setOverrideFtp(event.target.value)} placeholder="optional" />
        </label>
        <label>
          Override event date{" "}
          <input
            type="date"
            value={adapt.overrideDate}
            onChange={(event) => adapt.setOverrideDate(event.target.value)}
            placeholder="optional"
          />
        </label>
      </div>
      <button disabled={!adapt.planId} onClick={() => void adapt.adaptPlan()}>
        Adapt current plan
      </button>
    </section>

    <section>
      <h2>Current weeks</h2>
      {weeks.length === 0 ? (
        <p>No generated plan yet.</p>
      ) : (
        weeks.map((week) => (
          <article key={week.weekId}>
            <h3>
              Week {week.weekIndex + 1} ({week.startDate}) — {week.loadTag}
            </h3>
            <p>
              Target {week.targetMinutes} min @ IF {week.targetIF}
            </p>
            <ul>
              {week.days.map((day) => {
                const workoutId = day.workoutId;
                return (
                  <li key={`${week.weekId}-${day.dayIndex}`}>
                    {dayLabels[day.dayIndex]}:{" "}
                    {day.workoutName ? `${day.workoutName} (${day.durationMin} min, IF ${day.targetIF ?? "-"})` : "Rest"}{" "}
                    {workoutId ? (
                      <button
                        onClick={() => void startWorkoutForDay(workoutId, day.workoutName ?? "Workout")}
                        disabled={liveWorkoutBusy || isWorkoutSessionActive || !connectedTrainerDeviceId}
                      >
                        Start workout
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </article>
        ))
      )}
    </section>
  </main>
);
