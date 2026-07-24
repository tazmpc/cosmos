import { describe, it, expect } from 'vitest'
import { angularFovDeg } from './angularSize'

describe('angularFovDeg', () => {
  it('M42 Orion Nebula (24 ly diameter @ 412 pc): realistic ~1° object, padded 1.6x', () => {
    // Standard angular-diameter formula: 2*atan((diameter/2)/dist). M42's real sky size is
    // famously ~1° (65'x60'), which is what this produces pre-padding (≈1.023°); the 1.6x
    // padding used for the hips2fits FOV brings it to ≈1.637°.
    expect(angularFovDeg(24, 412)).toBeCloseTo(1.637, 2)
  })

  it('M31 Andromeda (220 kly diameter @ 0.78 Mpc = 780,000 pc): large, but under the ceiling', () => {
    expect(angularFovDeg(220_000, 780_000)).toBeCloseTo(7.923, 2)
  })

  it('clamps to the 10° ceiling for an object that is very close and very large', () => {
    expect(angularFovDeg(5_000_000, 100)).toBe(10)
  })

  it('clamps to the 0.05° floor for a tiny, very distant object', () => {
    expect(angularFovDeg(1, 1e9)).toBe(0.05)
  })

  it('never returns a value outside [0.05, 10] across extreme inputs', () => {
    expect(angularFovDeg(0.001, 1e12)).toBeGreaterThanOrEqual(0.05)
    expect(angularFovDeg(1e9, 1)).toBeLessThanOrEqual(10)
  })
})
