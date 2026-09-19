# Device drawer redesign — implementation plan

Status: locked for implementation · 2026-09-15

Source design: `Home screen redesign concepts.zip` → `design_handoff_device_drawer/`
(concept **4b** of the "Home Status Concepts" wireframe exploration). This plan reads
that handoff, maps it onto the current codebase, and calls out where the design
assumes behavior the app doesn't have yet.

Replaces the always-visible **Devices** card on Home (`HomePage.tsx` lines 193–320)
with a nav-triggered drawer, so **Training status** can take the full content width.
Nothing else about Home changes.

**v1 scope, locked 2026-09-15** (see §8 for the full rationale on each):
- Icons: add `lucide-react` — this is the app's first icon dependency.
- Auto-open: **not shipped in v1.** Drawer only opens on an explicit click of the nav
  cluster. The handoff's auto-open rules move to a deferred/future item.
- "Forget": ships as a plain alias for the existing `Disconnect` action, using the
  label "Forget" in the drawer to match the mock. No new persistence or
  auto-reconnect suppression in v1.
- Optional device (HR/cadence) missing: signaled by the existing per-icon dimming
  spec only (grey icon in both the cluster and the drawer) — never escalates the
  cluster to its red "attention" variant and never drives any open behavior. Trainer
  remains the only device that does either of those things.

---

## 1. Tech lead assessment — read this first

**The design is well-specified and mostly free.** `styles.css` in this repo is
already "Modernist" (same token names, same hex values, same 0-radius/Archivo/2px-rule
language as the handoff's reference stylesheet — it was ported from
`docs/design/fullsend/`, the same source family this mock came from). `.btn-primary`,
`.btn-secondary`, `.btn-ghost`, `.btn-block` already exist with the right semantics.
This is a near-zero-translation job on the visual side — the actual work is in state
and interaction, not styling.

**Three places the design assumes behavior the app doesn't have. These are real
scope, not implementation detail:**

1. **"Required vs optional" doesn't exist as a concept.** Today the only gate is
   `bleState?.connectedDeviceId == null` sprinkled across `App.tsx` /
   `WorkoutPreviewDialog.tsx` before allowing a workout to start — power/trainer is
   *implicitly* required by convention. Fine to keep implicit (hardcode
   `role === "power"`); no schema change needed. Flagging so it isn't mistaken for a
   refactor of something that already existed.

2. **Per-cell scan/pair doesn't match the current scan model.** The mock has each
   grid cell own its own `Scan` → that cell's own found device → `Pair`. The current
   implementation is one global `Scan` button that populates a single flat
   "Available devices" list, each with a row of `+ Power`/`+ Heart rate`/`+ Cadence`
   buttons per discovered device. Only one physical scan can run at a time regardless
   of UI (BLE hardware constraint), so the drawer has to *fake* per-cell scanning: one
   scan runs, and each cell's UI reacts by filtering `discoveredDevices` down to
   devices whose `roles` include that cell's role. This is a genuine (small) rewrite
   of the connect flow, not a copy of existing markup into new boxes.

3. **"Forget" doesn't exist.** No persisted known-device / bonding list is surfaced
   today — `BleService` tracks `lastConnectedDeviceId` only for its own in-memory
   auto-reconnect backoff. Before building a real "Forget", decide what it means (see
   Open decisions §8.1). Building it wrong is worse than deferring it — recommend
   shipping "Forget" as a plain `Disconnect` alias in v1 and scoping true forget/unpair
   as a follow-up once product confirms the semantics.

**Everything else in the handoff — the cluster button, the drawer shell, the grid,
copy, colors, states 1–5 — is straightforward to build against this codebase as
specified.**

---

## 2. Data model

No IPC/contract changes required for the core drawer. Everything needed already
exists in `BleState` (`src/shared/ipc/contracts.ts` lines 163–184).

New **renderer-only** state, added in `App.tsx` next to the existing `bleState`
declarations (around line 65-67):

```ts
const [drawerOpen, setDrawerOpen] = useState(false);
```

No auto-open state in v1 (locked decision — see header and §8.2): the drawer only
opens on an explicit click, so there's no "shown once this session" flag to track.

Derived values (computed where needed, not stored):

