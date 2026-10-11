import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Eases a number from its previous value (0 on mount) to `target` with an
 * ease-out-cubic curve, for headline stats that "roll" into place. Returns the
 * target unchanged under prefers-reduced-motion, or where rAF is missing.
 */
export const useCountUp = (target: number | null, durationMs = 900): number | null => {
  const animatable = target !== null && !prefersReducedMotion() && typeof requestAnimationFrame === "function";
  const [value, setValue] = useState<number | null>(animatable ? 0 : target);
  const current = useRef<number>(animatable ? 0 : (target ?? 0));

  useEffect(() => {
    if (target === null || !animatable) {
      current.current = target ?? 0;
      setValue(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (target - from) * eased);
      current.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, animatable]);

  return value;
};
