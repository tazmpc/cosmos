/**
 * Resample the Edenhofer et al. (2023) 3D dust map into the compact cumulative-extinction grid
 * that build-milkyway.ts marches through.
 *
 *   npm run dustmap                  # streams the source from Zenodo (~1.6 GB, once)
 *   npm run dustmap -- --mean FILE   # use an already-downloaded copy of the MEAN cube
 *
 * Source: Zenodo record 8187943, file `mean_and_std_healpix.fits` (3.25 GB).
 * Layout, read straight off the FITS headers (this script parses them rather than trusting it):
 *
 *   HDU 0  primary, no data
 *   HDU 1  IMAGE  'MEAN'                    float32, 786432 x 516  (nside=256 NESTED x radii)
 *   HDU 2  IMAGE  'STD.'                    float32, same shape
 *   HDU 3  BINTABLE 'RADIAL PIXEL CENTERS'      float32 x 516, parsecs
 *   HDU 4  BINTABLE 'RADIAL PIXEL BOUNDARIES'   float32 x 517, parsecs
 *
 * Only HDU 1 and HDU 4 are needed, so the script HTTP-range-fetches exactly those byte spans
 * (~1.6 GB instead of 3.25 GB) and never stores the cube — it streams one 3 MB distance slice at
 * a time, accumulating the integral in place.
 *
 * The cube holds *differential* extinction density in units of "E of Zhang, Green & Rix (2023)"
 * per parsec (FITS keyword CUNIT), on 516 geometrically spaced radii from 68.8 pc to 1244.6 pc.
 * Integrating density x ds over distance gives the cumulative extinction E, which is what gets
 * written out — resampled onto N_NODES evenly spaced distance nodes so the cache stays small.
 *
 * FITS is simple enough to read without a dependency: a header is a whole number of 2880-byte
 * blocks of 80-character card images, terminated by an `END` card, and the data unit that follows
 * is big-endian and padded to a whole number of 2880-byte blocks.
 */
import { existsSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from 'node:fs'
import { encodeDustGrid } from '../src/data/dustMap'

const URL = 'https://zenodo.org/api/records/8187943/files/mean_and_std_healpix.fits/content'
const OUT = 'scripts/cache/edenhofer-cum.bin'
const BLOCK = 2880

/** Distance nodes: evenly spaced out to the map's validity radius. 16 nodes = 83 pc apart, a
 *  little finer than the 100 pc sight-line bins in build-milkyway that sample them. */
const N_NODES = 16
const S_MAX_PC = 1250

// ---- minimal FITS reading ------------------------------------------------------------------

interface FitsHeader { cards: Record<string, string>; blocks: number }

/** Parse 80-char card images out of `buf` starting at `off` until the END card. */
function parseHeader(buf: Buffer, off: number): FitsHeader {
  const cards: Record<string, string> = {}
  for (let n = 0; ; n++) {
    const p = off + n * 80
    if (p + 80 > buf.length) throw new Error('FITS header ran past the buffer')
    const card = buf.toString('ascii', p, p + 80)
    const key = card.slice(0, 8).trim()
    if (key === 'END') return { cards, blocks: Math.ceil((n + 1) * 80 / BLOCK) }
    if (card[8] === '=') cards[key] = card.slice(9).split('/')[0].trim().replace(/^'|'\s*$/g, '').trim()
  }
}

const int = (h: FitsHeader, k: string) => {
  const v = h.cards[k]
  if (v === undefined) throw new Error(`FITS keyword ${k} missing — data release changed?`)
  return parseInt(v, 10)
}
/** Size of a header+data unit in bytes, given the header's own block count. */
const hduBytes = (h: FitsHeader, dataBytes: number) =>
  h.blocks * BLOCK + Math.ceil(dataBytes / BLOCK) * BLOCK

async function fetchRange(start: number, endInclusive: number): Promise<Buffer> {
  const res = await fetch(URL, { headers: { Range: `bytes=${start}-${endInclusive}` } })
  if (!res.ok) throw new Error(`range fetch ${start}-${endInclusive} failed: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// ---- main ------------------------------------------------------------------------------------

async function main() {
  const meanArg = process.argv.indexOf('--mean')
  const localMean = meanArg !== -1 ? process.argv[meanArg + 1] : undefined

  // 1. headers: primary + MEAN, and from their sizes the offset of everything after them
  const head = await fetchRange(0, 4 * BLOCK - 1)
  const primary = parseHeader(head, 0)
  if (primary.cards.SIMPLE !== 'T') throw new Error('not a FITS file')
  const mean = parseHeader(head, primary.blocks * BLOCK)
  const npix = int(mean, 'NAXIS1')
  const nbins = int(mean, 'NAXIS2')
  const nside = int(mean, 'NSIDE')
  if (int(mean, 'BITPIX') !== -32) throw new Error('expected float32 MEAN cube')
  if (mean.cards.ORDERING !== 'NEST') throw new Error(`expected NESTED ordering, got ${mean.cards.ORDERING}`)
  if (npix !== 12 * nside * nside) throw new Error(`NAXIS1 ${npix} is not 12*nside^2 for nside ${nside}`)
  console.log(`MEAN cube: nside=${nside} (${npix} px, ${mean.cards.ORDERING}) x ${nbins} radii, unit "${mean.cards.CUNIT}"`)

  const cubeBytes = npix * nbins * 4
  const meanDataStart = primary.blocks * BLOCK + mean.blocks * BLOCK
  const stdStart = meanDataStart + Math.ceil(cubeBytes / BLOCK) * BLOCK

  // 2. walk past STD and the CENTERS table to reach the radial boundaries table
  const stdHead = parseHeader(await fetchRange(stdStart, stdStart + 4 * BLOCK - 1), 0)
  const centersStart = stdStart + hduBytes(stdHead, int(stdHead, 'NAXIS1') * int(stdHead, 'NAXIS2') * 4)
  const centersHead = parseHeader(await fetchRange(centersStart, centersStart + 4 * BLOCK - 1), 0)
  const boundsStart = centersStart + hduBytes(centersHead, int(centersHead, 'NAXIS1') * int(centersHead, 'NAXIS2'))
  const boundsBuf = await fetchRange(boundsStart, boundsStart + 8 * BLOCK - 1)
  const boundsHead = parseHeader(boundsBuf, 0)
  if (boundsHead.cards.EXTNAME !== 'RADIAL PIXEL BOUNDARIES') {
    throw new Error(`expected the radial boundaries table, found "${boundsHead.cards.EXTNAME}"`)
  }
  if (boundsHead.cards.CUNIT !== 'pc') throw new Error(`radii are in "${boundsHead.cards.CUNIT}", expected pc`)
  const nBounds = int(boundsHead, 'NAXIS2')
  if (nBounds !== nbins + 1) throw new Error(`${nBounds} boundaries for ${nbins} bins`)
  const bounds = new Float64Array(nBounds)
  for (let i = 0; i < nBounds; i++) bounds[i] = boundsBuf.readFloatBE(boundsHead.blocks * BLOCK + i * 4)
  console.log(`radial bins: ${bounds[0].toFixed(1)} pc .. ${bounds[nBounds - 1].toFixed(1)} pc (${nbins} geometric bins)`)

  // 3. distance nodes, and a running integral of density x ds over the cube
  const nodes = new Float32Array(N_NODES)
  for (let j = 0; j < N_NODES; j++) nodes[j] = (j * S_MAX_PC) / (N_NODES - 1)
  const cum = new Float64Array(npix)          // E integrated out to the current bin boundary
  const out = new Float32Array(N_NODES * npix) // node 0 (distance 0) stays zero
  let nextNode = 1
  while (nextNode < N_NODES && nodes[nextNode] <= bounds[0]) nextNode++ // inside the map's inner edge: no dust

  const slice = Buffer.allocUnsafe(npix * 4)
  const readSlice = await sliceReader(localMean, meanDataStart, npix, nbins)
  for (let k = 0; k < nbins; k++) {
    await readSlice(k, slice)
    slice.swap32() // FITS is big-endian; swap in place so the bytes can be read as a Float32Array
    const dens = new Float32Array(slice.buffer, slice.byteOffset, npix)
    const lo = bounds[k], hi = bounds[k + 1]
    // any node landing inside this bin is the integral to `lo` plus a partial step
    while (nextNode < N_NODES && nodes[nextNode] <= hi) {
      const partial = nodes[nextNode] - lo
      const base = nextNode * npix
      for (let p = 0; p < npix; p++) out[base + p] = cum[p] + dens[p] * partial
      nextNode++
    }
    const dvol = hi - lo
    for (let p = 0; p < npix; p++) cum[p] += dens[p] * dvol
    if (k % 100 === 0) process.stdout.write(`\r  integrating radial bin ${k}/${nbins}`)
  }
  // nodes past the map's outer edge clamp to the full column
  for (; nextNode < N_NODES; nextNode++) {
    const base = nextNode * npix
    for (let p = 0; p < npix; p++) out[base + p] = cum[p]
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r')

  mkdirSync('scripts/cache', { recursive: true })
  const buf = Buffer.from(encodeDustGrid({ nside, nodes, cum: out }))
  writeFileSync(OUT, buf)

  const sorted = Float64Array.from(out.subarray((N_NODES - 1) * npix)).sort()
  const pct = (q: number) => sorted[Math.floor(q * (sorted.length - 1))]
  console.log(`wrote ${OUT} — ${(buf.length / 1e6).toFixed(1)} MB, ${N_NODES} nodes 0..${S_MAX_PC} pc`)
  console.log(`E at ${S_MAX_PC} pc over the whole sky: median ${pct(0.5).toFixed(3)}, p90 ${pct(0.9).toFixed(3)}, max ${pct(1).toFixed(3)}`)
}

/** Distance slices come either from a local copy of the cube or straight off the network. Both
 *  readers assume the caller walks the slices in order, which the integration loop does. */
async function sliceReader(localMean: string | undefined, dataStart: number, npix: number, nbins: number) {
  if (localMean) {
    if (!existsSync(localMean)) throw new Error(`--mean file not found: ${localMean}`)
    const fd = openSync(localMean, 'r')
    process.on('exit', () => closeSync(fd))
    console.log(`reading the MEAN cube from ${localMean}`)
    return async (k: number, into: Buffer) => { readSync(fd, into, 0, npix * 4, k * npix * 4) }
  }
  const cubeBytes = npix * 4 * nbins
  console.log(`streaming the MEAN cube from Zenodo (${(cubeBytes / 1e9).toFixed(1)} GB, once)`)
  const res = await fetch(URL, { headers: { Range: `bytes=${dataStart}-${dataStart + cubeBytes - 1}` } })
  if (!res.ok || !res.body) throw new Error(`cube fetch failed: HTTP ${res.status}`)
  const reader = res.body.getReader()
  // Hold arriving chunks in a queue and copy each one out exactly once. Concatenating the queue
  // on every arrival instead would recopy the whole pending buffer per network chunk — tens of
  // GB of memcpy over the full cube.
  const queue: Uint8Array[] = []
  let queued = 0
  return async (_k: number, into: Buffer) => {
    while (queued < into.length) {
      const { value, done } = await reader.read()
      if (done) throw new Error('stream ended early')
      queue.push(value)
      queued += value.length
    }
    let off = 0
    while (off < into.length) {
      const head = queue[0]
      const take = Math.min(head.length, into.length - off)
      into.set(head.subarray(0, take), off)
      off += take
      if (take === head.length) queue.shift()
      else queue[0] = head.subarray(take)
      queued -= take
    }
  }
}

main()
