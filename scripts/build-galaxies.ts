import { readFileSync, writeFileSync } from 'node:fs'
import { encodeCatalog } from '../src/data/catalogFormat'
import { raDecDistToXyz } from '../src/data/starMath'
import { comovingDistanceMpc, luminosityDistanceMpc } from '../src/data/cosmology'
import { dedupe, type GalaxyRow } from '../src/data/galaxyDedup'

const C_KM_S = 299792.458
const DIST_MIN_MPC = 0.05
const DIST_MAX_MPC = 1100

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** Physical sanity filter shared by every source: keeps the post-dedupe distance gate from
 *  tripping on a stray bad row, and drops the handful of catalog entries at the extreme
 *  edges of validity (e.g. one CF4 row for a satellite closer than our 0.05 Mpc floor). */
function inRange(distMpc: number, czKms: number): boolean {
  return Number.isFinite(distMpc) && Number.isFinite(czKms) && distMpc > DIST_MIN_MPC && distMpc < DIST_MAX_MPC
}

const bySource: Record<GalaxyRow['source'], GalaxyRow[]> = { cf4: [], sdss: [], '6df': [], '2mrs': [] }
const skipped: Record<string, number> = {}

// ---- SDSS: 10 z-slice CSVs, class='GALAXY', columns ra,dec,z,modelMag_r,modelMag_g ----
// SkyServer CSV bodies start with a "#Table1" comment line before the header row.
let sdssRangeSkipped = 0
{
  let sdssParseSkipped = 0
  for (let i = 0; i < 10; i++) {
    const raw = readFileSync(`scripts/cache/sdss_${i}.csv`, 'utf8').split('\n')
    const lines = raw[0].startsWith('#') ? raw.slice(1) : raw
    const header = lines[0].split(',').map((h) => h.trim())
    const col = (name: string) => {
      const idx = header.indexOf(name)
      if (idx === -1) throw new Error(`sdss_${i}.csv: column ${name} missing — SDSS format changed?`)
      return idx
    }
    const [cRa, cDec, cZ, cMagR, cMagG] = [col('ra'), col('dec'), col('z'), col('modelMag_r'), col('modelMag_g')]

    for (let li = 1; li < lines.length; li++) {
      const line = lines[li].trim()
      if (!line) continue
      const f = line.split(',')
      if (f.length < header.length) continue
      const ra = parseFloat(f[cRa])
      const dec = parseFloat(f[cDec])
      const z = parseFloat(f[cZ])
      const magR = parseFloat(f[cMagR])
      const magG = parseFloat(f[cMagG])
      if (!(z > 0.003 && z < 0.25) || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(magR)) {
        sdssParseSkipped++
        continue
      }
      const distMpc = comovingDistanceMpc(z)
      const czKms = z * C_KM_S
      const absoluteMag = magR - 5 * Math.log10((luminosityDistanceMpc(z) * 1e6) / 10)
      const gr = magG - magR
      const colorIndex = Number.isFinite(gr) ? clamp(gr, -0.5, 2.5) : 0.8
      if (!inRange(distMpc, czKms)) { sdssRangeSkipped++; continue }
      bySource.sdss.push({ raDeg: ra, decDeg: dec, distMpc, czKms, absMag: absoluteMag, colorIndex, source: 'sdss' })
    }
  }
  skipped.sdss = sdssParseSkipped + sdssRangeSkipped
}

// ---- 2MRS: columns RAJ2000, DEJ2000, cz, Ktmag ----
{
  let mrsSkippedLowZ = 0
  let mrsSkippedBad = 0
  let mrsRangeSkipped = 0
  const lines = readFileSync('scripts/cache/2mrs.csv', 'utf8').split('\n')
  const header = lines[0].split(',').map((h) => h.trim())
  const col = (name: string) => {
    const idx = header.indexOf(name)
    if (idx === -1) throw new Error(`2mrs.csv: column ${name} missing — 2MRS format changed?`)
    return idx
  }
  const [cRa, cDec, cCz, cKt] = [col('RAJ2000'), col('DEJ2000'), col('cz'), col('Ktmag')]

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim()
    if (!line) continue
    const f = line.split(',')
    if (f.length < header.length) continue
    const ra = parseFloat(f[cRa])
    const dec = parseFloat(f[cDec])
    const cz = parseFloat(f[cCz])
    const magK = parseFloat(f[cKt])
    if (!Number.isFinite(cz) || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(magK)) {
      mrsSkippedBad++
      continue
    }
    const z = cz / C_KM_S
    if (z <= 0.0005) {
      mrsSkippedLowZ++
      continue
    }
    const distMpc = comovingDistanceMpc(z)
    const absoluteMag = magK - 5 * Math.log10((luminosityDistanceMpc(z) * 1e6) / 10)
    if (!inRange(distMpc, cz)) { mrsRangeSkipped++; continue }
    bySource['2mrs'].push({ raDeg: ra, decDeg: dec, distMpc, czKms: cz, absMag: absoluteMag, colorIndex: 1.0, source: '2mrs' })
  }
  skipped['2mrs'] = mrsSkippedLowZ + mrsSkippedBad + mrsRangeSkipped
}

