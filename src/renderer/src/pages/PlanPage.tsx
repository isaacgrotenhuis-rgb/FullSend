import { Fragment, useEffect, useRef, useState, type ReactElement } from "react";
import type {
  DayAvailability,
  EventPlanWeek,
  EventType,
  LoadTag,
  PlanLengthWeeks,
  SessionType
} from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Muted body text at the legacy 50/55/60/65% opacity steps used throughout
    this page's cards, meta rows and empty-state copy. */
const mutedText50Class = "text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]";
const mutedText55Class = "text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]";
const mutedText60Class = "text-[color-mix(in_srgb,var(--color-text)_60%,transparent)]";
const mutedText65Class = "text-[color-mix(in_srgb,var(--color-text)_65%,transparent)]";

const eventTypeOptions: { value: EventType; label: string }[] = [
  { value: "road-race", label: "Road race" },
  { value: "time-trial", label: "Time trial" },
  { value: "criterium", label: "Criterium" },
  { value: "gran-fondo", label: "Gran fondo" }
];

const planLengthOptions: PlanLengthWeeks[] = [8, 12, 16];

const ratioOptions: { value: "2:1" | "3:1"; description: string }[] = [
  { value: "2:1", description: "Two training days for every rest day" },
  { value: "3:1", description: "Three training days for every rest day" }
];

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
  // The saved plan's event date — not `generate.eventDate`, which is the
  // wizard's form state and defaults to today.
  eventDate: string | null;
  currentPlanName: string | null;
  liveWorkoutBusy: boolean;
  isWorkoutSessionActive: boolean;
  previewWorkoutForDay: (
    workoutId: string,
    workoutName: string,
    sessionType: SessionType | null
  ) => Promise<void>;
  onDeletePlan: () => Promise<void>;
  onOpenWorkoutBank: () => void;
};

const loadTagLabels: Record<LoadTag, string> = {
  build: "Build",
  recovery: "Recovery",
  taper: "Taper"
};

const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/** "3 workouts · 5h 24m" — totals over the days actually scheduled. */
const weekSummary = (week: EventPlanWeek): string => {
  const workouts = week.days.filter((day) => day.workoutId !== null);
  if (workouts.length === 0) return "Rest week";
  const totalMinutes = workouts.reduce((sum, day) => sum + day.durationMin, 0);
  return `${workouts.length} workout${workouts.length === 1 ? "" : "s"} · ${formatMinutes(totalMinutes)}`;
};

type PlanWeekSectionProps = {
  week: EventPlanWeek;
  isCurrent: boolean;
  today: Date;
  previewDisabled: boolean;
  previewWorkoutForDay: Props["previewWorkoutForDay"];
};

/** One week in the scrolling plan list: a sticky header that pins to the top
    of the scroll area while its days scroll beneath it (and is pushed off by
    the next week's header), over hairline-separated day rows. */
