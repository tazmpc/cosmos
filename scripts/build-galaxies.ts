import { readFileSync, writeFileSync } from 'node:fs'
import { encodeCatalog } from '../src/data/catalogFormat'
import { raDecDistToXyz } from '../src/data/starMath'
import { comovingDistanceMpc, luminosityDistanceMpc } from '../src/data/cosmology'

const C_KM_S = 299792.458

const pos: number[] = []
const absMag: number[] = []
const ci: number[] = []

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

// ---- SDSS: 10 z-slice CSVs, class='GALAXY', columns ra,dec,z,modelMag_r,modelMag_g ----
// SkyServer CSV bodies start with a "#Table1" comment line before the header row.
let sdssCount = 0
let sdssSkipped = 0
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
      sdssSkipped++
      continue
    }
    const dC = comovingDistanceMpc(z)
    const [x, y, z3] = raDecDistToXyz(ra / 15, dec, dC)
    const absoluteMag = magR - 5 * Math.log10((luminosityDistanceMpc(z) * 1e6) / 10)
    const gr = magG - magR
    const colorIndex = Number.isFinite(gr) ? clamp(gr, -0.5, 2.5) : 0.8
    pos.push(x, y, z3)
    absMag.push(absoluteMag)
    ci.push(colorIndex)
    sdssCount++
  }
}

// ---- 2MRS: columns RAJ2000, DEJ2000, cz, Ktmag ----
let mrsCount = 0
let mrsSkippedLowZ = 0
let mrsSkippedBad = 0
{
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
    const dC = comovingDistanceMpc(z)
    const [x, y, z3] = raDecDistToXyz(ra / 15, dec, dC)
    const absoluteMag = magK - 5 * Math.log10((luminosityDistanceMpc(z) * 1e6) / 10)
    pos.push(x, y, z3)
    absMag.push(absoluteMag)
    ci.push(1.0)
    mrsCount++
  }
}

const count = pos.length / 3
console.log(`SDSS: ${sdssCount} kept, ${sdssSkipped} skipped (bad/out-of-range z)`)
console.log(`2MRS: ${mrsCount} kept, ${mrsSkippedLowZ} skipped (z <= 0.0005 blueshifted/too-local), ${mrsSkippedBad} skipped (bad parse)`)
console.log(`total: ${count}`)

// ---- gates ----
if (count < 500_000 || count > 3_000_000) {
  throw new Error(`total galaxy count ${count} outside expected [500k, 3M]`)
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
for (let i = 0; i < count; i++) {
  const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
  const d = Math.hypot(x, y, z)
  if (d < 10) belowTen++
  if (!(d > 2 && d < 1100)) {
    throw new Error(`distance out of range (2, 1100) Mpc at index ${i}: ${d}`)
  }
}
console.log(`${belowTen} galaxies below 10 Mpc (2MRS z floor 0.0005 -> ~2.1 Mpc)`)

const catalog = { count, positions, absMag: absMagArr, colorIndex: ciArr }
writeFileSync('public/galaxies.bin', Buffer.from(encodeCatalog(catalog)))
console.log(`wrote ${count} galaxies -> public/galaxies.bin`)
