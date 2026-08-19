import { describe, it, expect } from 'vitest'
import { bodyPosition, type BodyId } from './ephemeris'
import { MOON_ELEMENTS, type MoonV2Id } from '../data/moonElements'
import { KM_PER_AU } from '../data/units'

const DATE = new Date('2026-07-13T00:00:00Z')

describe('bodyPosition', () => {
  it('puts Earth ~1 AU from the Sun', () => {
    const p = bodyPosition('earth', DATE)
    const r = Math.hypot(p.x, p.y, p.z)
    expect(r).toBeGreaterThan(0.98)
    expect(r).toBeLessThan(1.02)
  })

  it('puts the Moon ~0.00257 AU from Earth', () => {
    const e = bodyPosition('earth', DATE)
    const m = bodyPosition('moon', DATE)
    const d = Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z)
    expect(d).toBeGreaterThan(0.0023)
    expect(d).toBeLessThan(0.0028)
  })

  it('puts the Sun at the origin', () => {
    const s = bodyPosition('sun', DATE)
    expect(Math.hypot(s.x, s.y, s.z)).toBeLessThan(1e-9)
  })

  it('advancing one year returns Earth near its start point', () => {
    const a = bodyPosition('earth', DATE)
    const b = bodyPosition('earth', new Date('2027-07-13T06:00:00Z')) // +365.25 d
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    expect(d).toBeLessThan(0.05)
  })

  it('returns equatorial (EQJ) coordinates, not ecliptic', () => {
    // Earth's ecliptic z is ~0, so after the ecliptic->equatorial rotation
    // about x (y' = y*cos e, z' = y*sin e), z/y must equal tan(obliquity).
    const p = bodyPosition('earth', DATE)
    expect(p.z / p.y).toBeCloseTo(Math.tan(23.44 * Math.PI / 180), 2)
  })

  it('places the Galilean moons near Jupiter', () => {
    const j = bodyPosition('jupiter', DATE)
    // semi-major axes: Io 0.00282, Europa 0.00449, Ganymede 0.00716, Callisto 0.01259 AU
    const expected: Record<string, [number, number]> = {
      io: [0.002, 0.004], europa: [0.003, 0.006], ganymede: [0.006, 0.009], callisto: [0.011, 0.014],
    }
    for (const [id, [lo, hi]] of Object.entries(expected)) {
      const m = bodyPosition(id as BodyId, DATE)
      const d = Math.hypot(m.x - j.x, m.y - j.y, m.z - j.z)
      expect(d, id).toBeGreaterThan(lo)
      expect(d, id).toBeLessThan(hi)
    }
  })

  it('places each moons-v2 body within a·(1±e) ± 3% of its parent planet', () => {
    const PARENT: Record<MoonV2Id, BodyId> = {
      titan: 'saturn', rhea: 'saturn', iapetus: 'saturn', enceladus: 'saturn',
      triton: 'neptune',
      titania: 'uranus', oberon: 'uranus',
      phobos: 'mars', deimos: 'mars',
    }
    for (const [id, el] of Object.entries(MOON_ELEMENTS) as [MoonV2Id, typeof MOON_ELEMENTS[MoonV2Id]][]) {
      const parentPos = bodyPosition(PARENT[id], DATE)
      const moonPos = bodyPosition(id, DATE)
      const d = Math.hypot(moonPos.x - parentPos.x, moonPos.y - parentPos.y, moonPos.z - parentPos.z)
      const aAu = el.aKm / KM_PER_AU
      const lo = aAu * (1 - el.e) * 0.97
      const hi = aAu * (1 + el.e) * 1.03
      expect(d, `${id} distance ${d} AU, expected [${lo}, ${hi}]`).toBeGreaterThan(lo)
      expect(d, `${id} distance ${d} AU, expected [${lo}, ${hi}]`).toBeLessThan(hi)
    }
  })

  it('puts every planet within its perihelion/aphelion bounds', () => {
    const bounds: Record<Exclude<BodyId, 'sun' | 'moon' | 'io' | 'europa' | 'ganymede' | 'callisto' | MoonV2Id>, [number, number]> = {
      mercury: [0.30, 0.47], venus: [0.71, 0.73], earth: [0.97, 1.02],
      mars: [1.38, 1.67], jupiter: [4.95, 5.46], saturn: [9.0, 10.13],
      uranus: [18.2, 20.1], neptune: [29.8, 30.4],
    }
    for (const [id, [lo, hi]] of Object.entries(bounds) as [BodyId, [number, number]][]) {
      const p = bodyPosition(id, DATE)
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r, `${id} distance ${r}`).toBeGreaterThan(lo)
      expect(r, `${id} distance ${r}`).toBeLessThan(hi)
    }
  })
})
