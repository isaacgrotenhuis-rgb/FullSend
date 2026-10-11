import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ArrowRight, CalendarDays, Flag, Minus, TrendingDown, TrendingUp, Zap } from "lucide-react";
import type { DashboardMetrics, EventPlanWeek, LoadTag } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";

type Props = {
  dashboard: DashboardMetrics | null;
  currentFtp: number;
  weightKg: number | null;
  eventDate: Date | null;
  daysUntilEvent: number | null;
  /** "42 days to event" / "Event day" / "Event completed"; null when there is no plan. */
  countdownLabel: string | null;
  weeks: EventPlanWeek[];
  currentWeek: EventPlanWeek | null;
  currentWeekIndex: number;
  onNavigateToPlan: () => void;
};

const loadTagLabels: Record<LoadTag, string> = { build: "Build", recovery: "Recovery", taper: "Taper" };

const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/* Staggered entrance on mount (tw-animate-css). `fill-mode-both` holds each
   card invisible through its delay instead of flashing in and then animating. */
const enterClass =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:ease-out";
const enterDelay = (index: number): CSSProperties => ({ animationDelay: `${index * 90}ms` });

/** The shadcn "section cards" shell: tinted gradient, big tabular title, footer for context. */
const statCardClass =
  "relative gap-3 rounded-xl border-foreground/15 bg-gradient-to-t from-primary/5 to-card py-5 shadow-xs";
const titleClass = "text-4xl font-extrabold whitespace-nowrap tabular-nums";
const unitClass = "ml-1 text-base font-semibold text-muted-foreground";
const footerClass = "flex-col items-start gap-1.5 text-sm";

const StatCard = ({
  index,
  description,
  title,
  badge,
  children,
  className
}: {
  index: number;
  description: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  className?: string;
}): ReactElement => (
  <Card className={cn(statCardClass, enterClass, className)} style={enterDelay(index)}>
    <CardHeader className="px-5">
      <CardDescription>{description}</CardDescription>
      <CardTitle className={titleClass}>{title}</CardTitle>
      {badge ? <CardAction>{badge}</CardAction> : null}
    </CardHeader>
    <CardFooter className={cn(footerClass, "px-5")}>{children}</CardFooter>
  </Card>
);

/** Values shared by the full cards and the pinned compact bar. */
const deriveStatus = ({
  dashboard,
  currentFtp,
  weightKg,
  eventDate,
  weeks,
  currentWeek,
  currentWeekIndex
}: Pick<Props, "dashboard" | "currentFtp" | "weightKg" | "eventDate" | "weeks" | "currentWeek" | "currentWeekIndex">) => {
  const rawCompliance = dashboard?.planCompliancePercent ?? null;
  // FTP trend: current value against the oldest recorded test.
  const firstFtp = dashboard?.ftpTrend.find((point) => point.ftpWatts !== null)?.ftpWatts ?? null;
  return {
    compliance: rawCompliance !== null ? Math.round(rawCompliance) : null,
    blockProgress: currentWeek ? Math.round(((currentWeekIndex + 1) / weeks.length) * 100) : null,
    ftpDelta: firstFtp !== null && dashboard && dashboard.ftpTrend.length > 1 ? currentFtp - firstFtp : null,
    wattsPerKg: weightKg ? (currentFtp / weightKg).toFixed(2) : null,
    plannedThisWeek: currentWeek?.days.filter((day) => day.workoutId !== null).length ?? 0,
    eventDateLabel: eventDate?.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  };
};

/**
 * The Home header row: event countdown, training block, FTP and plan compliance
 * as attention-grabbing stat cards. Numbers count up on mount and the progress
 * bars fill in; all of it is skipped under prefers-reduced-motion.
 */
