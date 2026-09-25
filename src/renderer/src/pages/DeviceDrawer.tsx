import { useEffect, useState, type ReactElement } from "react";
import { Heart, RefreshCw, Zap, type LucideIcon } from "lucide-react";
import {
  bleRoles,
  type BleConnectionEntry,
  type BleDevice,
  type BleRole,
  type BleState
} from "@shared/ipc/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

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
  onClose: () => void;
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
// so the nav cluster and the dialog can't drift into disagreeing about it the
// way they did before this was a single function.
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

// The timeout App.scanForDevices passes to window.kickr.ble.startScan.
// Exported so OnboardingFlow's pairing step can time its own progress bar
// against the same value rather than a second hand-rolled constant.
export const SCAN_TIMEOUT_MS = 8000;

// Exported so OnboardingFlow's single-role trainer-pairing step (built on the
// same `ble: BleSectionProps` bag) can show identical candidate labels
// instead of re-deriving its own.
export const deviceLabel = (device: BleDevice): string => device.name ?? device.localName ?? "Unknown device";

// Only one physical BLE scan can run at a time regardless of which role's row
// triggered it, so every row reads from the same discoveredDevices list — this
// picks, per role, the strongest candidate that advertises that role. Exported
// for the same reason as deviceLabel above.
export const candidateForRole = (state: BleState, role: BleRole): BleDevice | null => {
  const matches = state.discoveredDevices
    // An empty roles array means the adapter couldn't classify the advertisement
    // (BleService: advertised roles are "a UI hint, not authoritative") — offer
    // such a device to every row rather than making it unpairable everywhere.
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

// Mounted only while open (see App.tsx: `{drawerOpen ? <DeviceDrawer .../> : null}`),
// matching every other dialog in this app — DialogContent's focus-restore patch
// (dialog.tsx's useRestoreFocusOnClose) captures document.activeElement once, on
// first mount, so a fresh mount per open is what makes it capture the cluster
// button rather than whatever was focused when the app first loaded.
export const DeviceDrawer = ({ ble, onClose }: Props): ReactElement => {
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
  const [hasScannedOnce, setHasScannedOnce] = useState(false);

  useEffect(() => {
    if (scanning) setHasScannedOnce(true);
  }, [scanning]);

  const disconnectForRole: Record<BleRole, () => Promise<void>> = {
    power: disconnectDevice,
    heart_rate: disconnectHrDevice,
    cadence: disconnectCadenceDevice
  };

  const lastErrorForRole = (role: BleRole): string | null => {
    if (!bleState) return null;
    return role === "power" ? bleState.lastError : bleState.connections[role].lastError;
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-[var(--color-divider)] px-4 py-3 text-left">
          <DialogTitle className="text-xs font-bold tracking-[0.12em] uppercase">Connect devices</DialogTitle>
        </DialogHeader>

        {actionError ? <div className="px-4 pt-2 text-xs text-[var(--color-accent-700)]">{actionError}</div> : null}

        <div className="divide-y divide-[var(--color-divider)]">
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

            // Single source for the status text and the one button below, so
            // the two can't independently disagree about which state a row is
            // actually in (the bug the old per-branch JSX risked).
            let statusLabel: string;
            let button: ReactElement | null;
            // required rows get the filled/default button so the one device
            // that actually gates a workout stands out; optional rows stay
            // outline, matching the old cards' actionVariant split.
            const actionVariant = required ? "default" : "outline";

            switch (phase.kind) {
              case "connected":
                statusLabel = `${connectedDevice ? deviceLabel(connectedDevice) : connectedDeviceId}${
                  role === "heart_rate" && bleState?.heartRate?.bpm != null ? ` · ${bleState.heartRate.bpm} bpm` : ""
                }`;
                button = (
                  <Button variant="outline" size="sm" disabled={actionPending} onClick={() => void disconnectForRole[role]()}>
                    Disconnect
                  </Button>
                );
                break;
              case "provided-by-power":
                statusLabel = "Provided by trainer connection";
                button = null;
                break;
              case "connecting":
                statusLabel = "Connecting…";
                button = (
                  <Button variant={actionVariant} size="sm" disabled>
                    <Spinner />
                    Connecting…
                  </Button>
                );
                break;
              case "candidate":
                statusLabel = `${deviceLabel(phase.device)} found${typeof phase.device.rssi === "number" ? ` · RSSI ${phase.device.rssi}` : ""}`;
                button = (
                  <Button
                    variant={actionVariant}
                    size="sm"
                    disabled={actionPending}
                    onClick={() => void connectToDevice(phase.device.id, role)}
                  >
                    Pair
                  </Button>
                );
                break;
              case "scanning":
                statusLabel = "Scanning…";
                button = (
                  <Button variant={actionVariant} size="sm" disabled>
                    <Spinner />
                    Scanning…
                  </Button>
                );
                break;
              case "idle":
                statusLabel = hasScannedOnce ? "No devices found · check it's awake" : `${required ? "Required" : "Optional"} · not connected`;
                button = (
                  <Button variant={actionVariant} size="sm" disabled={actionPending} onClick={() => void scanForDevices()}>
                    Scan
                  </Button>
                );
                break;
            }

            return (
              <div key={role} className="flex items-center gap-3 px-4 py-3">
                <Icon size={20} strokeWidth={2} className={iconColorClass} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{roleLabel(role)}</div>
                  <div className="truncate text-xs text-[var(--color-neutral-700)]">{statusLabel}</div>
                  {rowError ? <div className="text-xs text-[var(--color-accent-700)]">{rowError}</div> : null}
                </div>
                {button}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
