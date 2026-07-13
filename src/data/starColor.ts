/** B−V (or BP−RP) color index → normalized RGB via Ballesteros temperature + black-body fit. */
export function colorIndexToRgb(ci: number): [number, number, number] {
  const bv = Math.max(-0.4, Math.min(2.0, ci))
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) // Kelvin
  return tempToRgb(t)
}

function tempToRgb(kelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332)
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305.0
  const clamp = (v: number) => Math.min(1, Math.max(0, v / 255))
  return [clamp(r), clamp(g), clamp(b)]
}
