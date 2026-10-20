import { useId, useState, type ReactElement } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Copy, Lock, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import {
  BLOCK_LABELS,
  formatDuration,
  parseDuration,
  parsePercent,
  type BlockDraft,
  type BlockField
} from "../workoutBuilder";
import { zoneFor } from "../zones";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  /** Show the error even if this field hasn't been visited (after Next / Save). */
  showErrors: boolean;
};

/**
 * Errors appear once the rider has left the field, or once they've tried to
 * move on — never while they're still typing the first character.
 */
const useVisibleError = (error: string | undefined, showErrors: boolean) => {
  const [touched, setTouched] = useState(false);
  return { visibleError: touched || showErrors ? error : undefined, onBlur: () => setTouched(true) };
};

const DurationField = ({ label, value, onChange, error, showErrors }: FieldProps): ReactElement => {
  const id = useId();
  const { visibleError, onBlur } = useVisibleError(error, showErrors);
  return (
    <Field data-invalid={visibleError ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          inputMode="numeric"
          placeholder="m:ss"
          autoComplete="off"
          aria-invalid={visibleError ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            onBlur();
            // "10" → "10:00", "90:00" → "1:30:00": show what will be saved.
            const seconds = parseDuration(value);
            if (seconds !== null) onChange(formatDuration(seconds));
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>m:ss</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <FieldError>{visibleError}</FieldError>
    </Field>
  );
};

const PercentField = ({ label, value, onChange, error, showErrors, ftp }: FieldProps & { ftp: number }): ReactElement => {
  const id = useId();
  const hintId = useId();
  const { visibleError, onBlur } = useVisibleError(error, showErrors);
  const percent = parsePercent(value);
  const watts = percent !== null && !error ? Math.round((percent / 100) * ftp) : null;
  const zone = watts !== null ? zoneFor(watts, ftp) : null;
  return (
    <Field data-invalid={visibleError ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={visibleError ? true : undefined}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>% FTP</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {visibleError ? (
        <FieldError>{visibleError}</FieldError>
      ) : (
        <FieldDescription id={hintId} className="flex items-center gap-1.5 text-xs tabular-nums">
          {zone && watts !== null ? (
            <>
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: zone.color }} />
              {watts} W · {zone.name}
            </>
          ) : (
            " "
          )}
        </FieldDescription>
      )}
    </Field>
  );
};

const NumberField = ({
  label,
  value,
  onChange,
  error,
  showErrors,
  unit,
  optional = false
}: FieldProps & { unit: string; optional?: boolean }): ReactElement => {
  const id = useId();
  const { visibleError, onBlur } = useVisibleError(error, showErrors);
  return (
    <Field data-invalid={visibleError ? true : undefined}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={value}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={visibleError ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <FieldError>{visibleError}</FieldError>
    </Field>
  );
};

/** One-line summary for the block header, from whatever currently parses. */
const summarize = (block: BlockDraft): string => {
  if (block.locked) {
    return "Custom pattern";
  }
  const pct = (text: string): string => {
    const value = parsePercent(text);
    return value === null ? "–" : `${value}%`;
  };
  const time = (text: string): string => {
    const seconds = parseDuration(text);
    return seconds === null ? "–" : formatDuration(seconds);
  };
  switch (block.type) {
    case "warmup":
    case "cooldown":
    case "ramp":
      return `${time(block.duration)} · ${pct(block.powerLow)} → ${pct(block.powerHigh)}`;
    case "steady":
      return `${time(block.duration)} · ${pct(block.power)}`;
    case "freeride":
      return `${time(block.duration)} · no target`;
    case "intervals":
      return `${block.repeat || "–"} × ${time(block.onDuration)} @ ${pct(block.onPower)}`;
  }
};

type Props = {
  block: BlockDraft;
  index: number;
  count: number;
  ftp: number;
  errors: Partial<Record<BlockField, string>> | undefined;
  showErrors: boolean;
  onChange: (patch: Partial<BlockDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
};

/** One block of the workout: header with reorder / duplicate / delete, then its fields. */
export const WorkoutBlockEditor = ({
  block,
  index,
  count,
  ftp,
  errors,
  showErrors,
  onChange,
  onMove,
  onDuplicate,
  onRemove
}: Props): ReactElement => {
  const label = BLOCK_LABELS[block.type];
  const position = `${label}, block ${index + 1}`;
  const field = (name: BlockField, fieldLabel: string) => ({
    label: fieldLabel,
    value: block[name],
    onChange: (value: string) => onChange({ [name]: value }),
    error: errors?.[name],
    showErrors
  });
  const hasAdvancedError = Boolean(errors?.cadence || errors?.onCadence || errors?.offCadence);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(block.cadence || block.onCadence || block.offCadence || block.trailingRecovery)
  );
  const keepsExtras = Boolean(block.preserved.surges || block.preserved.textEvents);

  const renderFields = (): ReactElement => {
    if (block.locked) {
      return (
        <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          This block uses a multi-step pattern the builder can't edit yet. It's saved as-is; you can still move or
          remove it.
        </p>
      );
    }
    switch (block.type) {
      case "intervals":
        return (
          <FieldGroup className="gap-4">
            <div className="sm:w-40">
              <NumberField {...field("repeat", "Reps")} unit="×" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DurationField {...field("onDuration", "Work time")} />
              <PercentField {...field("onPower", "Work power")} ftp={ftp} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DurationField {...field("offDuration", "Recovery time")} />
              <PercentField {...field("offPower", "Recovery power")} ftp={ftp} />
            </div>
          </FieldGroup>
        );
      case "steady":
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <DurationField {...field("duration", "Time")} />
            <PercentField {...field("power", "Power")} ftp={ftp} />
          </div>
        );
      case "freeride":
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <DurationField {...field("duration", "Time")} />
          </div>
        );
      case "warmup":
      case "cooldown":
      case "ramp":
        return (
          <div className="grid gap-4 sm:grid-cols-3">
            <DurationField {...field("duration", "Time")} />
            <PercentField {...field("powerLow", "Start power")} ftp={ftp} />
            <PercentField {...field("powerHigh", "End power")} ftp={ftp} />
          </div>
        );
    }
  };

  return (
    <Card className="gap-0 rounded-xl py-0 shadow-xs" role="listitem" aria-label={position}>
      <CardHeader className="flex flex-row items-center gap-3 border-b px-4 py-2.5 [.border-b]:pb-2.5">
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{index + 1}</span>
        <Badge variant="secondary">{label}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground tabular-nums">{summarize(block)}</span>
        <ButtonGroup aria-label={`${position} actions`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${position} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${position} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Duplicate ${position}`} onClick={onDuplicate}>
            <Copy />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${position}`}
            className="hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </ButtonGroup>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 py-4">
        {renderFields()}
        {block.locked ? null : (
          // Forced open once Save has been tried, so an error in here is never hidden.
          <Collapsible open={advancedOpen || (showErrors && hasAdvancedError)} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="group/advanced -ml-2 text-muted-foreground">
                <ChevronDown className="transition-transform group-data-[state=open]/advanced:rotate-180" />
                More options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {block.type === "intervals" ? (
                <FieldGroup className="gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <NumberField {...field("onCadence", "Work cadence")} unit="rpm" optional />
                    <NumberField {...field("offCadence", "Recovery cadence")} unit="rpm" optional />
                  </div>
                  <Field orientation="horizontal">
                    <Checkbox
                      id={`${block.key}-trailing`}
                      checked={block.trailingRecovery}
                      onCheckedChange={(checked) => onChange({ trailingRecovery: checked === true })}
                    />
                    <FieldLabel htmlFor={`${block.key}-trailing`} className="font-normal">
                      Recover after the last rep too
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField {...field("cadence", "Cadence")} unit="rpm" optional />
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
        {keepsExtras ? (
          <p className="m-0 text-xs text-muted-foreground">
            Keeps this block's {block.preserved.surges ? "surges" : ""}
            {block.preserved.surges && block.preserved.textEvents ? " and " : ""}
            {block.preserved.textEvents ? "on-screen messages" : ""} from the original.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
