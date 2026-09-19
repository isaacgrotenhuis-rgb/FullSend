import type { ReactElement } from "react";
import type { StravaStatus, StravaSyncEventSummary } from "@shared/ipc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type StravaSectionProps = {
  stravaStatus: StravaStatus | null;
  stravaAuthCode: string;
  setStravaAuthCode: (value: string) => void;
  stravaAuthState: string;
  setStravaAuthState: (value: string) => void;
  stravaAuthUrl: string;
  refreshStravaStatus: () => Promise<void>;
  startStravaConnect: () => Promise<void>;
  completeStravaConnect: () => Promise<void>;
  disconnectStrava: () => Promise<void>;
  syncStrava: () => Promise<void>;
  retryStrava: (event: StravaSyncEventSummary) => Promise<void>;
};

type Props = {
  currentFtp: number;
  strava: StravaSectionProps;
};

const trainingZoneNames = [
  "Recovery",
  "Endurance",
  "Tempo",
  "Threshold",
  "VO2 max",
  "Anaerobic",
  "Neuromuscular"
];

/** Legacy `.card-meta`: small flex row of muted 11px text. */
const cardMetaClass = "flex items-center gap-1.5 text-[11px] text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]";

/** Legacy `.card-title`. */
const cardTitleClass = "text-[17px] font-extrabold leading-[1.2]";

/** Legacy `.field > label`: small muted label above a form control. */
const fieldLabelClass = "text-[12px] font-normal text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]";

/** Legacy `.input`. */
const inputClass = "border-[color:var(--color-divider)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm caret-primary";

/** Legacy `.tag`, minus its color variant (applied per call site below). */
const tagClass = "rounded-sm border-transparent px-2.5 py-[3px] text-[11px] font-normal tracking-[0.02em]";

/** Legacy `.card`, flattened: no border/shadow, muted surface, small gap/padding. */
const cardClass = "gap-2 rounded-md border-0 bg-muted p-3 shadow-none";

/** The "Personal stats" grid draws hairline seams from a divider-colored
    background peeking through a 2px gap between opaque cells. Rounding each
    cell (the theme default) would leave visible notches at every seam where
    two rounded corners meet, so this shared cell class — reused by all three
    cells below, not repeated as three separate one-off overrides — keeps
    them square instead. */
const seamCellClass = "gap-2 rounded-none border-0 bg-muted p-3 shadow-none";

const zoneHeadClass =
  "h-auto p-2 text-[11px] font-normal uppercase tracking-[0.08em] text-[color-mix(in_srgb,var(--color-text)_60%,transparent)]";
const zoneCellClass = "p-2";
const zoneMutedCellClass = "text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]";
const zoneRowClass = "border-[color:var(--color-divider)]";

