import { describe, it, expect } from 'vitest'
import { interpolateTrajectory } from './trajectory'

/** Flattens an array of {x,y,z} into the flat xyz layout interpolateTrajectory expects. */
function flatten(points: { x: number; y: number; z: number }[]): number[] {
  const out: number[] = []
  for (const p of points) out.push(p.x, p.y, p.z)
  return out
}

describe('interpolateTrajectory', () => {
  it('is exact at every sample point', () => {
    const jd = [0, 10, 25, 40, 100]
    const pts = [
      { x: 1, y: 2, z: 3 },
      { x: -4, y: 0.5, z: 7 },
      { x: 2.2, y: -9, z: 0 },
      { x: 5, y: 5, z: 5 },
      { x: -1, y: -1, z: -1 },
    ]
    const xyz = flatten(pts)
    for (let i = 0; i < jd.length; i++) {
      const r = interpolateTrajectory(jd, xyz, jd[i])
      expect(r.x).toBeCloseTo(pts[i].x, 9)
      expect(r.y).toBeCloseTo(pts[i].y, 9)
      expect(r.z).toBeCloseTo(pts[i].z, 9)
    }
  })

  it('approximates a circular orbit at the midpoint within 0.5% of the true radius', () => {
    // 30 samples over one full period of a unit-radius circular orbit in the xy plane.
    const N = 30
    const R = 1
    const jd: number[] = []
    const pts: { x: number; y: number; z: number }[] = []
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * 2 * Math.PI
      jd.push(i) // one "day" per sample, arbitrary uniform spacing
      pts.push({ x: R * Math.cos(theta), y: R * Math.sin(theta), z: 0 })
    }
    const xyz = flatten(pts)
    // Midpoint of segment [5, 6] -> jd 5.5
    for (const i of [0, 5, 14, 28]) {
      const midJd = jd[i] + 0.5
      const r = interpolateTrajectory(jd, xyz, midJd)
      const radius = Math.hypot(r.x, r.y, r.z)
      expect(Math.abs(radius - R) / R).toBeLessThan(0.005)
    }
  })

  it('clamps to the first sample before the start of the range', () => {
    const jd = [10, 20, 30]
    const xyz = flatten([
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ])
    const r = interpolateTrajectory(jd, xyz, -500)
    expect(r).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('clamps to the last sample beyond the end of the range', () => {
    const jd = [10, 20, 30]
    const xyz = flatten([
      { x: 1, y: 1, z: 1 },
      { x: 2, y: 2, z: 2 },
      { x: 3, y: 3, z: 3 },
    ])
    const r = interpolateTrajectory(jd, xyz, 1e6)
    expect(r).toEqual({ x: 3, y: 3, z: 3 })
  })

  it('binary search picks the correct segment for a jd exactly on a sample boundary', () => {
    // A non-uniform grid with many samples, so a linear scan bug (always segment 0, or an
    // off-by-one at the boundary) would be caught: every internal boundary is exercised.
    const jd = [0, 1, 3, 3.5, 10, 10.001, 50, 200]
    const pts = jd.map((t, i) => ({ x: t, y: i * 2, z: -i }))
    const xyz = flatten(pts)
    for (let i = 0; i < jd.length; i++) {
      const r = interpolateTrajectory(jd, xyz, jd[i])
      expect(r.x).toBeCloseTo(pts[i].x, 9)
      expect(r.y).toBeCloseTo(pts[i].y, 9)
      expect(r.z).toBeCloseTo(pts[i].z, 9)
    }
  })

  it('reproduces a linear trajectory exactly at any point, not just samples', () => {
    // Non-uniform sample spacing on purpose: a linear function's tangent formula must still give
    // the exact slope regardless of spacing for the Hermite curve to collapse onto the line.
    const jd = [0, 2, 3, 7, 8, 20]
    const v = { x: 0.3, y: -1.7, z: 2.0 } // AU/day
    const p0 = { x: 10, y: -5, z: 1 }
    const pts = jd.map((t) => ({ x: p0.x + v.x * t, y: p0.y + v.y * t, z: p0.z + v.z * t }))
    const xyz = flatten(pts)
    for (const t of [0.5, 1, 2.6, 5, 6.9, 7.001, 15, 19.99]) {
      const r = interpolateTrajectory(jd, xyz, t)
      expect(r.x).toBeCloseTo(p0.x + v.x * t, 9)
      expect(r.y).toBeCloseTo(p0.y + v.y * t, 9)
      expect(r.z).toBeCloseTo(p0.z + v.z * t, 9)
    }
  })

  it('handles a two-sample trajectory (only one segment, both tangents one-sided)', () => {
    const jd = [0, 10]
    const xyz = flatten([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ])
    const r = interpolateTrajectory(jd, xyz, 5)
    expect(r.x).toBeCloseTo(5, 9)
    expect(r.y).toBeCloseTo(0, 9)
    expect(r.z).toBeCloseTo(0, 9)
  })
})
