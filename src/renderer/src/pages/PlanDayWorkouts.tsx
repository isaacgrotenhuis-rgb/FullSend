import type { ReactElement } from "react";
import type { EventPlanDay, PlanDayEntry, SessionType } from "@shared/ipc/contracts";

type Props = {
  day: EventPlanDay;
  /** Preview / start a workout. planContext lets a launched session attach to this day. */
  onPreview: (
    workoutId: string,
    workoutName: string,
    sessionType: SessionType | null
  ) => void;
  /** Open the bank browser to add or swap a workout on this day. */
  onAdd: () => void;
  onRemoveEntry: (entryId: string) => void;
  disabled: boolean;
  compact?: boolean;
};

const meta = (durationMin: number, targetIF: number | null): string =>
  `${durationMin} min${targetIF !== null ? ` · IF ${targetIF}` : ""}`;

const mutedStrike = {
  textDecoration: "line-through",
  color: "color-mix(in srgb, var(--color-text) 45%, transparent)"
} as const;

export const PlanDayWorkouts = ({
  day,
  onPreview,
  onAdd,
  onRemoveEntry,
  disabled,
  compact = false
}: Props): ReactElement => {
  const hasPlanned = day.workoutId !== null;
  const nothing = !hasPlanned && day.entries.length === 0 && day.completed.length === 0;
  const rowGap = compact ? 3 : 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: rowGap, flex: 1, minWidth: 0 }}>
      {nothing ? (
        <div style={{ fontSize: compact ? 13 : 14, fontWeight: 600, opacity: 0.7 }}>Rest</div>
      ) : null}

      {hasPlanned ? (
        <button
          type="button"
          className="plan-day-line"
          disabled={disabled}
          onClick={() =>
            onPreview(day.workoutId as string, day.workoutName ?? "Workout", day.sessionType)
          }
          style={{
            all: "unset",
            cursor: disabled ? "default" : "pointer",
            display: "flex",
            flexDirection: "column",
            gap: 1
          }}
        >
          <span
            style={{
              fontSize: compact ? 13 : 14,
              fontWeight: 600,
              overflowWrap: "break-word",
              ...(day.plannedReplaced ? mutedStrike : {})
            }}
          >
            {day.workoutName ?? "Workout"}
          </span>
          <span className="card-meta" style={day.plannedReplaced ? mutedStrike : undefined}>
            {meta(day.durationMin, day.targetIF)}
            {day.plannedReplaced ? " · swapped out" : ""}
          </span>
        </button>
      ) : null}

      {day.entries.map((entry: PlanDayEntry) => (
        <div key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPreview(entry.workoutId, entry.workoutName, entry.sessionType)}
            style={{
              all: "unset",
              cursor: disabled ? "default" : "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              flex: 1,
              minWidth: 0
            }}
          >
            <span style={{ fontSize: compact ? 13 : 14, fontWeight: 600, overflowWrap: "break-word" }}>
              <span className="tag tag-accent" style={{ marginRight: 4, textTransform: "capitalize" }}>
                {entry.mode === "swap" ? "swap" : "added"}
              </span>
              {entry.workoutName}
            </span>
            <span className="card-meta">{meta(entry.durationMin, entry.targetIF)}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "0 6px", fontSize: 12, lineHeight: 1.6 }}
            disabled={disabled}
            aria-label={`Remove ${entry.workoutName}`}
            title="Remove"
            onClick={() => onRemoveEntry(entry.id)}
          >
            ✕
          </button>
        </div>
      ))}

      {day.completed.map((session) => (
        <div key={session.sessionId} className="card-meta" style={{ display: "flex", gap: 4 }}>
          <span aria-hidden>✓</span>
          <span>{session.workoutName ?? "Completed ride"}</span>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", padding: "2px 6px", fontSize: 11 }}
        disabled={disabled}
        onClick={onAdd}
      >
        {hasPlanned && !day.plannedReplaced ? "＋ Add / swap" : "＋ Add workout"}
      </button>
    </div>
  );
};
