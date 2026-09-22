# First-run onboarding — implementation plan

Status: locked for implementation · 2026-09-20

Request: what does an onboarding flow need to look like, covering install → first
open → the settings/info a rider has to provide before they can train.

**Locked decisions (§5 below has the full reasoning for each):**
- FTP: skippable, defaults to 200W if unknown — never blocks reaching the app.
- Skipping trainer pairing: no extra nudge — Home just shows the existing
  not-paired indicator, same as it does today for anyone who disconnects.
- Weight, name/email, Strava stay **in** onboarding as optional steps, grouped by
  kind: **"About you"** (name/email/weight, one step, one skip) is separate from
  **Strava connect** (its own step — a distinct OAuth flow, not a form field).
- Goal event is **dropped from onboarding**. It isn't a persisted profile field
  today — PlanPage collects `eventType`/`eventDate` fresh on every plan
  generation — so there's nothing for onboarding to save without also adding new
  goal-event storage, which is out of scope here.
- No "redo setup" action. Once ProfilePage is a real editable form, that's the
  only path to change these fields later — no separate re-entrant onboarding flow
  to build or maintain.
- Local-only, no auth. One profile row per installed app; no login concept
  anywhere else in the codebase to account for.

---

## 1. Tech lead assessment — read this first

**There is currently no onboarding, and almost nothing it would onboard *into*.**
This isn't "add a welcome screen in front of Home" — a few of the fields a normal
onboarding flow would collect don't have anywhere to be stored yet:

- **No user/profile table exists.** `schema.ts` has `metrics_snapshots` (ftp_watts,
  weight_kg, resting_hr, vo2max — a time series for the dashboard trend chart) and
  nothing else. There's no `user_profile` / `app_settings` row anywhere.
- **FTP is a non-persisted React default.** [App.tsx:56](../src/renderer/src/App.tsx#L56)
  does `useState(250)`. Every launch starts at 250 W; nothing reads or writes a real
  value. Every FTP-consuming flow (bank workout compile, adhoc start, event-plan
  generation) is silently working off that in-memory guess until someone changes it
  in that session, and the change doesn't survive a restart.
- **[ProfilePage.tsx](../src/renderer/src/pages/ProfilePage.tsx) is a display shell,
  not a settings page.** Name, Email, Weight, Goal event are `disabled` inputs with
  placeholder "Not yet available." The Edit button is `disabled` with the same
  copy. There is no save path for any of this — building onboarding around this
  page means building the persistence + edit flow at the same time, not reusing
  something that already works.
- **No first-run detection.** `main/index.ts` always boots straight to `HomePage`.
  No flag, no `userData` marker, nothing like the `seedWorkoutBankIfEmpty` pattern
  used for the workout bank's first-run seed.
- **Device pairing already exists and is reusable.** [DeviceDrawer.tsx](../src/renderer/src/pages/DeviceDrawer.tsx)
  is a real, working scan/pair/connect flow for power/HR/cadence over BLE, with a
  documented required-vs-optional distinction (`isRequiredRole` — power only).
  Onboarding should drive this existing component rather than build a second pairing
  UI; it just needs to be reachable from outside the nav-cluster click.
- **Strava connect already exists** on ProfilePage as a working authorize-in-browser
  → paste-code → complete flow. Reusable as-is for an optional "connect services"
  onboarding step.
- **macOS Bluetooth permission is a real first-run event.** `entitlements.mac.plist`
  and `NSBluetoothAlwaysUsageDescription` are set, so the *first* scan attempt is
  what triggers the OS permission dialog — that's effectively part of onboarding
  whether or not it's designed as a step, and the copy explaining it is worth
  owning explicitly rather than letting the OS dialog appear unexplained mid-flow.

**Net: this is a full-slice feature**, same shape as the workout bank build — new
schema, new IPC contracts + handlers, new repository, new renderer state/page(s),
wired into `main/index.ts` bootstrap. Not a UI-only task.

---

## 2. What onboarding needs to collect (and what's actually required to train)

Walking `App.tsx`/`WorkoutBankBrowser`/`EventPlanService` for hard requirements
(not just "nice to have on the profile"):

| Field | Required to start a workout? | Used by |
|---|---|---|
| FTP (watts) | **Yes** — every workout compile/start call takes `ftp` | bank compile, adhoc start, event-plan generation |
| Power source (trainer) paired | **Yes** — `requiredMissing()` gates workout start today | DeviceDrawer / BleService |
| HR monitor, cadence sensor | No — optional roles, app runs without them | telemetry display only |
| Weight (kg) | No — not read anywhere yet (power-to-weight on ProfilePage is hardcoded `—`) | future: power-to-weight display |
| Name / email | No | display only, once ProfilePage is real |
| Goal event (type + date) | No — plan generation works without a saved goal; `eventType`/`eventDate` are entered fresh on PlanPage each time | event-plan generation |
| Weekly availability | No — same as above, entered on PlanPage per plan | event-plan generation |
| Strava connect | No | activity publishing |

So the *minimum viable* onboarding — the thing that actually unblocks "get on the
bike" — is two steps: **FTP** and **pair your trainer**. Everything else (weight,
goal event, availability, Strava) is legitimately optional and arguably belongs on
PlanPage/ProfilePage rather than gating first launch at all.

