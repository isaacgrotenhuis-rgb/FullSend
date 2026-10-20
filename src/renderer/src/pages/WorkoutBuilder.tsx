import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import type { BankWorkoutDetail, TrainingPhase, TrainingZone } from "@shared/ipc/contracts";
import { deriveFswMetrics, FSW_PHASES, type FswDocument } from "@shared/fsw";
import { compile } from "@shared/workoutCompiler";
import { ZONE_KEYS, ZONES } from "@shared/zones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { StatStrip, type Stat } from "../StatStrip";
import { WorkoutProfileChart } from "../WorkoutProfileChart";
import {
  BLOCK_LABELS,
  createBlock,
  createEmptyDraft,
  documentToDraft,
  draftToDocument,
  draftWarnings,
  duplicateBlock,
  formatDuration,
  LIMITS,
  normalizeTag,
  PHASE_LABELS,
  previewDocument,
  suggestZone,
  uniqueWorkoutId,
  validateAbout,
  validateDraft,
  type AboutDraft,
  type BlockDraft,
  type BlockType,
  type DraftErrors,
  type WorkoutDraft
} from "../workoutBuilder";
import { WorkoutBlockEditor } from "./WorkoutBlockEditor";

export type BuilderMode = "create" | "edit" | "duplicate";

type Props = {
  mode: BuilderMode;
  /** The workout being edited or duplicated; null when creating. */
  source: BankWorkoutDetail | null;
  ftp: number;
  /** Ids already in the bank, so a new workout never collides with one. */
  takenIds: string[];
  /** Reports whether there are unsaved changes, so the host can confirm before closing. */
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: (id: string) => void;
};

type Step = "about" | "structure";

const TITLES: Record<BuilderMode, string> = {
  create: "New workout",
  edit: "Edit workout",
  duplicate: "Duplicate workout"
};

const ADDABLE_BLOCKS: BlockType[] = ["steady", "intervals", "ramp", "freeride", "warmup", "cooldown"];

const initialDraft = (mode: BuilderMode, source: BankWorkoutDetail | null): WorkoutDraft => {
  if (!source) {
    return createEmptyDraft();
  }
  const draft = documentToDraft(source.document);
  if (mode === "duplicate") {
    draft.about.name = `${source.name} (copy)`.slice(0, LIMITS.nameMax);
  }
  return draft;
};

/** Electron prefixes invoke errors with "Error invoking remote method '…': Error: "; riders only need the message. */
const ipcErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
};

