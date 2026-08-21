import { randomUUID } from "node:crypto";
import { safeStorage, shell } from "electron";
import type { Repositories } from "@main/database/repositories";
import type {
  StravaConnectRequest,
  StravaConnectResult,
  StravaStatus,
  StravaSyncEventSummary,
  StravaSyncResult
} from "@shared/ipc/contracts";

type TokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athleteId: number | null;
};

type CompletedSessionRow = {
  id: string;
  workout_id: string | null;
  started_at: string;
  ended_at: string | null;
  summary_json: string;
  workout_name: string | null;
  duration_seconds: number | null;
  intensity_factor: number | null;
};

type StravaEventRow = {
  id: string;
  event_type: string;
  sync_status: "pending" | "success" | "failed";
  strava_activity_id: string | null;
  session_id: string | null;
  payload_json: string;
  attempted_at: string;
};

const STRAVA_OAUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_ACTIVITY_URL = "https://www.strava.com/api/v3/activities";

const formatStravaDate = (isoTimestamp: string): string => {
  const date = new Date(isoTimestamp);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().replace(".000Z", "Z");
};

const parseSummaryElapsed = (summaryJson: string): number | null => {
  try {
    const summary = JSON.parse(summaryJson) as { elapsedSec?: number };
    return typeof summary.elapsedSec === "number" && summary.elapsedSec > 0 ? Math.round(summary.elapsedSec) : null;
  } catch {
    return null;
  }
};

export class StravaService {
  private readonly clientId = process.env.KICKR_STRAVA_CLIENT_ID?.trim() ?? "";
  private readonly clientSecret = process.env.KICKR_STRAVA_CLIENT_SECRET?.trim() ?? "";
  private readonly redirectUri = process.env.KICKR_STRAVA_REDIRECT_URI?.trim() ?? "urn:ietf:wg:oauth:2.0:oob";
  private readonly scope = process.env.KICKR_STRAVA_SCOPE?.trim() ?? "activity:write,activity:read_all";
  private pendingState: string | null = null;

  constructor(private readonly repositories: Repositories) {}

  private hasConfig(): boolean {
    return !!this.clientId && !!this.clientSecret;
  }

