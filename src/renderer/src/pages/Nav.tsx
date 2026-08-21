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
    <span
      onClick={() => onNavigate("plan")}
      aria-current={page === "plan" ? "page" : undefined}
      style={{
        cursor: "pointer",
        fontSize: 14,
        color: page === "plan" ? "var(--color-accent)" : "inherit"
      }}
    >
      Plan
    </span>
    <button
      className="btn btn-icon"
      style={{
        marginLeft: "auto",
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
