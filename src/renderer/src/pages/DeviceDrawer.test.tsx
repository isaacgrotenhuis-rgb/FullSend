import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Nav } from "./Nav";
import { DeviceDrawer, type BleSectionProps } from "./DeviceDrawer";

/* Mirrors App.tsx's real wiring: Nav owns the toggle button and DeviceDrawer
   (a real Radix modal Dialog) is only mounted while `drawerOpen` — matching
   how every other dialog in this app is rendered, which is also what makes
   DialogContent's focus-restore patch (dialog.tsx's useRestoreFocusOnClose)
   capture the cluster button as the opener instead of whatever had focus
   when the harness first rendered. */
const Harness = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ble: BleSectionProps = {
    bleState: null,
    actionError: null,
    actionPending: false,
    scanForDevices: vi.fn(),
    stopScanning: vi.fn(),
    disconnectDevice: vi.fn(),
    disconnectHrDevice: vi.fn(),
    disconnectCadenceDevice: vi.fn(),
    getRoleConnection: vi.fn(),
    roleLabel: (role) => role,
    connectToDevice: vi.fn()
  };

  return (
    <>
      <Nav
        page="home"
        onNavigate={vi.fn()}
        bleState={null}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((open) => !open)}
      />
      {drawerOpen ? <DeviceDrawer ble={ble} onClose={() => setDrawerOpen(false)} /> : null}
      <button type="button">After drawer</button>
    </>
  );
};

// Radix's modal Dialog hides everything outside it from the accessibility
// tree AND sets `pointer-events: none` on the rest of the page while open —
// a real click can no longer reach the cluster button or the sentinel below,
// which is why there's no "click the trigger again to close" test here the
// way the old non-modal drawer needed: that interaction is now impossible,
// not just untested. `hidden: true` opts back into finding the (still
// present, just accessibility-hidden) cluster button before the dialog opens.
const getCluster = (): HTMLElement => screen.getByRole("button", { name: /^Devices:/, hidden: true });
const queryDialog = (): HTMLElement | null => screen.queryByRole("dialog", { name: "Connect devices" });

describe("DeviceDrawer", () => {
  it("is closed until the cluster button opens it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(queryDialog()).not.toBeInTheDocument();

    await user.click(getCluster());
    await waitFor(() => expect(queryDialog()).toBeInTheDocument());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDialog()).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(queryDialog()).not.toBeInTheDocument());
  });

  it("closes via its own close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDialog()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(queryDialog()).not.toBeInTheDocument());
  });

  it("closes on a click outside the dialog (the overlay)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDialog()).toBeInTheDocument());

    // The rest of the page has pointer-events: none while a modal Dialog is
    // open (Radix), so the overlay — not some other on-page element — is the
    // real "click outside" surface a user can actually reach.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toBeInstanceOf(HTMLElement);
    await user.click(overlay as HTMLElement);
    await waitFor(() => expect(queryDialog()).not.toBeInTheDocument());
  });

  it("traps Tab inside the open dialog, unlike the old non-modal drawer", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    const dialog = await screen.findByRole("dialog", { name: "Connect devices" });

    // Radix's modal Dialog moves focus inside Content on open (onto its
    // first tabbable element, the search input) and traps Tab from there.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    // Tab all the way around every focusable control inside the dialog —
    // a real focus trap loops back inside `dialog` instead of ever reaching
    // the sentinel rendered after it.
    for (let step = 0; step < 20; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("restores focus to the cluster button on close, matching this app's other dialogs", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDialog()).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(getCluster()).toHaveFocus());
  });
});
