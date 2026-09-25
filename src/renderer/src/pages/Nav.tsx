import type { ReactElement } from "react";
import type { Page } from "../App";
import { bleRoles, type BleState } from "@shared/ipc/contracts";
import { connectedCount, isRoleConnected, requiredMissing, roleIcons } from "./DeviceDrawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  page: Page;
  onNavigate: (page: Page) => void;
  bleState: BleState | null;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
};

// Shared focus ring for the plain <button> elements below (device-cluster and
// the profile toggle use shadcn's <Button>, which already carries this). None
// of these controls were focusable before — they were `<span onClick>` — so
// there is no legacy focus style to match; this mirrors Button's own ring.
const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export const Nav = ({ page, onNavigate, bleState, drawerOpen, onToggleDrawer }: Props): ReactElement => {
  const attention = requiredMissing(bleState);
  const count = connectedCount(bleState);
  const ariaLabel = `Devices: ${count} of 3 connected${attention ? ", trainer not connected" : ""}`;

  return (
    <nav className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-4">
      <button
        type="button"
        onClick={() => onNavigate("home")}
        className={cn(
          "cursor-pointer appearance-none rounded-sm bg-transparent p-0 justify-self-start text-lg font-extrabold text-[var(--color-text)]",
          focusRing
        )}
      >
        FULLSEND
      </button>

      <div className="inline-flex items-center gap-[2px] justify-self-center rounded-[10px] bg-[var(--color-surface)] p-[3px]">
        {(
          [
            { key: "home", label: "Home" },
            { key: "plan", label: "Plan" }
          ] as const
        ).map(({ key, label }) => {
          const isActive = page === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onNavigate(key)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "cursor-pointer appearance-none rounded-[8px] border bg-transparent px-[18px] py-[7px] text-sm leading-none font-semibold",
                focusRing,
                isActive
                  ? "border-[var(--color-text)] bg-[var(--color-bg)] text-[var(--color-text)]"
                  : "border-transparent text-[color-mix(in_srgb,var(--color-text)_55%,transparent)] hover:text-[var(--color-text)]"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 justify-self-end">
        <button
          onClick={onToggleDrawer}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-label={ariaLabel}
          className={cn(
            "inline-flex cursor-pointer items-center gap-[10px] rounded-md border-2 bg-transparent px-[10px] py-[7px] font-sans",
            focusRing,
            attention
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-bg)] hover:bg-[var(--color-accent-600)]"
              : "border-[var(--color-text)] text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)]"
          )}
        >
          {bleRoles.map((role) => {
            const Icon = roleIcons[role];
            const connected = isRoleConnected(bleState, role);
            return (
              <Icon
                key={role}
                size={16}
                strokeWidth={2.5}
                className={
                  attention
                    ? connected
                      ? "text-[var(--color-bg)]"
                      : "text-[var(--color-bg)] opacity-45"
                    : connected
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-neutral-500)]"
                }
              />
            );
          })}
          <span className="ml-0.5 text-[11px] font-semibold">{drawerOpen ? "▲" : "▼"}</span>
        </button>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => onNavigate("profile")}
          aria-current={page === "profile" ? "page" : undefined}
          aria-label="Profile"
          className={cn(
            "text-[var(--color-bg)] hover:text-[var(--color-bg)] dark:hover:text-[var(--color-bg)]",
            page === "profile"
              ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent)] dark:hover:bg-[var(--color-accent)]"
              : "bg-[var(--color-text)] hover:bg-[var(--color-text)] dark:hover:bg-[var(--color-text)]"
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
          </svg>
        </Button>
      </div>
    </nav>
  );
};
