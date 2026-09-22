import { useEffect, useState, type ReactElement } from "react";
import type { UpdateProfileRequest, UserProfile } from "@shared/ipc/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  type BleSectionProps,
  SCAN_TIMEOUT_MS,
  candidateForRole,
  deviceLabel,
  roleIcons
} from "./DeviceDrawer";
// Strava step removed for now — see the "strava" step block further down
// (kept commented out, not deleted) and the note on `finishOnboarding`'s
// call sites below.

export type OnboardingFlowProps = {
  ble: BleSectionProps;
  currentFtp: number;
  // Persists whatever subset of fields the current step collected — the same
  // "omitted fields are left alone" IPC contract ProfilePage's Save uses
  // (see ProfileRepository.upsert), so each step can save independently
  // without clobbering what an earlier step already wrote.
  onSaveProfile: (input: UpdateProfileRequest) => Promise<UserProfile>;
  // Marks onboarding_completed_at and returns the app to Home.
  onComplete: () => Promise<void>;
};

type StepId = "welcome" | "ftp" | "pair" | "about";

// Locked flow, docs/onboarding-plan.md §3. Every step after Welcome has a
// Skip and a Back — pairing in particular is exactly the kind of thing that
// can genuinely fail on a first run (trainer off, Bluetooth permission not
// yet granted), and shouldn't be able to strand anyone here.
//
// The "Connect Strava" step that used to close out this flow is disabled for
// now — Strava integration isn't functional yet (no registered OAuth app,
// see StravaService's clientId/clientSecret env vars, plus uploads only ever
// created a bare manual activity with no real ride data). Pair trainer is
// now the last step and finishes onboarding directly. To restore the Strava
// step: add "strava" back to StepId/stepOrder/stepTitles, uncomment its JSX
// block below, and point Pair's two buttons back at goNext() instead of
// finishOnboarding().
const stepOrder: StepId[] = ["welcome", "about", "ftp", "pair"];
const stepTitles: Record<StepId, string> = {
  welcome: "Welcome to Full Send",
  ftp: "What's your FTP?",
  pair: "Pair your trainer",
  about: "About you"
};

/** Legacy field-label styling, matching ProfilePage's own module-level const
    (not exported from there — this is a small enough duplicate that pulling
    it into a shared module isn't worth it yet). */
const fieldLabelClass = "text-[12px] font-normal text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]";
const inputClass = "border-[color:var(--color-divider)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm caret-primary";

const TrainerIcon = roleIcons.power;

