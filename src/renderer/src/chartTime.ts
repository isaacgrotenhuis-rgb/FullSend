/** Time-axis helpers shared by the hand-rolled session charts. */

/** Axis label for an elapsed time: "0", "15m", "1h", "1h15". */
export const formatTick = (sec: number): string => {
  if (sec === 0) return "0";
  const hours = Math.floor(sec / 3600);
  const minutes = Math.round((sec % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h${`${minutes}`.padStart(2, "0")}`;
};

/** The smallest round tick step that keeps a duration to at most six ticks. */
export const tickStepSec = (durationSec: number): number =>
  [60, 300, 600, 900, 1800, 3600, 7200].find((step) => durationSec / step <= 6) ?? 7200;

/** Tick positions from 0, dropping a final tick that would crowd the right edge. */
export const timeTicks = (durationSec: number): number[] => {
  const step = tickStepSec(durationSec);
  const ticks: number[] = [];
  for (let sec = 0; sec <= durationSec - step * 0.4; sec += step) ticks.push(sec);
  return ticks;
};
