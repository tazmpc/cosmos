/** RA in HOURS (HYG convention!), Dec in degrees, dist in parsecs → EQJ cartesian parsecs. */
export function raDecDistToXyz(raHours: number, decDeg: number, distPc: number): [number, number, number] {
  const ra = raHours * 15 * Math.PI / 180
  const dec = decDeg * Math.PI / 180
  const cd = Math.cos(dec)
  return [distPc * cd * Math.cos(ra), distPc * cd * Math.sin(ra), distPc * Math.sin(dec)]
}

/** Apparent → absolute magnitude at dist parsecs. */
export function absoluteMagnitude(apparentMag: number, distPc: number): number {
  return apparentMag - 5 * (Math.log10(distPc) - 1)
}
