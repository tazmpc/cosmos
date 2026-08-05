import { describe, it, expect } from 'vitest'
import { chunkCatalog } from './chunkCatalog'
import type { StarCatalog } from './catalogFormat'

function makeCatalog(pts: [number, number, number][], absMag?: number[], colorIndex?: number[]): StarCatalog {
  const count = pts.length
  const positions = new Float32Array(count * 3)
  pts.forEach((p, i) => { positions[i * 3] = p[0]; positions[i * 3 + 1] = p[1]; positions[i * 3 + 2] = p[2] })
  return {
    count,
    positions,
    absMag: Float32Array.from(absMag ?? pts.map((_, i) => i)),
    colorIndex: Float32Array.from(colorIndex ?? pts.map((_, i) => i * 0.25)),
  }
}

/** Every (position, absMag, colorIndex) row, as a sortable string — for multiset comparison. */
function rows(c: StarCatalog): string[] {
  const out: string[] = []
  for (let i = 0; i < c.count; i++) {
    out.push([c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2], c.absMag[i], c.colorIndex[i]].join(','))
  }
  return out.sort()
}

const OCTANTS: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
]

describe('chunkCatalog', () => {
  it('partitions [0,count) contiguously with no gaps or overlap', () => {
    const cat = makeCatalog(OCTANTS)
    const { catalog, chunks } = chunkCatalog(cat, 8)
    expect(catalog.count).toBe(8)
    let cursor = 0
    for (const ch of chunks) {
      expect(ch.start).toBe(cursor)
      expect(ch.count).toBeGreaterThan(0)
      cursor += ch.count
    }
    expect(cursor).toBe(catalog.count)
  })

  it('separates 8 points in known octants into 8 single-point chunks', () => {
    const { catalog, chunks } = chunkCatalog(makeCatalog(OCTANTS), 8)
    expect(chunks.length).toBe(8)
    for (const ch of chunks) {
      expect(ch.count).toBe(1)
      expect(ch.radius).toBe(0)
      // a one-point chunk's center is that point
      expect([catalog.positions[ch.start * 3], catalog.positions[ch.start * 3 + 1], catalog.positions[ch.start * 3 + 2]])
        .toEqual(ch.center)
    }
  })

  it('every point lies within its chunk bounding sphere', () => {
    const pts: [number, number, number][] = []
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 2000; i++) pts.push([rnd() * 200 - 100, rnd() * 50, rnd() * 1000])
    const { catalog, chunks } = chunkCatalog(makeCatalog(pts), 64)
    expect(chunks.length).toBeGreaterThan(1)
    for (const ch of chunks) {
      for (let i = ch.start; i < ch.start + ch.count; i++) {
        const d = Math.hypot(
          catalog.positions[i * 3] - ch.center[0],
          catalog.positions[i * 3 + 1] - ch.center[1],
          catalog.positions[i * 3 + 2] - ch.center[2])
        expect(d).toBeLessThanOrEqual(ch.radius + 1e-4)
      }
    }
  })

  it('preserves the multiset of (position, absMag, colorIndex) rows', () => {
    const pts: [number, number, number][] = []
    let seed = 999
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 500; i++) pts.push([rnd() * 10, rnd() * 10, rnd() * 10])
    const cat = makeCatalog(pts)
    const before = rows(cat)
    const { catalog } = chunkCatalog(cat, 27)
    expect(rows(catalog)).toEqual(before)
    expect(catalog.count).toBe(cat.count)
  })

  it('newIndexOf maps each original row to its position in the reordered catalog', () => {
    const pts: [number, number, number][] = []
    let seed = 7
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 300; i++) pts.push([rnd() * 10, rnd() * 10, rnd() * 10])
    const cat = makeCatalog(pts)
    const { catalog, newIndexOf } = chunkCatalog(cat, 64)
    expect(newIndexOf.length).toBe(cat.count)
    const seen = new Set<number>()
    for (let i = 0; i < cat.count; i++) {
      const j = newIndexOf[i]
      expect(seen.has(j)).toBe(false)
      seen.add(j)
      expect(catalog.positions[j * 3]).toBe(cat.positions[i * 3])
      expect(catalog.positions[j * 3 + 1]).toBe(cat.positions[i * 3 + 1])
      expect(catalog.positions[j * 3 + 2]).toBe(cat.positions[i * 3 + 2])
      expect(catalog.absMag[j]).toBe(cat.absMag[i])
      expect(catalog.colorIndex[j]).toBe(cat.colorIndex[i])
    }
  })

  it('collapses a degenerate all-identical catalog to one zero-radius chunk', () => {
    const pts: [number, number, number][] = Array.from({ length: 50 }, () => [3, -4, 5] as [number, number, number])
    const { chunks } = chunkCatalog(makeCatalog(pts), 64)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toMatchObject({ start: 0, count: 50, radius: 0 })
    expect(chunks[0].center).toEqual([3, -4, 5])
  })

  it('is order-stable within a chunk', () => {
    // three points in the same cell keep their relative order
    const cat = makeCatalog([[0, 0, 0], [0.1, 0, 0], [10, 10, 10], [0.2, 0, 0]])
    const { catalog } = chunkCatalog(cat, 8)
    const mags: number[] = []
    for (let i = 0; i < catalog.count; i++) if (catalog.positions[i * 3] < 1) mags.push(catalog.absMag[i])
    expect(mags).toEqual([0, 1, 3]) // original indices 0,1,3 in original order
  })

  it('handles an empty catalog', () => {
    const { catalog, chunks } = chunkCatalog(makeCatalog([]), 64)
    expect(chunks).toEqual([])
    expect(catalog.count).toBe(0)
  })

  it('holds every chunk under the per-chunk point cap implied by targetChunks', () => {
    const pts: [number, number, number][] = []
    for (let i = 0; i < 1000; i++) pts.push([i, i % 7, i % 13])
    const { chunks } = chunkCatalog(makeCatalog(pts), 64)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.count).toBeLessThanOrEqual(Math.ceil(1000 / 64))
  })

  it('keeps a centrally-concentrated catalog cullable: a narrow cone from the center draws a small share of the points', () => {
    // The reason for midpoint/octree splits over a uniform grid or equal-count median splits.
    // Both of those put most of the catalog into a handful of chunks that engulf the camera at
    // the density center, so culling chunks culled almost no vertices — the exact failure this
    // test pins down. On THIS cloud: uniform 4^3 grid 87% drawn, uniform 8^3 grid 73%, k-d median
    // splits (64 chunks) 83%, octree 49%. On the real star catalog the same comparison was
    // 93% / — / 77% / 30%.
    const pts: [number, number, number][] = []
    let seed = 4242
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 40000; i++) {
      const r = Math.pow(rnd(), 3) * 1000 // strong r^3 concentration toward the origin
      const t = rnd() * Math.PI * 2, u = rnd() * 2 - 1, s = Math.sqrt(1 - u * u)
      pts.push([r * s * Math.cos(t), r * s * Math.sin(t), r * u])
    }
    const { chunks } = chunkCatalog(makeCatalog(pts), 128)

    // camera at the origin looking down +x with a 55° vertical FOV: keep every chunk whose
    // bounding sphere is not fully outside one of the four side planes (a plain cone test).
    const tan = Math.tan(55 * Math.PI / 360)
    const sidePlanes = [ // inward normals of the four side planes, all through the origin
      [-tan, 1, 0], [-tan, -1, 0], [-tan, 0, 1], [-tan, 0, -1],
    ].map(n => { const l = Math.hypot(n[0], n[1], n[2]); return n.map(v => v / l) })
    let drawn = 0
    let total = 0
    for (const c of chunks) {
      total += c.count
      const visible = sidePlanes.every(p =>
        p[0] * c.center[0] + p[1] * c.center[1] + p[2] * c.center[2] >= -c.radius)
      if (visible) drawn += c.count
    }
    expect(drawn / total).toBeLessThan(0.6)
  })
})