export const OnboardingFlow = ({ ble, currentFtp, onSaveProfile, onComplete }: OnboardingFlowProps): ReactElement => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = stepOrder[stepIndex];

  const [ftpInput, setFtpInput] = useState("");
  const [ftpError, setFtpError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [weightInput, setWeightInput] = useState("");
  const [stepSaving, setStepSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const goBack = (): void => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = (): void => setStepIndex((index) => Math.min(stepOrder.length - 1, index + 1));

  // --- FTP step -------------------------------------------------------
  const saveFtpAndContinue = async (watts: number): Promise<void> => {
    setStepSaving(true);
    setFtpError(null);
    try {
      await onSaveProfile({ ftpWatts: watts });
      goNext();
    } catch (error) {
      setFtpError(error instanceof Error ? error.message : "Failed to save FTP.");
    } finally {
      setStepSaving(false);
    }
  };

  const continueFtp = (): void => {
    const trimmed = ftpInput.trim();
    const value = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(value) || value < 100 || value > 600) {
      setFtpError("Enter a number between 100 and 600, or use “I don’t know it yet.”");
      return;
    }
    void saveFtpAndContinue(Math.round(value));
  };

  const useEstimatedFtp = (): void => {
    void saveFtpAndContinue(200);
  };

  // --- Pair trainer step ------------------------------------------------
  const scanning = ble.bleState?.scanning ?? false;
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    setScanStartedAt((prev) => (scanning ? (prev ?? Date.now()) : null));
  }, [scanning]);

  // Cosmetic-only re-render to move the countdown/progress bar, same
  // approach as DeviceDrawer's own timer (see its comment on that effect).
  useEffect(() => {
    if (step !== "pair" || !scanning) return;
    const id = setInterval(() => forceTick((tick) => tick + 1), 200);
    return () => clearInterval(id);
  }, [step, scanning]);

  const powerConnection = ble.bleState ? ble.getRoleConnection(ble.bleState, "power") : null;
  const trainerConnected = powerConnection?.connectedDeviceId != null;
  const connectedTrainer = powerConnection?.connectedDeviceId
    ? (ble.bleState?.discoveredDevices.find((device) => device.id === powerConnection.connectedDeviceId) ?? null)
    : null;
  const trainerConnecting = powerConnection?.lifecycle === "connecting";
  const trainerCandidate = !trainerConnected && ble.bleState ? candidateForRole(ble.bleState, "power") : null;

  const elapsedMs = scanStartedAt ? Date.now() - scanStartedAt : 0;
  const remainingSec = Math.max(0, Math.ceil((SCAN_TIMEOUT_MS - elapsedMs) / 1000));
  const progressPercent = Math.min(100, (elapsedMs / SCAN_TIMEOUT_MS) * 100);

  let trainerStatus: string;
  let trainerAction: ReactElement | null;
  if (trainerConnected) {
    trainerStatus = connectedTrainer ? deviceLabel(connectedTrainer) : "Connected";
    trainerAction = null;
  } else if (trainerConnecting) {
    trainerStatus = "Connecting…";
    trainerAction = (
      <Button disabled className="w-full">
        Connecting…
      </Button>
    );
  } else if (trainerCandidate) {
    trainerStatus = `${deviceLabel(trainerCandidate)} found`;
    trainerAction = (
      <Button
        disabled={ble.actionPending}
        className="w-full"
        onClick={() => void ble.connectToDevice(trainerCandidate.id, "power")}
      >
        Pair
      </Button>
    );
  } else if (scanning) {
    trainerStatus = `Scanning… ${remainingSec}s remaining`;
    trainerAction = (
      <Button disabled className="w-full">
        Scanning…
      </Button>
    );
  } else {
    trainerStatus = "Make sure your trainer is powered on and nearby.";
    trainerAction = (
      <Button disabled={ble.actionPending} className="w-full" onClick={() => void ble.scanForDevices()}>
        Scan for trainer
      </Button>
    );
  }

  // --- About you step -----------------------------------------------------
  const saveAboutYouAndContinue = async (): Promise<void> => {
    setStepSaving(true);
    try {
      const trimmedName = nameInput.trim();
      const trimmedEmail = emailInput.trim();
      const trimmedWeight = weightInput.trim();
      const weightValue = trimmedWeight === "" ? null : Number(trimmedWeight);
      await onSaveProfile({
        name: trimmedName === "" ? null : trimmedName,
        email: trimmedEmail === "" ? null : trimmedEmail,
        weightKg: weightValue !== null && Number.isFinite(weightValue) ? weightValue : null
      });
      goNext();
    } finally {
      setStepSaving(false);
    }
  };

  // --- Finish -----------------------------------------------------------
  const finishOnboarding = async (): Promise<void> => {
    setFinishing(true);
    try {
      await onComplete();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-[560px] flex-col justify-center p-6">
      {/* Welcome is a splash screen, not a counted step — "Get started" moves
          past it before the count starts, so About you is Step 1 (not
          Step 2), out of the 3 real steps (welcome excluded from both the
          numerator and stepOrder.length - 1). */}
      {step !== "welcome" ? (
        <div className="mb-2 text-[11px] font-normal uppercase tracking-[0.1em] text-[color-mix(in_srgb,var(--color-text)_55%,transparent)]">
          Step {stepIndex} of {stepOrder.length - 1}
        </div>
      ) : null}
      <h1 className="m-0 mb-6">{stepTitles[step]}</h1>

      {step === "welcome" ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]">
            Full Send connects to your smart trainer and turns structured workouts, plans, and progress
            tracking into a couple of clicks. Let&rsquo;s get you set up &mdash; this takes less than a
            minute, and every step here can be changed later from Profile.
          </p>
          <Button className="w-full" onClick={goNext}>
            Get started
          </Button>
        </div>
      ) : null}

      {step === "ftp" ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]">
            Your FTP (Functional Threshold Power) sets the intensity of every workout. You can update it
            any time from Profile.
          </p>
          <div className="flex flex-col gap-[5px]">
            <Label htmlFor="onboarding-ftp" className={fieldLabelClass}>
              FTP (watts)
            </Label>
            <Input
              id="onboarding-ftp"
              type="number"
              value={ftpInput}
              onChange={(event) => setFtpInput(event.target.value)}
              placeholder={`e.g. ${currentFtp}`}
              className={inputClass}
              disabled={stepSaving}
            />
          </div>
          {ftpError ? <p className="m-0 text-sm text-destructive">{ftpError}</p> : null}
          <Button className="w-full" onClick={continueFtp} disabled={stepSaving}>
            Continue
          </Button>
          <Button variant="ghost" className="w-full" onClick={useEstimatedFtp} disabled={stepSaving}>
            I don&rsquo;t know it yet &mdash; use an estimate (200W)
          </Button>
        </div>
      ) : null}

      {step === "pair" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border border-[color:var(--color-divider)] bg-muted p-4">
            <TrainerIcon
              size={28}
              strokeWidth={2}
              strokeLinecap="square"
              className={trainerConnected ? "text-[var(--color-text)]" : "text-[var(--color-accent)]"}
            />
            <div>
              <div className="text-[15px] font-semibold">Trainer</div>
              <div className="text-xs text-[var(--color-neutral-700)]">{trainerStatus}</div>
            </div>
          </div>
          {ble.actionError ? <p className="m-0 text-sm text-destructive">{ble.actionError}</p> : null}
          {scanning && step === "pair" ? (
            <Progress value={progressPercent} className="h-1 w-full rounded-none bg-[var(--color-neutral-300)]" />
          ) : null}
          {trainerAction}
          {/* Pair trainer is the last step while Strava is disabled (see the
              type comment above), so both buttons finish onboarding directly
              instead of advancing to a next step. */}
          {trainerConnected ? (
            <Button className="w-full" onClick={() => void finishOnboarding()} disabled={finishing}>
              {finishing ? "Finishing…" : "Finish setup"}
            </Button>
          ) : (
            <Button variant="ghost" className="w-full" onClick={() => void finishOnboarding()} disabled={finishing}>
              {finishing ? "Finishing…" : "Skip and finish"}
            </Button>
          )}
        </div>
      ) : null}

      {step === "about" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-[5px]">
            <Label htmlFor="onboarding-name" className={fieldLabelClass}>
              Name
            </Label>
            <Input
              id="onboarding-name"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              className={inputClass}
              disabled={stepSaving}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <Label htmlFor="onboarding-email" className={fieldLabelClass}>
              Email
            </Label>
            <Input
              id="onboarding-email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              className={inputClass}
              disabled={stepSaving}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <Label htmlFor="onboarding-weight" className={fieldLabelClass}>
              Weight (kg)
            </Label>
            <Input
              id="onboarding-weight"
              type="number"
              value={weightInput}
              onChange={(event) => setWeightInput(event.target.value)}
              className={inputClass}
              disabled={stepSaving}
            />
          </div>
          <Button className="w-full" onClick={() => void saveAboutYouAndContinue()} disabled={stepSaving}>
            Continue
          </Button>
          <Button variant="ghost" className="w-full" onClick={goNext} disabled={stepSaving}>
            Skip
          </Button>
        </div>
      ) : null}

      {/* Strava step disabled for now — see the StepId comment above for how
          to restore it. Left in place rather than deleted.

      {step === "strava" ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-[color-mix(in_srgb,var(--color-text)_70%,transparent)]">
            Connect Strava to publish completed workouts automatically. Optional -- you can do this
            later from Profile instead.
          </p>
          <StravaCard strava={strava} />
          <Button className="w-full" onClick={() => void finishOnboarding()} disabled={finishing}>
            {finishing ? "Finishing..." : "Finish setup"}
          </Button>
        </div>
      ) : null}

      */}

      {step !== "welcome" ? (
        <Button
          variant="ghost"
          className={cn("mt-4 w-fit px-0 text-xs", "hover:bg-transparent")}
          onClick={goBack}
          disabled={stepSaving || finishing}
        >
          Back
        </Button>
      ) : null}
    </main>
  );
};
