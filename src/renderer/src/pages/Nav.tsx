import type { ReactElement } from "react";
import type { Page } from "../App";

type Props = {
  page: Page;
  onNavigate: (page: Page) => void;
};

export const Nav = ({ page, onNavigate }: Props): ReactElement => (
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

    <button
      className="btn btn-icon"
      style={{
        justifySelf: "end",
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
  </nav>
);
