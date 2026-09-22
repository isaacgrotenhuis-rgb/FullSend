import type { Repositories } from "@main/database/repositories";
import type { UpdateProfileRequest, UserProfile } from "@shared/ipc/contracts";

type ProfileRow = {
  name: string | null;
  email: string | null;
  ftp_watts: number | null;
  weight_kg: number | null;
  onboarding_completed_at: string | null;
};

// Returned when no row has been written yet (first launch, before onboarding
// runs) — an object rather than null so callers never have to null-check the
// whole profile, only its individual fields.
const emptyProfile: UserProfile = {
  name: null,
  email: null,
  ftpWatts: null,
  weightKg: null,
  onboardingCompletedAt: null
};

const toProfile = (row: ProfileRow | undefined): UserProfile => {
  if (!row) return emptyProfile;
  return {
    name: row.name,
    email: row.email,
    ftpWatts: row.ftp_watts,
    weightKg: row.weight_kg,
    onboardingCompletedAt: row.onboarding_completed_at
  };
};

export class ProfileService {
  constructor(private readonly repositories: Repositories) {}

  getProfile(): UserProfile {
    return toProfile(this.repositories.profile.get() as ProfileRow | undefined);
  }

  updateProfile(input: UpdateProfileRequest): UserProfile {
    // Forward as-is, not spread into a fixed literal — a literal would set
    // every key (even ones the caller omitted), which defeats
    // ProfileRepository.upsert's omitted-vs-null distinction.
    this.repositories.profile.upsert(input);
    return this.getProfile();
  }

  completeOnboarding(): UserProfile {
    this.repositories.profile.completeOnboarding();
    return this.getProfile();
  }
}
