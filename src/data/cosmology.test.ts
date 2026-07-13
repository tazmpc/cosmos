import { describe, it, expect } from 'vitest'
import { comovingDistanceMpc, luminosityDistanceMpc } from './cosmology'

describe('cosmology (flat LCDM H0=70 Om=0.3)', () => {
  it('d(0) = 0', () => expect(comovingDistanceMpc(0)).toBe(0))
  it('matches cz/H0 at low z within 1%', () => {
    const d = comovingDistanceMpc(0.01)
    const approx = 299792.458 * 0.01 / 70 // 42.827 Mpc
    expect(Math.abs(d - approx) / approx).toBeLessThan(0.01)
  })
  it('is monotonic and sub-linear at higher z', () => {
    const d1 = comovingDistanceMpc(0.1), d2 = comovingDistanceMpc(0.2)
    expect(d2).toBeGreaterThan(d1)
    expect(d2).toBeLessThan(2 * d1)
  })
  it('luminosity distance = (1+z) * comoving', () => {
    expect(luminosityDistanceMpc(0.1)).toBeCloseTo(1.1 * comovingDistanceMpc(0.1), 6)
  })
})