```ts
const REQUIRED_ROLES: readonly BleRole[] = ["power"]; // hardcode; see §1.1

const requiredMissing = (state: BleState | null): boolean =>
  state ? state.connectedDeviceId === null : true;

const connectedCount = (state: BleState | null): number =>
  state
    ? [
        state.connectedDeviceId !== null,
        state.connections.heart_rate.connectedDeviceId !== null,
        state.connections.cadence.connectedDeviceId !== null
      ].filter(Boolean).length
    : 0;
```

`requiredMissing` drives the cluster's red/neutral variant and reuses the exact gate
already applied to "Start workout" elsewhere — no new source of truth for that
boolean, just a shared helper.

---

## 3. Renderer components

### `DeviceStatusCluster` — new, in `Nav.tsx` or a sibling file

- Single `<button>` in the nav's right cell, next to the existing profile
  `.btn.btn-icon` (`Nav.tsx` line 24). The nav's 3-column grid (`1fr auto 1fr`) needs
  its right cell to hold two elements now — wrap both in a flex row rather than
  widening the grid template, to avoid re-centering the segmented control.
- Props: `bleState: BleState | null`, `drawerOpen: boolean`, `onToggle: () => void`.
- Three 16×16 icons (trainer/heart/cadence, stroke 2.5) + caret, colored per
  `requiredMissing` per §1's two variants, with connected/not-connected dimming
  applied **per icon** regardless of variant (this is what carries the optional-device
  signal — see §8.3). Icons come from `lucide-react` (`Zap`, `Heart`, `RefreshCw`) —
  the app's first icon dependency (locked decision, §8.4); every other icon in the
  codebase today is a hand-rolled inline `<svg>`, so this is a deliberate exception
  going forward, not an inconsistency to "fix" later.
- `aria-expanded={drawerOpen}`, `aria-controls="device-drawer"`,
  `aria-label` built from `connectedCount`/`requiredMissing` per the handoff's spec
  (`Devices: 1 of 3 connected, trainer not connected`).

### `DeviceDrawer` — new file, `src/renderer/src/pages/DeviceDrawer.tsx`

- Rendered from `App.tsx` directly under `<Nav />` (line ~474), only when
  `page !== "profile"`-style guard isn't needed — render it whenever `Nav` renders
  (i.e. hidden during an active ride, same as `Nav` today — see §8.6).
- Takes the same `BleSectionProps` shape `HomePage` currently owns (lines 13–25 of
  `HomePage.tsx`) plus `open: boolean` and `onClose: () => void`. Moving this props
  bundle from `HomePage` to `DeviceDrawer` is a pure relocation.
- Renders the header row, the 3-up grid, and the per-cell state machine described in
  the handoff (§2 "The drawer" in the handoff README) — connected / not-connected /
  scanning / found / error, using `discoveredDevices.filter(d => d.roles.includes(role))`
  per cell as described in §1.2 above.
- Bluetooth-off / permission-denied full-width error row: `bleCapabilities.canScan`
  (from `window.kickr.ble.getCapabilities()`, currently fetched nowhere — this drawer
  is the first consumer) gates this state.
- The connected-device action button reads **"Forget"** per the mock's copy, but
  calls the existing `disconnect*` actions unchanged (locked decision, §8.1) — purely
  a label, no new behavior or persistence.
- Not a modal: no backdrop, page stays interactive, matches the handoff exactly (this
  is *not* the existing `.dialog-backdrop`/`.dialog` pattern used elsewhere — it's
  new, and should stay structurally distinct from those dialogs since it behaves
  differently — non-modal, page pushed down not overlaid).

### `HomePage.tsx` changes

- Delete lines 193–320 (the Devices card) and the now-unused `BleSectionProps` export
  (moves to `DeviceDrawer.tsx`).
- Change the outer grid (line 144-152, currently `gridTemplateColumns: "1fr 1fr"`) to
  a single column so **Training status** (lines 154–191) takes full width. The
  handoff explicitly leaves this layout choice to the team — plain full-width `.card`
  is the least risky option, no new layout system needed.
- `HomePage`'s `Props` type drops the `ble` field entirely — devices are no longer a
  Home concern.

---

## 4. Styling additions — `styles.css`

