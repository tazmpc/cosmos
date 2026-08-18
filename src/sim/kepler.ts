/**
 * Two-body Keplerian propagation of osculating orbital elements.
 *
 * Used for the ~400k MPCORB asteroids (src/scene/asteroidField.ts) — the planets keep using
 * astronomy-engine's full VSOP/DE ephemeris (src/sim/ephemeris.ts), which is far more accurate
 * than this but has no notion of an arbitrary minor planet.
 *
 * Honesty note: this is an UNPERTURBED two-body model. MPCORB elements are osculating elements
 * valid at their epoch; propagated far from it, planetary perturbations accumulate — for a main
 * belt asteroid the error is well under a milli-AU over the ~6-month window MPCORB epochs sit in,
 * and grows to order 0.01 AU over a decade. Fine for "where is the belt", not for astrometry.
 */

/** Obliquity of the ecliptic at J2000, degrees. Same value used throughout the project for the
 *  ecliptic -> EQJ rotation. */
export const OBLIQUITY_DEG = 23.43928

const D2R = Math.PI / 180
const EPS = OBLIQUITY_DEG * D2R
const COS_EPS = Math.cos(EPS)
const SIN_EPS = Math.sin(EPS)
const TWO_PI = 2 * Math.PI

/** Newton-Raphson convergence tolerance on |E - e·sin E - M|, radians. */
const TOL = 1e-8
const MAX_ITERS = 30

/** Elliptical orbits only. Real MPCORB belt eccentricities are < 0.6, so Newton converges in a
 *  handful of iterations; the guard exists so a corrupt/parabolic row fails loudly instead of
 *  silently producing garbage or spinning. */
const MAX_ECCENTRICITY = 0.995

/** Wraps an angle into (-PI, PI]. */
function normalizePi(x: number): number {
  let a = x % TWO_PI
  if (a > Math.PI) a -= TWO_PI
  else if (a <= -Math.PI) a += TWO_PI
  return a
}

/**
 * Solves Kepler's equation E - e·sin E = M for the eccentric anomaly E (radians).
 *
 * `M` is any real angle in radians (wrapped internally into (-PI, PI]); `e` must satisfy
 * |e| < 0.995. Newton-Raphson from a pericentre-aware starting guess, falling back to bisection
 * on the bracketing interval if Newton fails to converge in MAX_ITERS — Newton's derivative
 * (1 - e·cos E) approaches 1 - e near pericentre at high e, so the iteration can overshoot for
 * pathological inputs even though it converges for everything in the real catalog.
 */
export function solveKepler(M: number, e: number): number {
  if (!(Math.abs(e) < MAX_ECCENTRICITY)) {
    throw new Error(`solveKepler: eccentricity ${e} outside the elliptical guard |e| < ${MAX_ECCENTRICITY}`)
  }
  const m = normalizePi(M)
  if (e === 0) return m

  // Standard starting guess: E ~= M + e·sin M is a good first-order inversion away from
  // pericentre, and stays on the correct side of the root near it.
  let E = m + e * Math.sin(m)
  for (let k = 0; k < MAX_ITERS; k++) {
    const f = E - e * Math.sin(E) - m
    if (Math.abs(f) < TOL) return E
    E -= f / (1 - e * Math.cos(E))
  }
  // Bisection fallback. E - e·sin E is strictly increasing in E, and for |m| <= PI the root is
  // bracketed by [m - e, m + e] (|E - m| = |e·sin E| <= e).
  let lo = m - e
  let hi = m + e
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi)
    const f = mid - e * Math.sin(mid) - m
    if (Math.abs(f) < TOL) return mid
    if (f > 0) hi = mid
    else lo = mid
  }
  return 0.5 * (lo + hi)
}

/**
 * Osculating Keplerian elements as MPCORB publishes them: angles in DEGREES, referred to the
 * J2000 ECLIPTIC, distances in AU, mean motion in degrees/day.
 */
export interface OrbitalElements {
  /** Semi-major axis, AU. */
  a: number
  /** Eccentricity. */
  e: number
  /** Inclination to the J2000 ecliptic, degrees. */
  i: number
  /** Longitude of the ascending node, degrees. */
  Omega: number
  /** Argument of perihelion, degrees. */
  omega: number
  /** Mean anomaly at `epochJd`, degrees. */
  M0: number
  /** Epoch of M0, Julian Date (TT). */
  epochJd: number
  /** Mean motion, degrees/day. */
  nDegDay: number
}

export interface Xyz {
  x: number
  y: number
  z: number
}

/**
 * Heliocentric position at Julian Date `jd`, J2000 EQUATORIAL frame (EQJ), AU — the frame every
 * position in this project lives in (see src/sim/ephemeris.ts).
 *
 * M = M0 + n·(jd - epochJd) -> eccentric anomaly -> true anomaly -> perifocal (x toward
 * perihelion) -> a 3-1-3 rotation by (-omega, -i, -Omega) into the J2000 ecliptic -> one rotation
 * about x by the obliquity into EQJ.
 */
export function elementsToHeliocentricEqj(el: OrbitalElements, jd: number): Xyz {
  return elementsToHeliocentricEqjInto(el, jd, { x: 0, y: 0, z: 0 })
}

/**
 * Allocation-free variant of elementsToHeliocentricEqj: writes into `out` and returns it.
 *
 * The asteroid layer solves ~8k orbits per frame (src/scene/asteroidField.ts); at that rate the
 * result object and the elements object both have to be reused scratch, or the layer allocates
 * ~50k short-lived objects every frame purely to hand numbers around.
 */
export function elementsToHeliocentricEqjInto(el: OrbitalElements, jd: number, out: Xyz): Xyz {
  const M = (el.M0 + el.nDegDay * (jd - el.epochJd)) * D2R
  const e = el.e
  const E = solveKepler(M, e)

  const cosE = Math.cos(E)
  const sinE = Math.sin(E)

  // Perifocal coordinates, derived from E directly — going via the true anomaly and r would give
  // the identical point for two more transcendental calls, and is worse conditioned near e -> 1.
  //   xp = a(cos E - e),  yp = a·sqrt(1 - e^2)·sin E
  const xp = el.a * (cosE - e)
  const yp = el.a * Math.sqrt(1 - e * e) * sinE

  const co = Math.cos(el.omega * D2R)
  const so = Math.sin(el.omega * D2R)
  const cO = Math.cos(el.Omega * D2R)
  const sO = Math.sin(el.Omega * D2R)
  const ci = Math.cos(el.i * D2R)
  const si = Math.sin(el.i * D2R)

  // Perifocal -> J2000 ecliptic (the classical 3-1-3 rotation, written out).
  const xEcl = xp * (cO * co - sO * so * ci) - yp * (cO * so + sO * co * ci)
  const yEcl = xp * (sO * co + cO * so * ci) - yp * (sO * so - cO * co * ci)
  const zEcl = xp * (so * si) + yp * (co * si)

  // J2000 ecliptic -> EQJ: rotate about +x by the obliquity.
  out.x = xEcl
  out.y = yEcl * COS_EPS - zEcl * SIN_EPS
  out.z = yEcl * SIN_EPS + zEcl * COS_EPS
  return out
}

/** Julian Date (TT) for a JS Date. The 0.5 offset puts JD 0.0 at noon; 2440587.5 is 1970-01-01
 *  00:00 UTC. TT-UTC (~69 s in 2026) is deliberately ignored: it is 8e-4 days, which moves a belt
 *  asteroid by ~2e-6 AU — five orders of magnitude below anything this layer renders. */
export function dateToJd(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5
}
