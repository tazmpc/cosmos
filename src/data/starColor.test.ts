import { describe, it, expect } from 'vitest'
import { colorIndexToRgb, ballesterosInverseCi } from './starColor'

/** Forward Ballesteros relation, mirrored from colorIndexToRgb for round-trip testing. */
const ciToTemp = (bv: number) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))

describe('ballesterosInverseCi', () => {
  it('round-trips ci → T → ci within 0.01', () => {
    for (const ci of [-0.3, 0.0, 0.65, 1.2, 2.0]) {
      expect(ballesterosInverseCi(ciToTemp(ci))).toBeCloseTo(ci, 2)
    }
  })
  it('the Sun (5778 K) gives ci ≈ 0.65', () => {
    expect(ballesterosInverseCi(5778)).toBeCloseTo(0.65, 2)
  })
  it('Vega-ish (9600 K) is near zero (Ballesteros puts ci = 0 at 10125 K)', () => {
    expect(ballesterosInverseCi(9600)).toBeCloseTo(0.045, 2)
    expect(Math.abs(ballesterosInverseCi(9600))).toBeLessThan(0.1)
  })
  it('a cool M star (3500 K) is deep red (Ballesteros puts ci = 1.6 at 3649 K)', () => {
    expect(ballesterosInverseCi(3500)).toBeCloseTo(1.71, 2)
    expect(ballesterosInverseCi(3500)).toBeGreaterThan(1.5)
  })
  it('is strictly decreasing in T across the unclamped range', () => {
    // clamping flattens the curve outside [3169 K, 21707 K] (where BV hits 2.0 / −0.4)
    let prev = Infinity
    for (let t = 3200; t <= 21000; t += 100) {
      const ci = ballesterosInverseCi(t)
      expect(ci).toBeLessThan(prev)
      prev = ci
    }
  })
  it('is monotonically non-increasing in T over the full [3000, 30000] range', () => {
    let prev = Infinity
    for (let t = 3000; t <= 30000; t += 100) {
      const ci = ballesterosInverseCi(t)
      expect(ci).toBeLessThanOrEqual(prev)
      prev = ci
    }
  })
  it('clamps to the [−0.4, 2.0] range the color ramp is defined over', () => {
    expect(ballesterosInverseCi(60000)).toBe(-0.4)
    expect(ballesterosInverseCi(1500)).toBe(2.0)
  })
})

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