const StepIndicator = ({ step, onAbout }: { step: Step; onAbout: () => void }): ReactElement => {
  const steps: { key: Step; label: string }[] = [
    { key: "about", label: "About" },
    { key: "structure", label: "Workout" }
  ];
  const currentIndex = steps.findIndex((entry) => entry.key === step);
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0 text-sm" aria-label="Steps">
      {steps.map((entry, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        const marker = (
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
              current && "border-primary bg-primary text-primary-foreground",
              done && "border-primary text-primary",
              !current && !done && "text-muted-foreground"
            )}
          >
            {done ? <Check className="size-3" /> : index + 1}
          </span>
        );
        return (
          <li key={entry.key} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            {index > 0 ? <span aria-hidden className="h-px w-6 bg-border" /> : null}
            {done ? (
              // Going back is always allowed; going forward goes through Next, which validates.
              <Button type="button" variant="ghost" size="sm" className="-mx-2 gap-2 px-2" onClick={onAbout}>
                {marker}
                {entry.label}
              </Button>
            ) : (
              <span className={cn("flex items-center gap-2", current ? "font-semibold" : "text-muted-foreground")}>
                {marker}
                {entry.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

/**
 * Create or edit a Workout Bank workout in two steps: what it is (name, zone,
 * phases, tags), then what you ride (blocks), with a live profile at the
 * rider's FTP. Rendered inside the bank's DialogContent.
 */
export const WorkoutBuilder = ({
  mode,
  source,
  ftp,
  takenIds,
  onDirtyChange,
  onCancel,
  onSaved
}: Props): ReactElement => {
  const [initial] = useState(() => initialDraft(mode, source));
  const [draft, setDraft] = useState<WorkoutDraft>(initial);
  const [step, setStep] = useState<Step>("about");
  const [showAboutErrors, setShowAboutErrors] = useState(false);
  const [showBlockErrors, setShowBlockErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [schemaErrors, setSchemaErrors] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const ids = { name: useId(), description: useId(), zone: useId(), tags: useId(), tagsHint: useId() };

  const dirty = draft !== initial;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const aboutErrors = useMemo(() => validateAbout(draft.about), [draft.about]);
  const errors: DraftErrors = useMemo(() => validateDraft(draft), [draft]);
  const preview = useMemo(() => previewDocument(draft), [draft]);

  // Keep showing the last good profile while a field is mid-edit, instead of
  // the chart blinking out on every keystroke.
  const [lastPreview, setLastPreview] = useState<FswDocument | null>(preview);
  useEffect(() => {
    if (preview) setLastPreview(preview);
  }, [preview]);
  const shown = preview ?? lastPreview;
  const intervals = useMemo(() => (shown ? compile(shown, ftp) : []), [shown, ftp]);
  const metrics = shown ? deriveFswMetrics(shown) : null;
  const suggested = preview ? suggestZone(preview) : null;
  const warnings = preview ? draftWarnings(draft, preview) : [];

  const updateAbout = (patch: Partial<AboutDraft>): void => {
    setDraft((current) => ({ ...current, about: { ...current.about, ...patch } }));
  };

  const updateBlocks = (update: (blocks: BlockDraft[]) => BlockDraft[]): void => {
    setSchemaErrors([]);
    setDraft((current) => ({ ...current, blocks: update(current.blocks) }));
  };

  const addBlock = (type: BlockType): void => {
    updateBlocks((blocks) => {
      const block = createBlock(type);
      // New blocks go before a trailing cool-down, which is nearly always where they belong.
      const last = blocks[blocks.length - 1];
      if (type !== "cooldown" && last?.type === "cooldown") {
        return [...blocks.slice(0, -1), block, last];
      }
      return [...blocks, block];
    });
  };

  const addTag = (): void => {
    const tag = normalizeTag(tagInput);
    setTagInput("");
    if (!tag || draft.about.tags.includes(tag) || draft.about.tags.length >= LIMITS.tagsMax) {
      return;
    }
    updateAbout({ tags: [...draft.about.tags, tag] });
  };

  const onTagKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag();
    } else if (event.key === "Backspace" && tagInput === "" && draft.about.tags.length > 0) {
      updateAbout({ tags: draft.about.tags.slice(0, -1) });
    }
  };

  const goToStructure = (event?: FormEvent): void => {
    event?.preventDefault();
    setShowAboutErrors(true);
    if (Object.keys(aboutErrors).length === 0) {
      setStep("structure");
    }
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setShowBlockErrors(true);
    setSaveError(null);
    const id = mode === "edit" && source ? source.id : uniqueWorkoutId(draft.about.name, takenIds);
    const result = draftToDocument(draft, id);
    if (!result.ok) {
      if (Object.keys(result.errors.about).length > 0) {
        setShowAboutErrors(true);
        setStep("about");
      }
      setSchemaErrors(result.errors.form);
      return;
    }
    setSaving(true);
    try {
      const saved =
        mode === "edit" && source
          ? await window.kickr.workoutBank.update({ id: source.id, document: result.document })
          : await window.kickr.workoutBank.create({ document: result.document });
      onDirtyChange(false);
      onSaved(saved.id);
    } catch (error) {
      setSaveError(ipcErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const visibleAbout = showAboutErrors ? aboutErrors : {};
  const formErrors = showBlockErrors ? [...errors.form, ...schemaErrors] : schemaErrors;

  const stats: Stat[] = [
    { label: "Duration", value: metrics ? formatDuration(metrics.durationSec) : null },
    { label: "Intensity", value: metrics ? metrics.estIF.toFixed(2) : null, unit: "IF" },
    { label: "TSS", value: metrics ? `${metrics.estTSS}` : null },
    { label: "Blocks", value: `${draft.blocks.length}` }
  ];

  const header = (
    <DialogHeader className="gap-3">
      <div className="flex flex-col gap-1.5 pr-8">
        <DialogTitle>{TITLES[mode]}</DialogTitle>
        <DialogDescription>
          {step === "about"
            ? "Name it and say what it trains."
            : `Build the blocks. Targets are % of FTP; watts are shown at your FTP of ${ftp} W.`}
        </DialogDescription>
      </div>
      <StepIndicator step={step} onAbout={() => setStep("about")} />
    </DialogHeader>
  );

  if (step === "about") {
    return (
      <form className="contents" noValidate onSubmit={goToStructure}>
        {header}
        <FieldGroup className="gap-5">
          <Field data-invalid={visibleAbout.name ? true : undefined}>
            <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
            <Input
              id={ids.name}
              value={draft.about.name}
              maxLength={LIMITS.nameMax}
              placeholder="e.g. Sweet Spot 3×12"
              autoComplete="off"
              autoFocus
              aria-invalid={visibleAbout.name ? true : undefined}
              onChange={(event) => updateAbout({ name: event.target.value })}
            />
            <FieldError>{visibleAbout.name}</FieldError>
          </Field>

          <Field data-invalid={visibleAbout.description ? true : undefined}>
            <FieldLabel htmlFor={ids.description}>
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id={ids.description}
              value={draft.about.description}
              rows={3}
              maxLength={LIMITS.descriptionMax}
              placeholder="What the workout is for and how it should feel."
              aria-invalid={visibleAbout.description ? true : undefined}
              onChange={(event) => updateAbout({ description: event.target.value })}
            />
            <FieldDescription className="text-right text-xs tabular-nums">
              {draft.about.description.length}/{LIMITS.descriptionMax}
            </FieldDescription>
          </Field>

          <Field data-invalid={visibleAbout.primaryZone ? true : undefined}>
            <FieldLabel htmlFor={ids.zone}>Primary zone</FieldLabel>
            <Select
              value={draft.about.primaryZone}
              onValueChange={(value) => updateAbout({ primaryZone: value as TrainingZone })}
            >
              <SelectTrigger id={ids.zone} className="w-full sm:w-72" aria-invalid={visibleAbout.primaryZone ? true : undefined}>
                <SelectValue placeholder="Choose a zone" />
              </SelectTrigger>
              <SelectContent>
                {ZONE_KEYS.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {ZONES[zone].label}
                    <span className="text-muted-foreground tabular-nums">
                      {Math.round(ZONES[zone].min * 100)}–{Math.round(ZONES[zone].max * 100)}%
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {visibleAbout.primaryZone ? (
              <FieldError>{visibleAbout.primaryZone}</FieldError>
            ) : (
              <FieldDescription>Used to file it in the bank and to pick it for plan days.</FieldDescription>
            )}
          </Field>

          <FieldSet>
            <FieldLegend variant="label">
              Training phases <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLegend>
            <ToggleGroup
              type="multiple"
              variant="outline"
              value={draft.about.phases}
              onValueChange={(value) => updateAbout({ phases: value as TrainingPhase[] })}
              aria-label="Training phases"
            >
              {FSW_PHASES.map((phase) => (
                <ToggleGroupItem key={phase} value={phase} className="px-4">
                  {PHASE_LABELS[phase]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>Plans only pick it in these phases. Leave all off to allow any.</FieldDescription>
          </FieldSet>

          <Field data-invalid={visibleAbout.tags ? true : undefined}>
            <FieldLabel htmlFor={ids.tags}>
              Tags <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            {draft.about.tags.length > 0 ? (
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tags">
                {draft.about.tags.map((tag) => (
                  <li key={tag}>
                    <Badge variant="secondary" className="gap-1 pr-1">
                      #{tag}
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => updateAbout({ tags: draft.about.tags.filter((entry) => entry !== tag) })}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            <InputGroup className="sm:w-72">
              <InputGroupInput
                id={ids.tags}
                value={tagInput}
                placeholder="e.g. over-unders"
                autoComplete="off"
                disabled={draft.about.tags.length >= LIMITS.tagsMax}
                aria-describedby={ids.tagsHint}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={onTagKeyDown}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="xs" disabled={normalizeTag(tagInput) === ""} onClick={addTag}>
                  Add
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription id={ids.tagsHint}>
              Press Enter to add. Up to {LIMITS.tagsMax}; they become filters in the bank.
            </FieldDescription>
            <FieldError>{visibleAbout.tags}</FieldError>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="min-w-[120px]">
            Next
            <ArrowRight />
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <form className="contents" noValidate onSubmit={(event) => void save(event)}>
      {header}

      <StatStrip stats={stats} label="Workout totals" />
      <div className={cn("transition-opacity", preview ? "opacity-100" : "opacity-50")}>
        <WorkoutProfileChart intervals={intervals} ftpWatts={ftp} heightClass="h-[160px]" />
      </div>
      {!preview && shown ? (
        <p className="-mt-2 m-0 text-xs text-muted-foreground">Fix the highlighted fields to update the profile.</p>
      ) : null}

      {suggested && suggested !== draft.about.primaryZone ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
          <Sparkles className="size-4 text-muted-foreground" />
          <span className="flex-1">
            Most of the work is in <strong>{ZONES[suggested].label}</strong>
            {draft.about.primaryZone ? <> (filed under {ZONES[draft.about.primaryZone].label})</> : null}.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={() => updateAbout({ primaryZone: suggested })}>
            Use {ZONES[suggested].label}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3" role="list" aria-label="Workout blocks">
        {draft.blocks.map((block, index) => (
          <WorkoutBlockEditor
            key={block.key}
            block={block}
            index={index}
            count={draft.blocks.length}
            ftp={ftp}
            errors={errors.blocks[block.key]}
            showErrors={showBlockErrors}
            onChange={(patch) =>
              updateBlocks((blocks) => blocks.map((entry) => (entry.key === block.key ? { ...entry, ...patch } : entry)))
            }
            onMove={(direction) =>
              updateBlocks((blocks) => {
                const next = [...blocks];
                const target = index + direction;
                [next[index], next[target]] = [next[target], next[index]];
                return next;
              })
            }
            onDuplicate={() =>
              updateBlocks((blocks) => [...blocks.slice(0, index + 1), duplicateBlock(block), ...blocks.slice(index + 1)])
            }
            onRemove={() => updateBlocks((blocks) => blocks.filter((entry) => entry.key !== block.key))}
          />
        ))}
      </div>

      <FieldSet>
        <FieldLegend variant="label">Add a block</FieldLegend>
        <div className="flex flex-wrap gap-2">
          {ADDABLE_BLOCKS.map((type) => (
            <Button
              key={type}
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.blocks.length >= LIMITS.blocksMax}
              onClick={() => addBlock(type)}
            >
              <Plus />
              {BLOCK_LABELS[type]}
            </Button>
          ))}
        </div>
      </FieldSet>

      {formErrors.length > 0 ? <FieldError errors={formErrors.map((message) => ({ message }))} /> : null}

      {warnings.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-muted-foreground" aria-label="Suggestions">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {saveError ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      <DialogFooter className="sticky -bottom-6 z-10 -mx-6 -mb-6 rounded-b-lg border-t bg-background px-6 py-4">
        <Button type="button" variant="outline" disabled={saving} onClick={() => setStep("about")}>
          <ArrowLeft />
          Back
        </Button>
        <Button type="submit" className="min-w-[140px]" disabled={saving}>
          {saving ? <Spinner /> : <Check />}
          {mode === "edit" ? "Save changes" : "Save workout"}
        </Button>
      </DialogFooter>
    </form>
  );
};
