import { describe, it, expect } from 'vitest'
import { colorIndexToRgb } from './starColor'

describe('colorIndexToRgb', () => {
  it('blue stars (negative index) are blue-white', () => {
    const [r, , b] = colorIndexToRgb(-0.24) // Spica-ish
    expect(b).toBeGreaterThan(r)
  })
  it('red stars (index ~1.85) are red-orange', () => {
    const [r, , b] = colorIndexToRgb(1.85) // Betelgeuse-ish
    expect(r).toBeGreaterThan(b)
    expect(r).toBeCloseTo(1, 1)
  })
  it('sun-like index ~0.65 is near-white', () => {
    const [r, g, b] = colorIndexToRgb(0.65)
    for (const c of [r, g, b]) { expect(c).toBeGreaterThan(0.75); expect(c).toBeLessThanOrEqual(1) }
  })
})
