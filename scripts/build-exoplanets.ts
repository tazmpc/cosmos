/**
 * Builds public/exoplanets.json from the NASA Exoplanet Archive TAP service (`ps` table —
 * Planetary Systems, one row per default-parameter-set planet):
 *
 *   https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=select+pl_name,hostname,sy_dist,
 *   disc_year,pl_orbper,pl_rade,pl_bmasse,discoverymethod+from+ps+where+default_flag=1&format=csv
 *
 * `default_flag=1` selects exactly one parameter set per planet (the Archive's own recommended
 * "best" row), so this is a clean one-row-per-planet table, not one-row-per-publication.
 *
 * Output shape: { hosts: { [hostname]: { distPc: number | null, planets: [{ name, periodDays,
 * radiusRe, massMe, method, year }] } } }, keyed by the Archive's own `hostname` string exactly
 * as published — cross-matching that string to this project's star catalog (by name, or by the
 * curated alias map for the handful whose catalog name differs — see
 * src/data/exoplanetAliases.ts) is entirely a runtime concern (src/data/exoplanets.ts), not baked
 * in here, so this file stays a faithful, honest copy of what the Archive actually reports.
 *
 * The response is cached verbatim in scripts/cache/exoplanets.csv (gitignored) — re-running from
 * a warm cache reproduces byte-identical output.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const CACHE_PATH = 'scripts/cache/exoplanets.csv'
const TAP_URL =
  'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=' +
  encodeURIComponent(
    'select pl_name,hostname,sy_dist,disc_year,pl_orbper,pl_rade,pl_bmasse,discoverymethod from ps where default_flag=1',
  ) +
  '&format=csv'

async function fetchCached(): Promise<string> {
  mkdirSync('scripts/cache', { recursive: true })
  if (existsSync(CACHE_PATH)) {
    console.log(`Using cached response (${CACHE_PATH})`)
    return readFileSync(CACHE_PATH, 'utf8')
  }
  console.log(`Fetching ${TAP_URL}`)
  const res = await fetch(TAP_URL)
  if (!res.ok) throw new Error(`Exoplanet Archive TAP fetch failed: HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim().startsWith('pl_name')) {
    throw new Error(`Unexpected TAP response (no pl_name header):\n${text.slice(0, 500)}`)
  }
  writeFileSync(CACHE_PATH, text)
  return text
}

// ---- CSV parsing --------------------------------------------------------------------------
// The Archive's CSV quotes string fields ("pl_name","hostname","discoverymethod") and leaves
// numeric fields (sy_dist, disc_year, pl_orbper, pl_rade, pl_bmasse) unquoted, empty when null.
// A small state machine handles commas without assuming any field is comma-free, rather than a
// naive split(',') that would be one accidental embedded comma away from silently misaligning
// every column after it.
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      fields.push(cur); cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

interface Row {
  plName: string
  hostname: string
  distPc: number | null
  discYear: number | null
  periodDays: number | null
  radiusRe: number | null
  massMe: number | null
  method: string
}

function parseNum(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseCsv(text: string): Row[] {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  const col = (name: string): number => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`exoplanets.csv missing expected column "${name}"`)
    return i
  }
  const iName = col('pl_name'), iHost = col('hostname'), iDist = col('sy_dist'), iYear = col('disc_year')
  const iPeriod = col('pl_orbper'), iRadius = col('pl_rade'), iMass = col('pl_bmasse'), iMethod = col('discoverymethod')

  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i])
    if (f.length < header.length) throw new Error(`exoplanets.csv line ${i + 1}: expected ${header.length} fields, got ${f.length}`)
    const plName = f[iName].trim()
    const hostname = f[iHost].trim()
    if (!plName || !hostname) throw new Error(`exoplanets.csv line ${i + 1}: missing pl_name or hostname`)
    rows.push({
      plName, hostname,
      distPc: parseNum(f[iDist]),
      discYear: parseNum(f[iYear]),
      periodDays: parseNum(f[iPeriod]),
      radiusRe: parseNum(f[iRadius]),
      massMe: parseNum(f[iMass]),
      method: f[iMethod].trim(),
    })
  }
  return rows
}

// ---- output shape -------------------------------------------------------------------------

interface PlanetRow {
  name: string
  periodDays: number | null
  radiusRe: number | null
  massMe: number | null
  method: string
  year: number | null
}

interface HostRow {
  distPc: number | null
  planets: PlanetRow[]
}

function round(n: number | null, decimals: number): number | null {
  if (n === null) return null
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

// ---- main -----------------------------------------------------------------------------------

const text = await fetchCached()
const rows = parseCsv(text)
console.log(`Parsed ${rows.length} planet rows`)

const hosts: Record<string, HostRow> = {}
for (const r of rows) {
  let h = hosts[r.hostname]
  if (!h) { h = { distPc: null, planets: [] }; hosts[r.hostname] = h }
  if (h.distPc === null && r.distPc !== null) h.distPc = round(r.distPc, 4)
  h.planets.push({
    name: r.plName,
    periodDays: round(r.periodDays, 6),
    radiusRe: round(r.radiusRe, 4),
    massMe: round(r.massMe, 4),
    method: r.method,
    year: r.discYear,
  })
}

const hostCount = Object.keys(hosts).length
console.log(`Grouped into ${hostCount} host systems`)

// ---- gates ------------------------------------------------------------------------------------

if (rows.length < 5000) throw new Error(`Gate failed: ${rows.length} planets < 5,000 minimum`)
if (hostCount < 3500) throw new Error(`Gate failed: ${hostCount} hosts < 3,500 minimum`)
console.log(`Gates OK: ${rows.length} planets >= 5,000, ${hostCount} hosts >= 3,500`)

// Sanity: a handful of famous systems must have come through with a plausible planet count.
const expectCount: Record<string, number> = { 'TRAPPIST-1': 7, '51 Peg': 1, 'HD 209458': 1 }
for (const [host, expected] of Object.entries(expectCount)) {
  const got = hosts[host]?.planets.length ?? 0
  if (got !== expected) throw new Error(`Gate failed: expected ${host} to have ${expected} planet(s), got ${got}`)
}
console.log('Sanity checks OK: TRAPPIST-1 (7), 51 Peg (1), HD 209458 (1)')

const out = { hosts }
mkdirSync('public', { recursive: true })
writeFileSync('public/exoplanets.json', JSON.stringify(out))
console.log(`wrote ${rows.length} planets across ${hostCount} hosts -> public/exoplanets.json`)
