export interface SearchEntry {
  name: string
  kind: 'planet' | 'galaxy' | 'dso' | 'star'
  key: string | number // planet id, galaxy id, deep-sky-object id, or star index
  mag: number          // for tie-breaking: brighter first
  label?: string        // display override for renderResults (kind stays 'planet' for ranking)
}

// kind tiebreak order at equal match rank: planet > (galaxy, dso) > star — dso shares the
// galaxy rank tier since both are curated non-star landmarks with hips2fits imagery.
const KIND_ORDER: Record<SearchEntry['kind'], number> = { planet: 0, galaxy: 1, dso: 1, star: 2 }

function matchRank(query: string, name: string): number | null {
  const q = query.toLowerCase().trim()
  const n = name.toLowerCase()
  if (!q) return null
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.includes(q)) return 2
  return null
}

export function search(entries: SearchEntry[], query: string, limit = 8): SearchEntry[] {
  return entries
    .map(e => ({ e, rank: matchRank(query, e.name) }))
    .filter((x): x is { e: SearchEntry; rank: number } => x.rank !== null)
    .sort((a, b) =>
      a.rank - b.rank ||
      (a.e.kind !== b.e.kind ? KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] : a.e.mag - b.e.mag))
    .slice(0, limit)
    .map(x => x.e)
}
