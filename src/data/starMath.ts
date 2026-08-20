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

/** Milliarcseconds → radians. (1 mas = 1e-3", 1" = pi/(180*3600) rad.) Exported because catalogs
 *  quote proper motions in either unit — HYG carries both — and the conversion has to agree. */
export const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000)

/**
 * Tangential (across-the-sky) velocity of a star, in PARSECS PER YEAR, as an EQJ cartesian
 * vector on the same axes as raDecDistToXyz.
 *
 * A proper motion is an ANGULAR rate; multiplying it by the distance turns it into a linear one:
 *
 *     v = d * (mu_alpha* * e_east + mu_delta * e_north)
 *
 * where the local sky basis at (alpha, delta) is
 *
 *     e_east  = (-sin a,            cos a,             0     )
 *     e_north = (-sin d * cos a,   -sin d * sin a,     cos d )
 *
 * Both are unit vectors and both are perpendicular to the line of sight, so the result is purely
 * tangential — there is no radial term here even for stars with a known radial velocity. That is
 * deliberate: the Gaia extract this catalog is built from carries pmra/pmdec but no radial
 * velocity (Gaia measures RV for only a subset), so including RV for the few stars that have it
 * would make the catalog inconsistent with itself. Over the +/-200 kyr the app extrapolates, the
 * missing radial term changes a star's DISTANCE, which the eye reads as brightness, not as the
 * across-the-sky drift that the constellations are made of.
 *
 * CONVENTION: `pmraMasYr` is mu_alpha* — the proper motion in right ascension ALREADY multiplied
 * by cos(delta), so that it is a true angular rate on the sky rather than a coordinate rate. This
 * is what both of this catalog's sources publish:
 *   - Gaia DR3's `pmra` column is defined as mu_alpha* (gaiadr3.gaia_source documentation).
 *   - HYG's README says only "proper motion in right ascension, in milliarcseconds per year", but
 *     the data settles it: HYG gives Polaris (dec +89.264, cos d = 0.0128) pmra = 44.22 mas/yr,
 *     which is its mu_alpha*; the raw d(alpha)/dt would be ~3450 mas/yr. Kapteyn's Star agrees
 *     (HYG 6506.05 vs mu_alpha* 6500, raw ~9200). So no cos(delta) is applied here for either
 *     source — see the near-pole test in starMath.test.ts, which locks this in.
 *
 * @param raDeg   right ascension in DEGREES (note: raDecDistToXyz takes hours)
 * @param decDeg  declination in degrees
 * @param distPc  distance in parsecs
 * @param pmraMasYr   mu_alpha* in mas/yr
 * @param pmdecMasYr  mu_delta in mas/yr
 */
export function tangentialVelocityPcYr(
  raDeg: number,
  decDeg: number,
  distPc: number,
  pmraMasYr: number,
  pmdecMasYr: number,
): [number, number, number] {
  const a = (raDeg * Math.PI) / 180
  const d = (decDeg * Math.PI) / 180
  const sa = Math.sin(a), ca = Math.cos(a)
  const sd = Math.sin(d), cd = Math.cos(d)
  // rad/yr, then × distance to get pc/yr
  const muE = pmraMasYr * MAS_TO_RAD * distPc
  const muN = pmdecMasYr * MAS_TO_RAD * distPc
  return [
    muE * -sa + muN * -sd * ca,
    muE * ca + muN * -sd * sa,
    muN * cd,
  ]
}
