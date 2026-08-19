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

/** Evaluate a polynomial given coefficients in ASCENDING order: c[0] + c[1]x + c[2]x² + … */
export function polyval(coeffs: number[], x: number): number {
  let acc = 0
  for (let i = coeffs.length - 1; i >= 0; i--) acc = acc * x + coeffs[i]
  return acc
}

/**
 * Least-squares polynomial fit, returning coefficients in ASCENDING order.
 * Solves the normal equations by Gauss-Jordan elimination with partial pivoting — fine for the
 * low degrees used here (the normal equations get ill-conditioned well before degree ~6).
 */
export function polyfit(xs: number[], ys: number[], degree: number): number[] {
  if (xs.length !== ys.length) throw new Error('polyfit: x and y length mismatch')
  if (xs.length <= degree) throw new Error('polyfit: not enough points for that degree')
  const n = degree + 1
  const powers = new Array(2 * degree + 1).fill(0)
  const rhs = new Array(n).fill(0)
  for (let i = 0; i < xs.length; i++) {
    let p = 1
    for (let k = 0; k <= 2 * degree; k++) { powers[k] += p; p *= xs[i] }
    p = 1
    for (let k = 0; k < n; k++) { rhs[k] += ys[i] * p; p *= xs[i] }
  }
  const m: number[][] = Array.from({ length: n }, (_, r) => {
    const row = new Array(n + 1)
    for (let c = 0; c < n; c++) row[c] = powers[r + c]
    row[n] = rhs[r]
    return row
  })
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r
    if (m[piv][c] === 0) throw new Error('polyfit: singular normal equations')
    ;[m[c], m[piv]] = [m[piv], m[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const factor = m[r][c] / m[c][c]
      for (let k = c; k <= n; k++) m[r][k] -= factor * m[c][k]
    }
  }
  return m.map((row, i) => row[n] / m[i][i])
}

/** Apparent → absolute magnitude at dist parsecs. */
export function absoluteMagnitude(apparentMag: number, distPc: number): number {
  return apparentMag - 5 * (Math.log10(distPc) - 1)
}

/** Absolute → apparent magnitude at dist parsecs (inverse of absoluteMagnitude). */
export function apparentMagnitude(absMag: number, distPc: number): number {
  return absMag + 5 * (Math.log10(distPc) - 1)
}
