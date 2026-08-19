import { readFileSync, writeFileSync } from 'node:fs'
import { encodeCatalog } from '../src/data/catalogFormat'
import { raDecDistToXyz, eqjToGalactic, polyfit, polyval } from '../src/data/starMath'
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
  const fitX: number[] = [], fitY: number[] = []          // same-star (BP−RP, B−V) pairs
  const fallbackAt: number[] = [], fallbackBpRp: number[] = []
  const ebvLowLat: number[] = [], ebvHighLat: number[] = []
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
    // BP−RP otherwise, converted to the same B−V system below
    const teff = teffByPos.get(posKey(raDeg, decDeg))
    const bpRp = parseFloat(f[gBpRp])
    if (teff !== undefined) {
      const [l, b] = eqjToGalactic(raDeg, decDeg)
      const ebv = cumulativeE(dustGrid, l, b, distPc)
      const c = ballesterosInverseCi(teff) + ebv
      keepCi.push(Math.max(REDDEN_CLAMP_LO, Math.min(REDDEN_CLAMP_HI, c)))
      measured++
      ebvSum += ebv
      if (ebv > ebvMax) ebvMax = ebv
      if (Number.isFinite(bpRp)) { fitX.push(bpRp); fitY.push(c) }
      // reddening-direction gate sample, taken in a matched distance band so the two
      // populations differ only in galactic latitude
      if (distPc >= 500 && distPc <= 1000) {
        const latDeg = Math.abs(b) * 180 / Math.PI
        if (latDeg < 5) ebvLowLat.push(ebv)
        else if (latDeg > 30) ebvHighLat.push(ebv)
      }
    } else {
      // patched in after the conversion law is fitted, below
      fallbackAt.push(keepCi.length)
      fallbackBpRp.push(bpRp)
      keepCi.push(0)
      fallback++
    }
  }
  console.log(`colors: ${measured} from measured teff + measured reddening, ${fallback} from BP−RP ` +
    `(${((100 * measured) / (measured + fallback)).toFixed(1)}% measured)`)
  console.log(`reddening applied to the measured set: mean E(B−V) ${(ebvSum / measured).toFixed(4)}, max ${ebvMax.toFixed(3)}`)

  // ---- join-rate gate ----
  // The teff join is keyed on formatted coordinates. If ESA ever changes how it prints doubles,
  // every key would miss and the join would silently collapse to zero — leaving a catalog that
  // still builds and still looks plausible, just entirely on the fallback path. Fail loudly.
  const measuredFrac = measured / (measured + fallback)
  if (measuredFrac < 0.5) {
    throw new Error(`teff join rate collapsed to ${(100 * measuredFrac).toFixed(1)}% (expected >= 50%) — ` +
      `gaia_teff.csv probably no longer matches gaia.csv row for row`)
  }

  // ---- BP−RP -> B−V conversion for the fallback stars ----
  //
  // colorIndexToRgb reads its argument as B−V, but BP−RP is a WIDER baseline: Gaia's BP and RP
  // straddle more of the spectrum than Johnson B and V, so the same star has a numerically larger
  // BP−RP than B−V. Feeding BP−RP in raw therefore renders every fallback star too red, and pins
  // the reddest ones against the ramp's 2.0 rail where they all collapse to one flat colour.
  //
  // The law is refitted here on this build's own data rather than taken from a paper: every star
  // that has BOTH a teff and a BP−RP gives a (BP−RP, B−V) pair on exactly the scale this catalog
  // uses, including its clamping. A cubic is used because the relation genuinely curves — a
  // straight line leaves a structured residual that sweeps from -0.16 at the blue end to +0.10
  // in the mid-range before turning over.
  //
  // NOTE: no dereddening happens here, deliberately. BP−RP is an observed colour, and the pairs
  // it is fitted against are observed B−V (intrinsic + E(B−V)). Reddening moves a star along
  // BOTH axes at once — E(BP−RP) ~ 1.29 E(B−V) — so the single law absorbs the average reddening
  // behaviour of the sample. Subtracting extinction here would double-count it.
  const CONVERSION_DEGREE = 3
  const bpRpToBv = polyfit(fitX, fitY, CONVERSION_DEGREE)
  {
    let ss = 0
    for (let i = 0; i < fitX.length; i++) { const d = fitY[i] - polyval(bpRpToBv, fitX[i]); ss += d * d }
    console.log(`BP−RP -> B−V fitted on ${fitX.length} same-star pairs (degree ${CONVERSION_DEGREE}): ` +
      `B−V = ${bpRpToBv.map((c, i) => `${c >= 0 && i > 0 ? '+' : ''}${c.toFixed(6)}${i ? `*x^${i}` : ''}`).join(' ')}` +
      `  (RMS ${Math.sqrt(ss / fitX.length).toFixed(4)})`)
  }
  let railedBefore = 0, railedAfter = 0
  for (let i = 0; i < fallbackAt.length; i++) {
    const raw = fallbackBpRp[i]
    if (!Number.isFinite(raw)) { keepCi[fallbackAt[i]] = 0.7; continue }
    if (raw > 2.0) railedBefore++
    const bv = Math.max(REDDEN_CLAMP_LO, Math.min(REDDEN_CLAMP_HI, polyval(bpRpToBv, raw)))
    if (bv > 2.0) railedAfter++
    keepCi[fallbackAt[i]] = bv
  }
  console.log(`fallback stars past the colour ramp's 2.0 rail: ${railedBefore} -> ${railedAfter}`)

  // ---- seam gate ----
  // The two populations must land on the same colour scale, or the sky splits into two tinted
  // halves along an invisible "did Gaia fit a temperature" boundary.
  //
  // The comparison is made WITHIN narrow BP−RP bins, not over the band as a whole: the two
  // populations do not share a BP−RP distribution (GSP-Phot's coverage is colour-dependent), so
  // comparing their bulk medians would report a difference in what the samples contain rather
  // than a difference in how they are coloured. Per bin, the two are looking at the same kind of
  // star, so any gap is the conversion itself being off.
  {
    const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
    const BIN = 0.2, LO = 0.4, HI = 1.6, TOL = 0.05
    let worstGap = 0, worstBin = 0, comparedBins = 0
    for (let lo = LO; lo < HI - 1e-9; lo += BIN) {
      const hi = lo + BIN
      const mine = fitY.filter((_, i) => fitX[i] >= lo && fitX[i] < hi)
      const theirs = fallbackBpRp.filter(v => v >= lo && v < hi).map(v => polyval(bpRpToBv, v))
      if (mine.length < 200 || theirs.length < 200) continue
      comparedBins++
      const gap = Math.abs(median(mine) - median(theirs))
      if (gap > worstGap) { worstGap = gap; worstBin = lo }
    }
    if (comparedBins < 3) throw new Error(`seam gate could only compare ${comparedBins} BP−RP bins`)
    console.log(`seam gate over BP−RP ${LO}..${HI} (${comparedBins} bins): worst median gap ` +
      `${worstGap.toFixed(4)} at BP−RP ${worstBin.toFixed(1)}..${(worstBin + BIN).toFixed(1)}`)
    if (!(worstGap <= TOL)) {
      throw new Error(`colour seam between the measured and fallback populations reaches ` +
        `${worstGap.toFixed(3)} (expected <= ${TOL}) — the BP−RP conversion is not landing on the same scale`)
    }
  }

  // ---- reddening-direction gate ----
  // Matched distance band (500-1000 pc), so the only difference is where on the sky the stars
  // are. Dust lives in the disk, so low-latitude stars must be far more reddened than polar ones;
  // if they are not, the map is being sampled in the wrong orientation (or not at all).
  {
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    if (ebvLowLat.length < 100 || ebvHighLat.length < 100) {
      throw new Error(`reddening-direction gate has too few stars: |b|<5 ${ebvLowLat.length}, |b|>30 ${ebvHighLat.length}`)
    }
    const lo = mean(ebvLowLat), hi = mean(ebvHighLat)
    const ratio = lo / hi
    console.log(`reddening-direction gate (500-1000 pc): mean E(B−V) ${lo.toFixed(4)} at |b|<5 deg ` +
      `(n=${ebvLowLat.length}) vs ${hi.toFixed(4)} at |b|>30 deg (n=${ebvHighLat.length}) -> ${ratio.toFixed(2)}x`)
    if (!(ratio >= 3)) {
      throw new Error(`in-plane stars are only ${ratio.toFixed(2)}x as reddened as polar ones (expected >= 3x) — ` +
        `the dust map is not being sampled in the right orientation`)
    }
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
