import { useEffect, useState } from "react";

export type SpeedUnit = "mph" | "kph";

export const SPEED_UNIT_STORAGE_KEY = "fullsend.speedUnit";
export const KMH_TO_MPH = 0.621371;

export const readStoredSpeedUnit = (): SpeedUnit => {
  if (typeof window === "undefined") {
    return "mph";
  }
  return window.localStorage.getItem(SPEED_UNIT_STORAGE_KEY) === "kph" ? "kph" : "mph";
};

/** Metres → a display string in the chosen unit, e.g. `"12.34 mi"` / `"19.86 km"` / `"—"`. */
export const formatDistance = (meters: number | null, unit: SpeedUnit): string => {
  if (meters === null) {
    return "—";
  }
  const km = meters / 1000;
  return unit === "mph" ? `${(km * KMH_TO_MPH).toFixed(2)} mi` : `${km.toFixed(2)} km`;
};

/** `[speedUnit, setSpeedUnit]`, persisted to localStorage under {@link SPEED_UNIT_STORAGE_KEY}. */
export const useSpeedUnit = (): [SpeedUnit, (unit: SpeedUnit) => void] => {
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>(readStoredSpeedUnit);
  useEffect(() => {
    window.localStorage.setItem(SPEED_UNIT_STORAGE_KEY, speedUnit);
  }, [speedUnit]);
  return [speedUnit, setSpeedUnit];
};
