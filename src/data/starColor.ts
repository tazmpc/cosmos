/** B−V (or BP−RP) color index → normalized RGB via Ballesteros temperature + black-body fit. */
export function colorIndexToRgb(ci: number): [number, number, number] {
  const bv = Math.max(-0.4, Math.min(2.0, ci))
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) // Kelvin
  return tempToRgb(t)
}

/**
 * Inverse of the Ballesteros relation: effective temperature → B−V color index.
 *
 * Derivation. With u = 0.92·BV the forward relation is
 *     T = 4600 · (1/(u + 1.7) + 1/(u + 0.62))
 * Writing k = T/4600 and combining the two fractions over (u+1.7)(u+0.62):
 *     k = (2u + 2.32) / (u² + 2.32u + 1.054)
 *     k·u² + (2.32k − 2)·u + (1.054k − 2.32) = 0
 * a quadratic in u. Its discriminant simplifies dramatically:
 *     (2.32k − 2)² − 4k(1.054k − 2.32)
 *   = 5.3824k² − 9.28k + 4 − 4.216k² + 9.28k
 *   = 1.1664k² + 4                                   (always positive)
 * so
 *     u = (2 − 2.32k ± √(1.1664k² + 4)) / (2k)
 * The − root is always far below the physical range (it sits left of the
 * u = −1.7 pole); the + root is the branch that contains the whole stellar
 * sequence, e.g. T = 5778 K → u = 0.598 → BV = 0.650 (the Sun). Take it.
 *
 * The result is clamped to [−0.4, 2.0], the range colorIndexToRgb is defined over.
 */
export function ballesterosInverseCi(teffK: number): number {
  const k = teffK / 4600
  const u = (2 - 2.32 * k + Math.sqrt(1.1664 * k * k + 4)) / (2 * k)
  return Math.max(-0.4, Math.min(2.0, u / 0.92))
}

function tempToRgb(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332)
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.0
  const clamp = (v: number) => Math.min(1, Math.max(0, v / 255))
  return [clamp(r), clamp(g), clamp(b)]
}