export const TrainingStatusCards = ({
  dashboard,
  currentFtp,
  weightKg,
  eventDate,
  daysUntilEvent,
  countdownLabel,
  weeks,
  currentWeek,
  currentWeekIndex,
  onNavigateToPlan
}: Props): ReactElement => {
  const { compliance, blockProgress, ftpDelta, wattsPerKg, plannedThisWeek, eventDateLabel } = deriveStatus({
    dashboard,
    currentFtp,
    weightKg,
    eventDate,
    weeks,
    currentWeek,
    currentWeekIndex
  });
  const animatedDays = useCountUp(daysUntilEvent !== null && daysUntilEvent > 0 ? daysUntilEvent : null);
  const animatedFtp = useCountUp(currentFtp);
  const animatedCompliance = useCountUp(compliance);
  const animatedBlockProgress = useCountUp(blockProgress, 1100);

  const eventTitle =
    countdownLabel === null ? (
      "No event yet"
    ) : daysUntilEvent !== null && daysUntilEvent > 0 ? (
      <>
        {animatedDays}
        <span className="ml-1.5 text-base font-semibold text-primary-foreground/80">
          day{daysUntilEvent === 1 ? "" : "s"}
        </span>
      </>
    ) : daysUntilEvent === 0 ? (
      "Race day"
    ) : (
      "Completed"
    );

  return (
    // status-cards-timeline names this grid's scroll position, which drives the
    // pinned TrainingStatusBar's reveal once the grid scrolls out of view.
    <div className="status-cards-timeline grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* The countdown is the one brand-filled card, so the eye lands there first.
          The whole card is the hit target via an empty full-bleed button laid
          over it, rather than a <button> around the Card, which may not hold
          its <div>s. It must be a direct child of the Card: CardHeader is a
          size container, which makes it the containing block for absolute
          descendants, so a stretched ::after inside it only covered the header. */}
      <Card
        className={cn(
          "group/event relative gap-3 overflow-hidden rounded-xl border-0 bg-primary py-5 text-primary-foreground shadow-md transition-[transform,box-shadow] duration-200",
          "focus-within:ring-[3px] focus-within:ring-ring/50 hover:shadow-lg motion-safe:hover:-translate-y-0.5",
          enterClass
        )}
        style={enterDelay(0)}
      >
        {/* Decorative oversized flag watermark. */}
        <button
          type="button"
          onClick={onNavigateToPlan}
          aria-label={countdownLabel ?? "Create a training plan"}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none"
        />
        <Flag aria-hidden className="pointer-events-none absolute -right-4 -bottom-6 size-32 -rotate-12 opacity-15" />
        <CardHeader className="px-5">
          <CardDescription className="text-primary-foreground/80">Event countdown</CardDescription>
          <CardTitle className={titleClass}>{eventTitle}</CardTitle>
        </CardHeader>
        <CardFooter className={cn(footerClass, "px-5")}>
          {eventDateLabel && countdownLabel !== null ? (
            <Badge variant="outline" className="border-primary-foreground/40 text-primary-foreground">
              <CalendarDays />
              {eventDateLabel}
            </Badge>
          ) : (
            <span className="text-primary-foreground/80">Set an event date to start a block</span>
          )}
          <span className="flex items-center gap-1 font-semibold">
            {countdownLabel === null ? "Build a training plan" : "Open your plan"}
            <ArrowRight className="size-4 transition-transform group-hover/event:translate-x-1" />
          </span>
        </CardFooter>
      </Card>

      <StatCard
        index={1}
        description="Training week"
        title={
          currentWeek ? (
            <>
              {currentWeekIndex + 1}
              <span className={unitClass}>of {weeks.length}</span>
            </>
          ) : (
            "—"
          )
        }
        badge={currentWeek ? <Badge variant="secondary">{loadTagLabels[currentWeek.loadTag]}</Badge> : null}
      >
        {currentWeek ? (
          <>
            <Progress
              value={animatedBlockProgress ?? 0}
              aria-label="Training block progress"
              className="mb-1 h-1.5"
            />
            <span className="text-muted-foreground">
              {plannedThisWeek} ride{plannedThisWeek === 1 ? "" : "s"} · {formatMinutes(currentWeek.targetMinutes)} this
              week
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No active training week</span>
        )}
      </StatCard>

      <StatCard
        index={2}
        description="Current FTP"
        title={
          <>
            {animatedFtp}
            <span className={unitClass}>W</span>
          </>
        }
        badge={
          ftpDelta !== null ? (
            <Badge variant="outline">
              {ftpDelta > 0 ? <TrendingUp /> : ftpDelta < 0 ? <TrendingDown /> : <Minus />}
              {ftpDelta > 0 ? "+" : ""}
              {ftpDelta} W
            </Badge>
          ) : null
        }
      >
        <span className="flex items-center gap-1 font-semibold">
          <Zap className="size-4 text-primary" />
          {wattsPerKg ? `${wattsPerKg} W/kg` : "Add your weight for W/kg"}
        </span>
        <span className="text-muted-foreground">
          {ftpDelta !== null
            ? `${ftpDelta >= 0 ? "Up" : "Down"} ${Math.abs(ftpDelta)} W since your first test`
            : "Your functional threshold power"}
        </span>
      </StatCard>

      <StatCard
        index={3}
        description="Plan compliance"
        title={
          compliance !== null ? (
            <>
              {animatedCompliance}
              <span className={unitClass}>%</span>
            </>
          ) : (
            "—"
          )
        }
        badge={
          dashboard ? (
            <Badge variant="outline">
              {dashboard.completedWorkoutsCount} ride{dashboard.completedWorkoutsCount === 1 ? "" : "s"}
            </Badge>
          ) : null
        }
      >
        {compliance !== null ? (
          <Progress value={animatedCompliance ?? 0} aria-label="Plan compliance" className="mb-1 h-1.5" />
        ) : null}
        <span className="text-muted-foreground">
          {compliance === null
            ? "Complete a planned ride to start tracking"
            : compliance >= 80
              ? "Right on plan — keep it rolling"
              : "Room to catch up this week"}
        </span>
      </StatCard>
    </div>
  );
};