---

## 3. Locked flow

Reordered 2026-09-21 (was Welcome → FTP → Pair → About you → Strava): About
you now comes right after Welcome, ahead of FTP and pairing.

**Connect Strava removed from the flow entirely, 2026-09-21** (not just
reordered — see §7): the Strava integration isn't functional yet (no
registered OAuth app, and uploads only ever created a bare manual activity
with no real ride data), so it's disabled throughout the app for now, not
just in onboarding. Pair your trainer is the last step and finishes
onboarding directly.

```
First launch (no profile row in DB, or onboarding_completed_at is null)
  1. Welcome
     - App name/purpose one-liner. No input.
  2. About you
     - Name, email, weight (kg). All optional, single Skip for the whole step —
       these are just personal-info fields, no reason to split them further.
  3. FTP
     - Number input, 100–600 (matches existing zod bound).
     - "I don't know it yet" → defaults to 200W, flagged as an estimate,
       editable later from a real ProfilePage.
  4. Pair your trainer → Done → Home
     - Reuse DeviceDrawer's scan/connect for the power role.
     - Last step: both its buttons ("Finish setup" once connected, "Skip and
       finish" otherwise) write the profile row, set onboarding_completed_at,
       and return to Home. Landing on Home afterward with no trainer paired
       looks exactly like it does today for anyone who disconnects — existing
       red nav-cluster indicator, no additional banner/nudge. No re-run
       affordance — later edits happen on ProfilePage once it's a real form.
```

Not a modal you can get trapped in: every step after Welcome needs a Skip, and
Back should work, because BLE pairing is exactly the kind of step that can
genuinely fail on a first run (trainer not powered on, Bluetooth permission not
yet granted) and shouldn't strand the user.

Goal event stays out of this flow entirely — see §5.3.

---

## 4. Scope this implies

**Schema** — new `user_profile` table (singleton row, like a settings table):
`ftp_watts`, `weight_kg`, `name`, `email`, `onboarding_completed_at`, plus room for
the Strava/goal-event fields already sketched on ProfilePage. Migration pattern
matches the existing `ALTER TABLE ... ADD COLUMN` style in `schema.ts`.

**IPC** — `profile.get` / `profile.update` request+result schemas in
`contracts.ts`, handlers in `registerIpcHandlers.ts`, a `ProfileRepository` next to
the existing repositories in `repositories.ts`.

**Main bootstrap** — `main/index.ts` reads the profile row at startup; if absent
(or `onboarding_completed_at` is null), the renderer routes to onboarding instead
of Home before anything else renders in a first-run state — mirrors the DB-path/
seed-on-boot pattern already there for the workout bank.

