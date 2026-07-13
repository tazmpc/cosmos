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

const catalog = {
  count: pos.length / 3,
  positions: new Float32Array(pos),
  absMag: new Float32Array(absMag),
  colorIndex: new Float32Array(ci),
}
writeFileSync('public/stars.bin', Buffer.from(encodeCatalog(catalog)))
writeFileSync('public/starnames.json', JSON.stringify(names))
console.log(`wrote ${catalog.count} stars (${skipped} skipped), ${Object.keys(names).length} named → public/`)
