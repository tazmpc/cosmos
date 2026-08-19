/**
 * Second Kepler propagator for planetary satellites — mirrors src/sim/kepler.ts's two-body
 * solver, but for JPL's planetary-satellite MEAN ELEMENTS (src/data/moonElements.ts), which unlike
 * MPCORB asteroid elements are NOT referred to the J2000 ecliptic.
 *
 * They are referred to each satellite's LAPLACE PLANE — a precessing best-fit plane that sits
 * close to the planet's equator for close-in regular moons, and close to the planet's orbital
 * plane for distant/irregular ones. JPL SSD's "Planetary Satellite Mean Elements" table
 * (https://ssd.jpl.nasa.gov/sats/elem/, fetched 2026-08-18) additionally publishes the Laplace
 * plane's own pole (right ascension, declination — EQJ/J2000 equatorial) directly for most
 * satellites; for the handful whose table row instead says frame "equatorial" (Uranus's moons in
 * this project's set), the elements are already given straight in the planet's own IAU equatorial
 * frame, and the planet's rotational pole stands in for the Laplace pole. Either way, the caller
 * supplies one (poleRaDeg, poleDecDeg) per moon (see src/data/moonElements.ts) and this module
 * doesn't need to know which case it is.
 *
 * Honesty note: like src/sim/kepler.ts, this is an unperturbed two-body propagation of a
 * *precessing* mean ellipse held fixed — real satellite motion (especially eccentricity/inclination
 * oscillations and nodal/apsidal precession) is smoothed out. JPL's own table carries a matching
 * warning: "these mean orbital parameters are not intended for ephemeris computation... primarily
 * useful in describing the general shape and orientation of a satellite's orbit." Good enough for
 * "where does Titan orbit Saturn", not for astrometry.
 *
 * Discovered discrepancy (2026-08-18, independent JPL Horizons cross-check): the ORIENTATION
 * this module reconstructs from the table's (i, Omega, omega, pole) is correct — Titan's modeled
 * orbit-normal direction agreed with Horizons' osculating pole to 0.28°. But the table's M0 does
 * NOT actually osculate at its own stated epoch for 7 of the 9 moons here — using it verbatim put
 * the mean-anomaly PHASE off by 50-175° at epoch (Phobos and Titania were the two exceptions,
 * both under 6° off). Whatever "epoch" JPL's mean-element fit is centered on for those seven, it
 * is not exactly the 2000-01-01.5 the table prints next to it. Rather than trust the table's M0,
 * src/data/moonElements.ts's M0Deg values are CALIBRATED: scripts/build-moon-phase.ts queries
 * JPL Horizons for each moon's real position vector at the table's epoch, transforms it into this
 * same (Omega, i, omega, pole) frame via eqjToLaplace below (the exact inverse of the forward
 * transform moonOffsetEqjAu uses), and solves for the M0 that reproduces that direction — a
 * calibration against ground truth, not a guess. moonOrbit.test.ts's "phase-sensitive" tests
 * guard this permanently: they hardcode a real Horizons vector and assert moonOffsetEqjAu's
 * output direction agrees with it to within 1° (a bare orientation test — Titan's original test
 * suite before this fix — cannot catch a phase bug, since orientation is a property of the
 * orbital plane and phase is a property of WHERE on that plane the moon sits at a given time).
 */

import { solveKepler } from './kepler'
import { KM_PER_AU } from '../data/units'

const D2R = Math.PI / 180

export interface MoonMeanElements {
  /** Semi-major axis, km. */
  aKm: number
  /** Eccentricity. */
  e: number
  /** Inclination to the Laplace plane, degrees. */
  iDeg: number
  /** Argument of periapsis, degrees. */
  omegaDeg: number
  /** Longitude of the ascending node on the Laplace plane's own reference (its node on the EQJ
   *  equator, per laplaceToEqj below), degrees. */
  OmegaDeg: number
  /** Mean anomaly at `epochJd`, degrees. */
  M0Deg: number
  /** Orbital period, days. Mean motion is derived as 360/periodDays rather than stored
   *  separately, so a period quoted anywhere else in the app can never drift from what's
   *  actually being propagated. */
  periodDays: number
  /** Epoch of M0, Julian date (TDB). */
  epochJd: number
  /** Laplace-plane pole (or the parent planet's IAU rotational pole, for satellites whose table
   *  row gives elements directly in the planet's equatorial frame) — EQJ right ascension, deg. */
  poleRaDeg: number
  /** Laplace-plane pole declination, EQJ degrees. */
  poleDecDeg: number
}

export interface Xyz { x: number; y: number; z: number }

