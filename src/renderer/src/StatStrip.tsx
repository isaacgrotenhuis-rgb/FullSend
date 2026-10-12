import type { ReactElement, ReactNode } from "react";

export type Stat = { label: string; value: string | null; unit?: string; color?: string };

const StatCell = ({ label, value, unit, color }: Stat): ReactElement => (
  <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-[color-mix(in_srgb,var(--color-text)_55%,transparent)] uppercase">
      {color ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
      {label}
    </span>
    <span className="truncate text-lg leading-tight font-extrabold tabular-nums">
      {value ?? "—"}
      {value !== null && unit ? <Unit>{unit}</Unit> : null}
    </span>
  </div>
);

const Unit = ({ children }: { children: ReactNode }): ReactElement => (
  <span className="ml-0.5 text-xs font-semibold text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
    {children}
  </span>
);

/**
 * One rounded card of headline stats, three across on narrow screens and all
 * in one row from `sm`. Shared by the ride recap and the workout preview.
 */
export const StatStrip = ({ stats, label }: { stats: Stat[]; label: string }): ReactElement => (
  <div
    className="grid grid-cols-3 divide-foreground/10 overflow-hidden rounded-xl border border-foreground/15 bg-muted sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none sm:divide-x"
    aria-label={label}
    role="group"
  >
    {stats.map((stat) => (
      <StatCell key={stat.label} {...stat} />
    ))}
  </div>
);
