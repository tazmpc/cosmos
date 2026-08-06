import { describe, it, expect } from 'vitest'
import { layerAlphas } from './layerAlphas'
import { KPC_TO_AU as KPC, MPC_TO_AU as MPC } from '../data/units'

describe('layerAlphas', () => {
  it('near Earth: stars only', () => {
    const a = layerAlphas(1)
    expect(a.stars).toBe(1)
    expect(a.milkyWay).toBe(0)
    expect(a.milkyWayExt).toBe(0)
    expect(a.galaxies).toBe(0)
  })

  it('at 5 kpc: interior MW rising, stars fading, exterior still off', () => {
    const a = layerAlphas(5 * KPC)
    expect(a.milkyWay).toBeGreaterThan(0.5)
    expect(a.stars).toBeLessThan(1)
    // the exterior layer must not appear while the camera is still inside the galaxy
    expect(a.milkyWayExt).toBe(0)
  })

  it('at 10 Mpc: galaxies only', () => {
    const a = layerAlphas(10 * MPC)
    expect(a.stars).toBe(0)
    expect(a.milkyWay).toBe(0)
    expect(a.milkyWayExt).toBe(0)
    expect(a.galaxies).toBe(1)
  })

  it('interior MW owns the inside and is gone past the handoff', () => {
    expect(layerAlphas(8 * KPC).milkyWay).toBe(1)
    expect(layerAlphas(12 * KPC).milkyWay).toBe(1)
    expect(layerAlphas(28 * KPC).milkyWay).toBe(0)
    expect(layerAlphas(100 * KPC).milkyWay).toBe(0)
  })

  it('exterior MW owns the outside: off inside the handoff, full past it', () => {
    expect(layerAlphas(12 * KPC).milkyWayExt).toBe(0)
    expect(layerAlphas(28 * KPC).milkyWayExt).toBe(1)
    expect(layerAlphas(200 * KPC).milkyWayExt).toBe(1)
  })

  it('the two MW layers sum to exactly 1 through the whole handoff — no bump, no sag', () => {
    // This is the property that matters on a flythrough: a sum that dips would dim the galaxy
    // partway out and brighten it again, and a sum above 1 would flash it. The two layers split
    // one ramp, so the sum must be flat to floating-point noise.
    for (let kpc = 8; kpc <= 100; kpc += 0.25) {
      const a = layerAlphas(kpc * KPC)
      expect(a.milkyWay + a.milkyWayExt).toBeCloseTo(1, 10)
    }
  })

  it('the layers actually cross over — each dominates on its own side', () => {
    const inside = layerAlphas(15 * KPC)
    expect(inside.milkyWay).toBeGreaterThan(inside.milkyWayExt)
    const outside = layerAlphas(25 * KPC)
    expect(outside.milkyWayExt).toBeGreaterThan(outside.milkyWay)
  })

  it('alphas are within [0,1] across 20 log-spaced distances', () => {
    for (let e = 0; e <= 19; e++) {
      const a = layerAlphas(Math.pow(10, e))
      for (const v of [a.stars, a.milkyWay, a.milkyWayExt, a.galaxies]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
