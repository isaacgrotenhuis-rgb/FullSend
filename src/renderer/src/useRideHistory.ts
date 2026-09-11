import { useCallback, useEffect, useRef, useState } from "react";
import type { CompletedSessionSummary, SessionRecap } from "@shared/ipc/contracts";

export type RideHistory = {
  /** null while the first fetch is in flight; [] once loaded with no rides (or on error). */
  sessions: CompletedSessionSummary[] | null;
  error: string | null;
  recapSessionId: string | null;
  recap: SessionRecap | null;
  recapLoading: boolean;
  recapError: string | null;
  openRecap: (sessionId: string) => void;
  closeRecap: () => void;
};

/**
 * Self-contained data for the Home "recent activity" list + its recap modal. Fetches
 * the list once on mount (the section remounts whenever Home is navigated to, so that
 * doubles as the post-ride refresh) and lazily loads each recap on open, cached so
 * reopening the same ride costs no round-trip.
 */
export const useRideHistory = (limit = 10): RideHistory => {
  const [sessions, setSessions] = useState<CompletedSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recapSessionId, setRecapSessionId] = useState<string | null>(null);
  const [recap, setRecap] = useState<SessionRecap | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, SessionRecap>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await window.kickr.workout.listCompletedSessions({ limit });
        if (!cancelled) {
          setSessions(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setSessions([]);
          setError(err instanceof Error ? err.message : "Could not load recent workouts");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  useEffect(() => {
    if (recapSessionId === null) {
      return;
    }
    const cached = cacheRef.current.get(recapSessionId);
    if (cached) {
      setRecap(cached);
      setRecapError(null);
      setRecapLoading(false);
      return;
    }
    let cancelled = false;
    setRecap(null);
    setRecapError(null);
    setRecapLoading(true);
    void (async () => {
      try {
        const next = await window.kickr.workout.getSessionRecap({ sessionId: recapSessionId });
        if (cancelled) {
          return;
        }
        cacheRef.current.set(recapSessionId, next);
        setRecap(next);
      } catch (err) {
        if (!cancelled) {
          setRecapError(err instanceof Error ? err.message : "Could not load this recap");
        }
      } finally {
        if (!cancelled) {
          setRecapLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recapSessionId]);

  const openRecap = useCallback((sessionId: string) => setRecapSessionId(sessionId), []);
  const closeRecap = useCallback(() => setRecapSessionId(null), []);

  return {
    sessions,
    error,
    recapSessionId,
    recap,
    recapLoading,
    recapError,
    openRecap,
    closeRecap
  };
};
