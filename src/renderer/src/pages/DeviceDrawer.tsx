import { useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import { Heart, RefreshCw, Zap, type LucideIcon } from "lucide-react";
import {
  bleRoles,
  type BleConnectionEntry,
  type BleDevice,
  type BleRole,
  type BleState
} from "@shared/ipc/contracts";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type BleSectionProps = {
  bleState: BleState | null;
  actionError: string | null;
  actionPending: boolean;
  scanForDevices: () => Promise<void>;
  stopScanning: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  disconnectHrDevice: () => Promise<void>;
  disconnectCadenceDevice: () => Promise<void>;
  getRoleConnection: (state: BleState, role: BleRole) => BleConnectionEntry;
  roleLabel: (role: BleRole) => string;
  connectToDevice: (deviceId: string, role: BleRole) => Promise<void>;
};

type Props = {
  ble: BleSectionProps;
  open: boolean;
  onClose: () => void;
  clusterButtonRef: RefObject<HTMLButtonElement | null>;
};

// Power/trainer is the only device anything in this app gates on today
// (see App.confirmStartWorkout) — treat it as the sole "required" role rather
// than adding a schema field for a distinction that has exactly one member.
export const isRequiredRole = (role: BleRole): boolean => role === "power";

export const requiredMissing = (state: BleState | null): boolean =>
  state ? state.connectedDeviceId === null : true;

// "Connected" for a role means either its own BLE connection is live, or —
// cadence only — an FTMS trainer is already streaming it over the power
// connection's Indoor Bike Data (see the cadence-cell comment below). Shared
// so the nav cluster and the drawer can't drift into disagreeing about it
// the way they did before this was a single function.
export const isRoleConnected = (state: BleState | null, role: BleRole): boolean => {
  if (!state) return false;
  const ownConnection = role === "power" ? state.connectedDeviceId !== null : state.connections[role].connectedDeviceId !== null;
  if (ownConnection) return true;
  return role === "cadence" && state.liveTelemetry?.cadenceRpm != null;
};

export const connectedCount = (state: BleState | null): number =>
  bleRoles.filter((role) => isRoleConnected(state, role)).length;

export const roleIcons: Record<BleRole, LucideIcon> = {
  power: Zap,
  heart_rate: Heart,
  cadence: RefreshCw
};

// Must match the timeout App.scanForDevices passes to window.kickr.ble.startScan —
// there's no scan-progress field on BleState, so the drawer times its own progress
// bar/countdown against this shared constant rather than the real BLE stack state.
export const SCAN_TIMEOUT_MS = 8000;

const deviceLabel = (device: BleDevice): string => device.name ?? device.localName ?? "Unknown device";

// Only one physical BLE scan can run at a time regardless of which cell's "Scan"
// was clicked, so every cell reads from the same discoveredDevices list — this
// picks, per cell, the strongest candidate that advertises that role.
const candidateForRole = (state: BleState, role: BleRole): BleDevice | null => {
  const matches = state.discoveredDevices
    // An empty roles array means the adapter couldn't classify the advertisement
    // (BleService: advertised roles are "a UI hint, not authoritative") — offer
    // such a device to every cell rather than making it unpairable everywhere.
    .filter((device) => device.roles.length === 0 || device.roles.includes(role))
    // An FTMS trainer already streams cadence over its power connection (Indoor
    // Bike Data) — offering it again as a standalone cadence candidate invites
    // connecting the same device twice, which tears down the working power
    // connection when its standalone CSC service (if any) doesn't verify.
    .filter((device) => !(role === "cadence" && device.roles.includes("power")))
    .sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity));
  return matches[0] ?? null;
};

type CellPhase =
  | { kind: "connected" }
  | { kind: "provided-by-power" }
  | { kind: "connecting" }
  | { kind: "candidate"; device: BleDevice }
  | { kind: "scanning" }
  | { kind: "idle" };

