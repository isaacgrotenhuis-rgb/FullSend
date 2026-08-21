import type { ReactElement } from "react";
import type { EventPlanAuditEntry, EventPlanVersion, StravaStatus, StravaSyncEventSummary } from "@shared/ipc/contracts";

export type SmokeCheck = {
  name: string;
  status: "pending" | "passed" | "failed" | "warning";
  detail: string;
};

export type StravaSectionProps = {
  stravaStatus: StravaStatus | null;
  stravaAuthCode: string;
  setStravaAuthCode: (value: string) => void;
  stravaAuthState: string;
  setStravaAuthState: (value: string) => void;
  stravaAuthUrl: string;
  refreshStravaStatus: () => Promise<void>;
  startStravaConnect: () => Promise<void>;
  completeStravaConnect: () => Promise<void>;
  disconnectStrava: () => Promise<void>;
  syncStrava: () => Promise<void>;
  retryStrava: (event: StravaSyncEventSummary) => Promise<void>;
};

type Props = {
  smokeChecks: SmokeCheck[];
  runningSmoke: boolean;
  runSmokeWorkflow: () => Promise<void>;
  strava: StravaSectionProps;
  versions: EventPlanVersion[];
  auditEntries: EventPlanAuditEntry[];
};

export const ProfilePage = ({ smokeChecks, runningSmoke, runSmokeWorkflow, strava, versions, auditEntries }: Props): ReactElement => (
  <main className="app">
    <h1>Profile</h1>

    <section>
      <h2>Strava sync</h2>
      <div className="row">
        <button onClick={() => void strava.refreshStravaStatus()}>Refresh Strava status</button>
        <button onClick={() => void strava.startStravaConnect()}>Connect Strava</button>
        <button onClick={() => void strava.disconnectStrava()}>Disconnect Strava</button>
        <button onClick={() => void strava.syncStrava()}>Sync completed workouts</button>
      </div>
      {strava.stravaStatus ? (
        <>
          <p>
            Connected: {strava.stravaStatus.connected ? "yes" : "no"} | Configured:{" "}
            {strava.stravaStatus.hasConfig ? "yes" : "no"} | Athlete ID: {strava.stravaStatus.athleteId ?? "N/A"}
          </p>
          <p>
            Counts — pending {strava.stravaStatus.counts.pending}, success {strava.stravaStatus.counts.success}, failed{" "}
            {strava.stravaStatus.counts.failed}
          </p>
          <p>Token expiry: {strava.stravaStatus.tokenExpiresAt ?? "N/A"}</p>
        </>
      ) : (
        <p>No Strava status loaded yet.</p>
      )}
      <div className="row">
        <label>
          OAuth state{" "}
          <input value={strava.stravaAuthState} onChange={(event) => strava.setStravaAuthState(event.target.value)} />
        </label>
        <label>
          Authorization code{" "}
          <input value={strava.stravaAuthCode} onChange={(event) => strava.setStravaAuthCode(event.target.value)} />
        </label>
        <button onClick={() => void strava.completeStravaConnect()}>Complete connect</button>
      </div>
      {strava.stravaAuthUrl ? <p>Auth URL: {strava.stravaAuthUrl}</p> : null}
      {strava.stravaStatus && strava.stravaStatus.recentEvents.length > 0 ? (
        <ul>
          {strava.stravaStatus.recentEvents.map((event) => (
            <li key={event.id}>
              [{event.syncStatus}] {event.eventType} / session {event.sessionId ?? "N/A"} / {event.message ?? "No message"}{" "}
              {event.syncStatus === "failed" ? (
                <button onClick={() => void strava.retryStrava(event)}>Retry</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No sync events yet.</p>
      )}
    </section>

    <section>
      <h2>Dev tools</h2>

      <h3>Release smoke workflow</h3>
      <button onClick={() => void runSmokeWorkflow()} disabled={runningSmoke}>
        {runningSmoke ? "Running..." : "Run smoke workflow"}
      </button>
      {smokeChecks.length === 0 ? (
        <p>No smoke run yet.</p>
      ) : (
        <ul>
          {smokeChecks.map((check) => (
            <li key={check.name}>
              [{check.status}] {check.name}: {check.detail}
            </li>
          ))}
        </ul>
      )}

      <h3>Version history</h3>
      {versions.length === 0 ? (
        <p>No versions yet.</p>
      ) : (
        <ul>
          {versions.map((version) => (
            <li key={version.id}>
              v{version.versionNumber} {version.isCurrent ? "(current)" : ""} — {version.source} — {version.reason} —{" "}
              {version.createdAt}
            </li>
          ))}
        </ul>
      )}

      <h3>Audit entries</h3>
      {auditEntries.length === 0 ? (
        <p>No audit entries yet.</p>
      ) : (
        <ul>
          {auditEntries.map((entry) => (
            <li key={entry.id}>
              [{entry.action}] {entry.reason} ({entry.source}) — {entry.createdAt}
            </li>
          ))}
        </ul>
      )}
    </section>
  </main>
);
