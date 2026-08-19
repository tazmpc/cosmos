import { readFileSync, writeFileSync } from 'node:fs'
import { encodeCatalog } from '../src/data/catalogFormat'
import { raDecDistToXyz, eqjToGalactic } from '../src/data/starMath'
import { ballesterosInverseCi } from '../src/data/starColor'
import { decodeDustGrid, cumulativeE } from '../src/data/dustMap'

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

  // ---- measured effective temperatures (Gaia DR3 teff_gspphot) ----
  //
  // Colors come from a measured temperature wherever Gaia has one, instead of from the BP-RP
  // photometric index. teff_gspphot is not in scripts/cache/gaia.csv (that extract predates it)
  // and the file carries no source_id to join on, so the temperatures live in a second extract,
  // scripts/cache/gaia_teff.csv, taken with the IDENTICAL WHERE clause and joined on position.
  // Joining rather than re-downloading the whole selection is deliberate: it cannot perturb which
  // stars are in the catalog or where they sit, so stars.bin's positions stay byte-identical and
  // only the colorIndex block changes. Full-precision ra/dec makes a safe key — the two extracts
  // are the same rows of the same static table, so the coordinates are bit-for-bit the same
  // doubles; 9 decimal places is 3.6 microarcsec, far finer than any pair of distinct sources.
  //
  //   curl -fG 'https://gea.esac.esa.int/tap-server/tap/sync' \
  //     --data-urlencode 'REQUEST=doQuery' --data-urlencode 'LANG=ADQL' \
  //     --data-urlencode 'FORMAT=csv' \
  //     --data-urlencode "QUERY=SELECT ra, dec, teff_gspphot FROM gaiadr3.gaia_source \
  //   WHERE phot_g_mean_mag < 10.5 AND parallax > 0.5 AND parallax_over_error > 5" \
  //     -o scripts/cache/gaia_teff.csv
  //
  // (the full-sky form trips the server's statement timeout; fetch it in 30-degree RA slices with
  // `AND ra >= L AND ra < L+30` appended, strictly one at a time, and concatenate)
  const posKey = (raDeg: number, decDeg: number) => `${raDeg.toFixed(9)},${decDeg.toFixed(9)}`
  const teffByPos = new Map<string, number>()
  {
    let teffCsv: string
    try {
      teffCsv = readFileSync('scripts/cache/gaia_teff.csv', 'utf8')
    } catch {
      throw new Error('scripts/cache/gaia_teff.csv missing — see the TAP query in this file')
    }
    const rows = teffCsv.split('\n')
    const th = rows[0].split(',')
    const [tRa, tDec, tTeff] = [th.indexOf('ra'), th.indexOf('dec'), th.indexOf('teff_gspphot')]
    if (tRa === -1 || tDec === -1 || tTeff === -1) throw new Error('gaia_teff.csv is missing a column')
    for (let i = 1; i < rows.length; i++) {
      const f = rows[i].split(',')
      if (f.length < th.length) continue
      const t = parseFloat(f[tTeff])
      // GSP-Phot only fits within this range; anything outside it is a fit that ran to a rail
      if (!(t >= 2500 && t <= 50000)) continue
      teffByPos.set(posKey(parseFloat(f[tRa]), parseFloat(f[tDec])), t)
    }
    console.log(`loaded ${teffByPos.size} usable Gaia effective temperatures`)
  }

  // ---- measured reddening (Edenhofer et al. 2023 3D dust) ----
  //
  // colorIndex in this catalog means "the color this star LOOKS from the viewpoint", not its
  // intrinsic photospheric color — the shader turns it straight into an on-screen hue. A measured
  // temperature alone gives the intrinsic color (GSP-Phot fits extinction out), so using it raw
  // would strip the reddening a real observer sees and turn the dusty half of the sky uniformly
  // blue. So the extinction is put back: ci = intrinsic(teff) + E(B−V) along that star's own
  // sight line, out to its own distance.
  //
  // Unit note: the map is in "E of Zhang, Green & Rix (2023)", which the literature converts to
  // E(B−V) with a factor within ~10-20% of unity depending on the extinction curve adopted. We
  // use 1.0 and take the error as being inside that spread.
  //
  // Distance note: the map stops at 1.25 kpc. Beyond that, cumulativeE clamps to the value at the
  // map's outer edge rather than extrapolating — so distant stars get the reddening accumulated
  // over the first 1.25 kpc only. That is a LOWER BOUND on their true reddening, deliberately:
  // inventing dust past the map's validity radius would be worse than under-reddening.
  const REDDEN_CLAMP_LO = -0.4, REDDEN_CLAMP_HI = 2.5
  let dustGrid: ReturnType<typeof decodeDustGrid>
  {
    let buf: Buffer
    try {
      buf = readFileSync('scripts/cache/edenhofer-cum.bin')
    } catch {
      throw new Error('measured dust map missing — run `npm run dustmap` first')
    }
    dustGrid = decodeDustGrid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  }

  const gaia = readFileSync('scripts/cache/gaia.csv', 'utf8').split('\n')
  const gh = gaia[0].split(',')
  const gi = (nm: string) => gh.indexOf(nm)
  const [gRa, gDec, gPar, gMag, gBpRp] = [gi('ra'), gi('dec'), gi('parallax'), gi('phot_g_mean_mag'), gi('bp_rp')]
  let dropped = 0, measured = 0, fallback = 0, ebvSum = 0, ebvMax = 0
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
    // measured temperature (re-reddened along its own sight line) where Gaia fitted one;
    // BP−RP otherwise, which is already an observed — hence already reddened — color
    const teff = teffByPos.get(posKey(raDeg, decDeg))
    if (teff !== undefined) {
      const [l, b] = eqjToGalactic(raDeg, decDeg)
      const ebv = cumulativeE(dustGrid, l, b, distPc)
      const c = ballesterosInverseCi(teff) + ebv
      keepCi.push(Math.max(REDDEN_CLAMP_LO, Math.min(REDDEN_CLAMP_HI, c)))
      measured++
      ebvSum += ebv
      if (ebv > ebvMax) ebvMax = ebv
    } else {
      const bpRp = parseFloat(f[gBpRp])
      keepCi.push(Number.isNaN(bpRp) ? 0.7 : bpRp)
      fallback++
    }
  }
  console.log(`colors: ${measured} from measured teff + measured reddening, ${fallback} from BP−RP ` +
    `(${((100 * measured) / (measured + fallback)).toFixed(1)}% measured)`)
  console.log(`reddening applied to the measured set: mean E(B−V) ${(ebvSum / measured).toFixed(4)}, max ${ebvMax.toFixed(3)}`)

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