const PlanWeekSection = ({
  week,
  isCurrent,
  today,
  previewDisabled,
  previewWorkoutForDay
}: PlanWeekSectionProps): ReactElement => {
  const weekStart = parseIsoDate(week.startDate);
  const weekEnd = addDaysToDate(weekStart, 6);
  const headingId = `plan-week-${week.weekId}`;

  return (
    <section aria-labelledby={headingId} data-week-id={week.weekId} aria-current={isCurrent ? "date" : undefined}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-foreground/15 bg-background px-4 py-2.5">
        <h4 id={headingId} className={cn("m-0", isCurrent && "text-[var(--color-accent-700)]")}>
          Week {week.weekIndex + 1}
        </h4>
        <span className={cn("text-[13px]", mutedText60Class)}>
          {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
        </span>
        <span className={cn("ml-auto text-[13px] font-semibold", mutedText65Class)}>{weekSummary(week)}</span>
        {isCurrent ? <Badge>This week</Badge> : null}
        <Badge variant="outline" className="border-foreground/25">
          {loadTagLabels[week.loadTag]}
        </Badge>
      </div>
      <ItemGroup className="pb-4">
        {week.days.map((day, index) => {
          const cellDate = addDaysToDate(weekStart, day.dayIndex);
          const isToday = cellDate.getTime() === today.getTime();
          const hasWorkout = day.workoutId !== null;
          return (
            <Fragment key={`${week.weekId}-${day.dayIndex}`}>
              {index > 0 ? <ItemSeparator className="bg-foreground/10" /> : null}
              <Item
                role="listitem"
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "flex-nowrap gap-4 rounded-none px-4",
                  hasWorkout ? "py-2.5" : "py-1.5",
                  isToday && "bg-[var(--color-accent-100)]",
                  !hasWorkout && "text-muted-foreground"
                )}
              >
                <div
                  className={cn(
                    "w-36 shrink-0 text-[11px] tracking-wide whitespace-nowrap uppercase",
                    isToday ? "font-bold text-[var(--color-accent-700)]" : mutedText55Class
                  )}
                >
                  {dayLabels[day.dayIndex]} · {formatShortDate(cellDate)}
                  {isToday ? " · Today" : ""}
                </div>
                <ItemContent className={cn("min-w-0", hasWorkout ? "text-sm font-semibold" : "text-[13px]")}>
                  {day.workoutName ?? "Rest"}
                </ItemContent>
                {hasWorkout ? (
                  <ItemActions>
                    <span className={cn("text-[11px] whitespace-nowrap", mutedText50Class)}>
                      {day.durationMin} min{day.targetIF !== null ? ` · IF ${day.targetIF}` : ""}
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={previewDisabled}
                      onClick={() =>
                        void previewWorkoutForDay(day.workoutId as string, day.workoutName ?? "Workout", day.sessionType)
                      }
                    >
                      Preview
                    </Button>
                  </ItemActions>
                ) : null}
              </Item>
            </Fragment>
          );
        })}
      </ItemGroup>
    </section>
  );
};

