/**
 * Coggan-style power zones as a fraction of FTP, used to shade workout blocks.
 * Upper bounds are exclusive; the last zone is open-ended.
 */
export type PowerZone = {
  id: number;
  name: string;
  /** Upper bound as a fraction of FTP. */
  maxFraction: number;
  color: string;
};

export const powerZones: PowerZone[] = [
  { id: 1, name: "Recovery", maxFraction: 0.55, color: "var(--color-zone-1)" },
  { id: 2, name: "Endurance", maxFraction: 0.76, color: "var(--color-zone-2)" },
  { id: 3, name: "Tempo", maxFraction: 0.91, color: "var(--color-zone-3)" },
  { id: 4, name: "Threshold", maxFraction: 1.06, color: "var(--color-zone-4)" },
  { id: 5, name: "VO2 max", maxFraction: 1.21, color: "var(--color-zone-5)" },
  { id: 6, name: "Anaerobic", maxFraction: Number.POSITIVE_INFINITY, color: "var(--color-zone-6)" }
];

/** The zone a target wattage falls in for a given FTP. */
export const zoneFor = (watts: number, ftpWatts: number): PowerZone =>
  powerZones.find((zone) => watts / ftpWatts < zone.maxFraction) ?? powerZones[powerZones.length - 1];
