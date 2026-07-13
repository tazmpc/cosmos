import { readFileSync, writeFileSync } from 'node:fs'
import { encodeCatalog } from '../src/data/catalogFormat'
import { raDecDistToXyz } from '../src/data/starMath'

// HYG v4.1 columns (header row names): id,hip,hd,hr,gl,bf,proper,ra,dec,dist,...,mag,absmag,spect,ci,...
const csv = readFileSync('scripts/cache/hygdata.csv', 'utf8').split('\n')
const header = csv[0].split(',').map((h: string) => h.replace(/^"|"$/g, ''))
const col = (name: string) => {
  const i = header.indexOf(name)
  if (i === -1) throw new Error(`column ${name} missing — HYG format changed?`)
  return i
}
const [cRa, cDec, cDist, cMag, cAbs, cCi, cProper, cBf] =
  [col('ra'), col('dec'), col('dist'), col('mag'), col('absmag'), col('ci'), col('proper'), col('bf')]

const pos: number[] = [], absMag: number[] = [], ci: number[] = []
const names: Record<string, number> = {}
let skipped = 0

for (let i = 1; i < csv.length; i++) {
  const f = csv[i].split(',')
  if (f.length < header.length) continue
  const dist = parseFloat(f[cDist])
  // dist<=0 is the Sun; dist>=100000 is HYG's "distance unknown" sentinel
  if (!(dist > 0) || dist >= 100000) { skipped++; continue }
  const [x, y, z] = raDecDistToXyz(parseFloat(f[cRa]), parseFloat(f[cDec]), dist)
  const index = pos.length / 3
  pos.push(x, y, z)
  absMag.push(parseFloat(f[cAbs]))
  const ciParsed = parseFloat(f[cCi])
  ci.push(Number.isNaN(ciParsed) ? 0.5 : ciParsed)
  const proper = f[cProper].replace(/^"|"$/g, '').trim()
  const bayer = f[cBf].replace(/^"|"$/g, '').trim()
  if (proper) names[proper] = index
  else if (bayer && parseFloat(f[cMag]) < 4) names[bayer] = index
}

if (process.argv.includes('--gaia')) {
  // keep named HYG stars (search needs them), replace the anonymous sky with Gaia
  const keepPos: number[] = [], keepAbs: number[] = [], keepCi: number[] = []
  const remap: Record<string, number> = {}
  const cellOf = (raDeg: number, decDeg: number) => `${Math.round(raDeg * 50)}:${Math.round(decDeg * 50)}`
  const namedCells = new Set<string>()
  let n = 0
  for (const [name, oldIdx] of Object.entries(names)) {
    keepPos.push(pos[oldIdx * 3], pos[oldIdx * 3 + 1], pos[oldIdx * 3 + 2])
    keepAbs.push(absMag[oldIdx]); keepCi.push(ci[oldIdx])
    remap[name] = n++
    const d = Math.hypot(pos[oldIdx * 3], pos[oldIdx * 3 + 1], pos[oldIdx * 3 + 2])
    const raDeg = Math.atan2(pos[oldIdx * 3 + 1], pos[oldIdx * 3]) * 180 / Math.PI
    const decDeg = Math.asin(pos[oldIdx * 3 + 2] / d) * 180 / Math.PI
    namedCells.add(cellOf((raDeg + 360) % 360, decDeg))
  }

  const gaia = readFileSync('scripts/cache/gaia.csv', 'utf8').split('\n')
  const gh = gaia[0].split(',')
  const gi = (nm: string) => gh.indexOf(nm)
  const [gRa, gDec, gPar, gMag, gBpRp] = [gi('ra'), gi('dec'), gi('parallax'), gi('phot_g_mean_mag'), gi('bp_rp')]
  let dropped = 0
  for (let i = 1; i < gaia.length; i++) {
    const f = gaia[i].split(',')
    if (f.length < gh.length) continue
    const par = parseFloat(f[gPar])
    if (!(par > 0)) continue
    const raDeg = parseFloat(f[gRa]), decDeg = parseFloat(f[gDec])
    if (namedCells.has(cellOf(raDeg, decDeg))) { dropped++; continue } // avoid doubling named stars
    const distPc = 1000 / par
    const [x, y, z] = raDecDistToXyz(raDeg / 15, decDeg, distPc)
    keepPos.push(x, y, z)
    keepAbs.push(parseFloat(f[gMag]) + 5 * (Math.log10(par) - 2)) // M = m + 5(log10 p_mas − 2)
    const bpRp = parseFloat(f[gBpRp])
    keepCi.push(Number.isNaN(bpRp) ? 0.7 : bpRp)
  }

  const cat = {
    count: keepPos.length / 3,
    positions: new Float32Array(keepPos),
    absMag: new Float32Array(keepAbs),
    colorIndex: new Float32Array(keepCi),
  }
  writeFileSync('public/stars.bin', Buffer.from(encodeCatalog(cat)))
  writeFileSync('public/starnames.json', JSON.stringify(remap))
  console.log(`gaia mode: ${cat.count} stars (${dropped} deduped near named stars)`)
} else {
  const catalog = {
    count: pos.length / 3,
    positions: new Float32Array(pos),
    absMag: new Float32Array(absMag),
    colorIndex: new Float32Array(ci),
  }
  writeFileSync('public/stars.bin', Buffer.from(encodeCatalog(catalog)))
  writeFileSync('public/starnames.json', JSON.stringify(names))
  console.log(`wrote ${catalog.count} stars (${skipped} skipped), ${Object.keys(names).length} named → public/`)
}