/**
 * A one-line digest of the cards, pinned just under the sticky Nav (it
 * slides out from beneath it, z-30 under the Nav's z-40). It is
 * fixed-position (so it never shifts the page) and revealed purely by scroll
 * position — `status-bar-reveal` in index.css ties it to the cards' own view
 * timeline, so it slides in as the cards scroll away and back out as they
 * return. While hidden it is visibility:hidden, so it is out of the tab order
 * and the accessibility tree too.
 *
 * Render it after the page's other content: it is fixed, so DOM position
 * doesn't move it visually, and last-in-DOM keeps it last in the tab order.
 */
export const TrainingStatusBar = (props: Props): ReactElement => {
  const { daysUntilEvent, countdownLabel, weeks, currentWeek, currentWeekIndex, currentFtp, onNavigateToPlan } = props;
  const { compliance, blockProgress, ftpDelta, wattsPerKg, eventDateLabel } = deriveStatus(props);

  const eventText =
    countdownLabel === null
      ? "Build a training plan"
      : daysUntilEvent !== null && daysUntilEvent > 0
        ? `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} to go`
        : daysUntilEvent === 0
          ? "Race day"
          : "Event completed";

  const statClass = "flex min-w-0 items-center gap-2 text-sm whitespace-nowrap";
  const labelClass = "text-xs text-muted-foreground";

  return (
    <div
      role="region"
      aria-label="Training status summary"
      className="status-bar-reveal fixed inset-x-0 top-[var(--app-header-height)] z-30 border-b border-foreground/10 bg-background/85 shadow-sm backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-6 py-2.5">
        <Button size="sm" onClick={onNavigateToPlan} className="shrink-0 font-bold">
          <Flag />
          {eventText}
          {eventDateLabel && countdownLabel !== null ? (
            <span className="font-medium text-primary-foreground/80">· {eventDateLabel}</span>
          ) : null}
        </Button>

        <Separator orientation="vertical" className="h-6! bg-foreground/15" />
        <div className={statClass}>
          <span className={labelClass}>Week</span>
          <span className="font-extrabold tabular-nums">{currentWeek ? `${currentWeekIndex + 1}/${weeks.length}` : "—"}</span>
          {blockProgress !== null ? (
            <Progress value={blockProgress} aria-label="Training block progress" className="hidden h-1.5 w-16 md:block" />
          ) : null}
          {currentWeek ? (
            <Badge variant="secondary" className="hidden lg:inline-flex">
              {loadTagLabels[currentWeek.loadTag]}
            </Badge>
          ) : null}
        </div>

        <Separator orientation="vertical" className="h-6! bg-foreground/15" />
        <div className={statClass}>
          <span className={labelClass}>FTP</span>
          <span className="font-extrabold tabular-nums">{currentFtp} W</span>
          {ftpDelta !== null ? (
            <Badge variant="outline" className="hidden md:inline-flex">
              {ftpDelta > 0 ? <TrendingUp /> : ftpDelta < 0 ? <TrendingDown /> : <Minus />}
              {ftpDelta > 0 ? "+" : ""}
              {ftpDelta} W
            </Badge>
          ) : null}
          {wattsPerKg ? <span className="hidden text-muted-foreground lg:inline">{wattsPerKg} W/kg</span> : null}
        </div>

        <Separator orientation="vertical" className="h-6! bg-foreground/15" />
        <div className={statClass}>
          <span className={labelClass}>Compliance</span>
          <span className="font-extrabold tabular-nums">{compliance !== null ? `${compliance}%` : "—"}</span>
          {compliance !== null ? (
            <Progress value={compliance} aria-label="Plan compliance" className="hidden h-1.5 w-16 md:block" />
          ) : null}
        </div>
      </div>
    </div>
  );
};
