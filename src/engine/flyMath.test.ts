import { describe, it, expect } from 'vitest'
import { easeInOutCubic, logLerp, flyDuration } from './flyMath'

describe('flyMath', () => {
  it('ease hits exact endpoints', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10)
  })

  it('logLerp midpoint is the geometric mean', () => {
    expect(logLerp(1, 100, 0.5)).toBeCloseTo(10, 10)
    expect(logLerp(4, 4, 0.7)).toBeCloseTo(4, 10)
    expect(logLerp(2, 512, 0)).toBe(2)
    expect(logLerp(2, 512, 1)).toBeCloseTo(512, 9)
  })

  it('duration grows with distance ratio and clamps to [2, 6] s', () => {
    expect(flyDuration(1, 1)).toBe(2)
    expect(flyDuration(1, 1e12)).toBe(6)
    const mid = flyDuration(1, 1e4)
    expect(mid).toBeGreaterThan(2)
    expect(mid).toBeLessThan(6)
  })
})
