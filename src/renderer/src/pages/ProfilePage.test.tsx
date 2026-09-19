import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StravaStatus } from "@shared/ipc/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProfilePage, type StravaSectionProps } from "./ProfilePage";

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

describe("ProfilePage Strava auto-publish checkbox", () => {
  it("renders as a correctly labelled, disabled, unchecked checkbox", () => {
    render(<ProfilePage currentFtp={250} strava={makeStrava()} />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Publish completed workouts to Strava automatically"
    });
    expect(checkbox).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });

  it("is absent when Strava isn't connected", () => {
    render(
      <ProfilePage
        currentFtp={250}
        strava={makeStrava({ stravaStatus: { ...connectedStravaStatus, connected: false } })}
      />
    );

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