export const PlanPage = ({
  generate,
  adapt,
  weeks,
  eventDate,
  currentPlanName,
  liveWorkoutBusy,
  isWorkoutSessionActive,
  previewWorkoutForDay,
  onDeletePlan,
  onOpenWorkoutBank
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

  /* The week containing today is scrolled to the top of the list on open;
     earlier weeks sit above it, reachable by scrolling up. */
  const currentWeekId =
    weeks.find((week) => {
      const start = parseIsoDate(week.startDate);
      return today >= start && today < addDaysToDate(start, 7);
    })?.weekId ?? null;
  const weekListRef = useRef<HTMLDivElement>(null);

  /* Runs when the plan (or the current week) changes, not on every render,
     so it never yanks the list back while someone is scrolling it. The
     viewport is Radix's own scroll container; offsetTop is measured from it
     since the week sections are its direct content. */
  useEffect(() => {
    const viewport = weekListRef.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const target = currentWeekId
      ? viewport?.querySelector<HTMLElement>(`[data-week-id="${currentWeekId}"]`)
      : null;
    if (viewport && target) {
      viewport.scrollTop = target.offsetTop;
    }
  }, [currentWeekId, weeks]);
  const daysUntilEvent =
    eventDate === null ? null : Math.round((parseIsoDate(eventDate).getTime() - today.getTime()) / 86400000);
  const countdownLabel =
    hasPlan && daysUntilEvent !== null
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
    <main className="mx-auto max-w-[960px] p-6">
      <div className="flex items-end justify-between gap-4 mb-2">
        <h1 className="m-0">{hasPlan && currentPlanName ? currentPlanName : "Your plan"}</h1>
        <div className="flex gap-2">
          <Button variant="outline-primary" onClick={onOpenWorkoutBank}>
            Browse workout bank
          </Button>
          {hasPlan ? <Button onClick={() => setAdaptOpen(true)}>Edit plan</Button> : null}
        </div>
      </div>

      {hasPlan ? (
        <>
          {countdownLabel ? (
            <h6 className="mb-6 text-[var(--color-accent-700)]">{countdownLabel}</h6>
          ) : null}

          {/* All weeks in one scroll area, opened at the current week. Each
              week's header sticks to the top while its days scroll away
              beneath it, and a gradient over the bottom edge makes upcoming
              weeks trail off rather than being cut off. (An overlay rather
              than a CSS mask: a mask on the scroll root made Chromium paint
              scrolled rows above the card's top edge.) The height fills the
              window below the page heading. */}
          <div className="relative">
            <ScrollArea
              ref={weekListRef}
              className="h-[max(420px,calc(100vh-13.5rem))] overflow-hidden rounded-xl border border-foreground/15 bg-muted"
            >
              <div className="relative">
                {weeks.map((week) => (
                  <PlanWeekSection
                    key={week.weekId}
                    week={week}
                    isCurrent={week.weekId === currentWeekId}
                    today={today}
                    previewDisabled={liveWorkoutBusy || isWorkoutSessionActive}
                    previewWorkoutForDay={previewWorkoutForDay}
                  />
                ))}
              </div>
            </ScrollArea>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-px bottom-px h-10 rounded-b-xl bg-gradient-to-t from-muted to-transparent"
            />
          </div>
        </>
      ) : (
        <Empty className="mt-6 border border-foreground/30 py-16">
          <EmptyHeader>
            <EmptyTitle className="text-2xl font-extrabold">No training plan yet</EmptyTitle>
            <EmptyDescription>
              Tell us what event you're training for and we'll build a weekly schedule of workouts around it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={openWizard}>Create a plan</Button>
          </EmptyContent>
        </Empty>
      )}

      {/* The plan wizard, the adapt dialog and the delete confirmation all
          convert together: the delete confirmation can open on top of either
          the wizard or the adapt dialog, so all three need to keep stacking
          correctly under Radix's shared layering once none of them carries
          its own hand-rolled z-index. */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-3 overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>New training plan</DialogTitle>
          </DialogHeader>
          <div className={cn("uppercase tracking-wide text-[11px] -mt-2 mb-2", mutedText55Class)}>
            Step {wizardStep + 1} of 4 · {wizardStepLabels[wizardStep]}
          </div>
          <div className="mb-4 h-0.5 w-full bg-[var(--color-divider)]" />

          {wizardStep === 0 ? (
            <>
              <div className="mb-3 flex flex-col gap-1.5">
                <Label>Plan name (optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g. Fall road race build"
                  maxLength={120}
                  value={generate.planName}
                  onChange={(event) => generate.setPlanName(event.target.value)}
                />
              </div>
              <h6 className="mb-3">What are you training for?</h6>
              <ToggleGroup
                type="single"
                variant="outline"
                className="grid w-full grid-cols-2 gap-1.5"
                value={generate.eventType}
                onValueChange={(value) => {
                  // Required choice — a required ToggleGroup would otherwise
                  // clear the selection on a re-click of the active option.
                  if (value) generate.setEventType(value as EventType);
                }}
              >
                {eventTypeOptions.map((opt) => (
                  <ToggleGroupItem key={opt.value} value={opt.value} className="w-full">
                    {opt.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </>
          ) : null}

          {wizardStep === 1 ? (
            <>
              <h6 className="mb-3">When is it?</h6>
              <div className="mb-3 flex max-w-[280px] flex-col gap-1.5">
                <Label>Event date</Label>
                <Input type="date" value={generate.eventDate} onChange={(event) => generate.setEventDate(event.target.value)} />
              </div>
              <div className="flex max-w-[280px] flex-col gap-1.5">
                <Label>Plan length</Label>
                <Select
                  value={String(generate.planLengthWeeks)}
                  onValueChange={(value) => generate.setPlanLengthWeeks(Number(value) as PlanLengthWeeks)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {planLengthOptions.map((weeksOption) => (
                      <SelectItem key={weeksOption} value={String(weeksOption)}>
                        {weeksOption} weeks
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {wizardStep === 2 ? (
            <>
              <h6 className="mb-3">Training-to-rest ratio</h6>
              <ToggleGroup
                type="single"
                variant="outline"
                className="flex w-full flex-col gap-1.5"
                value={ratioChoice}
                onValueChange={(value) => {
                  // Required choice — same deselection guard as the event-type
                  // picker above.
                  if (value) setRatioChoice(value as "2:1" | "3:1");
                }}
              >
                {ratioOptions.map((ratio) => (
                  <ToggleGroupItem
                    key={ratio.value}
                    value={ratio.value}
                    className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-3 py-3 text-left"
                  >
                    <span className="text-sm font-extrabold">{ratio.value}</span>
                    <span className={cn("text-[11px]", mutedText50Class)}>{ratio.description}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </>
          ) : null}

          {wizardStep === 3 ? (
            <>
              <h6 className="mb-3">Hours per week</h6>
              <div className="flex items-center gap-4">
                <Slider
                  className="flex-1"
                  min={3}
                  max={14}
                  step={0.5}
                  value={[hoursPerWeek]}
                  onValueChange={([next]) => setHoursPerWeek(next)}
                />
                <div className="min-w-20 text-right text-xl font-extrabold">{hoursPerWeek} hrs</div>
              </div>

              <h6 className="mt-4 mb-3">Weekly availability</h6>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Train</TableHead>
                    <TableHead>Max min</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generate.weeklyAvailability.map((day) => (
                    <TableRow key={day.dayIndex}>
                      <TableCell>{dayLabels[day.dayIndex]}</TableCell>
                      <TableCell>
                        <Label className="sr-only" htmlFor={`plan-day-${day.dayIndex}`}>
                          {dayLabels[day.dayIndex]} can train
                        </Label>
                        <Checkbox
                          id={`plan-day-${day.dayIndex}`}
                          checked={day.canTrain}
                          onCheckedChange={(checked) => generate.updateAvailability(day.dayIndex, { canTrain: checked === true })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={20}
                          max={360}
                          className="h-7 w-20 px-1.5 py-0.5"
                          value={day.maxDurationMin ?? ""}
                          onChange={(event) =>
                            generate.updateAvailability(day.dayIndex, {
                              maxDurationMin: event.target.value ? Number(event.target.value) : null
                            })
                          }
                          disabled={!day.canTrain}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex max-w-40 flex-col gap-1.5">
                <Label>Current FTP (W)</Label>
                <Input
                  type="number"
                  min={100}
                  max={600}
                  value={generate.currentFtp}
                  onChange={(event) => generate.setCurrentFtp(Number(event.target.value))}
                />
              </div>
            </>
          ) : null}

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="sm:mr-auto" onClick={() => setWizardOpen(false)}>
              Cancel
            </Button>
            <div className="flex gap-2">
              {wizardStep > 0 ? (
                <Button variant="outline" onClick={() => setWizardStep((step) => step - 1)}>
                  Back
                </Button>
              ) : null}
              {wizardStep < 3 ? (
                <Button onClick={() => setWizardStep((step) => step + 1)}>Next</Button>
              ) : (
                <Button disabled={!generate.canGenerate} onClick={() => void handleGenerate()}>
                  Generate plan
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adaptOpen} onOpenChange={setAdaptOpen}>
        <DialogContent className="gap-3 sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit plan</DialogTitle>
          </DialogHeader>
          <div className="mb-3 h-0.5 w-full bg-[var(--color-divider)]" />
          <div className="flex flex-col gap-1.5">
            <Label>Reason</Label>
            <Input value={adapt.adaptReason} onChange={(event) => adapt.setAdaptReason(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Prompt (optional)</Label>
            <Input
              placeholder="e.g. fatigue this week, reduce load"
              value={adapt.adaptationPrompt}
              onChange={(event) => adapt.setAdaptationPrompt(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Override FTP (optional)</Label>
              <Input value={adapt.overrideFtp} onChange={(event) => adapt.setOverrideFtp(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Override event date (optional)</Label>
              <Input type="date" value={adapt.overrideDate} onChange={(event) => adapt.setOverrideDate(event.target.value)} />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" className={mutedText55Class} onClick={() => setDeleteConfirmOpen(true)}>
              Delete plan
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setAdaptOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!adapt.planId} onClick={() => void handleAdapt()}>
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destructive confirmation, so AlertDialog rather than Dialog: it needs
          the `alertdialog` role and no outside-click dismiss, which Dialog
          doesn't give. It stacks above the adapt dialog because it is the
          later-opened Radix layer, matching the legacy z200/z210 order. */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="gap-3 sm:max-w-[420px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your current training plan and its schedule. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            {/* AlertDialogAction is Radix's DialogPrimitive.Close underneath, so
                it closes on click by default. That would dismiss the confirm
                before the delete finishes and — on failure — hide the busy
                state the original markup kept visible. preventDefault() stops
                that auto-close; handleDeletePlan closes it explicitly only
                once the delete has actually succeeded. */}
            <AlertDialogAction
              disabled={deleteBusy}
              onClick={(event) => {
                event.preventDefault();
                void handleDeletePlan();
              }}
            >
              {deleteBusy ? "Deleting..." : "Delete plan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};
