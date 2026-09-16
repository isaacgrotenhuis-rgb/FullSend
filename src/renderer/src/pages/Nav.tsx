import type { ReactElement } from "react";
import type { Page } from "../App";
import type { BleRole, BleState } from "@shared/ipc/contracts";
import { connectedCount, requiredMissing, roleIcons } from "./DeviceDrawer";

type Props = {
  page: Page;
  onNavigate: (page: Page) => void;
  bleState: BleState | null;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
};

const clusterRoles: BleRole[] = ["power", "heart_rate", "cadence"];

const isRoleConnected = (state: BleState | null, role: BleRole): boolean =>
  role === "power" ? state?.connectedDeviceId != null : (state?.connections[role].connectedDeviceId ?? null) != null;

export const Nav = ({ page, onNavigate, bleState, drawerOpen, onToggleDrawer }: Props): ReactElement => {
  const attention = requiredMissing(bleState);
  const count = connectedCount(bleState);
  const ariaLabel = `Devices: ${count} of 3 connected${attention ? ", trainer not connected" : ""}`;

  return (
    <nav className="nav">
      <span className="nav-brand" style={{ cursor: "pointer" }} onClick={() => onNavigate("home")}>
        FULLSEND
      </span>

      <div className="nav-seg">
        <span className="nav-seg-opt" onClick={() => onNavigate("home")} aria-current={page === "home" ? "page" : undefined}>
          Home
        </span>
        <span className="nav-seg-opt" onClick={() => onNavigate("plan")} aria-current={page === "plan" ? "page" : undefined}>
          Plan
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", justifySelf: "end" }}>
        <button
          className={`device-cluster${attention ? " device-cluster--attention" : ""}`}
          onClick={onToggleDrawer}
          aria-expanded={drawerOpen}
          aria-controls="device-drawer"
          aria-label={ariaLabel}
        >
          {clusterRoles.map((role) => {
            const Icon = roleIcons[role];
            const connected = isRoleConnected(bleState, role);
            return (
              <Icon
                key={role}
                size={16}
                strokeWidth={2.5}
                style={
                  attention
                    ? { color: "var(--color-bg)", opacity: connected ? 1 : 0.45 }
                    : { color: connected ? "var(--color-text)" : "var(--color-neutral-500)" }
                }
              />
            );
          })}
          <span className="device-cluster-caret">{drawerOpen ? "▲" : "▼"}</span>
        </button>

        <button
          className="btn btn-icon"
          style={{
            background: page === "profile" ? "var(--color-accent)" : "var(--color-text)",
            color: "var(--color-bg)"
          }}
          onClick={() => onNavigate("profile")}
          aria-current={page === "profile" ? "page" : undefined}
          aria-label="Profile"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </button>
      </div>
    </nav>
  );
};
