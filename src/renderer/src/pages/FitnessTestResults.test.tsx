import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FitnessTestRecord, UserProfile } from "@shared/ipc/contracts";
import { hrZonesFor, powerZonesFor } from "@shared/fitnessTest";
import { FitnessTestResults } from "./FitnessTestResults";
import { ProfilePage, type ProfileSectionProps, type StravaSectionProps } from "./ProfilePage";

const record: FitnessTestRecord = {
  id: "t1",
  sessionId: "s1",
  takenAt: "2026-11-05T10:00:00Z",
  appliedAt: null,
  result: {
    variant: "full",
    valid: true,
    flags: [{ code: "ftp-methods-disagree", severity: "info", message: "That's your rider profile showing." }],
    rampStepsCompleted: 13,
    mapWatts: 335,
    ftpRampWatts: 251,
    ftpCappedWatts: 262,
    ftpWatts: 262,
    ftpSource: "capped",
    thresholdHrBpm: 165,
    maxHrBpm: 190,
    hrCapBpm: 171,
    ftpWattsPerKg: 3.49,
    mapWattsPerKg: 4.47,
    vo2maxEst: 55.2,
    ftpToMapRatio: 0.78,
    riderProfile: "balanced",
    powerZones: powerZonesFor(262),
    hrZones: hrZonesFor(165),
    changes: { mapWatts: null, ftpWatts: 22, thresholdHrBpm: null },
    insights: ["Your FTP is 78% of your MAP: a balanced profile."]
  }
};

const profile: UserProfile = {
  name: null,
  email: null,
  ftpWatts: 240,
  weightKg: 75,
  mapWatts: null,
  thresholdHrBpm: null,
  maxHrBpm: null,
  onboardingCompletedAt: null
};

describe("FitnessTestResults", () => {
  it("shows the headline numbers, profile, insights and zones", () => {
    render(<FitnessTestResults record={record} loading={false} error={null} profile={profile} applying={false} onApply={vi.fn()} />);
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    expect(screen.getByText("+22 W · measured")).toBeInTheDocument();
    expect(screen.getByText(/a balanced profile/)).toBeInTheDocument();
    expect(screen.getByText("That's your rider profile showing.")).toBeInTheDocument();
    expect(screen.getByText("245–275 W")).toBeInTheDocument(); // threshold zone at 262 W
  });

  it("applies the metrics the rider keeps checked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FitnessTestResults record={record} loading={false} error={null} profile={profile} applying={false} onApply={onApply} />);

    expect(screen.getByLabelText(/FTP 240 → 262 W/)).toBeChecked();
    await user.click(screen.getByLabelText(/Threshold HR/));
    await user.click(screen.getByRole("button", { name: "Apply to profile" }));
    expect(onApply).toHaveBeenCalledWith({ ftp: true, map: true, thresholdHr: false, maxHr: true });
  });

  it("confirms once applied", () => {
    render(
      <FitnessTestResults
        record={{ ...record, appliedAt: "2026-11-05T11:00:00Z" }}
        loading={false}
        error={null}
        profile={profile}
        applying={false}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText("Applied to your profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to profile" })).not.toBeInTheDocument();
  });

  it("won't offer to apply an invalid test", () => {
    render(
      <FitnessTestResults
        record={{
          ...record,
          result: {
            ...record.result,
            valid: false,
            insights: [],
            flags: [{ code: "too-few-ramp-steps", severity: "blocking", message: "Only 3 ramp steps completed." }]
          }
        }}
        loading={false}
        error={null}
        profile={profile}
        applying={false}
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText("Not valid")).toBeInTheDocument();
    expect(screen.getByText(/didn't produce a valid result/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to profile" })).not.toBeInTheDocument();
  });

  it("shows scoring progress and errors", () => {
    const { rerender } = render(
      <FitnessTestResults record={null} loading error={null} profile={profile} applying={false} onApply={vi.fn()} />
    );
    expect(screen.getByText("Scoring your test…")).toBeInTheDocument();
    rerender(
      <FitnessTestResults record={null} loading={false} error="Boom" profile={profile} applying={false} onApply={vi.fn()} />
    );
    expect(screen.getByText("Boom")).toBeInTheDocument();
  });
});

describe("ProfilePage fitness and zones", () => {
  const profileProps = (overrides: Partial<ProfileSectionProps> = {}): ProfileSectionProps => ({
    profile: { ...profile, thresholdHrBpm: 165 },
    editing: false,
    saving: false,
    error: null,
    nameDraft: "",
    setNameDraft: vi.fn(),
    emailDraft: "",
    setEmailDraft: vi.fn(),
    weightDraft: "",
    setWeightDraft: vi.fn(),
    weightUnit: "kg",
    setWeightUnit: vi.fn(),
    ftpDraft: "",
    setFtpDraft: vi.fn(),
    mapDraft: "",
    setMapDraft: vi.fn(),
    thresholdHrDraft: "",
    setThresholdHrDraft: vi.fn(),
    maxHrDraft: "",
    setMaxHrDraft: vi.fn(),
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides
  });
  const strava = { stravaStatus: null } as unknown as StravaSectionProps;

  it("lists tests, and opens the briefing from Take a fitness test", async () => {
    const user = userEvent.setup();
    const onTakeTest = vi.fn();
    render(
      <ProfilePage currentFtp={240} profile={profileProps()} strava={strava} fitness={{ tests: [record], onTakeTest }} />
    );
    expect(screen.getByText(/Last valid test/)).toHaveTextContent("balanced profile");
    expect(screen.getByRole("cell", { name: "Not applied" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Take a fitness test/ }));
    expect(onTakeTest).toHaveBeenCalled();
  });

  it("fills the zone tables from FTP and threshold HR", () => {
    render(<ProfilePage currentFtp={240} profile={profileProps()} strava={strava} />);
    const power = screen.getByRole("table", { name: "Power zones" });
    expect(within(power).getByText("224–252 W")).toBeInTheDocument();
    const hr = screen.getByRole("table", { name: "Heart-rate zones" });
    expect(within(hr).getByText("Sub-threshold")).toBeInTheDocument();
  });

  it("edits MAP and heart-rate fields like the rest of the profile", () => {
    render(
      <ProfilePage
        currentFtp={240}
        profile={profileProps({ editing: true, mapDraft: "330", thresholdHrDraft: "165" })}
        strava={strava}
      />
    );
    expect(screen.getByLabelText("MAP (watts)")).toHaveValue(330);
    expect(screen.getByLabelText("Threshold heart rate (bpm)")).toBeEnabled();
  });
});