**Renderer** — a new `pages/OnboardingFlow.tsx` (multi-step) built out of the
existing `Input`/`Button` shadcn primitives and DeviceDrawer's pairing internals;
`App.tsx` gets an `onboarding` route alongside `home`/`plan`/`profile`, gated on
the loaded profile instead of defaulting to `home`.

**ProfilePage** — needs to go from disabled placeholders to a real editable form
wired to the same `profile.update` IPC, since onboarding and "edit profile later"
should be the same persistence path, not two.

This is comparable in size to the device-drawer rebuild (`docs/device-drawer-plan.md`)
plus a schema/IPC slice on top — call it a medium feature, not a quick add.

---

## 5. Decisions and rationale

1. **FTP is skippable, defaults to 200W.** Nothing in onboarding can ever fully
   block someone from reaching the app — matches how every other step behaves.
2. **Skipping pairing gets no special nudge.** Home already has a visible
   not-paired state (red nav-cluster indicator); reusing it instead of adding a
   second signal keeps "not paired" meaning one thing everywhere in the app.
3. **Goal event is dropped from onboarding, not just made optional.** It doesn't
   exist as a persisted concept today — `eventType`/`eventDate` are per-plan
   inputs on PlanPage, not profile fields — so there's nothing to save without
   first designing goal-event storage, which this plan doesn't take on. If a
   persisted "current goal" becomes wanted later, it's a separate scoping pass
   (schema + PlanPage default-from-profile behavior), not an onboarding add-on.
4. **Weight/name/email and Strava are two steps, not three or one.** The
   distinction is kind, not importance: About-you fields are all the same shape
   (optional form inputs, no side effects), Strava is a different shape (external
   OAuth round-trip with its own multi-part UI already built on ProfilePage).
   Grouping by shape keeps each step internally consistent.
5. **No redo-setup action.** ProfilePage becomes the one place these fields are
   edited after first run — building a second, re-entrant path into the same data
   would duplicate the edit UI for no real benefit once ProfilePage works.
6. **Local-only, no auth** — confirmed, matches the rest of the app (BLE devices,
   workouts, plans all assume a single local user with no login anywhere).

---

## 6. Build order

Same shape as `docs/device-drawer-plan.md` — schema and IPC first since the UI
has nothing to write to otherwise:

1. ✅ **Schema** — `user_profile` table (`name`, `email`, `ftp_watts`, `weight_kg`,
   `onboarding_completed_at`) + migration in `schema.ts`.
2. ✅ **Repository + IPC** — `ProfileRepository` in `repositories.ts`;
   `profile.get`/`profile.update`/`profile.completeOnboarding` schemas in
   `contracts.ts`; handlers in `registerIpcHandlers.ts`; `ProfileService` wraps
   the repository (mirrors `StravaService`'s constructor shape) and is wired into
   `main/index.ts`. `ProfileRepository.upsert` ended up doing real per-column
   partial updates (an omitted field leaves the column alone; a field present as
   `null` clears it) rather than the `COALESCE` approach first sketched — needed
   once ProfilePage's Save could legitimately clear a field, not just skip one.
3. ✅ **Renderer bootstrap** — `App.tsx` loads the profile on mount
   (`loadProfile`, next to the existing `refreshDashboard`/`eventPlan.getCurrent`
   mount effects) and seeds `currentFtp` from `ftp_watts` when a row exists,
   replacing the old always-250 default. Note: this is *only* the load — the
   actual onboarding-needed gate/route still doesn't exist (that's step 6, and
   depends on `OnboardingFlow.tsx` in step 5 existing to route to).
4. ✅ **ProfilePage → real form.** Name/Email/FTP/Weight are editable via a
   page-level Edit → Cancel/Save affordance (drafts owned by `App.tsx`,
   `profile.update` on Save). Personal-stats Weight and Power-to-weight cards
   now show real values instead of a permanent `—`. Goal event is untouched —
   correctly still a disabled placeholder, since §5.3 dropped it from having any
   persisted storage at all.