  private serializeToken(token: TokenState): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure token storage unavailable on this system.");
    }
    return safeStorage.encryptString(JSON.stringify(token)).toString("base64");
  }

  private deserializeToken(cipherTextBase64: string): TokenState {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure token storage unavailable on this system.");
    }
    const clearText = safeStorage.decryptString(Buffer.from(cipherTextBase64, "base64"));
    return JSON.parse(clearText) as TokenState;
  }

  private readToken(): TokenState | null {
    const row = this.repositories.stravaTokens.getToken() as { encrypted_payload: string } | undefined;
    if (!row) {
      return null;
    }
    return this.deserializeToken(row.encrypted_payload);
  }

  private writeToken(token: TokenState): void {
    this.repositories.stravaTokens.upsertToken(this.serializeToken(token));
  }

  private async exchangeCode(authorizationCode: string): Promise<TokenState> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: authorizationCode,
      grant_type: "authorization_code"
    });
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new Error(`Strava token exchange failed (${response.status}): ${await response.text()}`);
    }
    const tokenResponse = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: { id?: number };
    };
    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_at,
      athleteId: tokenResponse.athlete?.id ?? null
    };
  }

  private async refreshToken(current: TokenState): Promise<TokenState> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: current.refreshToken
    });
    const response = await fetch(STRAVA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new Error(`Strava token refresh failed (${response.status}): ${await response.text()}`);
    }
    const tokenResponse = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete?: { id?: number };
    };
    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_at,
      athleteId: tokenResponse.athlete?.id ?? current.athleteId ?? null
    };
  }

  private async requireValidAccessToken(): Promise<TokenState> {
    const token = this.readToken();
    if (!token) {
      throw new Error("Strava is not connected.");
    }
    const now = Math.floor(Date.now() / 1000);
    if (token.expiresAt <= now + 120) {
      const refreshed = await this.refreshToken(token);
      this.writeToken(refreshed);
      return refreshed;
    }
    return token;
  }

  private oauthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      approval_prompt: "auto",
      scope: this.scope,
      state
    });
    return `${STRAVA_OAUTH_URL}?${params.toString()}`;
  }

  async connect(request: StravaConnectRequest): Promise<StravaConnectResult> {
    if (!this.hasConfig()) {
      throw new Error("Strava credentials are missing. Set KICKR_STRAVA_CLIENT_ID and KICKR_STRAVA_CLIENT_SECRET.");
    }
    if (!request.authorizationCode) {
      const state = randomUUID();
      this.pendingState = state;
      const authorizationUrl = this.oauthUrl(state);
      await shell.openExternal(authorizationUrl);
      return {
        ok: true,
        connected: false,
        requiresAuthorizationCode: true,
        authorizationUrl,
        state
      };
    }
    if (!request.state || request.state !== this.pendingState) {
      throw new Error("Invalid Strava OAuth state.");
    }
    const token = await this.exchangeCode(request.authorizationCode.trim());
    this.writeToken(token);
    this.pendingState = null;
    return {
      ok: true,
      connected: true,
      requiresAuthorizationCode: false
    };
  }

  disconnect(): { ok: true } {
    this.repositories.stravaTokens.clearToken();
    this.pendingState = null;
    return { ok: true };
  }

  private toEventSummary(row: StravaEventRow): StravaSyncEventSummary {
    const payload = JSON.parse(row.payload_json) as { message?: string };
    return {
      id: row.id,
      eventType: row.event_type,
      syncStatus: row.sync_status,
      stravaActivityId: row.strava_activity_id,
      sessionId: row.session_id,
      attemptedAt: row.attempted_at,
      message: payload.message ?? null
    };
  }

  private toElapsedSeconds(row: CompletedSessionRow): number {
    if (row.started_at && row.ended_at) {
      const start = new Date(row.started_at).getTime();
      const end = new Date(row.ended_at).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return Math.max(1, Math.round((end - start) / 1000));
      }
    }
    const fromSummary = parseSummaryElapsed(row.summary_json);
    if (fromSummary) {
      return fromSummary;
    }
    if (row.duration_seconds && row.duration_seconds > 0) {
      return row.duration_seconds;
    }
    return 1800;
  }

  private async uploadSession(row: CompletedSessionRow, token: TokenState, retryOfEventId?: string): Promise<StravaSyncEventSummary> {
    const eventId = randomUUID();
    this.repositories.stravaSyncEvents.create({
      id: eventId,
      eventType: "upload",
      syncStatus: "pending",
      stravaActivityId: null,
      sessionId: row.id,
      payloadJson: JSON.stringify({
        message: "Upload in progress",
        workoutName: row.workout_name ?? null,
        retryOfEventId: retryOfEventId ?? null
      })
    });

    const payload = new URLSearchParams({
      name: row.workout_name?.trim() || `Full Send Session ${row.id.slice(0, 8)}`,
      sport_type: "Ride",
      start_date_local: formatStravaDate(row.started_at),
      elapsed_time: `${this.toElapsedSeconds(row)}`,
      trainer: "1",
      description: `Full Send session ${row.id}${row.workout_id ? ` (workout ${row.workout_id})` : ""}`
    });

    try {
      const response = await fetch(STRAVA_ACTIVITY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: payload
      });

      if (!response.ok) {
        throw new Error(`Strava upload failed (${response.status}): ${await response.text()}`);
      }
      const activity = (await response.json()) as { id?: number; id_str?: string };
      const activityId = activity.id_str ?? (activity.id ? String(activity.id) : null);
      this.repositories.stravaSyncEvents.updateResult({
        id: eventId,
        syncStatus: "success",
        stravaActivityId: activityId,
        payloadJson: JSON.stringify({
          message: "Uploaded to Strava",
          workoutName: row.workout_name ?? null,
          retryOfEventId: retryOfEventId ?? null
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Strava upload failure";
      this.repositories.stravaSyncEvents.updateResult({
        id: eventId,
        syncStatus: "failed",
        stravaActivityId: null,
        payloadJson: JSON.stringify({
          message,
          workoutName: row.workout_name ?? null,
          retryOfEventId: retryOfEventId ?? null
        })
      });
    }
    const rowResult = this.repositories.stravaSyncEvents.getById(eventId) as StravaEventRow;
    return this.toEventSummary(rowResult);
  }

  private getCompletedSessionsToSync(sessionId: string | undefined, limit: number): CompletedSessionRow[] {
    if (sessionId) {
      const row = this.repositories.workoutSessions.getCompletedForStrava(sessionId) as CompletedSessionRow | undefined;
      if (!row) {
        throw new Error(`Completed session not found: ${sessionId}`);
      }
      return [row];
    }
    const sessions = this.repositories.workoutSessions.listCompletedForStrava() as CompletedSessionRow[];
    const successRows = this.repositories.stravaSyncEvents.listSuccessfulSessionIds() as Array<{ session_id: string }>;
    const syncedIds = new Set(successRows.map((item) => item.session_id));
    return sessions.filter((item) => !syncedIds.has(item.id)).slice(0, limit);
  }

  async sync(input: { sessionId?: string; limit: number }): Promise<StravaSyncResult> {
    const token = await this.requireValidAccessToken();
    const sessions = this.getCompletedSessionsToSync(input.sessionId, input.limit);
    const events: StravaSyncEventSummary[] = [];
    for (const session of sessions) {
      events.push(await this.uploadSession(session, token));
    }
    return {
      ok: true,
      processedCount: events.length,
      successCount: events.filter((event) => event.syncStatus === "success").length,
      failedCount: events.filter((event) => event.syncStatus === "failed").length,
      events
    };
  }

  async retry(eventId: string): Promise<StravaSyncResult> {
    const original = this.repositories.stravaSyncEvents.getById(eventId) as StravaEventRow | undefined;
    if (!original) {
      throw new Error(`Strava sync event not found: ${eventId}`);
    }
    if (!original.session_id) {
      throw new Error("Cannot retry event without a linked workout session.");
    }
    const session = this.repositories.workoutSessions.getCompletedForStrava(original.session_id) as
      | CompletedSessionRow
      | undefined;
    if (!session) {
      throw new Error(`Completed session not found for retry: ${original.session_id}`);
    }
    const token = await this.requireValidAccessToken();
    const event = await this.uploadSession(session, token, eventId);
    return {
      ok: true,
      processedCount: 1,
      successCount: event.syncStatus === "success" ? 1 : 0,
      failedCount: event.syncStatus === "failed" ? 1 : 0,
      events: [event]
    };
  }

  getStatus(): StravaStatus {
    const token = this.readToken();
    const recentRows = this.repositories.stravaSyncEvents.listRecent(25) as StravaEventRow[];
    return {
      connected: !!token,
      hasConfig: this.hasConfig(),
      athleteId: token?.athleteId ?? null,
      tokenExpiresAt: token ? new Date(token.expiresAt * 1000).toISOString() : null,
      counts: {
        pending: this.repositories.stravaSyncEvents.countByStatus("pending"),
        success: this.repositories.stravaSyncEvents.countByStatus("success"),
        failed: this.repositories.stravaSyncEvents.countByStatus("failed")
      },
      recentEvents: recentRows.map((row) => this.toEventSummary(row))
    };
  }
}