// ---- 6dFGS: VII/259/6dfgs final redshift release. Columns RAJ2000, DEJ2000 (deg), cz (km/s),
// q_cz (redshift quality: 3/4 = 6dFGS probable/reliable, 9 = SDSS/ZCAT-sourced), bJmag, rFmag.
// Keep q_cz >= 3 (matches the note-5 scheme in the VII/259 ReadMe) and the same z window as
// SDSS for consistency (0.003 < z < 0.25) — drops the too-local/too-distant tail.
{
  let sixdfSkippedQuality = 0
  let sixdfSkippedZ = 0
  let sixdfSkippedBad = 0
  let sixdfRangeSkipped = 0
  const lines = readFileSync('scripts/cache/6dfgs.csv', 'utf8').split('\n')
  const header = lines[0].split(',').map((h) => h.trim())
  const col = (name: string) => {
    const idx = header.indexOf(name)
    if (idx === -1) throw new Error(`6dfgs.csv: column ${name} missing — 6dFGS format changed?`)
    return idx
  }
  const [cRa, cDec, cCz, cQ, cBj, cRf] = [col('RAJ2000'), col('DEJ2000'), col('cz'), col('q_cz'), col('bJmag'), col('rFmag')]

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim()
    if (!line) continue
    const f = line.split(',')
    if (f.length < header.length) continue
    const ra = parseFloat(f[cRa])
    const dec = parseFloat(f[cDec])
    const cz = parseFloat(f[cCz])
    const q = parseFloat(f[cQ])
    const bj = parseFloat(f[cBj])
    const rf = parseFloat(f[cRf])
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(cz) || !Number.isFinite(q) || !Number.isFinite(rf)) {
      sixdfSkippedBad++
      continue
    }
    if (q < 3) { sixdfSkippedQuality++; continue }
    const z = cz / C_KM_S
    if (!(z > 0.003 && z < 0.25)) { sixdfSkippedZ++; continue }
    const distMpc = comovingDistanceMpc(z)
    const absoluteMag = rf - 5 * Math.log10((luminosityDistanceMpc(z) * 1e6) / 10)
    const br = Number.isFinite(bj) ? bj - rf : NaN
    const colorIndex = Number.isFinite(br) ? clamp(br, -0.5, 2.5) : 0.8
    if (!inRange(distMpc, cz)) { sixdfRangeSkipped++; continue }
    bySource['6df'].push({ raDeg: ra, decDeg: dec, distMpc, czKms: cz, absMag: absoluteMag, colorIndex, source: '6df' })
  }
  skipped['6df'] = sixdfSkippedQuality + sixdfSkippedZ + sixdfSkippedBad + sixdfRangeSkipped
}

// ---- Cosmicflows-4 (Tully+2023, J/ApJ/944/94/table2 "Distances of individual galaxies").
// Columns RAJ2000, DEJ2000 (deg), DM (distance modulus, all methodologies combined), Vcmb
// (CMB-frame systemic velocity, km/s — can be negative for Local Group members). Distance is
// used DIRECTLY (measured, not inverted from redshift): distMpc = 10^((DM-25)/5). This table
// carries no B/K magnitude column, so absMag falls back to a fixed -20 proxy per source spec.
{
  let cf4SkippedBad = 0
  let cf4RangeSkipped = 0
  const lines = readFileSync('scripts/cache/cf4.csv', 'utf8').split('\n')
  const header = lines[0].split(',').map((h) => h.trim())
  const col = (name: string) => {
    const idx = header.indexOf(name)
    if (idx === -1) throw new Error(`cf4.csv: column ${name} missing — Cosmicflows-4 format changed?`)
    return idx
  }
  const [cRa, cDec, cDM, cVcmb] = [col('RAJ2000'), col('DEJ2000'), col('DM'), col('Vcmb')]

  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trim()
    if (!line) continue
    const f = line.split(',')
    if (f.length < header.length) continue
    const ra = parseFloat(f[cRa])
    const dec = parseFloat(f[cDec])
    const dm = parseFloat(f[cDM])
    const vcmb = parseFloat(f[cVcmb])
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(dm) || !Number.isFinite(vcmb)) {
      cf4SkippedBad++
      continue
    }
    const distMpc = 10 ** ((dm - 25) / 5)
    if (!inRange(distMpc, vcmb)) { cf4RangeSkipped++; continue }
    bySource.cf4.push({ raDeg: ra, decDeg: dec, distMpc, czKms: vcmb, absMag: -20, colorIndex: 1.0, source: 'cf4' })
  }
  skipped.cf4 = cf4SkippedBad + cf4RangeSkipped
}

