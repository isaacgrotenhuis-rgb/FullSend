import { useState, type ReactElement } from "react";
import type { DayAvailability, EventPlanWeek, EventType, PlanLengthWeeks } from "@shared/ipc/contracts";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const eventTypeOptions: { value: EventType; label: string }[] = [
  { value: "road-race", label: "Road race" },
  { value: "time-trial", label: "Time trial" },
  { value: "criterium", label: "Criterium" },
  { value: "gran-fondo", label: "Gran fondo" }
];

const planLengthOptions: PlanLengthWeeks[] = [8, 12, 16];

const wizardStepLabels = ["Event", "Timeline", "Ratio", "Hours"];

const parseIsoDate = (iso: string): Date => new Date(`${iso}T00:00:00`);

const addDaysToDate = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatShortDate = (date: Date): string => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

export type GeneratePlanSectionProps = {
  planName: string;
  setPlanName: (value: string) => void;
  eventType: EventType;
  setEventType: (value: EventType) => void;
  eventDate: string;
  setEventDate: (value: string) => void;
  planLengthWeeks: PlanLengthWeeks;
  setPlanLengthWeeks: (value: PlanLengthWeeks) => void;
  currentFtp: number;
  setCurrentFtp: (value: number) => void;
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
  currentPlanName: string | null;
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  connectedTrainerDeviceId: string | null;
  startWorkoutForDay: (workoutId: string, workoutName: string) => Promise<void>;
  onDeletePlan: () => Promise<void>;
};

