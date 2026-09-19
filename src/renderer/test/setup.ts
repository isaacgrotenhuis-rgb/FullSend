import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { KickrDesktopApi } from "@shared/ipc/api";

/* ── jsdom gaps that Radix trips over ──────────────────────────────────────
   jsdom implements neither window.matchMedia nor ResizeObserver, and Radix's
   Dialog, Select and Popover both. The resulting failures surface a long way
   from the cause ("matchMedia is not a function" thrown from inside a
   presence hook), so these two stubs are load-bearing for every primitive
   test, not just the ones that obviously use them. */

vi.stubGlobal(
  "matchMedia",
  vi.fn((query: string): MediaQueryList => {
    const list: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false)
    };
    return list;
  })
);

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

/* Radix also calls these on the focus-scoped content in a few code paths.
   jsdom has no layout engine, so they are missing or inert. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (): void => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (): boolean => false;
  Element.prototype.setPointerCapture = (): void => {};
  Element.prototype.releasePointerCapture = (): void => {};
}

/* ── window.kickr preload bridge ───────────────────────────────────────────
   src/preload/index.ts exposes the API as `kickr`, not `api`. Every method is
   a vi.fn that rejects, so a component reaching for IPC in a unit test fails
   loudly with a named channel instead of hanging on a pending promise. Tests
   that need data override the one method they care about:

     vi.mocked(window.kickr.workout.getSessionRecap).mockResolvedValue(recap)

   The two subscribe* methods are the exceptions — they are synchronous and
   must hand back an unsubscribe function or the components leak on unmount. */

type AsyncIpcMethod = (...args: never[]) => Promise<never>;

const rejecting = (path: string): AsyncIpcMethod =>
  vi.fn(() =>
    Promise.reject(new Error(`window.kickr.${path} is not stubbed in this test`))
  ) as AsyncIpcMethod;

const namespace = <T>(name: string, methods: readonly string[]): T =>
  Object.fromEntries(methods.map((method) => [method, rejecting(`${name}.${method}`)])) as T;

const createApiStub = (): KickrDesktopApi => ({
  ping: rejecting("ping") as KickrDesktopApi["ping"],
  ble: {
    ...namespace<KickrDesktopApi["ble"]>("ble", [
      "startScan",
      "stopScan",
      "listDevices",
      "connect",
      "disconnect",
      "getState",
      "getCapabilities",
      "discoverFtms"
    ]),
    subscribeState: vi.fn(() => vi.fn())
  },
  workout: {
    ...namespace<KickrDesktopApi["workout"]>("workout", [
      "startSession",
      "pauseSession",
      "resumeSession",
      "stopSession",
      "saveSession",
      "discardSession",
      "setIntensity",
      "setRampDuration",
      "getSessionState",
      "getSessionTelemetry",
      "listCompletedSessions",
      "getSessionRecap"
    ]),
    subscribeSession: vi.fn(() => vi.fn())
  },
  workoutLibrary: namespace<KickrDesktopApi["workoutLibrary"]>("workoutLibrary", [
    "createWorkout",
    "updateWorkout",
    "deleteWorkout",
    "listWorkouts",
    "getWorkoutDetail",
    "createInterval",
    "updateInterval",
    "reorderIntervals",
    "deleteInterval",
    "assignWorkoutToPlanDay",
    "unassignWorkoutFromPlanDay",
    "listPlanWeeks"
  ]),
  workoutBank: namespace<KickrDesktopApi["workoutBank"]>("workoutBank", [
    "list",
    "get",
    "compile",
    "create",
    "update",
    "archive",
    "startAdhoc"
  ]),
  eventPlan: namespace<KickrDesktopApi["eventPlan"]>("eventPlan", [
    "generate",
    "adapt",
    "delete",
    "getCurrent"
  ]),
  dashboard: namespace<KickrDesktopApi["dashboard"]>("dashboard", ["getMetrics"]),
  strava: namespace<KickrDesktopApi["strava"]>("strava", [
    "connect",
    "disconnect",
    "sync",
    "retry",
    "getStatus"
  ])
});

window.kickr = createApiStub();

afterEach(() => {
  cleanup();
  window.kickr = createApiStub();
});
