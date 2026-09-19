import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Nav } from "./Nav";
import { DeviceDrawer, type BleSectionProps } from "./DeviceDrawer";

/* Mirrors App.tsx's real wiring: Nav owns the toggle button, DeviceDrawer
   owns the panel, and `drawerOpen`/`clusterButtonRef` are threaded through
   from a shared parent — exactly the shape that made a plain Radix
   Collapsible (trigger + content in one tree) not fit here. A sentinel
   button after both proves Tab can leave the drawer instead of looping. */
const Harness = () => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const clusterButtonRef = useRef<HTMLButtonElement>(null);
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
        clusterButtonRef={clusterButtonRef}
      />
      <DeviceDrawer ble={ble} open={drawerOpen} onClose={() => setDrawerOpen(false)} clusterButtonRef={clusterButtonRef} />
      <button type="button">After drawer</button>
    </>
  );
};

const getCluster = (): HTMLElement => screen.getByRole("button", { name: /^Devices:/ });
const queryDrawer = (): HTMLElement | null => screen.queryByRole("region", { name: "Devices" });

describe("DeviceDrawer", () => {
  it("is closed until the cluster button opens it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(queryDrawer()).not.toBeInTheDocument();

    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).toBeInTheDocument());

    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).not.toBeInTheDocument());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(queryDrawer()).not.toBeInTheDocument());
  });

  it("closes on a click outside the drawer", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "After drawer" }));
    await waitFor(() => expect(queryDrawer()).not.toBeInTheDocument());
  });

  it("does not close-then-reopen when the cluster button itself is clicked while open", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).toBeInTheDocument());

    // The click-outside effect explicitly exempts clusterButtonRef so this
    // single click is a plain close, not a close-then-reopen race between
    // the pointerdown-driven outside-click handler and the button's own
    // onClick toggle.
    await user.click(getCluster());
    await waitFor(() => expect(queryDrawer()).not.toBeInTheDocument());
  });

  it("does not trap Tab — focus can leave the open drawer", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(getCluster());
    const drawer = await screen.findByRole("region", { name: "Devices" });

    // Opening moves focus into the drawer (the Close button).
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());

    // Tab far enough to exhaust every focusable control inside the drawer
    // and land on the sentinel after it — a focus trap would instead loop
    // back inside `drawer`.
    for (let step = 0; step < 20; step += 1) {
      if (document.activeElement === screen.getByRole("button", { name: "After drawer" })) break;
      await user.tab();
    }

    const sentinel = screen.getByRole("button", { name: "After drawer" });
    expect(sentinel).toHaveFocus();
    expect(drawer).not.toContainElement(document.activeElement as HTMLElement);
  });
});
