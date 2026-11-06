import { useEffect, useState, type ReactElement } from "react";
import { CircleCheck, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { ApplyFitnessTestRequest, FitnessTestRecord, UserProfile } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ApplyChoice = ApplyFitnessTestRequest["apply"];

type Props = {
  record: FitnessTestRecord | null;
  loading: boolean;
  error: string | null;
  /** The profile before applying, for "from → to" and to hide no-op choices. */
  profile: UserProfile | null;
  applying: boolean;
  onApply: (choice: ApplyChoice) => void;
};

const profileLabels = {
  anaerobic: "Punchy / anaerobic",
  balanced: "Balanced",
  aerobic: "Diesel / aerobic"
} as const;

const formatChange = (change: number | null | undefined, unit: string): string | null => {
  if (change === null || change === undefined) return null;
  if (change === 0) return `no change`;
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} ${unit}`;
};

const Headline = ({
  label,
  value,
  unit,
  change,
  note
}: {
  label: string;
  value: number | null;
  unit: string;
  change: string | null;
  note?: string;
}): ReactElement => (
  <div className="flex flex-col gap-1 rounded-lg border border-foreground/15 bg-muted p-3">
    <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
    <div className="text-3xl leading-none font-extrabold tabular-nums">
      {value ?? <span className="text-muted-foreground/60">–</span>}
      <span className="ml-1 text-base font-semibold text-muted-foreground">{unit}</span>
    </div>
    <div className="min-h-4 text-xs text-muted-foreground">
      {[change, note].filter(Boolean).join(" · ")}
    </div>
  </div>
);

/**
 * The fitness-test result: headline FTP / MAP / threshold HR with changes,
 * rider profile, warnings, plain-language insights, new zones, and an explicit
 * "Apply to profile" with per-metric choices. Nothing is written until the
 * rider applies.
 */
export const FitnessTestResults = ({ record, loading, error, profile, applying, onApply }: Props): ReactElement => {
  const result = record?.result ?? null;
  const [choice, setChoice] = useState<ApplyChoice>({ ftp: true, map: true, thresholdHr: true, maxHr: true });
  useEffect(() => {
    setChoice({ ftp: true, map: true, thresholdHr: true, maxHr: true });
  }, [record?.id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Scoring your test…
      </div>
    );
  }
  if (error || !result || !record) {
    return <p className="m-0 text-sm text-destructive">{error ?? "No result for this test."}</p>;
  }

  const options: Array<{ key: keyof ApplyChoice; label: string; value: number | null; current: number | null; unit: string }> = [
    { key: "ftp", label: "FTP", value: result.ftpWatts, current: profile?.ftpWatts ?? null, unit: "W" },
    { key: "map", label: "MAP", value: result.mapWatts, current: profile?.mapWatts ?? null, unit: "W" },
    { key: "thresholdHr", label: "Threshold HR", value: result.thresholdHrBpm, current: profile?.thresholdHrBpm ?? null, unit: "bpm" },
    // Max HR only ever goes up from a test (see FitnessTestService.apply).
    {
      key: "maxHr",
      label: "Max HR",
      value:
        result.maxHrBpm !== null && (profile?.maxHrBpm == null || result.maxHrBpm > profile.maxHrBpm) ? result.maxHrBpm : null,
      current: profile?.maxHrBpm ?? null,
      unit: "bpm"
    }
  ];
  const available = options.filter((option) => option.value !== null && option.value !== option.current);
  const anyChosen = available.some((option) => choice[option.key]);

  return (
    <section aria-label="Fitness test results" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-lg font-extrabold">Your results</h3>
        {result.riderProfile ? <Badge variant="secondary">{profileLabels[result.riderProfile]}</Badge> : null}
        {!result.valid ? <Badge variant="destructive">Not valid</Badge> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Headline
          label="FTP"
          value={result.ftpWatts}
          unit="W"
          change={formatChange(result.changes?.ftpWatts, "W")}
          note={
            result.ftpSource === "capped"
              ? "measured"
              : result.ftpSource === "ramp"
                ? "ramp estimate"
                : undefined
          }
        />
        <Headline label="MAP" value={result.mapWatts} unit="W" change={formatChange(result.changes?.mapWatts, "W")} />
        <Headline
          label="Threshold HR"
          value={result.thresholdHrBpm}
          unit="bpm"
          change={formatChange(result.changes?.thresholdHrBpm, "bpm")}
        />
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {[
          ["FTP W/kg", result.ftpWattsPerKg?.toFixed(2)],
          ["MAP W/kg", result.mapWattsPerKg?.toFixed(2)],
          ["VO₂max (est.)", result.vo2maxEst !== null ? `${Math.round(result.vo2maxEst)}` : null],
          ["Max HR seen", result.maxHrBpm !== null ? `${result.maxHrBpm} bpm` : null]
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 font-bold tabular-nums">{value ?? "–"}</dd>
          </div>
        ))}
      </dl>

      {result.flags.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {result.flags.map((flag) => (
            <li
              key={flag.code}
              className={cn(
                "flex items-start gap-2",
                flag.severity === "blocking" ? "text-destructive" : flag.severity === "warning" ? "" : "text-muted-foreground"
              )}
            >
              {flag.severity === "info" ? (
                <Info className="mt-0.5 size-4 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              )}
              {flag.message}
            </li>
          ))}
        </ul>
      ) : null}

      {result.insights.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 rounded-lg border border-foreground/15 bg-background p-3 text-sm">
          {result.insights.map((insight) => (
            <li key={insight} className="flex items-start gap-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
              {insight}
            </li>
          ))}
        </ul>
      ) : null}

      {result.powerZones.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ZoneTable
            title="Power zones"
            rows={result.powerZones.map((zone) => ({
              label: zone.label,
              range: zone.maxWatts === null ? `${zone.minWatts}+ W` : `${zone.minWatts}–${zone.maxWatts} W`
            }))}
          />
          {result.hrZones ? (
            <ZoneTable
              title="Heart-rate zones"
              rows={result.hrZones.map((zone) => ({
                label: zone.label,
                range: zone.maxBpm === null ? `${zone.minBpm}+ bpm` : `${zone.minBpm}–${zone.maxBpm} bpm`
              }))}
            />
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-foreground/15 bg-muted p-3">
        {record.appliedAt ? (
          <p className="m-0 flex items-center gap-2 text-sm font-semibold">
            <CircleCheck className="size-4 text-primary" />
            Applied to your profile.
          </p>
        ) : !result.valid ? (
          <p className="m-0 text-sm text-muted-foreground">
            This test didn't produce a valid result, so your profile wasn't changed. Re-test when you're fresh.
          </p>
        ) : available.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">Your profile already matches this result.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold">Update your profile with:</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {available.map((option) => (
                <div key={option.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`apply-${option.key}`}
                    checked={choice[option.key]}
                    onCheckedChange={(checked) => setChoice((prev) => ({ ...prev, [option.key]: checked === true }))}
                  />
                  <Label htmlFor={`apply-${option.key}`} className="text-sm font-normal">
                    {option.label}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      {option.current !== null ? `${option.current} → ` : ""}
                      {option.value} {option.unit}
                    </span>
                  </Label>
                </div>
              ))}
            </div>
            <div>
              <Button
                disabled={applying || !anyChosen}
                onClick={() =>
                  onApply({
                    ftp: choice.ftp && available.some((option) => option.key === "ftp"),
                    map: choice.map && available.some((option) => option.key === "map"),
                    thresholdHr: choice.thresholdHr && available.some((option) => option.key === "thresholdHr"),
                    maxHr: choice.maxHr && available.some((option) => option.key === "maxHr")
                  })
                }
              >
                {applying ? "Applying…" : "Apply to profile"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const ZoneTable = ({ title, rows }: { title: string; rows: Array<{ label: string; range: string }> }): ReactElement => (
  <div>
    <div className="mb-1 text-xs font-semibold text-muted-foreground">{title}</div>
    <Table>
      <TableHeader className="sr-only">
        <TableRow>
          <TableHead>Zone</TableHead>
          <TableHead>Range</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.label}>
            <TableCell className="py-1 pl-0 text-sm">
              <span className="mr-2 text-muted-foreground tabular-nums">Z{index + 1}</span>
              {row.label}
            </TableCell>
            <TableCell className="py-1 pr-0 text-right text-sm tabular-nums">{row.range}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);
