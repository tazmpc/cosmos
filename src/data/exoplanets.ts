import { CATALOG_NAME_TO_ARCHIVE_HOST } from './exoplanetAliases'

/** One row of public/exoplanets.json (scripts/build-exoplanets.ts) — a NASA Exoplanet Archive
 *  `ps` table row (default_flag=1) for one confirmed planet. Any numeric field can be null: the
 *  Archive's own recommended parameter set genuinely leaves some measurements unreported (e.g.
 *  every TRAPPIST-1 planet has no sy_dist in this snapshot, and radial-velocity planets routinely
 *  have no measured radius). */
export interface ExoplanetRow {
  name: string
  periodDays: number | null
  radiusRe: number | null
  massMe: number | null
  method: string
  year: number | null
}

export interface ExoplanetHost {
  /** Parsecs. Null when the Archive's default row for this system has no sy_dist. */
  distPc: number | null
  planets: ExoplanetRow[]
}

export interface ExoplanetCatalog {
  /** Keyed by the Archive's own `hostname` string exactly as published — cross-matching that to
   *  this project's star catalog is entirely a runtime concern, handled by hostForStarName below. */
  hosts: Record<string, ExoplanetHost>
}

export async function loadExoplanets(): Promise<ExoplanetCatalog> {
  const res = await fetch(import.meta.env.BASE_URL + 'exoplanets.json')
  if (!res.ok) throw new Error(`exoplanets.json fetch failed: HTTP ${res.status}`)
  return (await res.json()) as ExoplanetCatalog
}

/** Looks up the exoplanet host record for a star known to this project's catalog, by its display
 *  name (the same string shown in the star's own info card / search entry). Tries the name
 *  directly first — covers any Archive hostname that happens to already match a catalog proper
 *  name verbatim — then falls back to the curated alias map (src/data/exoplanetAliases.ts) for
 *  the handful of famous hosts whose Archive hostname differs from the catalog's proper name. */
export function hostForStarName(catalog: ExoplanetCatalog, starName: string): ExoplanetHost | undefined {
  if (catalog.hosts[starName]) return catalog.hosts[starName]
  const archiveHost = CATALOG_NAME_TO_ARCHIVE_HOST[starName]
  return archiveHost ? catalog.hosts[archiveHost] : undefined
}

/** Cap on how many planets summarizePlanets lists individually before folding the rest into a
 *  "+N more" tail — none of this project's curated hosts need it (TRAPPIST-1 tops out at 7), but
 *  it keeps the card readable for any host with an unusually large confirmed system. */
const MAX_LISTED_PLANETS = 8

function planetFragment(p: ExoplanetRow): string {
  const parts: string[] = []
  if (p.radiusRe != null) parts.push(`${p.radiusRe.toFixed(2)} R⊕`)
  else if (p.massMe != null) parts.push(`${p.massMe.toFixed(1)} M⊕`)
  if (p.periodDays != null) parts.push(`${p.periodDays.toFixed(2)} d`)
  return parts.length ? `${p.name} (${parts.join(', ')})` : p.name
}

/** "Known planets" card fact text, e.g. "1 — 51 Peg b (193.9 M⊕, 4.23 d)" or, for TRAPPIST-1,
 *  "7 — TRAPPIST-1 b (1.12 R⊕, 1.51 d), TRAPPIST-1 c (1.10 R⊕, 2.42 d), …". */
export function summarizePlanets(host: ExoplanetHost): string {
  const listed = host.planets.slice(0, MAX_LISTED_PLANETS).map(planetFragment)
  const suffix = host.planets.length > MAX_LISTED_PLANETS ? `, +${host.planets.length - MAX_LISTED_PLANETS} more` : ''
  return `${host.planets.length} — ${listed.join(', ')}${suffix}`
}
