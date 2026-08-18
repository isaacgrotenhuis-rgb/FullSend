import { useMemo, useState, type ReactElement } from "react";
import type {
  DayAvailability,
  EventPlanAuditEntry,
  EventPlanVersion,
  EventPlanWeek,
  EventType,
  PlanLengthWeeks
} from "@shared/ipc/contracts";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const defaultAvailability = (): DayAvailability[] =>
  dayLabels.map((_label, dayIndex) => ({
    dayIndex,
    canTrain: dayIndex === 2 || dayIndex === 4 || dayIndex === 6,
    maxDurationMin: dayIndex === 6 ? 150 : 90
  }));

const todayIso = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const App = (): ReactElement => {
  const [eventType, setEventType] = useState<EventType>("road-race");
  const [eventDate, setEventDate] = useState(todayIso());
  const [planLengthWeeks, setPlanLengthWeeks] = useState<PlanLengthWeeks>(12);
  const [currentFtp, setCurrentFtp] = useState(250);
  const [weeklyAvailability, setWeeklyAvailability] = useState<DayAvailability[]>(defaultAvailability());
  const [reason, setReason] = useState("Initial event plan generation");
  const [status, setStatus] = useState("");

  const [planId, setPlanId] = useState("");
  const [weeks, setWeeks] = useState<EventPlanWeek[]>([]);
  const [versions, setVersions] = useState<EventPlanVersion[]>([]);
  const [auditEntries, setAuditEntries] = useState<EventPlanAuditEntry[]>([]);

  const [adaptReason, setAdaptReason] = useState("Adapt plan based on latest constraints");
  const [adaptationPrompt, setAdaptationPrompt] = useState("");
  const [overrideFtp, setOverrideFtp] = useState<string>("");
  const [overrideDate, setOverrideDate] = useState("");

  const canGenerate = useMemo(
    () => weeklyAvailability.filter((day) => day.canTrain).length >= 2,
    [weeklyAvailability]
  );

  const refreshHistory = async (activePlanId: string): Promise<void> => {
    const [nextVersions, nextAudits] = await Promise.all([
      window.kickr.eventPlan.listVersions({ planId: activePlanId }),
      window.kickr.eventPlan.listAuditEntries({ planId: activePlanId })
    ]);
    setVersions(nextVersions);
    setAuditEntries(nextAudits);
  };

  const generatePlan = async (): Promise<void> => {
    setStatus("Generating event plan...");
    const result = await window.kickr.eventPlan.generate({
      eventType,
      eventDate,
      planLengthWeeks,
      currentFtp,
      weeklyAvailability,
      reason,
      source: "user"
    });
    setPlanId(result.planId);
    setWeeks(result.weeks);
    await refreshHistory(result.planId);
    setStatus(`Generated plan ${result.planId}, version ${result.versionNumber}`);
  };

  const adaptPlan = async (): Promise<void> => {
    if (!planId) {
      setStatus("Generate a plan first.");
      return;
    }
    setStatus("Adapting plan...");
    const result = await window.kickr.eventPlan.adapt({
      planId,
      reason: adaptReason,
      source: "user",
      adaptationPrompt: adaptationPrompt.trim() || undefined,
      overrides:
        overrideFtp || overrideDate
          ? {
              currentFtp: overrideFtp ? Number(overrideFtp) : undefined,
              eventDate: overrideDate || undefined
            }
          : undefined
    });
    setWeeks(result.weeks);
    await refreshHistory(planId);
    setStatus(`Adapted to version ${result.versionNumber} using ${result.appliedStrategy}`);
  };

  const updateAvailability = (dayIndex: number, patch: Partial<DayAvailability>): void => {
    setWeeklyAvailability((prev) => prev.map((day) => (day.dayIndex === dayIndex ? { ...day, ...patch } : day)));
  };

  return (
    <main className="app">
      <h1>Event Plan Generator</h1>
      <p>{status}</p>

      <section>
        <h2>Generate plan</h2>
        <div className="row">
          <label>
            Event type{" "}
            <select value={eventType} onChange={(event) => setEventType(event.target.value as EventType)}>
              <option value="road-race">road-race</option>
              <option value="time-trial">time-trial</option>
              <option value="criterium">criterium</option>
              <option value="gran-fondo">gran-fondo</option>
            </select>
          </label>
          <label>
            Event date <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
          </label>
          <label>
            Plan length{" "}
            <select
              value={planLengthWeeks}
              onChange={(event) => setPlanLengthWeeks(Number(event.target.value) as PlanLengthWeeks)}
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
              value={currentFtp}
              onChange={(event) => setCurrentFtp(Number(event.target.value))}
            />
          </label>
        </div>
        <label>
          Generation reason{" "}
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
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
            {weeklyAvailability.map((day) => (
              <tr key={day.dayIndex}>
                <td>{dayLabels[day.dayIndex]}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={day.canTrain}
                    onChange={(event) => updateAvailability(day.dayIndex, { canTrain: event.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={20}
                    max={360}
                    value={day.maxDurationMin ?? ""}
                    onChange={(event) =>
                      updateAvailability(day.dayIndex, {
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
        <button disabled={!canGenerate} onClick={() => void generatePlan()}>
          Generate event plan
        </button>
      </section>

      <section>
        <h2>Adapt plan</h2>
        <div className="row">
          <label>
            Adapt reason{" "}
            <input value={adaptReason} onChange={(event) => setAdaptReason(event.target.value)} />
          </label>
          <label>
            Prompt{" "}
            <input
              placeholder="e.g. fatigue this week, reduce load"
              value={adaptationPrompt}
              onChange={(event) => setAdaptationPrompt(event.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <label>
            Override FTP{" "}
            <input value={overrideFtp} onChange={(event) => setOverrideFtp(event.target.value)} placeholder="optional" />
          </label>
          <label>
            Override event date{" "}
            <input
              type="date"
              value={overrideDate}
              onChange={(event) => setOverrideDate(event.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
        <button disabled={!planId} onClick={() => void adaptPlan()}>
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
                {week.days.map((day) => (
                  <li key={`${week.weekId}-${day.dayIndex}`}>
                    {dayLabels[day.dayIndex]}:{" "}
                    {day.workoutName
                      ? `${day.workoutName} (${day.durationMin} min, IF ${day.targetIF ?? "-"})`
                      : "Rest"}
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </section>

      <section>
        <h2>Version history</h2>
        {versions.length === 0 ? (
          <p>No versions yet.</p>
        ) : (
          <ul>
            {versions.map((version) => (
              <li key={version.id}>
                v{version.versionNumber} {version.isCurrent ? "(current)" : ""} — {version.source} —{" "}
                {version.reason} — {version.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Audit entries</h2>
        {auditEntries.length === 0 ? (
          <p>No audit entries yet.</p>
        ) : (
          <ul>
            {auditEntries.map((entry) => (
              <li key={entry.id}>
                [{entry.action}] {entry.reason} ({entry.source}) — {entry.createdAt}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};
