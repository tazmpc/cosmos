import { describe, it, expect } from 'vitest'
import { search, type SearchEntry } from './search'

const entries: SearchEntry[] = [
  { name: 'Mars', kind: 'planet', key: 'mars', mag: -2 },
  { name: 'Sirius', kind: 'star', key: 0, mag: -1.46 },
  { name: 'Sirrah', kind: 'star', key: 1, mag: 2.06 },
  { name: 'Vega', kind: 'star', key: 2, mag: 0.03 },
  { name: 'Alpha Centauri', kind: 'star', key: 3, mag: -0.27 },
]

describe('search', () => {
  it('exact match ranks first', () => {
    expect(search(entries, 'sirius')[0].name).toBe('Sirius')
  })
  it('prefix beats substring', () => {
    const r = search(entries, 'sir')
    expect(r.map(e => e.name)).toEqual(['Sirius', 'Sirrah'])
  })
  it('matches inside multi-word names', () => {
    expect(search(entries, 'centauri')[0].name).toBe('Alpha Centauri')
  })
  it('planets rank above stars at equal match quality', () => {
    const all = [...entries, { name: 'Marsic', kind: 'star' as const, key: 9, mag: 3 }]
    // both are prefix matches for "mar" — the planet must win the tiebreak
    expect(search(all, 'mar')[0].kind).toBe('planet')
  })
  it('galaxies rank above stars, below planets, at equal match quality', () => {
    const tied: SearchEntry[] = [
      { name: 'Messier Star', kind: 'star', key: 20, mag: 1 },
      { name: 'Messier Galaxy', kind: 'galaxy', key: 'm-test', mag: -26 },
      { name: 'Messier Planet', kind: 'planet', key: 'm-test-planet', mag: -30 },
    ]
    // all three are exact-prefix matches for "messier" — order must be planet, galaxy, star
    expect(search(tied, 'messier').map(e => e.kind)).toEqual(['planet', 'galaxy', 'star'])
  })
  it('empty query returns nothing', () => {
    expect(search(entries, '')).toEqual([])
  })
  it('brighter star wins the tiebreak at equal match quality', () => {
    const stars: SearchEntry[] = [
      { name: 'Denebola', kind: 'star', key: 10, mag: 2.14 },
      { name: 'Deneb', kind: 'star', key: 11, mag: 1.25 },
    ]
    // both are prefix matches for "den" — the brighter (lower mag) star must rank first
    expect(search(stars, 'den')[0].name).toBe('Deneb')
  })
  it('caps results at the limit (default 8)', () => {
    const many: SearchEntry[] = Array.from({ length: 10 }, (_, i) =>
      ({ name: `Star Alcor ${i}`, kind: 'star' as const, key: i, mag: i }))
    expect(search(many, 'alcor')).toHaveLength(8)
  })

  it('dso, asteroid, and spacecraft tie with galaxy in one tier: below planet, above star', () => {
    const tied: SearchEntry[] = [
      { name: 'Testeria Star', kind: 'star', key: 40, mag: 1 },
      { name: 'Testeria Galaxy', kind: 'galaxy', key: 'g-test', mag: -26 },
      { name: 'Testeria Dso', kind: 'dso', key: 'd-test', mag: -26 },
      { name: 'Testeria Asteroid', kind: 'asteroid', key: 'a-test', mag: -26 },
      { name: 'Testeria Spacecraft', kind: 'spacecraft', key: 's-test', mag: -26 },
      { name: 'Testeria Planet', kind: 'planet', key: 'p-test', mag: -30 },
    ]
    // all six are exact-prefix matches for "testeria" — the same match rank, so only the kind
    // tiebreak (KIND_ORDER) decides order.
    const kinds = search(tied, 'testeria', 10).map(e => e.kind)
    expect(kinds).toHaveLength(6)
    expect(kinds[0]).toBe('planet')
    expect(kinds[kinds.length - 1]).toBe('star')
    // galaxy/dso/asteroid/spacecraft all sit in the same middle tier — order among them isn't
    // asserted (their equal mag ties fall back to insertion order), only that the tier itself is
    // exactly these four kinds, sandwiched between planet and star.
    expect(new Set(kinds.slice(1, -1))).toEqual(new Set(['galaxy', 'dso', 'asteroid', 'spacecraft']))
  })

  it('perf smoke: 50 varied searches over ~13k entries complete well under budget', () => {
    const kinds = ['planet', 'galaxy', 'dso', 'asteroid', 'spacecraft', 'star'] as const
    const entries: SearchEntry[] = Array.from({ length: 13_200 }, (_, i) => ({
      name: `Object ${i} Alpha${i % 37} Beta${i % 101} Gamma${i % 293}`,
      kind: kinds[i % kinds.length],
      key: i,
      mag: (i % 41) - 20,
    }))
    // Varied: a mix of short/long, prefix/substring, numeric and alpha queries — not 50 copies of
    // the same lookup.
    const queries = Array.from({ length: 50 }, (_, i) => {
      const n = i * 260
      const variants = [`Object ${n}`, `Alpha${i % 37}`, `Beta${i % 101}`, `Gamma${i % 293}`, `${n}`]
      return variants[i % variants.length]
    })
    const start = performance.now()
    for (const q of queries) search(entries, q)
    const elapsedMs = performance.now() - start
    console.log(`search perf smoke: 50 searches over ${entries.length} entries in ${elapsedMs.toFixed(2)} ms`)
    expect(elapsedMs).toBeLessThan(250)
  })
})