> **Update (PR 8 of the shadcn migration):** the classes below never shipped
> as `styles.css` additions. The device drawer was instead built with Radix
> `Collapsible` + Tailwind utilities directly in `DeviceDrawer.tsx`, and
> `styles.css` was reduced to its `:root` design-token block. The table below
> is kept as-written for historical context on the original plan; treat
> `DeviceDrawer.tsx` as the source of truth for what actually shipped.

Everything reuses existing tokens; only new **structural** classes are needed, no new
colors:

| New class | Purpose |
| --- | --- |
| `.device-cluster` | nav cluster button base (padding `7px 10px`, gap `10px`, radius 0) |
| `.device-cluster--attention` | red-fill variant (extends `.btn-primary`, dims not-connected icons via `opacity:.45`) |
| `.device-drawer` | drawer container: `--color-surface` ground, `24px 32px 26px` padding, `2px solid var(--color-text)` bottom rule |
| `.device-grid` | the 3-up grid: `repeat(3,1fr)` / `gap:2px` / `background:var(--color-neutral-400)` / `2px solid var(--color-text)` border — same "gap-as-rule" technique `HomePage.tsx` already uses at lines 209 and 328, so this is a known pattern in this codebase, just promoted to a shared class |
| `.device-cell` | grid cell: `--color-bg` fill, `20px` padding |
| `.device-progress` / `.device-progress-fill` | scanning progress bar (`4px` track, accent fill) |

One gap: the cluster's **neutral** variant needs a 2px solid `--color-text` outline
with transparent fill, which is not quite `.btn-secondary` (that uses
`--color-divider`, not full-strength `--color-text`, and 1px-equivalent styling) —
add `.device-cluster` as its own small rule rather than stretching `.btn-secondary`'s
meaning.

Responsive breakpoints (≥900 / 600–899 / <600) match the handoff exactly; implement
as plain media queries in the new classes.

---

## 5. Behavior

- **Toggle:** click cluster → `setDrawerOpen(v => !v)`. Click outside, `Escape`, or
  re-click the cluster closes it. Not modal — no focus trap that blocks interaction
  with the rest of the page, but focus *does* move into the drawer on open and back to
  the cluster on close (new pattern for this codebase — see §8.5).
- **Transition:** 180ms height/slide, `cubic-bezier(.2,0,0,1)`, guarded by
  `prefers-reduced-motion`. Nav cluster color change is instant, not animated (per
  spec).
- **Scan:** `Scan` on any cell calls the existing `scanForDevices()` — since only one
  physical scan can run, disable other cells' `Scan` buttons and show `Scanning` on
  them while `bleState.scanning` is true (the handoff explicitly allows this
  BLE-stack-constrained fallback — handoff §"Scanning" bullet 2).
- **Auto-open: deferred, not in v1** (locked decision, §8.2). The drawer only opens
  from an explicit click of the nav cluster. If this is revisited later, the handoff's
  four rules are still the right spec to implement — keep that in mind if a
  `shouldAutoOpen()`-style pure function gets added down the line, so it stays a
  self-contained addition rather than something threaded through the drawer's core
  logic.

---

## 6. Accessibility

None of `aria-expanded`, `aria-controls`, or `aria-live` exist anywhere in this
codebase today — this drawer is establishing the pattern, not following one:

- Cluster: `aria-expanded`, `aria-controls="device-drawer"`, descriptive `aria-label`.
- Drawer: `id="device-drawer"`, `aria-label="Devices"`, focus moves to first
  focusable element on open, returns to cluster on close.
- A `aria-live="polite"` region for the connected-count summary line.
- Keyboard focus ring: reuse `:focus-visible { outline: 2px solid var(--color-accent) }`
  — already the site-wide default in `styles.css`, nothing new to add there.

---

## 7. Suggested PR split

| PR | Scope | Risk |
| --- | --- | --- |
| 1 | Cluster + drawer shell, pure relocation of existing scan/connect/disconnect actions and props from `HomePage` into `Nav`/`DeviceDrawer`; add `lucide-react`. No new BLE behavior. Home goes full-width. | Low — same actions, new location, one new small dependency |
| 2 | Per-cell scan UX: filter `discoveredDevices` by role per cell, per-cell progress bar, disabled-sibling-buttons-while-scanning | Medium — real behavior change to the connect flow |
| 3 | Accessibility (`aria-live`, focus management, `Escape`/click-outside, reduced-motion) | Low-medium — new but isolated |
| 4 (later, revisit if wanted) | Auto-open session logic per the handoff's four rules — explicitly **not** in v1 (locked decision, §8.2) | Deferred by product choice, not a technical blocker |
| 5 (later, own design pass) | Real "Forget" semantics (auto-reconnect suppression and/or persisted known-device list) beyond the v1 `Disconnect` alias | Needs product/design decision first (§8.1) — don't bundle into this redesign |
| 6 (separate initiative, out of scope) | Mid-ride device-drop handling — `RidePage.tsx` currently has **zero** BLE awareness today, independent of this redesign | Explicitly deferred by the handoff's own open question #3 |

