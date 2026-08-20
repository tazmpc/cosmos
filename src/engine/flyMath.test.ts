import { describe, it, expect } from 'vitest'
import { easeInOutCubic, logLerp, flyDuration, aimOrientation } from './flyMath'
import { PITCH_LIMIT } from './cameraControls'

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

describe('aimOrientation', () => {
  it('+x direction yields yaw 0, pitch 0', () => {
    const { yaw, pitch } = aimOrientation({ x: 1, y: 0, z: 0 })
    expect(yaw).toBeCloseTo(0, 10)
    expect(pitch).toBeCloseTo(0, 10)
  })

  it('+z direction (straight up) clamps pitch to the controls pitch limit', () => {
    const { pitch } = aimOrientation({ x: 0, y: 0, z: 1 })
    expect(pitch).toBeCloseTo(PITCH_LIMIT, 10)
  })

  it('-z direction clamps pitch to the negative pitch limit', () => {
    const { pitch } = aimOrientation({ x: 0, y: 0, z: -1 })
    expect(pitch).toBeCloseTo(-PITCH_LIMIT, 10)
  })

  it('+y direction yields yaw pi/2', () => {
    const { yaw, pitch } = aimOrientation({ x: 0, y: 1, z: 0 })
    expect(yaw).toBeCloseTo(Math.PI / 2, 10)
    expect(pitch).toBeCloseTo(0, 10)
  })
})
