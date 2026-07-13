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
})
