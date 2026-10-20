import { ZONE_KEYS, ZONES, zoneForFraction, type Zone } from "@shared/zones";

/**
 * Display model for the app's training zones. The bands and labels come from
 * `@shared/zones` — the same eight zones the plan generator, workout bank
 * badges and bank filter chips use — so a block the chart calls "Sweet Spot"
 * is the same Sweet Spot everywhere. This module only adds a colour per zone.
 */
export type PowerZone = {
  key: Zone;
  /** 1-based position in ZONE_KEYS, light → dark on the colour ramp. */
  index: number;
  name: string;
  color: string;
};

export const powerZones: PowerZone[] = ZONE_KEYS.map((key, i) => ({
  key,
  index: i + 1,
  name: ZONES[key].label,
  color: `var(--color-zone-${i + 1})`
}));

/** The zone a target wattage falls in for a given FTP. */
export const zoneFor = (watts: number, ftpWatts: number): PowerZone => {
  const key = zoneForFraction(watts / ftpWatts);
  return powerZones.find((zone) => zone.key === key) ?? powerZones[powerZones.length - 1];
};
