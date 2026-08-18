export interface SearchEntry {
  name: string
  kind: 'planet' | 'galaxy' | 'dso' | 'asteroid' | 'spacecraft' | 'star'
  key: string | number // planet id, galaxy id, deep-sky-object id, asteroid id, spacecraft id, or star index
  mag: number          // for tie-breaking: brighter first
  label?: string        // display override for renderResults (kind stays 'planet' for ranking)
}

// kind tiebreak order at equal match rank: planet > (galaxy, dso, asteroid, spacecraft) > star —
// dso shares the galaxy rank tier since both are curated non-star landmarks with hips2fits
// imagery, and the named asteroids and spacecraft sit in that same tier as the other curated
// non-star bodies.
const KIND_ORDER: Record<SearchEntry['kind'], number> = {
  planet: 0, galaxy: 1, dso: 1, asteroid: 1, spacecraft: 1, star: 2,
}

// Lowercased name per entry, computed once and reused across every keystroke. Since OpenNGC
// landed (~12.4k extra entries — see src/data/openNgc.ts), a naive per-keystroke
// `name.toLowerCase()` over the whole entries array measured well above the <2ms target (a
// micro-benchmark against the real openngc.json + starnames.json data: ~7-35ms/call depending on
// query, all over the plan's 5ms memoization trigger). A WeakMap keyed by the entry object itself
// survives entries being appended later (openNgcPromise.then pushes ~12.4k more into the same
// array main.ts already handed to search()) without needing invalidation — new entries just miss
// the cache once and get memoized on their first search.
const lowerNameCache = new WeakMap<SearchEntry, string>()
function lowerName(e: SearchEntry): string {
  let n = lowerNameCache.get(e)
  if (n === undefined) {
    n = e.name.toLowerCase()
    lowerNameCache.set(e, n)
  }
  return n
}

// q is always non-empty here — search() returns before calling this when the trimmed query is
// empty, so there's no need to re-check.
function matchRank(q: string, n: string): number | null {
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.includes(q)) return 2
  return null
}

export function search(entries: SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  return entries
    .map(e => ({ e, rank: matchRank(q, lowerName(e)) }))
    .filter((x): x is { e: SearchEntry; rank: number } => x.rank !== null)
    .sort((a, b) =>
      a.rank - b.rank ||
      (a.e.kind !== b.e.kind ? KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] : a.e.mag - b.e.mag))
    .slice(0, limit)
    .map(x => x.e)
}
