/** Builds public/openngc.json from scripts/cache/NGC.csv — the OpenNGC project's main catalog
 *  (mattiaverga/OpenNGC, CC-BY-SA-4.0), ~14k NGC/IC rows, semicolon-separated. This is the ~14k
 *  "everything else" layer sitting under the 15 hand-curated deep-sky objects (src/data/deepSky.ts)
 *  and the ~26 curated galaxies (src/data/galaxies.ts): typed, positioned, searchable, but with no
 *  hand-written facts and (mostly) no measured distance.
 *
 *  Download (not committed, scripts/cache/ is gitignored):
 *    curl -sL -o scripts/cache/NGC.csv \
 *      https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv
 *
 *  Columns used (of 32; see the CSV header for the rest):
 *    Name (catalog id, e.g. "NGC0891", "IC0080 NED01" for multi-nucleus components)
 *    Type (raw type code, see TYPE_INFO below)
 *    RA / Dec (sexagesimal: "HH:MM:SS.ss" / "+DD:MM:SS.s")
 *    MajAx (major axis, arcmin — often blank)
 *    V-Mag (visual magnitude — often blank; ~30% coverage)
 *    M (Messier cross-reference number, zero-padded 3-digit — rarely present, ~107 rows)
 *    Common names (comma-separated; first one used as the display name when present)
 *
 *  No distance column exists in the base CSV at all. Every object gets a type-based placeholder
 *  distance (DIST_PC_BY_CATEGORY below) and distEstimated: true — this is a deliberate honesty
 *  trade-off (see spec's honesty-notes convention): position (RA/Dec) is exact, distance is a
 *  category median standing in for a real measurement so the object has *somewhere* to be placed
 *  and *some* card distance, not a precise claim.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { PC_TO_LY } from '../src/data/units'

// ---- type mapping ---------------------------------------------------------------------------
// Every raw code found in NGC.csv (20 distinct codes, checked below) must resolve to a human
// label. Codes with no natural single-word label ("Other" — OpenNGC's own catch-all for objects
// whose classification needs a footnote) fall to the generic 'object' category/label rather than
// being treated as a parse failure — the gate is "zero codes silently unmapped", not "zero codes
// generic".
type ObjectCategory = 'galaxy' | 'globular' | 'open' | 'planetary' | 'nebula' | 'snr' | 'other'

const TYPE_INFO: Record<string, { label: string; category: ObjectCategory }> = {
  G: { label: 'galaxy', category: 'galaxy' },
  GPair: { label: 'galaxy pair', category: 'galaxy' },
  GTrpl: { label: 'galaxy triplet', category: 'galaxy' },
  GGroup: { label: 'galaxy group', category: 'galaxy' },
  GCl: { label: 'globular cluster', category: 'globular' },
  OCl: { label: 'open cluster', category: 'open' },
  'Cl+N': { label: 'open cluster with nebulosity', category: 'open' },
  PN: { label: 'planetary nebula', category: 'planetary' },
  Neb: { label: 'nebula', category: 'nebula' },
  HII: { label: 'nebula (H II region)', category: 'nebula' },
  EmN: { label: 'emission nebula', category: 'nebula' },
  RfN: { label: 'reflection nebula', category: 'nebula' },
  SNR: { label: 'supernova remnant', category: 'snr' },
  Other: { label: 'object', category: 'other' },
}

// Excluded from output entirely — not a type-mapping gap, a data-quality one: these rows are
// misclassified stars/novae caught up in the historical NGC/IC numbering, bookkeeping duplicates
// (a second catalog number for a physical object already emitted under its primary number), or
// "nominal position, does not exist" placeholders. None of these are deep-sky objects to search
// or fly to.
const EXCLUDE_TYPES = new Set(['Dup', 'NonEx', '*', '**', '*Ass', 'Nova'])

// Type-based placeholder distances (parsecs) per the plan: no distance column exists in the base
// CSV, so every object is placed at its category's typical distance and flagged distEstimated.
// 'other' (OpenNGC's ambiguous "Other" bucket, ~419 rows spanning odd notes-only entries) has no
// natural category of its own — treated as nebula-scale (2 kpc), a reasonable generic middle
// ground rather than inventing a seventh number with no basis.
const DIST_PC_BY_CATEGORY: Record<ObjectCategory, number> = {
  galaxy: 15_000_000, // 15 Mpc
  globular: 10_000, // 10 kpc
  open: 1_500, // 1.5 kpc
  planetary: 1_000, // 1 kpc
  nebula: 2_000, // 2 kpc
  snr: 3_000, // 3 kpc
  other: 2_000,
}

// ---- curated-collision skip-list -------------------------------------------------------------
// Every src/data/deepSky.ts and src/data/galaxies.ts entry that corresponds to a real NGC/IC
// catalog number, mapped by hand to OpenNGC's zero-padded Name field. Curated wins: these ids are
// dropped from the OpenNGC output so search/cards resolve to the richer hand-written entry.
// Galaxy-catalog "cluster" entries (virgo-cluster, fornax-cluster, coma-cluster, perseus-cluster)
// have no single NGC/IC number and so nothing to skip. M45 (Pleiades, curated id "m45") also has
// no NGC/IC number in OpenNGC — nothing to skip there either.
const CURATED_SKIP_IDS = new Set([
  // src/data/deepSky.ts
  'NGC1976', // m42 — Orion Nebula
  'NGC3372', // carina-nebula — Carina Nebula
  'NGC6523', // m8 — Lagoon Nebula
  'NGC6611', // m16 — Eagle Nebula
  'NGC6514', // m20 — Trifid Nebula
  'NGC6720', // m57 — Ring Nebula
  'NGC6853', // m27 — Dumbbell Nebula
  'NGC1952', // m1 — Crab Nebula
  'NGC7293', // helix — Helix Nebula
  'NGC2237', // rosette — Rosette Nebula
  'NGC6205', // m13 — Hercules Cluster
  'NGC5139', // omega-centauri — Omega Centauri
  'NGC0104', // 47-tucanae — 47 Tucanae
  'NGC0869', // double-cluster — Double Cluster (h Per)
  'NGC0884', // double-cluster — Double Cluster (chi Per)
  // src/data/galaxies.ts
  'NGC0224', // m31 — Andromeda Galaxy
  'NGC0598', // m33 — Triangulum Galaxy
  'NGC3031', // m81 — Bode's Galaxy
  'NGC3034', // m82 — Cigar Galaxy
  'NGC4486', // m87 — Virgo A
  'NGC4594', // m104 — Sombrero Galaxy
  'NGC5194', // m51 — Whirlpool Galaxy
  'NGC5457', // m101 — Pinwheel Galaxy
  'NGC5128', // centaurus-a — Centaurus A
  'NGC4472', // m49
  'NGC4649', // m60
  'NGC1316', // ngc1316 — Fornax A
  'NGC0253', // ngc253 — Sculptor Galaxy
  'NGC4874', // ngc4874
  'NGC4889', // ngc4889
  'NGC1275', // ngc1275 — Perseus A
  'NGC4736', // m94
  'NGC5236', // m83 — Southern Pinwheel Galaxy
  'NGC4826', // m64 — Black Eye Galaxy
  'NGC5055', // m63 — Sunflower Galaxy
  'NGC0891', // ngc891
  'NGC1068', // m77 — M77 (Cetus A)
  'NGC1300', // ngc1300
  'NGC1365', // ngc1365
  'NGC5195', // ngc5195
  'IC1101', // ic1101
])

// ---- parsing helpers --------------------------------------------------------------------------

function parseRaHours(s: string): number {
  const m = s.match(/^(\d+):(\d+):([\d.]+)$/)
  if (!m) throw new Error(`bad RA "${s}"`)
  const [, h, mm, ss] = m
  return Number(h) + Number(mm) / 60 + Number(ss) / 3600
}

function parseDecDeg(s: string): number {
  const m = s.match(/^([+-])(\d+):(\d+):([\d.]+)$/)
  if (!m) throw new Error(`bad Dec "${s}"`)
  const [, sign, d, mm, ss] = m
  const mag = Number(d) + Number(mm) / 60 + Number(ss) / 3600
  return sign === '-' ? -mag : mag
}

/** "NGC0891" -> "NGC 891", "IC0080 NED01" -> "IC 80 NED01". */
function formatCatalogName(raw: string): string {
  const m = raw.match(/^(NGC|IC)(\d+)(.*)$/)
  if (!m) return raw
  const [, prefix, num, suffix] = m
  return `${prefix} ${Number(num)}${suffix}`
}

