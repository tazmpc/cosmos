/**
 * Builds public/asteroids.bin + public/asteroidnames.json from scripts/cache/MPCORB.DAT — the
 * Minor Planet Center's orbit database (~1.55M numbered + unnumbered minor planets).
 *
 * Download (not committed; scripts/cache/ is gitignored):
 *   curl -L -o scripts/cache/MPCORB.DAT.gz https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz
 *   gunzip -k scripts/cache/MPCORB.DAT.gz
 *
 * Attribution: MPCORB is redistributable with attribution to the Minor Planet Center — see
 * CREDITS.md. We redistribute a DERIVED binary (a magnitude-cut subset of 9 columns), not the
 * file itself.
 *
 * Fixed-width format (https://minorplanetcenter.net/iau/info/MPOrbitFormat.html), 1-based
 * columns, verified against the (1) Ceres row:
 *    1-7    packed designation      "00001"
 *    9-13   H, absolute magnitude   " 3.34"
 *   15-19   G, slope parameter
 *   21-25   packed epoch            "K2669"  -> 2026-06-09.0 TT
 *   27-35   M, mean anomaly (deg)
 *   38-46   Peri., argument of perihelion (deg, J2000 ecliptic)
 *   49-57   Node, longitude of ascending node (deg)
 *   60-68   Incl., inclination (deg)
 *   71-79   e, eccentricity
 *   81-91   n, mean daily motion (deg/day)
 *   93-103  a, semi-major axis (AU)
 *  167-194  readable designation    "     (1) Ceres              "
 *
 * Output binary "CAST" (see src/data/asteroidFormat.ts for the decoder and the exact layout):
 * a 24-byte header carrying one f64 base epoch JD, then nine parallel f32 arrays. Per-object
 * epochs VARY, but the overwhelming majority share the MPC's current standard epoch, so each
 * object stores only an f32 offset in days from the common base instead of its own f64 JD.
 */

