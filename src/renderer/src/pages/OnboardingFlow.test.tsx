import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BleConnectionEntry, BleRole, BleState, UserProfile } from "@shared/ipc/contracts";
import type { BleSectionProps } from "./DeviceDrawer";
import { OnboardingFlow } from "./OnboardingFlow";

/* Covers the locked flow in docs/onboarding-plan.md §3: Welcome -> About you
   -> FTP -> Pair trainer -> Finish. The "Connect Strava" step is disabled for
   now (see OnboardingFlow.tsx's StepId comment) — Pair trainer is the last
   step and finishes onboarding directly, which these tests exercise via both
   of its buttons (connected -> "Finish setup", not connected -> "Skip and
   finish"). Every step after Welcome has a working Skip/Back, and each step
   persists through the same onSaveProfile callback App.tsx wires to
   profile.update (never a local-only draft that gets lost if onboarding is
   abandoned partway). */

const idleBleState: BleState = {
  lifecycle: "idle",
  connectedDeviceId: null,
  lastError: null,
  ftmsProfile: null,
  scanning: false,
  discoveredDevices: [],
  liveTelemetry: null,
  connections: {
    heart_rate: { lifecycle: "idle", connectedDeviceId: null, lastError: null },
    cadence: { lifecycle: "idle", connectedDeviceId: null, lastError: null }
  },
  heartRate: null
};

const connectedTrainerState: BleState = {
  ...idleBleState,
  lifecycle: "connected",
  connectedDeviceId: "trainer-1",
  discoveredDevices: [{ id: "trainer-1", name: "KICKR CORE", roles: ["power"] }]
};

const getRoleConnection = (state: BleState, role: BleRole): BleConnectionEntry =>
  role === "power"
    ? { lifecycle: state.lifecycle as BleConnectionEntry["lifecycle"], connectedDeviceId: state.connectedDeviceId, lastError: state.lastError }
    : state.connections[role];

const makeBle = (overrides: Partial<BleSectionProps> = {}): BleSectionProps => ({
  bleState: idleBleState,
  actionError: null,
  actionPending: false,
  scanForDevices: vi.fn().mockResolvedValue(undefined),
  stopScanning: vi.fn().mockResolvedValue(undefined),
  disconnectDevice: vi.fn().mockResolvedValue(undefined),
  disconnectHrDevice: vi.fn().mockResolvedValue(undefined),
  disconnectCadenceDevice: vi.fn().mockResolvedValue(undefined),
  getRoleConnection,
  roleLabel: (role) => role,
  connectToDevice: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

const blankProfile: UserProfile = {
  name: null,
  email: null,
  ftpWatts: null,
  weightKg: null,
  onboardingCompletedAt: null
};

const renderFlow = (overrides: { ble?: Partial<BleSectionProps> } = {}) => {
  const onSaveProfile = vi.fn().mockResolvedValue(blankProfile);
  const onComplete = vi.fn().mockResolvedValue(undefined);
  render(
    <OnboardingFlow
      ble={makeBle(overrides.ble)}
      currentFtp={250}
      onSaveProfile={onSaveProfile}
      onComplete={onComplete}
    />
  );
  return { onSaveProfile, onComplete };
};

describe("OnboardingFlow", () => {
  it("starts on Welcome with no Back button, and Get started advances to About you", async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(screen.getByRole("heading", { name: "Welcome to Full Send" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();
  });

  it("saves whatever About-you fields are filled and advances to FTP", async () => {
    const user = userEvent.setup();
    const { onSaveProfile } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.type(screen.getByLabelText("Name"), "Isaac");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSaveProfile).toHaveBeenLastCalledWith({ name: "Isaac", email: null, weightKg: null });
    expect(await screen.findByRole("heading", { name: "What's your FTP?" })).toBeInTheDocument();
  });

  it("skips About-you without saving anything", async () => {
    const user = userEvent.setup();
    const { onSaveProfile } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "What's your FTP?" })).toBeInTheDocument();
  });

  it("rejects an out-of-range FTP without saving or advancing", async () => {
    const user = userEvent.setup();
    const { onSaveProfile } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.type(screen.getByLabelText("FTP (watts)"), "50");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "What's your FTP?" })).toBeInTheDocument();
    expect(screen.getByText(/between 100 and 600/)).toBeInTheDocument();
  });

  it("saves a valid FTP and advances to the pairing step", async () => {
    const user = userEvent.setup();
    const { onSaveProfile } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.type(screen.getByLabelText("FTP (watts)"), "220");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSaveProfile).toHaveBeenCalledWith({ ftpWatts: 220 });
    expect(await screen.findByRole("heading", { name: "Pair your trainer" })).toBeInTheDocument();
  });

  it("uses the 200W estimate and advances when FTP is unknown", async () => {
    const user = userEvent.setup();
    const { onSaveProfile } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: /use an estimate/ }));

    expect(onSaveProfile).toHaveBeenCalledWith({ ftpWatts: 200 });
    expect(await screen.findByRole("heading", { name: "Pair your trainer" })).toBeInTheDocument();
  });

  it("finishes onboarding from the trainer step when skipped unpaired", async () => {
    const user = userEvent.setup();
    const { onComplete } = renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: /use an estimate/ }));
    expect(await screen.findByRole("heading", { name: "Pair your trainer" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Scan for trainer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip and finish" }));

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("finishes onboarding from the trainer step once a trainer is connected", async () => {
    const user = userEvent.setup();
    const { onComplete } = renderFlow({ ble: { bleState: connectedTrainerState } });

    await user.click(screen.getByRole("button", { name: "Get started" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: /use an estimate/ }));
    expect(await screen.findByRole("heading", { name: "Pair your trainer" })).toBeInTheDocument();

    expect(screen.getByText("KICKR CORE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip and finish" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("counts About you/FTP/Pair as the 3 steps, excluding the Welcome splash", async () => {
    const user = userEvent.setup();
    renderFlow();

    // Welcome is a splash, not a counted step — no "Step X of Y" shown at all.
    expect(screen.queryByText(/^Step \d+ of \d+$/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /use an estimate/ }));
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
  });

  it("Back returns to the previous step", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Welcome to Full Send" })).toBeInTheDocument();
  });
});