/**
 * Rotates a vector from a frame whose +Z axis points at (poleRaDeg, poleDecDeg) in EQJ — and
 * whose +X axis is that frame's ascending node on the EQJ equator (EQJ right ascension =
 * poleRaDeg + 90°, declination = 0), with +Y completing a right-handed set — into EQJ coordinates.
 *
 * This is the standard "pole RA/Dec defines a body frame" construction (the same one the IAU uses
 * to define planet and satellite equatorial frames): the frame's basis vectors expressed in EQJ
 * are X_hat (the node direction), Z_hat (the pole itself), and Y_hat = Z_hat × X_hat.
 */
export function laplaceToEqj(x: number, y: number, z: number, poleRaDeg: number, poleDecDeg: number): Xyz {
  const ra = poleRaDeg * D2R
  const dec = poleDecDeg * D2R
  const cosDec = Math.cos(dec), sinDec = Math.sin(dec)
  const cosRa = Math.cos(ra), sinRa = Math.sin(ra)

  // Z_hat: the pole direction itself.
  const zx = cosDec * cosRa, zy = cosDec * sinRa, zz = sinDec
  // X_hat: the frame's ascending node on the EQJ equator (RA = poleRa + 90°, Dec = 0) — always
  // perpendicular to Z_hat regardless of poleDecDeg (dot(X_hat, Z_hat) = cosDec*(-cosRa*sinRa +
  // sinRa*cosRa) = 0).
  const xx = -sinRa, xy = cosRa, xz = 0
  // Y_hat = Z_hat × X_hat, completing a right-handed set.
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  return {
    x: x * xx + y * yx + z * zx,
    y: x * xy + y * yy + z * zy,
    z: x * xz + y * yz + z * zz,
  }
}

/**
 * Inverse of laplaceToEqj: rotates an EQJ vector INTO the frame whose +Z axis points at
 * (poleRaDeg, poleDecDeg). Since laplaceToEqj is a pure rotation (its basis vectors are
 * orthonormal), the inverse is just the transpose — projecting the EQJ vector onto each of that
 * same basis's three axes — rather than a second, independently-derived rotation.
 *
 * Used by scripts/build-moon-phase.ts (and its own tests) to go the other way: taking a real JPL
 * Horizons position vector, which comes back in EQJ, and expressing it in the frame
 * src/data/moonElements.ts's (Omega, i, omega) are defined in, so a mean anomaly can be read off
 * it. Not used by moonOffsetEqjAu itself, which only ever needs the forward direction.
 */
export function eqjToLaplace(x: number, y: number, z: number, poleRaDeg: number, poleDecDeg: number): Xyz {
  const ra = poleRaDeg * D2R
  const dec = poleDecDeg * D2R
  const cosDec = Math.cos(dec), sinDec = Math.sin(dec)
  const cosRa = Math.cos(ra), sinRa = Math.sin(ra)

  const zx = cosDec * cosRa, zy = cosDec * sinRa, zz = sinDec
  const xx = -sinRa, xy = cosRa, xz = 0
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  return {
    x: x * xx + y * xy + z * xz,
    y: x * yx + y * yy + z * yz,
    z: x * zx + y * zy + z * zz,
  }
}

/**
 * Parent-centered offset at Julian Date `jd`, EQJ AU — the vector this project's ephemeris
 * (src/sim/ephemeris.ts) adds to the parent planet's own heliocentric position.
 *
 * M = M0 + (360/period)·(jd - epoch) -> eccentric anomaly -> perifocal (x toward periapsis) ->
 * 3-1-3 rotation by (Omega, i, omega) into the Laplace-plane frame -> laplaceToEqj into EQJ.
 */
export function moonOffsetEqjAu(el: MoonMeanElements, jd: number): Xyz {
  const n = 360 / el.periodDays // deg/day
  const M = (el.M0Deg + n * (jd - el.epochJd)) * D2R
  const e = el.e
  const E = solveKepler(M, e)

  const a = el.aKm / KM_PER_AU
  const cosE = Math.cos(E), sinE = Math.sin(E)
  // Perifocal coordinates (identical construction to kepler.ts's elementsToHeliocentricEqjInto).
  const xp = a * (cosE - e)
  const yp = a * Math.sqrt(1 - e * e) * sinE

  const co = Math.cos(el.omegaDeg * D2R), so = Math.sin(el.omegaDeg * D2R)
  const cO = Math.cos(el.OmegaDeg * D2R), sO = Math.sin(el.OmegaDeg * D2R)
  const ci = Math.cos(el.iDeg * D2R), si = Math.sin(el.iDeg * D2R)

  // Perifocal -> Laplace-plane frame (the classical 3-1-3 rotation).
  const xL = xp * (cO * co - sO * so * ci) - yp * (cO * so + sO * co * ci)
  const yL = xp * (sO * co + cO * so * ci) - yp * (sO * so - cO * co * ci)
  const zL = xp * (so * si) + yp * (co * si)

  return laplaceToEqj(xL, yL, zL, el.poleRaDeg, el.poleDecDeg)
}