export const ProfilePage = ({ currentFtp, strava }: Props): ReactElement => {
  const stravaConnected = strava.stravaStatus?.connected ?? false;

  return (
    <main className="mx-auto max-w-[960px] p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="m-0">Profile</h1>
        <Button disabled title="Account details aren't editable yet">
          Edit
        </Button>
      </div>

      <h2>Account details</h2>
      <Separator className="my-4 h-[2px] bg-[var(--color-divider)]" />
      <div className="mb-8 grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-[5px]">
          <Label className={fieldLabelClass}>Name</Label>
          <Input value="" disabled placeholder="Not yet available" className={inputClass} />
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label className={fieldLabelClass}>Email</Label>
          <Input value="" disabled placeholder="Not yet available" className={inputClass} />
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label className={fieldLabelClass}>Weight (kg)</Label>
          <Input value="" disabled placeholder="Not yet available" className={inputClass} />
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label className={fieldLabelClass}>Goal event</Label>
          <Input value="" disabled placeholder="Not yet available" className={inputClass} />
        </div>
      </div>

      <h2>Connected services</h2>
      <Separator className="my-4 h-[2px] bg-[var(--color-divider)]" />
      {/* Deliberate visual change: this card used to override its radius to
          0 (a square corner surviving PR 1's token flip). Removed so it
          picks up the hybrid theme's rounded-md, matching every other
          surface. */}
      <Card className={cn(cardClass, "mb-8")}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className={cardTitleClass}>Strava</div>
            <div className={cn(cardMetaClass, "mt-1")}>
              <Badge
                className={cn(
                  tagClass,
                  stravaConnected
                    ? "bg-[var(--color-accent-100)] text-[var(--color-accent-800)]"
                    : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-800)]"
                )}
              >
                {stravaConnected ? "Connected" : "Not connected"}
              </Badge>
              {stravaConnected && strava.stravaStatus?.athleteId ? <span>Athlete {strava.stravaStatus.athleteId}</span> : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="h-auto px-2.5 py-1 text-xs" onClick={() => void strava.refreshStravaStatus()}>
              Refresh
            </Button>
            {stravaConnected ? (
              <Button variant="outline" className="h-auto px-2.5 py-1 text-xs" onClick={() => void strava.disconnectStrava()}>
                Disconnect
              </Button>
            ) : (
              <Button className="h-auto px-2.5 py-1 text-xs" onClick={() => void strava.startStravaConnect()}>
                Connect
              </Button>
            )}
            {stravaConnected ? (
              <Button className="h-auto px-2.5 py-1 text-xs" onClick={() => void strava.syncStrava()}>
                Sync now
              </Button>
            ) : null}
          </div>
        </div>

        {!stravaConnected && strava.stravaAuthUrl ? (
          <>
            <Separator className="my-3 h-[2px] bg-[var(--color-divider)]" />
            <p className={cn(cardMetaClass, "mb-2")}>
              Authorize in the browser, then paste the returned code below.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-1 flex-col gap-[5px]">
                <Label htmlFor="strava-auth-code" className={fieldLabelClass}>
                  Authorization code
                </Label>
                <Input
                  id="strava-auth-code"
                  className={inputClass}
                  value={strava.stravaAuthCode}
                  onChange={(event) => strava.setStravaAuthCode(event.target.value)}
                />
              </div>
              <Button variant="outline" onClick={() => void strava.completeStravaConnect()}>
                Complete connect
              </Button>
            </div>
          </>
        ) : null}

        {stravaConnected ? (
          <>
            <Separator className="my-3 h-[2px] bg-[var(--color-divider)]" />
            <div className="flex items-center gap-2.5">
              <Checkbox id="strava-auto-publish" checked={false} disabled />
              <Label htmlFor="strava-auto-publish" className="text-[13px] font-normal">
                Publish completed workouts to Strava automatically
              </Label>
            </div>
          </>
        ) : null}

        {strava.stravaStatus && strava.stravaStatus.recentEvents.length > 0 ? (
          <>
            <Separator className="my-3 h-[2px] bg-[var(--color-divider)]" />
            <div className="flex flex-col gap-1">
              {strava.stravaStatus.recentEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between text-xs">
                  <span>
                    <Badge
                      className={cn(
                        tagClass,
                        "mr-1.5",
                        event.syncStatus === "failed"
                          ? "border border-[color:var(--color-accent)] bg-transparent text-primary"
                          : "bg-[var(--color-neutral-100)] text-[var(--color-neutral-800)]"
                      )}
                    >
                      {event.syncStatus}
                    </Badge>
                    {event.eventType} · {event.message ?? "No message"}
                  </span>
                  {event.syncStatus === "failed" ? (
                    <Button
                      variant="ghost"
                      className="h-auto px-1.5 py-0.5 text-[11px]"
                      onClick={() => void strava.retryStrava(event)}
                    >
                      Retry
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Card>

      <h2>Personal stats</h2>
      <Separator className="my-4 h-[2px] bg-[var(--color-divider)]" />
      <div className="mb-8 grid grid-cols-3 gap-0.5 bg-[var(--color-divider)]">
        <Card className={seamCellClass}>
          <div className="text-[10px] tracking-[0.1em] uppercase text-primary">Current FTP</div>
          <div className={cn(cardTitleClass, "text-[28px]")}>{currentFtp} W</div>
        </Card>
        <Card className={seamCellClass}>
          <div className="text-[10px] tracking-[0.1em] uppercase text-primary">Weight</div>
          <div className={cn(cardTitleClass, "text-[28px] opacity-40")}>—</div>
        </Card>
        <Card className={seamCellClass}>
          <div className="text-[10px] tracking-[0.1em] uppercase text-primary">Power-to-weight</div>
          <div className={cn(cardTitleClass, "text-[28px] opacity-40")}>—</div>
        </Card>
      </div>

      <h2>Training zones</h2>
      <Separator className="my-4 h-[2px] bg-[var(--color-divider)]" />
      <Table className="mb-8">
        <TableHeader>
          <TableRow className={cn(zoneRowClass, "border-b-2 hover:bg-transparent")}>
            {["Zone", "Name", "Range", "Power"].map((heading) => (
              <TableHead key={heading} className={zoneHeadClass}>
                {heading}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {trainingZoneNames.map((name, index) => (
            <TableRow key={name} className={zoneRowClass}>
              <TableCell className={zoneCellClass}>{index + 1}</TableCell>
              <TableCell className={zoneCellClass}>{name}</TableCell>
              <TableCell className={cn(zoneCellClass, zoneMutedCellClass)}>—</TableCell>
              <TableCell className={cn(zoneCellClass, zoneMutedCellClass)}>—</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </main>
  );
};
