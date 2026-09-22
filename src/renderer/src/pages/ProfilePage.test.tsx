import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StravaStatus } from "@shared/ipc/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProfilePage, StravaCard, type ProfileSectionProps, type StravaSectionProps } from "./ProfilePage";

/* The "publish to Strava automatically" checkbox replaces a raw
   `<input type="checkbox">` whose inline style undid the stylesheet's
   visually-hidden rule (see PR 4). These tests cover the two things that
   hack put at risk: the page renders a real, correctly-labelled checkbox
   for its current (disabled, unchecked) state, and the shadcn
   Checkbox+Label pairing it uses is genuinely keyboard-operable and toggles
   when it is not disabled. */

const connectedStravaStatus: StravaStatus = {
  connected: true,
  hasConfig: true,
  athleteId: 42,
  tokenExpiresAt: null,
  counts: { pending: 0, success: 0, failed: 0 },
  recentEvents: []
};

const makeStrava = (overrides: Partial<StravaSectionProps> = {}): StravaSectionProps => ({
  stravaStatus: connectedStravaStatus,
  stravaAuthCode: "",
  setStravaAuthCode: vi.fn(),
  stravaAuthState: "",
  setStravaAuthState: vi.fn(),
  stravaAuthUrl: "",
  refreshStravaStatus: vi.fn().mockResolvedValue(undefined),
  startStravaConnect: vi.fn().mockResolvedValue(undefined),
  completeStravaConnect: vi.fn().mockResolvedValue(undefined),
  disconnectStrava: vi.fn().mockResolvedValue(undefined),
  syncStrava: vi.fn().mockResolvedValue(undefined),
  retryStrava: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

const makeProfile = (overrides: Partial<ProfileSectionProps> = {}): ProfileSectionProps => ({
  profile: null,
  editing: false,
  saving: false,
  error: null,
  nameDraft: "",
  setNameDraft: vi.fn(),
  emailDraft: "",
  setEmailDraft: vi.fn(),
  weightDraft: "",
  setWeightDraft: vi.fn(),
  ftpDraft: "",
  setFtpDraft: vi.fn(),
  startEdit: vi.fn(),
  cancelEdit: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

/* Account details went from permanently-disabled placeholders to a real
   edit/save form (profile persistence landed in ProfileService). These
   cover the shape of that interaction — not disabled by default, clicking
   Edit reveals editable fields wired to the drafts App.tsx owns, Save/Cancel
   call back into it, and a persisted profile/error surface correctly. */
describe("ProfilePage account details", () => {
  it("shows persisted values read-only, with an Edit button, when not editing", () => {
    render(
      <ProfilePage
        currentFtp={250}
        profile={makeProfile({
          profile: { name: "Isaac", email: "isaac@example.com", ftpWatts: 250, weightKg: 70, onboardingCompletedAt: null }
        })}
        strava={makeStrava()}
      />
    );

    expect(screen.getByLabelText("Name")).toHaveValue("Isaac");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toHaveValue("isaac@example.com");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("calls startEdit when Edit is clicked", async () => {
    const user = userEvent.setup();
    const profile = makeProfile();
    render(<ProfilePage currentFtp={250} profile={profile} strava={makeStrava()} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(profile.startEdit).toHaveBeenCalledOnce();
  });

  it("shows editable draft fields and Cancel/Save once editing", async () => {
    const user = userEvent.setup();
    const profile = makeProfile({ editing: true, nameDraft: "Isaac" });
    render(<ProfilePage currentFtp={250} profile={profile} strava={makeStrava()} />);

    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toHaveValue("Isaac");
    expect(nameInput).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(profile.save).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(profile.cancelEdit).toHaveBeenCalledOnce();
  });

  it("disables Save/Cancel and shows a saving state while a save is in flight", () => {
    render(
      <ProfilePage
        currentFtp={250}
        profile={makeProfile({ editing: true, saving: true })}
        strava={makeStrava()}
      />
    );

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("surfaces a save error", () => {
    render(
      <ProfilePage
        currentFtp={250}
        profile={makeProfile({ editing: true, error: "FTP must be a number." })}
        strava={makeStrava()}
      />
    );

    expect(screen.getByText("FTP must be a number.")).toBeInTheDocument();
  });
});

/* StravaCard itself is untouched and still real — only its call sites
   (ProfilePage's "Connected services" section, OnboardingFlow's Strava step)
   are commented out while the integration isn't functional yet (see
   StravaService.ts / docs/onboarding-plan.md). These test the component
   directly rather than through ProfilePage, since ProfilePage no longer
   mounts it. */
describe("StravaCard auto-publish checkbox", () => {
  it("renders as a correctly labelled, disabled, unchecked checkbox", () => {
    render(<StravaCard strava={makeStrava()} />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Publish completed workouts to Strava automatically"
    });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });

  it("is absent when Strava isn't connected", () => {
    render(<StravaCard strava={makeStrava({ stravaStatus: { ...connectedStravaStatus, connected: false } })} />);

    expect(
      screen.queryByRole("checkbox", { name: "Publish completed workouts to Strava automatically" })
    ).not.toBeInTheDocument();
  });
});

/* The page currently renders this control disabled (there is no wired-up
   toggle yet), so keyboard/toggle behaviour is verified against the same
   Checkbox+Label composition in an interactive harness rather than against
   a control that can never receive input. */
const InteractiveHarness = () => {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex items-center gap-2.5">
      <Checkbox id="auto-publish" checked={checked} onCheckedChange={(next) => setChecked(next === true)} />
      <Label htmlFor="auto-publish" className="text-[13px] font-normal">
        Publish completed workouts to Strava automatically
      </Label>
    </div>
  );
};

describe("Checkbox + Label composition used by that control", () => {
  it("toggles on click and reflects the new checked state", async () => {
    const user = userEvent.setup();
    render(<InteractiveHarness />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Publish completed workouts to Strava automatically"
    });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("is keyboard-operable via Tab + Space", async () => {
    const user = userEvent.setup();
    render(<InteractiveHarness />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Publish completed workouts to Strava automatically"
    });

    await user.tab();
    expect(checkbox).toHaveFocus();

    await user.keyboard(" ");
    expect(checkbox).toBeChecked();
  });

  it("toggles by clicking its label, since the label targets the checkbox by id", async () => {
    const user = userEvent.setup();
    render(<InteractiveHarness />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Publish completed workouts to Strava automatically"
    });

    await user.click(screen.getByText("Publish completed workouts to Strava automatically"));
    expect(checkbox).toBeChecked();
  });
});