export const DeviceDrawer = ({ ble, open, onClose, clusterButtonRef }: Props): ReactElement => {
  const {
    bleState,
    actionError,
    actionPending,
    scanForDevices,
    disconnectDevice,
    disconnectHrDevice,
    disconnectCadenceDevice,
    getRoleConnection,
    roleLabel,
    connectToDevice
  } = ble;

  const scanning = bleState?.scanning ?? false;
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [hasScannedOnce, setHasScannedOnce] = useState(false);
  const [, forceTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (scanning) {
      setHasScannedOnce(true);
      setScanStartedAt((prev) => prev ?? Date.now());
    } else {
      setScanStartedAt(null);
    }
  }, [scanning]);

  // The countdown/progress bar are purely cosmetic — a plain interval re-render
  // is enough to move them without hauling in a request-animation-frame loop.
  // Gated on `open` too so a scan left running after the drawer is closed
  // doesn't keep re-rendering a hidden component 5 times a second.
  useEffect(() => {
    if (!open || !scanning) return;
    const id = setInterval(() => forceTick((tick) => tick + 1), 200);
    return () => clearInterval(id);
  }, [open, scanning]);

  // Not modal — Tab is never trapped inside, so a keyboard user can leave the
  // drawer normally. Focus still needs to move somewhere sensible on open
  // (into the drawer) and on close (back to the cluster that opened it),
  // since the drawer's own contents become inert while closed.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      closeButtonRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (clusterButtonRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, onClose, clusterButtonRef]);

  const disconnectForRole: Record<BleRole, () => Promise<void>> = {
    power: disconnectDevice,
    heart_rate: disconnectHrDevice,
    cadence: disconnectCadenceDevice
  };

  const lastErrorForRole = (role: BleRole): string | null => {
    if (!bleState) return null;
    return role === "power" ? bleState.lastError : bleState.connections[role].lastError;
  };

  const elapsedMs = scanStartedAt ? Date.now() - scanStartedAt : 0;
  const remainingSec = Math.max(0, Math.ceil((SCAN_TIMEOUT_MS - elapsedMs) / 1000));
  const progressPercent = Math.min(100, (elapsedMs / SCAN_TIMEOUT_MS) * 100);

  const count = connectedCount(bleState);
  const summary = scanning ? `Scanning… ${remainingSec}s remaining` : `${count} of 3 connected`;

  return (
    // Not a self-contained Radix Collapsible: the trigger (the device cluster
    // button) renders in Nav.tsx, a sibling of this component under App, not
    // a child of this Root — there is no shared tree to hang a
    // CollapsibleTrigger on without editing App.tsx. So this Root is used
    // trigger-less, driven purely by the controlled `open` prop, and Nav's
    // button keeps its own manual aria-expanded/aria-controls pairing (see
    // Nav.tsx) instead of Radix's auto-wired version.
    <Collapsible open={open}>
      <CollapsibleContent
        id="device-drawer"
        role="region"
        aria-label="Devices"
        ref={containerRef}
        // Belt-and-suspenders with Radix's own `hidden` (set once the exit
        // animation finishes): this flips the instant `open` flips, matching
        // the original's immediate inert-on-close rather than waiting out
        // the 180ms close animation.
        inert={!open}
        className={cn(
          "overflow-hidden border-b-2 border-[var(--color-text)] bg-[var(--color-surface)] duration-[180ms] ease-out",
          "data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
          // prefers-reduced-motion: reduce → snap instead of animate, same as
          // the legacy `.device-drawer-wrapper` media query used to.
          "motion-reduce:animate-none"
        )}
      >
        <div className="px-6 pt-6 pb-[26px]">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold tracking-[0.12em] uppercase">Devices</span>
            <div className="flex items-center gap-3">
              <span
                className="flex items-center gap-[6px] text-[11px] text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]"
                aria-live="polite"
              >
                {summary}
              </span>
              <Button ref={closeButtonRef} variant="ghost" onClick={onClose} className="h-auto px-[10px] py-1 text-xs">
                Close
              </Button>
            </div>
          </div>

          {actionError ? <div className="mt-2 text-xs text-[var(--color-accent-700)]">{actionError}</div> : null}

          <div className="mt-4 grid grid-cols-3 gap-[2px] border-2 border-[var(--color-text)] bg-[var(--color-neutral-400)] max-[899px]:grid-cols-1">
            {bleRoles.map((role) => {
              const conn = bleState ? getRoleConnection(bleState, role) : null;
              const connectedDeviceId = conn?.connectedDeviceId ?? null;
              const isConnected = connectedDeviceId !== null;
              const connectedDevice = connectedDeviceId
                ? (bleState?.discoveredDevices.find((d) => d.id === connectedDeviceId) ?? null)
                : null;
              const isConnecting = conn?.lifecycle === "connecting";
              const required = isRequiredRole(role);
              // Only ever true for cadence today (a trainer's power connection already
              // streams it over Indoor Bike Data), expressed generically off the same
              // isRoleConnected() the nav cluster uses rather than a second hand-rolled
              // liveTelemetry check that could drift from it.
              const providedByPower = !isConnected && isRoleConnected(bleState, role);
              const candidate = !isConnected && !providedByPower && bleState ? candidateForRole(bleState, role) : null;
              const rowError = lastErrorForRole(role);
              const Icon = roleIcons[role];
              const iconColorClass = isRoleConnected(bleState, role)
                ? "text-[var(--color-text)]"
                : required
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-neutral-500)]";
              // .btn-primary -> default variant, .btn-secondary -> outline (PR 2 mapping).
              const actionVariant = required ? "default" : "outline";

              const phase: CellPhase = isConnected
                ? { kind: "connected" }
                : providedByPower
                  ? { kind: "provided-by-power" }
                  : isConnecting
                    ? { kind: "connecting" }
                    : candidate
                      ? { kind: "candidate", device: candidate }
                      : scanning
                        ? { kind: "scanning" }
                        : { kind: "idle" };

              // Single source for both the label/button below AND whether the scan
              // progress bar shows, so the two can't independently disagree about
              // which state a cell is actually in.
              const actionButton = (label: string, onClick: (() => void) | null, disabled: boolean): ReactElement => (
                <Button variant={actionVariant} block disabled={disabled} onClick={onClick ? () => void onClick() : undefined}>
                  {label}
                </Button>
              );

              let statusLabel: string;
              let action: ReactElement | null;

              switch (phase.kind) {
                case "connected":
                  statusLabel = `${connectedDevice ? deviceLabel(connectedDevice) : connectedDeviceId}${
                    role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
                  }`;
                  action = (
                    <Button variant="ghost" block disabled={actionPending} onClick={() => void disconnectForRole[role]()}>
                      Forget
                    </Button>
                  );
                  break;
                case "provided-by-power":
                  statusLabel = "Provided by trainer connection";
                  action = null;
                  break;
                case "connecting":
                  statusLabel = "Connecting…";
                  action = actionButton("Connecting", null, true);
                  break;
                case "candidate":
                  statusLabel = `${deviceLabel(phase.device)} found${typeof phase.device.rssi === "number" ? ` · RSSI ${phase.device.rssi}` : ""}`;
                  action = actionButton("Pair", () => connectToDevice(phase.device.id, role), actionPending);
                  break;
                case "scanning":
                  statusLabel = "Scanning…";
                  action = actionButton("Scanning", null, true);
                  break;
                case "idle":
                  statusLabel = hasScannedOnce ? "No devices found · check it's awake" : `${required ? "Required" : "Optional"} · not connected`;
                  action = actionButton("Scan", () => scanForDevices(), actionPending);
                  break;
              }

              return (
                <div key={role} className="bg-[var(--color-bg)] p-4">
                  <Icon size={30} strokeWidth={2} className={iconColorClass} strokeLinecap="square" />
                  <div className="mt-3 text-[15px] font-semibold">{roleLabel(role)}</div>
                  <div className="mt-[5px] mb-3 text-xs text-[var(--color-neutral-700)]">{statusLabel}</div>
                  {rowError ? (
                    <div className="mt-[5px] mb-3 text-xs text-[var(--color-accent-700)]">{rowError}</div>
                  ) : null}
                  {phase.kind === "scanning" ? (
                    <Progress value={progressPercent} className="mb-3 h-1 w-full rounded-none bg-[var(--color-neutral-300)]" />
                  ) : null}
                  {action}
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