/** True diameter (ly) from angular major axis (arcmin) + distance (pc), small-angle approximation
 *  — same convention as angularFovDeg's inverse (see src/data/angularSize.ts). */
function diameterLyFromMajAx(majAxArcmin: number, distPc: number): number {
  const angleRad = majAxArcmin * (1 / 60) * (Math.PI / 180)
  return distPc * angleRad * PC_TO_LY
}

/** Rounds to `digits` decimal places — keeps public/openngc.json's serialized size down (raw
 *  IEEE-754 doubles from parseFloat print with 10+ meaningless digits of noise otherwise) without
 *  losing precision anyone could use: RA/Dec at 6dp is sub-milliarcsecond, well beyond both the
 *  source catalog's own precision and anything this app renders at. */
function round(x: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

// ---- output shape -----------------------------------------------------------------------------

export interface OpenNgcRow {
  id: string
  name: string
  messier: number | null
  raHours: number
  decDeg: number
  distPc: number
  distEstimated: true
  diameterLy: number | null
  majAxArcmin: number | null
  type: string
  vmag: number | null
}

// ---- parse --------------------------------------------------------------------------------

const lines = readFileSync('scripts/cache/NGC.csv', 'utf8').split('\n')
const header = lines[0].split(';').map((h) => h.trim())
const col = (name: string) => {
  const idx = header.indexOf(name)
  if (idx === -1) throw new Error(`NGC.csv: column "${name}" missing — OpenNGC format changed?`)
  return idx
}
const [cName, cType, cRa, cDec, cMajAx, cVMag, cM, cCommon] =
  [col('Name'), col('Type'), col('RA'), col('Dec'), col('MajAx'), col('V-Mag'), col('M'), col('Common names')]

let excludedByType = 0
let excludedCurated = 0
let excludedNoPosition = 0
const unmappedTypes = new Set<string>()
const seenTypes = new Set<string>()
const rows: OpenNgcRow[] = []

for (let li = 1; li < lines.length; li++) {
  const line = lines[li].trim()
  if (!line) continue
  const f = line.split(';')
  if (f.length < header.length) continue

  const id = f[cName]
  const rawType = f[cType]
  seenTypes.add(rawType)

  if (EXCLUDE_TYPES.has(rawType)) { excludedByType++; continue }
  if (CURATED_SKIP_IDS.has(id)) { excludedCurated++; continue }

  const raStr = f[cRa]
  const decStr = f[cDec]
  if (!raStr || !decStr) { excludedNoPosition++; continue }

  const info = TYPE_INFO[rawType]
  if (!info) {
    unmappedTypes.add(rawType)
    // Fall back to a generic label/category rather than dropping the row — "log any unmapped",
    // not "silently lose data" (see report for what, if anything, landed here).
  }
  const label = info?.label ?? 'object'
  const category = info?.category ?? 'other'

  const raHours = parseRaHours(raStr)
  const decDeg = parseDecDeg(decStr)

  const majAxStr = f[cMajAx]
  const majAxArcmin = majAxStr ? parseFloat(majAxStr) : null

  const distPc = DIST_PC_BY_CATEGORY[category]
  const diameterLy = majAxArcmin != null && Number.isFinite(majAxArcmin)
    ? diameterLyFromMajAx(majAxArcmin, distPc)
    : null

  const vmagStr = f[cVMag]
  const vmag = vmagStr ? parseFloat(vmagStr) : null

  const mStr = f[cM]
  const messier = mStr ? Number(mStr) : null

  const commonStr = f[cCommon]
  const name = commonStr ? commonStr.split(',')[0].trim() : formatCatalogName(id)

  rows.push({
    id,
    name,
    messier,
    raHours: round(raHours, 6),
    decDeg: round(decDeg, 6),
    distPc,
    distEstimated: true,
    diameterLy: diameterLy != null ? round(diameterLy, 2) : null,
    majAxArcmin: majAxArcmin != null ? round(majAxArcmin, 2) : null,
    type: label,
    vmag: vmag != null ? round(vmag, 2) : null,
  })
}

console.log(`raw type codes seen in file: ${[...seenTypes].sort().join(', ')}`)
console.log(`excluded (non-DSO type code): ${excludedByType}`)
console.log(`excluded (curated collision): ${excludedCurated} (skip-list has ${CURATED_SKIP_IDS.size} ids)`)
console.log(`excluded (no RA/Dec): ${excludedNoPosition}`)
if (unmappedTypes.size > 0) {
  console.log(`UNMAPPED type codes (defaulted to 'object'): ${[...unmappedTypes].join(', ')}`)
} else {
  console.log('unmapped type codes: none — every code in TYPE_INFO or excluded explicitly')
}
console.log(`parsed: ${rows.length} objects`)

// ---- gates --------------------------------------------------------------------------------

if (rows.length < 12_000) {
  throw new Error(`only ${rows.length} objects parsed — expected >= 12000`)
}

for (const r of rows) {
  if (!(r.raHours >= 0 && r.raHours < 24)) {
    throw new Error(`raHours out of [0,24) for ${r.id}: ${r.raHours}`)
  }
  if (!(r.decDeg >= -90 && r.decDeg <= 90)) {
    throw new Error(`decDeg out of [-90,90] for ${r.id}: ${r.decDeg}`)
  }
}
console.log('gate: all raHours in [0,24), all decDeg in [-90,90] — OK')

if (unmappedTypes.size > 0) {
  // Not fatal (the plan allows "log + map to 'object'"), but surfaced loudly since it means a
  // TYPE_INFO entry should probably be added.
  console.warn(`WARNING: ${unmappedTypes.size} type code(s) had no explicit mapping — see above`)
}

// ---- write --------------------------------------------------------------------------------

const json = JSON.stringify(rows)
writeFileSync('public/openngc.json', json)
console.log(`wrote ${rows.length} objects -> public/openngc.json (${(json.length / 1024 / 1024).toFixed(2)} MB)`)
