import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Page } from "../App";
import { Nav } from "./Nav";

/* Regression coverage for the bug this PR fixes: the page links used to be
   `<span className="nav-seg-opt" onClick={...}>`, which is never reachable
   by Tab and never activatable by Enter/Space. They are now plain
   <button>s. */

const Harness = ({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) => (
  <Nav page={page} onNavigate={onNavigate} bleState={null} drawerOpen={false} onToggleDrawer={vi.fn()} />
);

describe("Nav", () => {
  it("renders the page links as real, focusable buttons", () => {
    render(<Harness page="home" onNavigate={vi.fn()} />);

    const home = screen.getByRole("button", { name: "Home" });
    const plan = screen.getByRole("button", { name: "Plan" });

    // A <span onClick> has no tabIndex and is never focused directly.
    plan.focus();
    expect(plan).toHaveFocus();
    home.focus();
    expect(home).toHaveFocus();
  });

  it("activates a page link from the keyboard", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Harness page="home" onNavigate={onNavigate} />);

    screen.getByRole("button", { name: "Plan" }).focus();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("plan");

    await user.keyboard(" ");
    expect(onNavigate).toHaveBeenCalledWith("plan");
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("reaches the brand and both page links via sequential Tab, in order", async () => {
    const user = userEvent.setup();
    render(<Harness page="home" onNavigate={vi.fn()} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "FULLSEND" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Home" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Plan" })).toHaveFocus();
  });

  it("marks only the active page with aria-current", () => {
    render(<Harness page="plan" onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("navigates home from the brand button", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<Harness page="plan" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "FULLSEND" }));
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});