import { createReadStream, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { CAST_MAGIC, CAST_VERSION, CAST_HEADER_BYTES, CAST_FIELDS } from '../src/data/asteroidFormat'
import { FAMOUS_ASTEROIDS } from '../src/data/asteroids'

// ---- filters ----------------------------------------------------------------------------------
// H < 17 is the brightness cut: absolute magnitude in the asteroid (H, G) system, so it is a
// proxy for size (H 17 is roughly a 1 km body at belt albedos). a and e bound the orbit to
// something this two-body propagator can render sensibly.
//
// The cut is set for VISUAL DENSITY of the belt rather than for any physical completeness limit
// — MPCORB is nowhere near complete at H 17. H < 16 yields only ~206k objects; H < 17 yields
// ~486k, which is the density the phase-9 plan was describing, at ~17.5 MB lazily fetched.
const MAX_H = 17
const MIN_A_AU = 1.5
const MAX_A_AU = 50
const MAX_E = 0.95

// ---- packed-epoch parsing -----------------------------------------------------------------
// MPC packs an epoch into 5 chars: century letter, 2-digit year, packed month, packed day.
// Century: I = 18xx, J = 19xx, K = 20xx, L = 21xx.
// Month/day digits: '1'-'9' = 1-9, then 'A'-'V' = 10-31.
// e.g. "K2669" -> 2026-06-09;  "K25AH" -> 2025-10-17.
const CENTURY: Record<string, number> = { I: 1800, J: 1900, K: 2000, L: 2100 }

function unpackDigit(c: string): number {
  if (c >= '1' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'V') return c.charCodeAt(0) - 65 + 10
  throw new Error(`bad packed month/day char "${c}"`)
}

/** Calendar date (Gregorian, 0h TT) -> Julian Date. Standard Fliegel-Van Flandern. */
export function calendarToJd(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  const jdn = d + Math.floor((153 * mm + 2) / 5) + 365 * yy
    + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
  return jdn - 0.5 // JDN is noon-based; MPCORB epochs are at 0h TT
}

export function parsePackedEpoch(s: string): number {
  if (s.length !== 5) throw new Error(`bad packed epoch "${s}"`)
  const century = CENTURY[s[0]]
  if (century === undefined) throw new Error(`bad packed epoch century "${s}"`)
  const year = century + Number(s.slice(1, 3))
  if (!Number.isFinite(year)) throw new Error(`bad packed epoch year "${s}"`)
  return calendarToJd(year, unpackDigit(s[3]), unpackDigit(s[4]))
}

const EPOCH_RE = /^[IJKL]\d\d[1-9A-V][1-9A-V]$/

// ---- always-include set -----------------------------------------------------------------------
// Three of the famous 12 (Bennu H 20.68 a 1.13, Ryugu H 19.54 a 1.19, Apophis H 19.00 a 0.92)
// are small near-Earth objects that fail BOTH the H cut and the a cut. The cuts exist to bound
// the bulk belt render, not to decide which objects are worth naming, so every famous asteroid is
// force-included regardless — 12 extra rows out of ~486k, and without them "search Bennu" would
// have nothing to fly to.
const FAMOUS_NUMBERS = new Set(FAMOUS_ASTEROIDS.map((f) => f.mpcNumber))

// ---- parse ------------------------------------------------------------------------------------

interface Row {
  mpcNumber: number | null
  a: number; e: number; i: number; Omega: number; omega: number
  M0: number; nDegDay: number; H: number; epochJd: number
}

/** "     (1) Ceres              " -> 1 ; unnumbered designations have no leading (n) and give null. */
function parseMpcNumber(readable: string): number | null {
  const m = readable.match(/^\s*\((\d+)\)/)
  return m ? Number(m[1]) : null
}

async function parse(): Promise<{ rows: Row[]; stats: Record<string, number>; epochCounts: Map<number, number> }> {
  const rows: Row[] = []
  const stats = { total: 0, noH: 0, rejectedH: 0, rejectedOrbit: 0, forcedIn: 0, badParse: 0 }
  const epochCounts = new Map<number, number>()

  const rl = createInterface({
    input: createReadStream('scripts/cache/MPCORB.DAT'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    // The file opens with a ~40-line prose header and its three sections are separated by blank
    // lines; a well-formed packed epoch in columns 21-25 is the cheapest reliable "this is a data
    // row" test, and it doubles as a format-drift canary (see the gate on stats.total below).
    if (line.length < 103) continue
    const epochStr = line.slice(20, 25)
    if (!EPOCH_RE.test(epochStr)) continue
    stats.total++

    const readable = line.slice(166, 194)
    const mpcNumber = parseMpcNumber(readable)
    const forced = mpcNumber !== null && FAMOUS_NUMBERS.has(mpcNumber)

    const hStr = line.slice(8, 13).trim()
    if (hStr === '') {
      stats.noH++
      // A bulk row with no H simply can't pass a brightness cut — drop it. A FAMOUS row with no H
      // is a different thing entirely: it would be force-included with a fabricated magnitude,
      // which would then drive its rendered point size and its info card. Fail loudly instead —
      // this has never fired (all 12 have measured H), and if MPCORB ever drops one it should be
      // a build failure, not a silently invented number.
      if (forced) {
        throw new Error(`famous asteroid ${readable.trim()} has a blank H in MPCORB — refusing to fabricate one`)
      }
      continue
    }
    const H = Number(hStr)

    const a = Number(line.slice(92, 103))
    const e = Number(line.slice(70, 79))
    const i = Number(line.slice(59, 68))
    const Omega = Number(line.slice(48, 57))
    const omega = Number(line.slice(37, 46))
    const M0 = Number(line.slice(26, 35))
    const nDegDay = Number(line.slice(80, 91))

    if (![a, e, i, Omega, omega, M0, nDegDay, H].every(Number.isFinite)) { stats.badParse++; continue }

    if (!forced) {
      if (!(H < MAX_H)) { stats.rejectedH++; continue }
      if (!(a > MIN_A_AU && a < MAX_A_AU && e < MAX_E)) { stats.rejectedOrbit++; continue }
    } else {
      stats.forcedIn++
    }

    const epochJd = parsePackedEpoch(epochStr)
    epochCounts.set(epochJd, (epochCounts.get(epochJd) ?? 0) + 1)
    rows.push({ mpcNumber, a, e, i, Omega, omega, M0, nDegDay, H, epochJd })
  }

  return { rows, stats, epochCounts }
}

// ---- encode -----------------------------------------------------------------------------------

function encode(rows: Row[], baseEpochJd: number): Buffer {
  const n = rows.length
  const buf = Buffer.alloc(CAST_HEADER_BYTES + n * CAST_FIELDS * 4)
  buf.writeUInt32LE(CAST_MAGIC, 0)
  buf.writeUInt32LE(CAST_VERSION, 4)
  buf.writeUInt32LE(n, 8)
  buf.writeUInt32LE(0, 12) // padding, keeps the f64 below 8-byte aligned
  buf.writeDoubleLE(baseEpochJd, 16)

  // Nine parallel f32 arrays, in the order asteroidFormat.ts decodes them.
  const field = (k: number): Float32Array =>
    new Float32Array(buf.buffer, buf.byteOffset + CAST_HEADER_BYTES + k * n * 4, n)
  const [fa, fe, fi, fOm, fom, fM0, fn, fH, fEp] =
    [field(0), field(1), field(2), field(3), field(4), field(5), field(6), field(7), field(8)]

  for (let k = 0; k < n; k++) {
    const r = rows[k]
    fa[k] = r.a; fe[k] = r.e; fi[k] = r.i; fOm[k] = r.Omega; fom[k] = r.omega
    fM0[k] = r.M0; fn[k] = r.nDegDay; fH[k] = r.H; fEp[k] = r.epochJd - baseEpochJd
  }
  return buf
}

// ---- main ---------------------------------------------------------------------------------

const { rows, stats, epochCounts } = await parse()

console.log(`MPCORB data rows scanned: ${stats.total}`)
console.log(`  rejected by H >= ${MAX_H}: ${stats.rejectedH}`)
console.log(`  rejected by orbit cuts (a in (${MIN_A_AU}, ${MAX_A_AU}) AU, e < ${MAX_E}): ${stats.rejectedOrbit}`)
console.log(`  rows with blank H: ${stats.noH}`)
console.log(`  unparseable numeric fields: ${stats.badParse}`)
console.log(`  force-included famous asteroids (exempt from the cuts): ${stats.forcedIn}`)
console.log(`kept: ${rows.length}`)

// The MPC re-epochs the whole database to one standard epoch every ~6 months; that shared value
// becomes the header's f64 base and every object stores only an f32 day offset from it.
let baseEpochJd = 0
let baseCount = -1
for (const [jd, c] of [...epochCounts].sort((x, y) => x[0] - y[0])) {
  if (c > baseCount) { baseCount = c; baseEpochJd = jd }
}
console.log(`base epoch JD ${baseEpochJd} shared by ${baseCount} / ${rows.length} objects ` +
  `(${((baseCount / rows.length) * 100).toFixed(1)}%), ${epochCounts.size} distinct epochs`)

// ---- gates --------------------------------------------------------------------------------

if (stats.total < 1_000_000) {
  throw new Error(`only ${stats.total} MPCORB data rows recognised — fixed-width format changed?`)
}

// Count gate. Measured H histogram on the 2026-08-11 MPCORB (after the orbit cuts): H<15 82k,
// H<16 206k, H<17 486k, H<18 938k. The band is wide enough to absorb MPCORB's daily growth
// without becoming so wide it would miss a parser regression.
if (rows.length < 430_000 || rows.length > 540_000) {
  throw new Error(`kept ${rows.length} objects — expected 430k-540k for H < ${MAX_H}`)
}

for (const r of rows) {
  for (const [k, v] of Object.entries(r)) {
    if (k === 'mpcNumber') continue
    if (!Number.isFinite(v as number)) throw new Error(`non-finite ${k} for MPC ${r.mpcNumber}`)
  }
  if (!(r.e >= 0 && r.e < 1)) throw new Error(`eccentricity ${r.e} out of [0,1) for MPC ${r.mpcNumber}`)
  if (!(r.a > 0)) throw new Error(`non-positive a for MPC ${r.mpcNumber}`)
}
console.log('gate: all elements finite, e in [0,1), a > 0 — OK')

// Kirkwood-gap structure gate — asserts the output carries REAL dynamics, not just plausible
// numbers. Mean-motion resonances with Jupiter clear narrow bands out of the belt, and a
// histogram of a must show them.
//
// The plan specified the 3.28 AU (2:1) gap tested against BOTH neighbouring bins. That test is
// physically ill-posed: the 2:1 resonance is the OUTER EDGE of the main belt, not an interior
// gap — beyond it the population simply ends (measured: 3.35-3.50 AU holds 1314 objects vs
// 53600 in 3.05-3.20), so no real dataset can have the gap bin be a minority of an outer
// neighbour that is itself nearly empty. So it is tested two ways instead:
//   - the 3:1 resonance at 2.50 AU, a true INTERIOR gap with a dense population on both sides,
//     asserted against both neighbours (this is the assertion the plan wanted);
//   - the 2:1 resonance at 3.27 AU asserted one-sided against its inner flank, which is the only
//     direction that means anything for a belt edge.
const histo = (lo: number, hi: number): number => rows.filter((r) => r.a >= lo && r.a < hi).length

const g31 = { gap: histo(2.45, 2.50), inner: histo(2.40, 2.45), outer: histo(2.50, 2.55) }
console.log(`3:1 Kirkwood gap @2.50 AU — inner 2.40-2.45: ${g31.inner}, gap 2.45-2.50: ${g31.gap}, outer 2.50-2.55: ${g31.outer}`)
if (!(g31.gap < 0.6 * g31.inner && g31.gap < 0.6 * g31.outer)) {
  throw new Error(`3:1 Kirkwood gap not resolved: ${g31.gap} vs inner ${g31.inner} / outer ${g31.outer}`)
}

const g21 = { gap: histo(3.25, 3.35), inner: histo(3.10, 3.20) }
console.log(`2:1 Kirkwood gap @3.27 AU (belt outer edge) — inner 3.10-3.20: ${g21.inner}, gap 3.25-3.35: ${g21.gap}`)
if (!(g21.gap < 0.6 * g21.inner)) {
  throw new Error(`2:1 Kirkwood gap not resolved: ${g21.gap} vs inner ${g21.inner}`)
}
console.log('gate: Kirkwood gaps present in the a-histogram — OK')

// ---- write --------------------------------------------------------------------------------

const bin = encode(rows, baseEpochJd)
writeFileSync('public/asteroids.bin', bin)
console.log(`wrote ${rows.length} objects -> public/asteroids.bin ` +
  `(${(bin.length / 1024 / 1024).toFixed(2)} MB, ${(bin.length / rows.length).toFixed(1)} B/object)`)

// Names sidecar: MPC number -> index into the binary, for JUST the famous few. The bulk objects
// are anonymous points; only these are searchable/flyable, so baking 200k designations would be
// dead weight.
const indexByNumber = new Map<number, number>()
rows.forEach((r, k) => { if (r.mpcNumber !== null && FAMOUS_NUMBERS.has(r.mpcNumber)) indexByNumber.set(r.mpcNumber, k) })
const missing = FAMOUS_ASTEROIDS.filter((f) => !indexByNumber.has(f.mpcNumber))
if (missing.length > 0) {
  throw new Error(`famous asteroids missing from the binary: ${missing.map((m) => m.name).join(', ')}`)
}
const names: Record<string, number> = {}
for (const f of FAMOUS_ASTEROIDS) names[String(f.mpcNumber)] = indexByNumber.get(f.mpcNumber)!
writeFileSync('public/asteroidnames.json', JSON.stringify(names))
console.log(`wrote ${Object.keys(names).length} famous-asteroid indices -> public/asteroidnames.json`)
