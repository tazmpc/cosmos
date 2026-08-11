import { describe, it, expect } from 'vitest'
import { dedupe, type GalaxyRow } from './galaxyDedup'

function row(partial: Partial<GalaxyRow> & Pick<GalaxyRow, 'source'>): GalaxyRow {
  return {
    raDeg: 10,
    decDeg: 20,
    distMpc: 100,
    czKms: 7000,
    absMag: -20,
    colorIndex: 1.0,
    ...partial,
  }
}

const SOURCES: GalaxyRow['source'][] = ['cf4', 'sdss', '6df', '2mrs']
const PREFERENCE: Record<GalaxyRow['source'], number> = { cf4: 0, sdss: 1, '6df': 2, '2mrs': 3 }

describe('dedupe', () => {
  it('keeps the higher-preference source for every survey pairing at the same position', () => {
    for (let a = 0; a < SOURCES.length; a++) {
      for (let b = a + 1; b < SOURCES.length; b++) {
        const sourceA = SOURCES[a]
        const sourceB = SOURCES[b]
        const rows = [
          row({ source: sourceA, raDeg: 50, decDeg: -10, distMpc: 150, czKms: 9000 }),
          row({ source: sourceB, raDeg: 50.01, decDeg: -10.01, distMpc: 150.5, czKms: 9050 }),
        ]
        const { kept, removedBySource } = dedupe(rows)
        expect(kept.length).toBe(1)
        // lower PREFERENCE number wins (cf4=0 is most preferred)
        const winner = PREFERENCE[sourceA] < PREFERENCE[sourceB] ? sourceA : sourceB
        const loser = winner === sourceA ? sourceB : sourceA
        expect(kept[0].source).toBe(winner)
        expect(removedBySource[loser]).toBe(1)
      }
    }
  })

  it('keeps both when 1.1 degrees apart (outside the 1 degree separation threshold)', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 100, decDeg: 0, distMpc: 50, czKms: 5000 }),
      row({ source: 'sdss', raDeg: 101.1, decDeg: 0, distMpc: 50, czKms: 5000 }),
    ]
    const { kept } = dedupe(rows)
    expect(kept.length).toBe(2)
  })

  it('keeps both when at the same position but delta-cz is 700 km/s and delta-dist is large (neither similarity condition met)', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 200, decDeg: 30, distMpc: 80, czKms: 6000 }),
      row({ source: 'sdss', raDeg: 200, decDeg: 30, distMpc: 90, czKms: 6700 }),
    ]
    const { kept } = dedupe(rows)
    expect(kept.length).toBe(2)
  })

  it('requires BOTH cz and distance to agree, not either alone — cz agrees but distance is far apart stays two galaxies', () => {
    // At cosmological depth 1 degree spans many Mpc transverse; an "OR" rule collapses
    // distinct cluster/filament members onto a single kept point (verified empirically:
    // ~32% of SDSS against CF4 alone). Requiring AND keeps this a same-object identification
    // rule rather than a large-scale-structure decimator.
    const rows = [
      row({ source: 'cf4', raDeg: 75, decDeg: -20, distMpc: 100, czKms: 7000 }),
      row({ source: 'sdss', raDeg: 75.02, decDeg: -20.01, distMpc: 115, czKms: 7050 }), // cz close, dist far
    ]
    const { kept } = dedupe(rows)
    expect(kept.length).toBe(2)
  })

  it('requires BOTH cz and distance to agree — distance agrees but cz is far apart stays two galaxies', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 220, decDeg: 10, distMpc: 100, czKms: 7000 }),
      row({ source: 'sdss', raDeg: 220.02, decDeg: 10.01, distMpc: 100.5, czKms: 8000 }), // dist close, cz far
    ]
    const { kept } = dedupe(rows)
    expect(kept.length).toBe(2)
  })

  it('catches a duplicate across the RA=0/360 wrap boundary', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 359.9, decDeg: 5, distMpc: 60, czKms: 4000 }),
      row({ source: 'sdss', raDeg: 0.1, decDeg: 5, distMpc: 60.2, czKms: 4020 }),
    ]
    const { kept, removedBySource } = dedupe(rows)
    expect(kept.length).toBe(1)
    expect(kept[0].source).toBe('cf4')
    expect(removedBySource.sdss).toBe(1)
  })

  it('never drops a negative-cz CF4 row (Local Group), even against another kept CF4 row nearby', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 10.68, decDeg: 41.27, distMpc: 0.78, czKms: -301 }), // M31
      row({ source: 'cf4', raDeg: 10.7, decDeg: 41.3, distMpc: 0.75, czKms: -280 }), // another close CF4 Local Group entry
    ]
    const { kept, removedBySource } = dedupe(rows)
    expect(kept.length).toBe(2)
    expect(removedBySource.cf4 ?? 0).toBe(0)
  })

  it('never drops a negative-cz CF4 row even when a higher-preference... there is none above cf4, but a same-source near-duplicate must still both survive', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 300, decDeg: -60, distMpc: 1.2, czKms: -50 }),
      row({ source: 'cf4', raDeg: 300.05, decDeg: -60.02, distMpc: 1.19, czKms: -45 }),
      row({ source: 'cf4', raDeg: 300.02, decDeg: -60.01, distMpc: 1.21, czKms: -55 }),
    ]
    const { kept } = dedupe(rows)
    expect(kept.length).toBe(3)
  })

  it('does not merge two same-source rows that happen to sit within threshold (each survey is internally already deduplicated)', () => {
    const rows = [
      row({ source: 'sdss', raDeg: 150, decDeg: 10, distMpc: 300, czKms: 22000 }),
      row({ source: 'sdss', raDeg: 150.05, decDeg: 10.02, distMpc: 300.5, czKms: 22040 }),
    ]
    const { kept, removedBySource } = dedupe(rows)
    expect(kept.length).toBe(2)
    expect(removedBySource.sdss ?? 0).toBe(0)
  })

  it('handles near-pole points without missing duplicates across large RA separation', () => {
    const rows = [
      row({ source: 'cf4', raDeg: 5, decDeg: 89.7, distMpc: 40, czKms: 3000 }),
      row({ source: 'sdss', raDeg: 175, decDeg: 89.7, distMpc: 40.1, czKms: 3010 }),
    ]
    const { kept, removedBySource } = dedupe(rows)
    // at dec=89.7, ra=5 and ra=175 are well within 1 degree of true angular separation
    expect(kept.length).toBe(1)
    expect(removedBySource.sdss).toBe(1)
  })

  it('performance smoke: 200k synthetic rows dedupe in under 5 seconds', () => {
    const n = 200_000
    const rows: GalaxyRow[] = new Array(n)
    let seed = 42
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < n; i++) {
      const raDeg = rand() * 360
      const decDeg = Math.asin(2 * rand() - 1) * (180 / Math.PI) // solid-angle-uniform
      const source = SOURCES[i % SOURCES.length]
      rows[i] = row({
        source,
        raDeg,
        decDeg,
        distMpc: 10 + rand() * 900,
        czKms: rand() * 60000,
      })
    }
    const start = Date.now()
    const { kept } = dedupe(rows)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThanOrEqual(n)
  })
})
