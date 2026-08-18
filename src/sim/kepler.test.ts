import { describe, it, expect } from 'vitest'
import { solveKepler, elementsToHeliocentricEqj, OBLIQUITY_DEG, type OrbitalElements } from './kepler'

const D2R = Math.PI / 180
const EPS = OBLIQUITY_DEG * D2R

/** Rotates a J2000-ecliptic vector into EQJ — the same obliquity rotation the module applies,
 *  written out independently here so the reference conversion in the Ceres test is explicit. */
function eclipticToEqj(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return {
    x,
    y: y * Math.cos(EPS) - z * Math.sin(EPS),
    z: y * Math.sin(EPS) + z * Math.cos(EPS),
  }
}

/** Signed difference a - b wrapped into (-PI, PI] — solveKepler normalises M internally, so
 *  every angle comparison in this file has to be modulo a full turn. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  else if (d <= -Math.PI) d += 2 * Math.PI
  return d
}

describe('solveKepler', () => {
  it('returns M for a circular orbit (e = 0)', () => {
    for (const M of [0, 0.5, 1, 3, 6]) {
      expect(angleDiff(solveKepler(M, 0), M)).toBeCloseTo(0, 12)
    }
  })

  it('returns 0 at pericentre for any eccentricity', () => {
    for (const e of [0, 0.1, 0.5, 0.9]) {
      expect(solveKepler(0, e)).toBeCloseTo(0, 10)
    }
  })

  it('satisfies E - e*sin(E) = M to 1e-8 across a wide (M, e) grid', () => {
    for (let e = 0; e <= 0.94; e += 0.02) {
      for (let k = 0; k < 32; k++) {
        const M = (k / 32) * 2 * Math.PI - Math.PI
        const E = solveKepler(M, e)
        // M is normalised to (-PI, PI] internally, and M = ±PI is the same angle, so the
        // residual is compared modulo a full turn rather than as a plain difference.
        // 1e-8 is the solver's own documented convergence tolerance, asserted directly rather
        // than via toBeCloseTo(0, 8) (which is the stricter |d| < 5e-9).
        expect(Math.abs(angleDiff(E - e * Math.sin(E), M))).toBeLessThanOrEqual(1e-8)
      }
    }
  })

  it('converges near pericentre at high eccentricity (e = 0.9, M = 0.1)', () => {
    const E = solveKepler(0.1, 0.9)
    expect(Number.isFinite(E)).toBe(true)
    expect(E - 0.9 * Math.sin(E)).toBeCloseTo(0.1, 10)
  })

  it('rejects eccentricities at or beyond the |e| < 0.995 guard', () => {
    expect(() => solveKepler(1, 0.995)).toThrow()
    expect(() => solveKepler(1, 1.2)).toThrow()
  })
})

// Ceres orbital elements, straight from MPCORB.DAT (Minor Planet Center, retrieved 2026-08-11):
//   00001  3.34  0.15 K2669 274.41935  73.29420  80.24863  10.58803  0.0796923  0.21430445  2.7655526
// Packed epoch "K2669" = 2026-06-09.0 TT = JD 2461200.5.
const CERES: OrbitalElements = {
  a: 2.7655526,
  e: 0.0796923,
  i: 10.58803,
  Omega: 80.24863,
  omega: 73.29420,
  M0: 274.41935,
  epochJd: 2461200.5,
  nDegDay: 0.21430445,
}

// JPL Horizons reference vector for (1) Ceres — fetched once, 2026-08-11, and hardcoded here.
// Query (https://ssd.jpl.nasa.gov/api/horizons.api):
//   format=text COMMAND='1;' OBJ_DATA='NO' MAKE_EPHEM='YES' EPHEM_TYPE='VECTORS'
//   CENTER='@sun' START_TIME='2026-08-07' STOP_TIME='2026-08-08' STEP_SIZE='1 d'
//   REF_PLANE='ECLIPTIC' OUT_UNITS='AU-D' VEC_TABLE='1'
// Result at JD 2461259.5 (A.D. 2026-Aug-07 00:00:00.0000 TDB), heliocentric, Ecliptic of J2000:
const CERES_JD = 2461259.5
const CERES_REF_ECLIPTIC = {
  x: 8.486706182716924e-1,
  y: 2.580441011296707e0,
  z: -7.465107008600519e-2,
}

describe('elementsToHeliocentricEqj', () => {
  it('places Ceres within 0.05 AU of the JPL Horizons reference vector', () => {
    const got = elementsToHeliocentricEqj(CERES, CERES_JD)
    const ref = eclipticToEqj(CERES_REF_ECLIPTIC.x, CERES_REF_ECLIPTIC.y, CERES_REF_ECLIPTIC.z)
    const err = Math.hypot(got.x - ref.x, got.y - ref.y, got.z - ref.z)
    expect(err).toBeLessThan(0.05)
  })

  it('keeps |r| = a at every mean anomaly for a circular orbit', () => {
    const el: OrbitalElements = {
      a: 2.5, e: 0, i: 7, Omega: 40, omega: 120, M0: 0, epochJd: 2461200.5, nDegDay: 0.25,
    }
    for (let M0 = 0; M0 < 360; M0 += 15) {
      const p = elementsToHeliocentricEqj({ ...el, M0 }, el.epochJd)
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(2.5, 9)
    }
  })

  it('gives a polar orbit (i = 90°) a z-excursion of a·cos(ε), far exceeding a coplanar orbit', () => {
    const base = { a: 3, e: 0, Omega: 0, omega: 0, epochJd: 2461200.5, nDegDay: 0.2 }
    const maxAbsZ = (i: number): number => {
      let m = 0
      for (let M0 = 0; M0 < 360; M0 += 1) {
        m = Math.max(m, Math.abs(elementsToHeliocentricEqj({ ...base, i, M0 }, base.epochJd).z))
      }
      return m
    }
    // Ω = 0, i = 90°, e = 0 puts the orbit in the ecliptic x-z plane, so the ecliptic-frame z
    // reaches ±a; the obliquity rotation into EQJ scales that peak by cos(ε).
    expect(maxAbsZ(90)).toBeCloseTo(3 * Math.cos(EPS), 4)
    // A coplanar orbit only leaves the equator by the obliquity tilt itself: a·sin(ε).
    expect(maxAbsZ(0)).toBeCloseTo(3 * Math.sin(EPS), 4)
    expect(maxAbsZ(90)).toBeGreaterThan(2 * maxAbsZ(0))
  })

  it('advances a circular orbit by exactly half a turn over half a period', () => {
    const el: OrbitalElements = {
      a: 2.2, e: 0, i: 15, Omega: 200, omega: 30, M0: 47, epochJd: 2461200.5, nDegDay: 0.3,
    }
    const halfPeriodDays = 180 / el.nDegDay
    const p0 = elementsToHeliocentricEqj(el, el.epochJd)
    const p1 = elementsToHeliocentricEqj(el, el.epochJd + halfPeriodDays)
    expect(p1.x).toBeCloseTo(-p0.x, 9)
    expect(p1.y).toBeCloseTo(-p0.y, 9)
    expect(p1.z).toBeCloseTo(-p0.z, 9)
  })

  it('returns to the same point after a full period', () => {
    const period = 360 / CERES.nDegDay
    const p0 = elementsToHeliocentricEqj(CERES, CERES.epochJd)
    const p1 = elementsToHeliocentricEqj(CERES, CERES.epochJd + period)
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)).toBeLessThan(1e-9)
  })

  it('orbits retrograde when i > 90°', () => {
    // Angular momentum in the ECLIPTIC frame: cross(r0, r1).z is > 0 for prograde motion and
    // < 0 for retrograde. Undo the obliquity rotation to test in the frame the elements live in.
    const eqjToEclipticY = (p: { y: number; z: number }): number => p.y * Math.cos(EPS) + p.z * Math.sin(EPS)
    const sample = (i: number): number => {
      const el: OrbitalElements = { a: 2.5, e: 0.1, i, Omega: 30, omega: 60, M0: 10, epochJd: 2461200.5, nDegDay: 0.25 }
      const p0 = elementsToHeliocentricEqj(el, el.epochJd)
      const p1 = elementsToHeliocentricEqj(el, el.epochJd + 1)
      const [x0, y0] = [p0.x, eqjToEclipticY(p0)]
      const [x1, y1] = [p1.x, eqjToEclipticY(p1)]
      return x0 * y1 - y0 * x1 // z-component of r0 x r1, ecliptic frame
    }
    expect(sample(10)).toBeGreaterThan(0)
    expect(sample(170)).toBeLessThan(0)
  })

  it('produces finite coordinates for a highly eccentric orbit at every anomaly', () => {
    for (let M0 = 0; M0 < 360; M0 += 5) {
      const p = elementsToHeliocentricEqj(
        { a: 2.0, e: 0.9, i: 25, Omega: 10, omega: 300, M0, epochJd: 2461200.5, nDegDay: 0.35 },
        2461200.5)
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r).toBeGreaterThan(2.0 * (1 - 0.9) - 1e-9)
      expect(r).toBeLessThan(2.0 * (1 + 0.9) + 1e-9)
    }
  })
})
