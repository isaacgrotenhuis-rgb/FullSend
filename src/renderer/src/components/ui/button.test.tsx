import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

/* PRs 3-7 rewrite ~60 legacy `.btn` call sites against the mapping below, so
   these assertions pin the mapping itself rather than any one call site. */

const renderButton = (ui: React.ReactElement): HTMLElement => {
  render(ui);
  return screen.getByRole("button");
};

describe("Button legacy class mapping", () => {
  it("maps .btn-primary to the default variant", () => {
    const button = renderButton(<Button>Save</Button>);
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveClass("bg-primary", "text-primary-foreground");
  });

  it("maps .btn-secondary to the outline variant", () => {
    const button = renderButton(<Button variant="outline">Cancel</Button>);
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveClass("border", "bg-background");
    expect(button).not.toHaveClass("bg-primary");
  });

  it("maps .btn-ghost to the ghost variant", () => {
    const button = renderButton(<Button variant="ghost">Back</Button>);
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveClass("hover:bg-accent");
    expect(button).not.toHaveClass("bg-primary", "border");
  });

  it("maps .btn-accent-outline to the outline-primary variant, which keeps the brand border AND label", () => {
    const button = renderButton(<Button variant="outline-primary">Browse</Button>);
    expect(button).toHaveAttribute("data-variant", "outline-primary");
    expect(button).toHaveClass("border-primary", "text-primary");
  });

  it("maps .btn-icon to size=icon, which is the same 36px square", () => {
    const button = renderButton(
      <Button size="icon" aria-label="Close">
        ×
      </Button>
    );
    expect(button).toHaveAttribute("data-size", "icon");
    expect(button).toHaveClass("size-9");
  });

  it("maps .btn-block to the block prop, margin-top included", () => {
    const button = renderButton(<Button block>Disconnect</Button>);
    expect(button).toHaveClass("w-full", "mt-2");
  });

  it("leaves block off by default", () => {
    const button = renderButton(<Button>Save</Button>);
    expect(button).not.toHaveClass("w-full", "mt-2");
  });

  it("composes block with a variant instead of replacing it", () => {
    const button = renderButton(
      <Button variant="ghost" block>
        Disconnect
      </Button>
    );
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveClass("w-full", "mt-2", "hover:bg-accent");
  });

  it("lets a call site override a variant class through className", () => {
    const button = renderButton(<Button className="bg-secondary">Save</Button>);
    expect(button).toHaveClass("bg-secondary");
    expect(button).not.toHaveClass("bg-primary");
  });
});
