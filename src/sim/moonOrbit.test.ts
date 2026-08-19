import { describe, it, expect } from 'vitest'
import { moonOffsetEqjAu, laplaceToEqj, eqjToLaplace, type MoonMeanElements } from './moonOrbit'

const D2R = Math.PI / 180
const KM_PER_AU = 149597870.7

// JPL SSD "Planetary Satellite Mean Elements" (https://ssd.jpl.nasa.gov/sats/elem/), fetched
// 2026-08-18 — same source as src/data/moonElements.ts, hardcoded independently here per this
// project's TDD convention (see src/sim/kepler.test.ts's CERES constant). Epoch for every row on
// that page is 2000-01-01.5 TDB = JD 2451545.0.
const EPOCH_JD = 2451545.0

const TITAN: MoonMeanElements = {
  aKm: 1221900, e: 0.029, iDeg: 0.3, omegaDeg: 78.3, OmegaDeg: 78.6, M0Deg: 11.7,
  periodDays: 15.945448, epochJd: EPOCH_JD, poleRaDeg: 36.4, poleDecDeg: 84.0,
}

// Neptune's own IAU pole in the table (RA 299.8, Dec 43.1) differs from Neptune's official IAU
// rotational pole (299.36, 43.46) by well under a degree, exactly as the plan expects for a moon
// whose Laplace plane sits close to its planet's equator.
const TRITON: MoonMeanElements = {
  aKm: 354800, e: 0.0, iDeg: 157.3, omegaDeg: 0.0, OmegaDeg: 178.1, M0Deg: 63.0,
  periodDays: 5.876994, epochJd: EPOCH_JD, poleRaDeg: 299.8, poleDecDeg: 43.1,
}

const PHOBOS: MoonMeanElements = {
  aKm: 9375, e: 0.015, iDeg: 1.1, omegaDeg: 216.3, OmegaDeg: 169.2, M0Deg: 189.7,
  periodDays: 0.3187, epochJd: EPOCH_JD, poleRaDeg: 317.7, poleDecDeg: 52.9,
}

// ---- Phase calibration cross-check (2026-08-18) ---------------------------------------------
// A later independent Horizons cross-check found that TITAN/TRITON's M0 above (the raw JPL table
// value) does NOT actually osculate at this epoch — orientation (i, Omega, omega, pole) is
// correct, but phase is off by tens of degrees for most of this project's 9 moons (see
// src/sim/moonOrbit.ts's and src/data/moonElements.ts's doc comments, and src/data/moonPhase.json
// for the full 9-moon report). These two constants below use the CALIBRATED M0 that
// scripts/build-moon-phase.ts solved for, and are checked against the real JPL Horizons position
// vector AT THIS EXACT EPOCH — the test the project's original suite lacked, since a bare
// orientation/period check (the tests above) cannot detect a phase error at all.
//
// Query (https://ssd.jpl.nasa.gov/api/horizons.api), response cached at
// scripts/cache/horizons-moon-titan.txt / horizons-moon-triton.txt:
//   format=text COMMAND='606'|'801' OBJ_DATA=NO MAKE_EPHEM=YES EPHEM_TYPE=VECTORS
//   CENTER='500@699' (Saturn) | '500@899' (Neptune) REF_PLANE=FRAME REF_SYSTEM=ICRF VEC_TABLE=1
//   OUT_UNITS=KM-D START_TIME='JD2451545.0' STOP_TIME='JD2451546.0' STEP_SIZE='1d'
// Result at JD 2451545.000000000 (A.D. 2000-Jan-01 12:00:00.0000 TDB), parent-centered, ICRF/EQJ:
const TITAN_PHASE_CALIBRATED: MoonMeanElements = { ...TITAN, M0Deg: 217.6983 }
const TITAN_HORIZONS_KM = { x: -9.468029384488795e5, y: 8.240982253187533e5, z: 2.708223040694325e4 }

const TRITON_PHASE_CALIBRATED: MoonMeanElements = { ...TRITON, M0Deg: 58.9544 }
const TRITON_HORIZONS_KM = { x: -2.056964744679369e5, y: 1.000407712666010e4, z: 2.888123684286066e5 }

