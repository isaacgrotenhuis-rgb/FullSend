/**
 * FTP-fraction training-zone boundaries (doc §3.3).
 *
 * `power` values throughout the `.fsw` format are fractions of FTP, never watts.
 * The zone *list* is owned by `@shared/fsw` (`FSW_PRIMARY_ZONES`); this module
 * adds each zone's numeric band + label. Intensity metrics (estIF / estTSS) live
 * in `@shared/fsw` (`deriveFswMetrics`) — do not re-add them here.
 *
 * Not yet imported: consumed by the Workout Bank UI and zone-configurable
 * generator work (follow-ups to the bank slice).
 */
import { FSW_PRIMARY_ZONES, type FswPrimaryZone } from "@shared/fsw";

export type Zone = FswPrimaryZone;
export const ZONE_KEYS = FSW_PRIMARY_ZONES;

export type ZoneDefinition = {
  readonly min: number;
  readonly max: number;
  readonly label: string;
};

export const ZONES = {
  recovery: { min: 0.0, max: 0.55, label: "Recovery" },
  endurance: { min: 0.56, max: 0.75, label: "Endurance" },
  tempo: { min: 0.76, max: 0.87, label: "Tempo" },
  "sweet-spot": { min: 0.88, max: 0.93, label: "Sweet Spot" },
  threshold: { min: 0.94, max: 1.05, label: "Threshold" },
  vo2: { min: 1.06, max: 1.2, label: "VO2max" },
  anaerobic: { min: 1.21, max: 1.5, label: "Anaerobic Capacity" },
  neuromuscular: { min: 1.51, max: 3.0, label: "Neuromuscular" }
} as const satisfies Record<Zone, ZoneDefinition>;

/** Representative (mid-band) FTP fraction for a zone. Handy for the plan generator. */
export const zoneMidFraction = (zone: Zone): number => {
  const def = ZONES[zone];
  return (def.min + def.max) / 2;
};

/** Classify an FTP fraction into the zone whose band contains it. */
export const zoneForFraction = (fraction: number): Zone => {
  for (const key of ZONE_KEYS) {
    if (fraction <= ZONES[key].max) {
      return key;
    }
  }
  return "neuromuscular";
};
