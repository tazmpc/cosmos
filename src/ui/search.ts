export interface SearchEntry {
  name: string
  kind: 'planet' | 'star'
  key: string | number // planet id or star index
  mag: number          // for tie-breaking: brighter first
}

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
      (a.e.kind !== b.e.kind ? (a.e.kind === 'planet' ? -1 : 1) : a.e.mag - b.e.mag))
    .slice(0, limit)
    .map(x => x.e)
}