5. ✅ **`OnboardingFlow.tsx`** — the flow in §3, built from existing
   `Input`/`Button` primitives. The pairing step reuses `DeviceDrawer`'s
   `candidateForRole`/`deviceLabel`/`SCAN_TIMEOUT_MS` (newly exported for this)
   against the power role only, rather than embedding the full three-role
   drawer with its own Close/Escape/click-outside chrome, which doesn't fit an
   onboarding step. The Strava step reuses `ProfilePage`'s card exactly —
   pulled out into an exported `StravaCard` component so both call sites
   render identically instead of one being a hand-copied duplicate.
6. ✅ **`App.tsx` routing.** `loadProfile`'s mount effect routes into
   `"onboarding"` when `onboardingCompletedAt == null`; `Nav`/`DeviceDrawer`
   chrome is hidden for that page (onboarding isn't a fourth nav destination,
   and hiding them means there's nowhere to accidentally navigate away to
   mid-flow). `completeOnboarding()` calls `profile.completeOnboarding` and
   returns to `"home"`. `bleSectionProps`/`stravaSectionProps` were factored
   out of the render so `DeviceDrawer`/`ProfilePage` and `OnboardingFlow` share
   one object instead of two independently-maintained copies.

All 6 build-order steps are done. Remaining/deferred, not part of this pass:
a "redo setup" action (deliberately out of scope, §5.5); a persisted
`ftp_is_estimate`-style flag for the FTP step's 200W default (the copy says
"estimate" in the moment, but nothing distinguishes it from a real value once
saved — a cosmetic gap, not a functional one, and not worth a schema column
for); and goal-event storage (deliberately dropped, §5.3).

---

## 7. Strava disabled throughout the app, 2026-09-21

Gap analysis (from the conversation that led to this): `StravaService.ts`'s
OAuth exchange, token refresh/encryption, and sync/retry logic are all real,
not stubs. What's actually missing is (a) a registered Strava OAuth app —
`clientId`/`clientSecret` read from env vars that aren't set, so `connect()`
throws immediately; (b) the default redirect URI
(`urn:ietf:wg:oauth:2.0:oob`) doesn't match how Strava's OAuth actually works
— it needs a real `http://localhost`-style URI matching a registered
Authorization Callback Domain; and (c) uploads only ever POST to Strava's
manual-activity endpoint (`/activities`) with a name/duration/"trainer" flag
— no FIT/TCX file, so a synced ride shows up on Strava with no power graph,
map, or real telemetry.

Rather than leave a feature visible that doesn't work, every UI entry point
that lets a user trigger Strava code was disabled (commented out, not
deleted) while the backend stays wired for whenever this gets picked back
up:

- **`OnboardingFlow.tsx`** — the "Connect Strava" step is gone from
  `StepId`/`stepOrder`; its JSX block is commented out in place. Pair your
  trainer is now the last step and calls `finishOnboarding()` directly (see
  §3).
- **`ProfilePage.tsx`** — the "Connected services" section
  (`<StravaCard strava={strava} />`) is commented out. `StravaCard` itself
  (in the same file) is untouched and still a real, working component —
  only this call site is disabled, so restoring it later is a single
  uncomment.
- **`RidePage.tsx`** — the "Post this workout to Strava" checkbox on the
  ride-finish dialog is commented out; `Done` always calls
  `finishRide(false)` now.
- **`App.tsx`** — `finishRide`'s `if (postToStrava) { await syncStrava(); }`
  branch is now unreachable (RidePage never passes `true`) but left in
  place, not rewritten, since restoring the checkbox restores the behavior
  for free.

**Deliberately left untouched**, since nothing above can reach them anymore
and they're real, tested infrastructure, not stubs: `StravaService.ts`,
`registerIpcHandlers.ts`'s `strava.*` handlers, the `strava` schemas in
`contracts.ts`, the preload bridge, and `StravaService`'s instantiation in
`main/index.ts`. Tests for the now-unreachable UI (the old "Connect Strava"
onboarding step, `RidePage`'s checkbox) were removed or commented out to
match; `StravaCard`'s own tests were pointed at rendering it directly instead
of through `ProfilePage`, since it's still a real component, just unmounted.