/** Angle between two vectors, degrees — used to compare a propagated direction against a real
 *  Horizons vector regardless of the (different) units/magnitudes each is expressed in. */
function angleBetweenDeg(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z
  const na = Math.hypot(a.x, a.y, a.z), nb = Math.hypot(b.x, b.y, b.z)
  const cos = Math.min(1, Math.max(-1, dot / (na * nb)))
  return Math.acos(cos) / D2R
}

// Neptune's IAU 2015 rotational pole, EQJ degrees (independent of TRITON.poleRaDeg/poleDecDeg
// above) — used so the retrograde test checks Triton's motion against the PLANET's pole, not
// against a number this same module already consumes for the propagation itself.
const NEPTUNE_POLE_RA = 299.36
const NEPTUNE_POLE_DEC = 43.46

describe('moonOffsetEqjAu', () => {
  it("reproduces Titan's ~15.945-day period and mean orbital radius", () => {
    const aAu = TITAN.aKm / KM_PER_AU
    // e = 0.029, so |r| ranges a*(1-e)..a*(1+e) = a*0.971..a*1.029 — comfortably inside 3%.
    for (const jd of [EPOCH_JD, EPOCH_JD + 1000, EPOCH_JD + 5000.37, EPOCH_JD - 837.2]) {
      const p = moonOffsetEqjAu(TITAN, jd)
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r, `jd=${jd}`).toBeGreaterThan(aAu * 0.97)
      expect(r, `jd=${jd}`).toBeLessThan(aAu * 1.03)
    }
    const p0 = moonOffsetEqjAu(TITAN, EPOCH_JD)
    const p1 = moonOffsetEqjAu(TITAN, EPOCH_JD + TITAN.periodDays)
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)).toBeLessThan(1e-9)
  })

  it("moves Triton retrograde relative to Neptune's own rotational pole", () => {
    // Angular momentum h = r x v (finite-difference velocity over a short step) — for prograde
    // motion h points roughly along the planet's pole; retrograde motion points opposite it.
    const dtDays = 0.01
    const p0 = moonOffsetEqjAu(TRITON, EPOCH_JD)
    const p1 = moonOffsetEqjAu(TRITON, EPOCH_JD + dtDays)
    const vx = (p1.x - p0.x) / dtDays, vy = (p1.y - p0.y) / dtDays, vz = (p1.z - p0.z) / dtDays
    const hx = p0.y * vz - p0.z * vy
    const hy = p0.z * vx - p0.x * vz
    const hz = p0.x * vy - p0.y * vx

    const poleRa = NEPTUNE_POLE_RA * D2R, poleDec = NEPTUNE_POLE_DEC * D2R
    const pole = {
      x: Math.cos(poleDec) * Math.cos(poleRa),
      y: Math.cos(poleDec) * Math.sin(poleRa),
      z: Math.sin(poleDec),
    }
    const dot = hx * pole.x + hy * pole.y + hz * pole.z
    expect(dot).toBeLessThan(0)
  })

  it('completes ~3.13 orbits per day for Phobos (mean motion check)', () => {
    const n = 360 / PHOBOS.periodDays // deg/day
    expect(n / 360).toBeCloseTo(3.13, 1)
  })

  it('produces finite coordinates across a decade for every test moon', () => {
    for (const el of [TITAN, TRITON, PHOBOS]) {
      for (let k = 0; k < 20; k++) {
        const p = moonOffsetEqjAu(el, EPOCH_JD + k * 200)
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
      }
    }
  })
})

