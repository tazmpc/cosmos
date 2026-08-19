import { describe, it, expect } from 'vitest'
import { moonOffsetEqjAu, laplaceToEqj, type MoonMeanElements } from './moonOrbit'

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
