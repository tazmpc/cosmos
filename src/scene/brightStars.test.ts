import { describe, it, expect } from 'vitest'
import type { StarCatalog } from '../data/catalogFormat'
import { pickBrightStars, haloOpacity, HALO_MAG_LIMIT } from './brightStars'
import { apparentMagnitude } from '../data/starMath'

/** Builds a catalog from [x,y,z (pc), absMag] tuples; colorIndex is irrelevant to the picker. */
function makeCatalog(rows: [number, number, number, number][]): StarCatalog {
  const positions = new Float32Array(rows.length * 3)
  const absMag = new Float32Array(rows.length)
  const colorIndex = new Float32Array(rows.length)
  rows.forEach((r, i) => {
    positions[i * 3] = r[0]; positions[i * 3 + 1] = r[1]; positions[i * 3 + 2] = r[2]
    absMag[i] = r[3]
    colorIndex[i] = 0.6
  })
  return { count: rows.length, positions, absMag, colorIndex }
}

describe('pickBrightStars', () => {
  it('ranks by apparent magnitude from Earth, not by absolute magnitude', () => {
    // A luminous supergiant far away vs a modest star nearby: absMag order is the reverse of
    // appMag order, so this fails outright if the picker sorts on absMag.
    const catalog = makeCatalog([
      [0, 0, 500, -7],   // absMag -7 at 500 pc -> appMag ~ 1.49
      [0, 0, 3, 1.4],    // absMag 1.4 at 3 pc  -> appMag ~ -1.21
    ])
    const picks = pickBrightStars(catalog)
    expect(picks.map(p => p.index)).toEqual([1, 0])
    expect(picks[0].appMag).toBeCloseTo(apparentMagnitude(1.4, 3), 5)
  })

  it('drops stars fainter than the magnitude limit', () => {
    const faintAbs = HALO_MAG_LIMIT + 1 // at 10 pc, appMag === absMag
    const catalog = makeCatalog([[0, 0, 10, 0], [0, 0, 10, faintAbs]])
    expect(pickBrightStars(catalog).map(p => p.index)).toEqual([0])
  })

  it('caps the number of halos', () => {
    const rows: [number, number, number, number][] = []
    for (let i = 0; i < 50; i++) rows.push([0, 0, 10, -5 + i * 0.01])
    expect(pickBrightStars(makeCatalog(rows), HALO_MAG_LIMIT, 10)).toHaveLength(10)
  })

  it('skips zero-distance entries instead of emitting a -Infinity magnitude', () => {
    const catalog = makeCatalog([[0, 0, 0, 1], [0, 0, 10, 1]])
    const picks = pickBrightStars(catalog)
    expect(picks.map(p => p.index)).toEqual([1])
    expect(picks.every(p => Number.isFinite(p.appMag))).toBe(true)
  })
})

describe('haloOpacity', () => {
  it('is monotonically decreasing in apparent magnitude', () => {
    const mags = [-1.5, -0.5, 0.5, 1.5, 2.5, 3.5]
    const ops = mags.map(haloOpacity)
    for (let i = 1; i < ops.length; i++) expect(ops[i]).toBeLessThanOrEqual(ops[i - 1])
  })

  it('stays inside the [0.05, 0.5] band at both extremes', () => {
    for (const m of [-30, -1.46, 0, 3.5, 30]) {
      expect(haloOpacity(m)).toBeGreaterThanOrEqual(0.05)
      expect(haloOpacity(m)).toBeLessThanOrEqual(0.5)
    }
  })

  it('separates the very brightest stars from mid-range ones by more than 2x', () => {
    // The whole point of the flux ramp: Sirius must not look like a mag-1.5 star.
    expect(haloOpacity(-1.46)).toBeGreaterThan(haloOpacity(1.5) * 2)
  })
})