// Phase-sensitive: guards against exactly the bug the raw JPL table M0 had (correct orbital
// plane, wrong position ON that plane). A test using the UNCALIBRATED M0 above would not catch
// this — it would place Titan somewhere on the right ellipse, at the wrong point on it, and every
// distance/period/orientation check above would still pass. Only a direct comparison against a
// real external position vector at a specific time can catch a phase error, which is exactly why
// this suite lacked one before the Horizons cross-check found the problem.
describe('moonOffsetEqjAu phase calibration (JPL Horizons cross-check)', () => {
  it("places Titan within 1° of its real Horizons direction at epoch", () => {
    const p = moonOffsetEqjAu(TITAN_PHASE_CALIBRATED, EPOCH_JD)
    const errDeg = angleBetweenDeg(p, TITAN_HORIZONS_KM)
    expect(errDeg).toBeLessThan(1.0)
  })

  it("places Triton within 1° of its real Horizons direction at epoch", () => {
    const p = moonOffsetEqjAu(TRITON_PHASE_CALIBRATED, EPOCH_JD)
    const errDeg = angleBetweenDeg(p, TRITON_HORIZONS_KM)
    expect(errDeg).toBeLessThan(1.0)
  })

  it('would have FAILED with the raw (uncalibrated) table M0 — proves this test is phase-sensitive', () => {
    // Documents the bug this whole fix is about: propagating with the table's own printed M0
    // (11.7° for Titan) lands far more than 1° away from the real Horizons direction at epoch.
    // This test pins that fact down so a future edit can't quietly make the calibrated tests
    // above pass "by accident" (e.g. from a bug that makes M0 stop mattering at all).
    const p = moonOffsetEqjAu(TITAN, EPOCH_JD) // TITAN still holds the raw table M0 = 11.7°
    const errDeg = angleBetweenDeg(p, TITAN_HORIZONS_KM)
    expect(errDeg).toBeGreaterThan(30)
  })
})

describe('laplaceToEqj', () => {
  it('maps a vector along the frame +Z to the pole direction unit vector', () => {
    const ra = 40.589, dec = 83.537 // Saturn's own IAU pole — an arbitrary test choice
    const p = laplaceToEqj(0, 0, 1, ra, dec)
    const expected = {
      x: Math.cos(dec * D2R) * Math.cos(ra * D2R),
      y: Math.cos(dec * D2R) * Math.sin(ra * D2R),
      z: Math.sin(dec * D2R),
    }
    expect(p.x).toBeCloseTo(expected.x, 12)
    expect(p.y).toBeCloseTo(expected.y, 12)
    expect(p.z).toBeCloseTo(expected.z, 12)
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 12)
  })

  it('maps the origin to the origin and preserves vector length', () => {
    const p = laplaceToEqj(0, 0, 0, 12.3, -45.6)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(0, 12)
    expect(p.z).toBeCloseTo(0, 12)
    const q = laplaceToEqj(3, -4, 0, 12.3, -45.6)
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(5, 10)
  })

  it('preserves right-handedness: rotated +X cross rotated +Y = rotated +Z', () => {
    const ra = 123.4, dec = -37.2
    const X = laplaceToEqj(1, 0, 0, ra, dec)
    const Y = laplaceToEqj(0, 1, 0, ra, dec)
    const Z = laplaceToEqj(0, 0, 1, ra, dec)
    const cx = X.y * Y.z - X.z * Y.y
    const cy = X.z * Y.x - X.x * Y.z
    const cz = X.x * Y.y - X.y * Y.x
    expect(cx).toBeCloseTo(Z.x, 12)
    expect(cy).toBeCloseTo(Z.y, 12)
    expect(cz).toBeCloseTo(Z.z, 12)
  })
})

describe('eqjToLaplace', () => {
  it('is the exact inverse of laplaceToEqj for arbitrary vectors and poles', () => {
    const cases: [number, number, number, number, number][] = [
      [1, 0, 0, 0, 0],
      [0.3, -1.7, 2.2, 36.4, 84.0],   // Titan's own pole
      [-9.47e5, 8.24e5, 2.71e4, 299.8, 43.1], // Triton's own pole, Horizons-scale magnitudes
      [5, 5, 5, 257.311, -15.175],    // Uranus's IAU pole
    ]
    for (const [x, y, z, ra, dec] of cases) {
      const laplace = eqjToLaplace(x, y, z, ra, dec)
      const back = laplaceToEqj(laplace.x, laplace.y, laplace.z, ra, dec)
      expect(back.x).toBeCloseTo(x, 6)
      expect(back.y).toBeCloseTo(y, 6)
      expect(back.z).toBeCloseTo(z, 6)
    }
  })
})
