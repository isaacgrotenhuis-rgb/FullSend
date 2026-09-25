import { useEffect, useState } from "react";

export type WeightUnit = "lb" | "kg";

export const WEIGHT_UNIT_STORAGE_KEY = "fullsend.weightUnit";
export const KG_TO_LB = 2.20462;

export const readStoredWeightUnit = (): WeightUnit => {
  if (typeof window === "undefined") {
    return "lb";
  }
  return window.localStorage.getItem(WEIGHT_UNIT_STORAGE_KEY) === "kg" ? "kg" : "lb";
};

/** Kilograms → a display string in the chosen unit, e.g. `"165.3 lb"` / `"75.0 kg"` / `"—"`. */
export const formatWeight = (weightKg: number | null, unit: WeightUnit): string => {
  if (weightKg === null) {
    return "—";
  }
  return unit === "lb" ? `${(weightKg * KG_TO_LB).toFixed(1)} lb` : `${weightKg.toFixed(1)} kg`;
};

/** Converts a value entered in the given unit to canonical kilograms. */
export const toKg = (value: number, unit: WeightUnit): number => (unit === "lb" ? value / KG_TO_LB : value);

/** Converts canonical kilograms to a value in the given unit, for populating an input. */
export const fromKg = (weightKg: number, unit: WeightUnit): number => (unit === "lb" ? weightKg * KG_TO_LB : weightKg);

/** `[weightUnit, setWeightUnit]`, persisted to localStorage under {@link WEIGHT_UNIT_STORAGE_KEY}. */
export const useWeightUnit = (): [WeightUnit, (unit: WeightUnit) => void] => {
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(readStoredWeightUnit);
  useEffect(() => {
    window.localStorage.setItem(WEIGHT_UNIT_STORAGE_KEY, weightUnit);
  }, [weightUnit]);
  return [weightUnit, setWeightUnit];
};
