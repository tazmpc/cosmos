import { describe, it, expect } from 'vitest'
import { bodyPosition } from './ephemeris'

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
})
