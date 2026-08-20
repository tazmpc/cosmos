import { describe, it, expect } from 'vitest'
import { maxSpeed, buildPointGeometry } from './starField'
import type { StarCatalog } from '../data/catalogFormat'

function catalogOf(velocities?: Float32Array): StarCatalog {
  return {
    count: 3,
    positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    absMag: new Float32Array([1, 2, 3]),
    colorIndex: new Float32Array([0.5, 0.6, 0.7]),
    velocities,
  }
}

describe('maxSpeed', () => {
  it('is zero for a catalog with no velocities (format v1)', () => {
    expect(maxSpeed(catalogOf())).toBe(0)
  })

  it('is zero for an all-zero velocity block', () => {
    expect(maxSpeed(catalogOf(new Float32Array(9)))).toBe(0)
  })

  it('returns the largest velocity magnitude, not the largest component', () => {
    // rows: |(3,4,0)| = 5, |(0,0,-6)| = 6, |(1,1,1)| = 1.732
    const v = new Float32Array([3, 4, 0, 0, 0, -6, 1, 1, 1])
    expect(maxSpeed(catalogOf(v))).toBeCloseTo(6, 6)
  })

  it('drives a cull-sphere inflation that covers the farthest a point can drift', () => {
    // The layer inflates each chunk sphere by |years| * maxSpeed. Over the app's 200 kyr clamp,
    // a Barnard-class 9.2e-5 pc/yr star moves ~18 pc — the inflation must be at least that.
    const v = new Float32Array([0, 9.22e-5, 0, 0, 0, 0, 0, 0, 0])
    expect(maxSpeed(catalogOf(v)) * 200_000).toBeGreaterThan(18)
  })
})

describe('buildPointGeometry', () => {
  it('gives a v1 catalog a zero-filled starVel attribute so one shader serves every layer', () => {
    const geo = buildPointGeometry(catalogOf())
    const vel = geo.getAttribute('starVel')
    expect(vel).toBeDefined()
    expect(vel.itemSize).toBe(3)
    expect(vel.count).toBe(3)
    expect(Array.from(vel.array as Float32Array)).toEqual(new Array(9).fill(0))
  })

  it('uploads a v2 catalog\'s real velocities unchanged', () => {
    const v = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const geo = buildPointGeometry(catalogOf(v))
    expect(Array.from(geo.getAttribute('starVel').array as Float32Array)).toEqual(Array.from(v))
  })
})