---

## 8. Decisions (locked 2026-09-15)

1. **"Forget" = alias for `Disconnect` in v1.** The button reads "Forget" (matches
   the mock's copy) but calls the same `disconnect*` actions that already exist —
   zero new state, zero main-process change. Real forget/unpair semantics
   (auto-reconnect suppression and/or a persisted known-device list) are deferred to
   PR 5 and need their own product/design pass before being built, since getting the
   semantics wrong is worse than shipping the alias.
2. **Auto-open is not in v1.** The drawer only opens on an explicit click of the nav
   cluster — no "once per session" logic, no `sessionStorage`/`useRef` flag, nothing
   watching for a device dropping while idle on Home. If this gets revisited, the
   handoff's four rules (§"Auto-open rules" in the original handoff README) are still
   the right spec — this decision is about *when*, not *whether* those rules are
   right.
3. **Missing optional device (HR/cadence) signal = per-icon dimming only, already in
   the mock spec.** Both nav-cluster variants color each of the three icons
   individually (connected = ink, not-connected = grey), and the drawer does the same
   for its cell icons. That dimming *is* the signal for a missing optional device — it
   never escalates the cluster to its red "attention" fill and never affects any open
   behavior. Only the trainer does either of those, matching the only gate that exists
   anywhere in the app today (`connectedTrainerDeviceId` before starting a workout).
4. **Icons: add `lucide-react`.** This is the app's first icon dependency — every
   other icon in the codebase (`Nav.tsx`, `HomePage.tsx`) is a hand-rolled inline
   `<svg>`. That's an intentional exception for this feature, not a stepping stone to
   migrating existing icons; don't take it as license to also rewrite unrelated icons
   elsewhere in the same PR.
5. **Renderer test coverage — still open, not decided.** No component test
   infrastructure exists anywhere (`vitest.config.ts` has no `jsdom`, no
   `@testing-library/react` in devDependencies) — this would be the first. Leaning
   toward keeping `requiredMissing`, `connectedCount`, and the per-cell status-label
   mapping as small exported pure functions (testable with plain `vitest`, no DOM)
   and not standing up full component-test infra just for this feature — revisit if
   that turns out to be insufficient once the drawer exists.
6. **Mid-ride device drop — explicitly out of scope**, per the handoff's own open
   question #3. `RidePage.tsx` has no BLE-awareness today regardless of this
   redesign; worth its own future plan, not a blocker here.

---

## 9. File touch list

| File | Change |
| --- | --- |
| `src/renderer/src/pages/HomePage.tsx` | Remove Devices card (lines 193–320) and `BleSectionProps` export/`ble` prop; Training status goes full width |
| `src/renderer/src/pages/Nav.tsx` | Add `DeviceStatusCluster` button to the right cell alongside the profile icon |
| `src/renderer/src/pages/DeviceDrawer.tsx` | **New.** Drawer shell, 3-up grid, per-cell state machine, error/scanning states |
| `src/renderer/src/App.tsx` | Add `drawerOpen`/`autoOpenedRef` state; move the `ble` prop bundle from `HomePage` to `Nav`+`DeviceDrawer`; add `requiredMissing`/`connectedCount`/`shouldAutoOpen` helpers |
| `src/renderer/src/styles.css` | Add `.device-cluster`, `.device-cluster--attention`, `.device-drawer`, `.device-grid`, `.device-cell`, `.device-progress[-fill]` |
| `src/main/ble/BleService.ts` | No change for PR 1–3; touched only if/when real "Forget" semantics (§8.1, PR 5) are scoped |
| `src/shared/ipc/contracts.ts` | No change required |
| `package.json` | Add `lucide-react` dependency (§8.4) |
