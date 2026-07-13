export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Interpolate a positive scalar in log space: t=0.5 gives the geometric mean. */
export function logLerp(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) * (1 - t) + Math.log(b) * t)
}

/** Seconds for a fly-to, scaled by orders of magnitude traversed, clamped 2–6 s. */
export function flyDuration(d0: number, d1: number): number {
  const decades = Math.abs(Math.log10(Math.max(d0, d1) / Math.min(d0, d1)))
  return Math.min(6, Math.max(2, 1 + 0.5 * decades))
}
