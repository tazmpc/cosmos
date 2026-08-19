/** RA in HOURS (HYG convention!), Dec in degrees, dist in parsecs → EQJ cartesian parsecs. */
export function raDecDistToXyz(raHours: number, decDeg: number, distPc: number): [number, number, number] {
  const ra = raHours * 15 * Math.PI / 180
  const dec = decDeg * Math.PI / 180
  const cd = Math.cos(dec)
  return [distPc * cd * Math.cos(ra), distPc * cd * Math.sin(ra), distPc * Math.sin(dec)]
}

/** Rows of the IAU J2000 equatorial (EQJ) → galactic rotation matrix. */
const EQJ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
]

/** RA/Dec in DEGREES → galactic [l, b] in radians, l wrapped to [−pi, pi]. */
export function eqjToGalactic(raDeg: number, decDeg: number): [number, number] {
  const ra = raDeg * Math.PI / 180
  const dec = decDeg * Math.PI / 180
  const cd = Math.cos(dec)
  const u = [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)]
  const g = EQJ_TO_GAL.map(r => r[0] * u[0] + r[1] * u[1] + r[2] * u[2])
  return [Math.atan2(g[1], g[0]), Math.asin(Math.max(-1, Math.min(1, g[2])))]
}

/** Apparent → absolute magnitude at dist parsecs. */
export function absoluteMagnitude(apparentMag: number, distPc: number): number {
  return apparentMag - 5 * (Math.log10(distPc) - 1)
}

/** Absolute → apparent magnitude at dist parsecs (inverse of absoluteMagnitude). */
export function apparentMagnitude(absMag: number, distPc: number): number {
  return absMag + 5 * (Math.log10(distPc) - 1)
}
