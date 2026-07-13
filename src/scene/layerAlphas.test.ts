import { describe, it, expect } from 'vitest'
import { layerAlphas } from './layerAlphas'
import { KPC_TO_AU as KPC, MPC_TO_AU as MPC } from '../data/units'

describe('layerAlphas', () => {
  it('near Earth: stars only', () => {
    const a = layerAlphas(1)
    expect(a.stars).toBe(1); expect(a.milkyWay).toBe(0); expect(a.galaxies).toBe(0)
  })
  it('at 5 kpc: MW rising, stars fading', () => {
    const a = layerAlphas(5 * KPC)
    expect(a.milkyWay).toBeGreaterThan(0.5)
    expect(a.stars).toBeLessThan(1)
  })
  it('at 10 Mpc: galaxies only', () => {
    const a = layerAlphas(10 * MPC)
    expect(a.stars).toBe(0); expect(a.milkyWay).toBe(0); expect(a.galaxies).toBe(1)
  })
  it('alphas are within [0,1] across 20 log-spaced distances', () => {
    for (let e = 0; e <= 19; e++) {
      const a = layerAlphas(Math.pow(10, e))
      for (const v of [a.stars, a.milkyWay, a.galaxies]) {
        expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