export const PlanPage = ({
  generate,
  adapt,
  weeks,
  currentPlanName,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  connectedTrainerDeviceId,
  startWorkoutForDay,
  onDeletePlan
}: Props): ReactElement => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  // Decorative only — the backend has no field for a training-to-rest ratio or a
  // weekly-hours target; see the plan's Follow-up work for wiring this up.
  const [ratioChoice, setRatioChoice] = useState<"2:1" | "3:1">("3:1");
  const [hoursPerWeek, setHoursPerWeek] = useState(8);
  const [adaptOpen, setAdaptOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const hasPlan = weeks.length > 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilEvent = Math.round((parseIsoDate(generate.eventDate).getTime() - today.getTime()) / 86400000);
  const countdownLabel = hasPlan
    ? daysUntilEvent > 0
      ? `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} to event`
      : daysUntilEvent === 0
        ? "Event day"
        : "Event completed"
    : null;

  const openWizard = (): void => {
    setWizardStep(0);
    setWizardOpen(true);
  };

  const handleGenerate = async (): Promise<void> => {
    await generate.generatePlan();
    setWizardOpen(false);
  };

  const handleAdapt = async (): Promise<void> => {
    await adapt.adaptPlan();
    setAdaptOpen(false);
  };

  const handleDeletePlan = async (): Promise<void> => {
    setDeleteBusy(true);
    try {
      await onDeletePlan();
      setDeleteConfirmOpen(false);
      setAdaptOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main className="app">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--space-4)", marginBottom: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>{hasPlan && currentPlanName ? currentPlanName : "Your plan"}</h1>
        {hasPlan ? (
          <button className="btn btn-primary" onClick={() => setAdaptOpen(true)}>
            Edit plan
          </button>
        ) : null}
      </div>

      {hasPlan ? (
        <>
          {countdownLabel ? (
            <h6 style={{ color: "var(--color-accent-700)", marginBottom: "var(--space-6)" }}>{countdownLabel}</h6>
          ) : null}

          {weeks.map((week) => {
            const weekStart = parseIsoDate(week.startDate);
            const weekEnd = addDaysToDate(weekStart, 6);
            return (
              <div key={week.weekId} style={{ marginBottom: "var(--space-6)" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "var(--space-1)" }}>
                  <h4 style={{ margin: 0 }}>
                    Week {week.weekIndex + 1} · {week.loadTag}
                  </h4>
                  <span style={{ fontSize: 13, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>
                    {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
                  </span>
                </div>
                <div className="hr" style={{ margin: "0 0 var(--space-2)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 2, background: "var(--color-divider)", border: "2px solid var(--color-divider)" }}>
                  {week.days.map((day) => {
                    const cellDate = addDaysToDate(weekStart, day.dayIndex);
                    const hasWorkout = day.workoutId !== null;
                    return (
                      <div
                        key={`${week.weekId}-${day.dayIndex}`}
                        style={{
                          background: "var(--color-bg)",
                          padding: "var(--space-3) var(--space-4)",
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-4)",
                          borderLeft: `3px solid ${hasWorkout ? "var(--color-accent)" : "var(--color-divider)"}`
                        }}
                      >
                        <div style={{ width: 96, flexShrink: 0 }}>
                          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
                            {dayLabels[day.dayIndex]}
                          </div>
                          <div style={{ fontSize: 12, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>{formatShortDate(cellDate)}</div>
                        </div>
                        <div style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{day.workoutName ?? "Rest"}</div>
                        <div className="card-meta">
                          {hasWorkout ? `${day.durationMin} min${day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}` : "Rest day"}
                        </div>
                        {hasWorkout ? (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            disabled={liveWorkoutBusy || isWorkoutSessionActive || !connectedTrainerDeviceId}
                            onClick={() => void startWorkoutForDay(day.workoutId as string, day.workoutName ?? "Workout")}
                          >
                            Start
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div style={{ border: "2px solid var(--color-divider)", padding: "64px var(--space-6)", textAlign: "center", marginTop: "var(--space-6)" }}>
          <h2 style={{ marginBottom: "var(--space-2)" }}>No training plan yet</h2>
          <p style={{ maxWidth: 420, margin: "0 auto var(--space-4)", color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
            Tell us what event you're training for and we'll build a weekly schedule of workouts around it.
          </p>
          <button className="btn btn-primary" onClick={openWizard}>
            Create a plan
          </button>
        </div>
      )}

      {wizardOpen ? (
        <div className="dialog-backdrop" onClick={() => setWizardOpen(false)} style={{ zIndex: 200 }}>
          <div className="dialog" onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, 100%)" }}>
            <div className="dialog-title">New training plan</div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                marginTop: -8,
                marginBottom: "var(--space-2)"
              }}
            >
              Step {wizardStep + 1} of 4 · {wizardStepLabels[wizardStep]}
            </div>
            <div className="hr" style={{ margin: "0 0 var(--space-4)" }} />

            {wizardStep === 0 ? (
              <>
                <div className="field" style={{ marginBottom: "var(--space-3)" }}>
                  <label>Plan name (optional)</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. Fall road race build"
                    maxLength={120}
                    value={generate.planName}
                    onChange={(event) => generate.setPlanName(event.target.value)}
                  />
                </div>
                <h6 style={{ marginBottom: "var(--space-3)" }}>What are you training for?</h6>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {eventTypeOptions.map((opt) => {
                    const selected = generate.eventType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        className={selected ? "btn btn-primary" : "btn btn-secondary"}
                        onClick={() => generate.setEventType(opt.value)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            {wizardStep === 1 ? (
              <>
                <h6 style={{ marginBottom: "var(--space-3)" }}>When is it?</h6>
                <div className="field" style={{ maxWidth: 280, marginBottom: "var(--space-3)" }}>
                  <label>Event date</label>
                  <input
                    className="input"
                    type="date"
                    value={generate.eventDate}
                    onChange={(event) => generate.setEventDate(event.target.value)}
                  />
                </div>
                <div className="field" style={{ maxWidth: 280 }}>
                  <label>Plan length</label>
                  <select
                    className="input"
                    value={generate.planLengthWeeks}
                    onChange={(event) => generate.setPlanLengthWeeks(Number(event.target.value) as PlanLengthWeeks)}
                  >
                    {planLengthOptions.map((weeksOption) => (
                      <option key={weeksOption} value={weeksOption}>
                        {weeksOption} weeks
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            {wizardStep === 2 ? (
              <>
                <h6 style={{ marginBottom: "var(--space-3)" }}>Training-to-rest ratio</h6>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(["2:1", "3:1"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      className={ratioChoice === ratio ? "btn btn-primary" : "btn btn-secondary"}
                      style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "var(--space-3)" }}
                      onClick={() => setRatioChoice(ratio)}
                    >
                      <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 14 }}>{ratio}</span>
                      <span className="card-meta">
                        {ratio === "2:1" ? "Two training days for every rest day" : "Three training days for every rest day"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {wizardStep === 3 ? (
              <>
                <h6 style={{ marginBottom: "var(--space-3)" }}>Hours per week</h6>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                  <input
                    type="range"
                    min={3}
                    max={14}
                    step={0.5}
                    value={hoursPerWeek}
                    onChange={(event) => setHoursPerWeek(Number(event.target.value))}
                    style={{ flex: 1 }}
                  />
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, minWidth: 80, textAlign: "right" }}>
                    {hoursPerWeek} hrs
                  </div>
                </div>

                <h6 style={{ margin: "var(--space-4) 0 var(--space-3)" }}>Weekly availability</h6>
                <table className="table">
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
                            className="input"
                            type="number"
                            min={20}
                            max={360}
                            style={{ minHeight: 28, padding: "2px 6px", width: 80 }}
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
                <div className="field" style={{ maxWidth: 160, marginTop: "var(--space-3)" }}>
                  <label>Current FTP (W)</label>
                  <input
                    className="input"
                    type="number"
                    min={100}
                    max={600}
                    value={generate.currentFtp}
                    onChange={(event) => generate.setCurrentFtp(Number(event.target.value))}
                  />
                </div>
              </>
            ) : null}

            <div className="dialog-actions">
              <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => setWizardOpen(false)}>
                Cancel
              </button>
              {wizardStep > 0 ? (
                <button className="btn btn-secondary" onClick={() => setWizardStep((step) => step - 1)}>
                  Back
                </button>
              ) : null}
              {wizardStep < 3 ? (
                <button className="btn btn-primary" onClick={() => setWizardStep((step) => step + 1)}>
                  Next
                </button>
              ) : (
                <button className="btn btn-primary" disabled={!generate.canGenerate} onClick={() => void handleGenerate()}>
                  Generate plan
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {adaptOpen ? (
        <div className="dialog-backdrop" onClick={() => setAdaptOpen(false)} style={{ zIndex: 200 }}>
          <div className="dialog" onClick={(event) => event.stopPropagation()} style={{ width: "min(480px, 100%)" }}>
            <div className="dialog-title">Edit plan</div>
            <div className="hr" style={{ margin: "0 0 var(--space-3)" }} />
            <div className="field">
              <label>Reason</label>
              <input className="input" value={adapt.adaptReason} onChange={(event) => adapt.setAdaptReason(event.target.value)} />
            </div>
            <div className="field">
              <label>Prompt (optional)</label>
              <input
                className="input"
                placeholder="e.g. fatigue this week, reduce load"
                value={adapt.adaptationPrompt}
                onChange={(event) => adapt.setAdaptationPrompt(event.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
              <div className="field">
                <label>Override FTP (optional)</label>
                <input className="input" value={adapt.overrideFtp} onChange={(event) => adapt.setOverrideFtp(event.target.value)} />
              </div>
              <div className="field">
                <label>Override event date (optional)</label>
                <input
                  className="input"
                  type="date"
                  value={adapt.overrideDate}
                  onChange={(event) => adapt.setOverrideDate(event.target.value)}
                />
              </div>
            </div>
            <div className="dialog-actions" style={{ justifyContent: "space-between" }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete plan
              </button>
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button className="btn btn-secondary" onClick={() => setAdaptOpen(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={!adapt.planId} onClick={() => void handleAdapt()}>
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <div className="dialog-backdrop" onClick={() => setDeleteConfirmOpen(false)} style={{ zIndex: 210 }}>
          <div className="dialog" onClick={(event) => event.stopPropagation()} style={{ width: "min(420px, 100%)" }}>
            <div className="dialog-title">Delete plan?</div>
            <div className="hr" style={{ margin: "0 0 var(--space-3)" }} />
            <p style={{ margin: "0 0 var(--space-2)", color: "color-mix(in srgb, var(--color-text) 65%, transparent)" }}>
              This removes your current training plan and its schedule. This can&apos;t be undone.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" disabled={deleteBusy} onClick={() => setDeleteConfirmOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={deleteBusy} onClick={() => void handleDeletePlan()}>
                {deleteBusy ? "Deleting..." : "Delete plan"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};