for (const source of ['cf4', 'sdss', '6df', '2mrs'] as const) {
  console.log(`${source}: ${bySource[source].length} parsed+in-range, ${skipped[source]} skipped (bad parse/quality/z-window/range)`)
}

// ---- merge + dedupe (spatial hash, 1 degree cells; cross-survey only; preference cf4 > sdss > 6df > 2mrs) ----
const allRows: GalaxyRow[] = [...bySource.cf4, ...bySource.sdss, ...bySource['6df'], ...bySource['2mrs']]
const { kept, removedBySource } = dedupe(allRows)

for (const source of ['cf4', 'sdss', '6df', '2mrs'] as const) {
  const input = bySource[source].length
  const removed = removedBySource[source] ?? 0
  console.log(`${source}: input ${input}, removed by dedupe ${removed}, kept ${input - removed}`)
}

const count = kept.length
console.log(`total after dedupe: ${count}`)

// ---- gates ----
if (count < 900_000 || count > 1_400_000) {
  throw new Error(`total galaxy count ${count} outside expected [900k, 1.4M]`)
}

const pos: number[] = []
const absMag: number[] = []
const ci: number[] = []
for (const row of kept) {
  const [x, y, z] = raDecDistToXyz(row.raDeg / 15, row.decDeg, row.distMpc)
  pos.push(x, y, z)
  absMag.push(row.absMag)
  ci.push(row.colorIndex)
}

const positions = new Float32Array(pos)
const absMagArr = new Float32Array(absMag)
const ciArr = new Float32Array(ci)

for (const [name, arr] of [['positions', positions], ['absMag', absMagArr], ['colorIndex', ciArr]] as const) {
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) throw new Error(`NaN found in ${name}[${i}]`)
  }
}

let belowTen = 0
let minDist = Infinity
for (let i = 0; i < count; i++) {
  const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
  const d = Math.hypot(x, y, z)
  if (d < minDist) minDist = d
  if (d < 10) belowTen++
  if (!(d > DIST_MIN_MPC && d < DIST_MAX_MPC)) {
    throw new Error(`distance out of range (${DIST_MIN_MPC}, ${DIST_MAX_MPC}) Mpc at index ${i}: ${d}`)
  }
}
console.log(`${belowTen} galaxies below 10 Mpc; min distance ${minDist.toFixed(4)} Mpc`)

// Andromeda assertion: a kept row within 0.15 Mpc (3D) of M31's known position. This is the
// entire point of pulling in CF4 — SDSS/2MRS/6dFGS are all redshift-based and drop the
// blueshifted Local Group entirely.
{
  const [mx, my, mz] = raDecDistToXyz(0.712, 41.269, 0.78)
  let minSep = Infinity
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - mx, dy = positions[i * 3 + 1] - my, dz = positions[i * 3 + 2] - mz
    const sep = Math.hypot(dx, dy, dz)
    if (sep < minSep) minSep = sep
  }
  console.log(`nearest kept row to M31's known position: ${minSep.toFixed(4)} Mpc`)
  if (!(minSep < 0.15)) {
    throw new Error(`Andromeda assertion failed: nearest catalog row to M31 is ${minSep.toFixed(4)} Mpc away (expected < 0.15 Mpc) — CF4 merge likely broken`)
  }
}

// Southern-fill assertion: 6dFGS should push the Dec < -30 count well past the old SDSS-only
// southern population (~15k in phase 6).
{
  let southernCount = 0
  for (const row of kept) {
    if (row.decDeg < -30) southernCount++
  }
  console.log(`southern (Dec < -30) kept rows: ${southernCount}`)
  if (!(southernCount > 60_000)) {
    throw new Error(`southern-fill assertion failed: ${southernCount} rows with Dec < -30 (expected > 60000) — 6dFGS merge likely broken`)
  }
}

const catalog = { count, positions, absMag: absMagArr, colorIndex: ciArr }
writeFileSync('public/galaxies.bin', Buffer.from(encodeCatalog(catalog)))
console.log(`wrote ${count} galaxies -> public/galaxies.bin`)
