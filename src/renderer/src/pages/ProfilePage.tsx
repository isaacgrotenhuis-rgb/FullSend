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
  currentFtp: number;
  smokeChecks: SmokeCheck[];
  runningSmoke: boolean;
  runSmokeWorkflow: () => Promise<void>;
  strava: StravaSectionProps;
  versions: EventPlanVersion[];
  auditEntries: EventPlanAuditEntry[];
};

const trainingZoneNames = [
  "Recovery",
  "Endurance",
  "Tempo",
  "Threshold",
  "VO2 max",
  "Anaerobic",
  "Neuromuscular"
];

export const ProfilePage = ({
  currentFtp,
  smokeChecks,
  runningSmoke,
  runSmokeWorkflow,
  strava,
  versions,
  auditEntries
}: Props): ReactElement => {
  const stravaConnected = strava.stravaStatus?.connected ?? false;

  return (
    <main className="app">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <h1 style={{ margin: 0 }}>Profile</h1>
        <button className="btn btn-primary" disabled title="Account details aren't editable yet">
          Edit
        </button>
      </div>

      <h2>Account details</h2>
      <div className="hr" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "var(--space-4)", marginBottom: "var(--space-8)" }}>
        <div className="field">
          <label>Name</label>
          <input className="input" value="" disabled placeholder="Not yet available" />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" value="" disabled placeholder="Not yet available" />
        </div>
        <div className="field">
          <label>Weight (kg)</label>
          <input className="input" value="" disabled placeholder="Not yet available" />
        </div>
        <div className="field">
          <label>Goal event</label>
          <input className="input" value="" disabled placeholder="Not yet available" />
        </div>
      </div>

      <h2>Connected services</h2>
      <div className="hr" />
      <div className="card" style={{ borderRadius: 0, marginBottom: "var(--space-8)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-4)" }}>
          <div>
            <div className="card-title">Strava</div>
            <div className="card-meta" style={{ marginTop: 4 }}>
              <span className={`tag ${stravaConnected ? "tag-accent" : "tag-neutral"}`}>
                {stravaConnected ? "Connected" : "Not connected"}
              </span>
              {stravaConnected && strava.stravaStatus?.athleteId ? <span>Athlete {strava.stravaStatus.athleteId}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void strava.refreshStravaStatus()}>
              Refresh
            </button>
            {stravaConnected ? (
              <button className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void strava.disconnectStrava()}>
                Disconnect
              </button>
            ) : (
              <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void strava.startStravaConnect()}>
                Connect
              </button>
            )}
            {stravaConnected ? (
              <button className="btn btn-primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void strava.syncStrava()}>
                Sync now
              </button>
            ) : null}
          </div>
        </div>

        {!stravaConnected && strava.stravaAuthUrl ? (
          <>
            <div className="hr" style={{ margin: "var(--space-3) 0" }} />
            <p className="card-meta" style={{ marginBottom: "var(--space-2)" }}>
              Authorize in the browser, then paste the returned code below.
            </p>
            <div className="row" style={{ margin: 0 }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Authorization code</span>
                <input className="input" value={strava.stravaAuthCode} onChange={(event) => strava.setStravaAuthCode(event.target.value)} />
              </label>
              <button className="btn btn-secondary" onClick={() => void strava.completeStravaConnect()}>
                Complete connect
              </button>
            </div>
          </>
        ) : null}

        {stravaConnected ? (
          <>
            <div className="hr" style={{ margin: "var(--space-3) 0" }} />
            <label className="radio" style={{ gap: 10 }}>
              <input
                type="checkbox"
                checked={false}
                disabled
                style={{ position: "static", opacity: 1, width: 16, height: 16, pointerEvents: "auto" }}
              />
              <span style={{ fontSize: 13 }}>Publish completed workouts to Strava automatically</span>
            </label>
          </>
        ) : null}

        {strava.stravaStatus && strava.stravaStatus.recentEvents.length > 0 ? (
          <>
            <div className="hr" style={{ margin: "var(--space-3) 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {strava.stravaStatus.recentEvents.map((event) => (
                <div key={event.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span>
                    <span className={`tag ${event.syncStatus === "failed" ? "tag-outline" : "tag-neutral"}`} style={{ marginRight: 6 }}>
                      {event.syncStatus}
                    </span>
                    {event.eventType} · {event.message ?? "No message"}
                  </span>
                  {event.syncStatus === "failed" ? (
                    <button className="btn btn-ghost" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => void strava.retryStrava(event)}>
                      Retry
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <h2>Personal stats</h2>
      <div className="hr" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 2,
          background: "var(--color-divider)",
          border: "2px solid var(--color-divider)",
          marginBottom: "var(--space-8)"
        }}
      >
        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-kicker">Current FTP</div>
          <div className="card-title" style={{ fontSize: 28 }}>
            {currentFtp} W
          </div>
        </div>
        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-kicker">Weight</div>
          <div className="card-title" style={{ fontSize: 28, opacity: 0.4 }}>
            —
          </div>
        </div>
        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-kicker">Power-to-weight</div>
          <div className="card-title" style={{ fontSize: 28, opacity: 0.4 }}>
            —
          </div>
        </div>
      </div>

      <h2>Training zones</h2>
      <div className="hr" />
      <table className="table" style={{ marginBottom: "var(--space-8)" }}>
        <thead>
          <tr>
            <th>Zone</th>
            <th>Name</th>
            <th>Range</th>
            <th>Power</th>
          </tr>
        </thead>
        <tbody>
          {trainingZoneNames.map((name, index) => (
            <tr key={name}>
              <td>{index + 1}</td>
              <td>{name}</td>
              <td className="text-muted">—</td>
              <td className="text-muted">—</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Dev tools</h2>
      <div className="hr" />

      <h3>Release smoke workflow</h3>
      <button className="btn btn-secondary" disabled={runningSmoke} onClick={() => void runSmokeWorkflow()}>
        {runningSmoke ? "Running..." : "Run smoke workflow"}
      </button>
      {smokeChecks.length === 0 ? (
        <p className="text-muted">No smoke run yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {smokeChecks.map((check) => (
              <tr key={check.name}>
                <td>{check.name}</td>
                <td>
                  <span
                    className={`tag ${
                      check.status === "passed" ? "tag-accent" : check.status === "failed" ? "tag-outline" : "tag-neutral"
                    }`}
                  >
                    {check.status}
                  </span>
                </td>
                <td>{check.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Version history</h3>
      {versions.length === 0 ? (
        <p className="text-muted">No versions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Source</th>
              <th>Reason</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td>
                  v{version.versionNumber} {version.isCurrent ? "(current)" : ""}
                </td>
                <td>{version.source}</td>
                <td>{version.reason}</td>
                <td>{version.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Audit entries</h3>
      {auditEntries.length === 0 ? (
        <p className="text-muted">No audit entries yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Reason</th>
              <th>Source</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {auditEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.action}</td>
                <td>{entry.reason}</td>
                <td>{entry.source}</td>
                <td>{entry.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
};
