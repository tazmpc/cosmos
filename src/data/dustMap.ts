/**
 * Measured 3D dust: a compact resampling of the Edenhofer et al. (2023) map.
 *
 * The published map (Zenodo record 8187943, `mean_and_std_healpix.fits`) is a stack of 516
 * HEALPix nside=256 NESTED spheres at geometrically spaced radii from 68.8 pc to 1244.6 pc,
 * holding *differential* extinction density in units of "E of Zhang, Green & Rix (2023)" per
 * parsec. scripts/build-dustmap.ts integrates that along distance and resamples it onto a
 * small number of distance nodes, giving the CUMULATIVE extinction E from the Sun out to each
 * node — which is what a sight-line march actually wants. This module owns the HEALPix
 * indexing, the cache's binary format, and the lookup.
 */

export interface DustGrid {
  nside: number
  /** Distance nodes in parsecs, ascending, nodes[0] === 0. */
  nodes: Float32Array
  /** Cumulative extinction E from the Sun: [node][pixel], NESTED order, length nodes*12*nside². */
  cum: Float32Array
}

const MAGIC = 0x4d445543 // "CUDM" little-endian
const VERSION = 1

export function encodeDustGrid(g: DustGrid): ArrayBuffer {
  const npix = 12 * g.nside * g.nside
  if (g.cum.length !== g.nodes.length * npix) throw new Error('dust grid arrays inconsistent')
  const buf = new ArrayBuffer(16 + g.nodes.length * 4 + g.cum.length * 4)
  const view = new DataView(buf)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, VERSION, true)
  view.setUint32(8, g.nside, true)
  view.setUint32(12, g.nodes.length, true)
  new Float32Array(buf, 16, g.nodes.length).set(g.nodes)
  new Float32Array(buf, 16 + g.nodes.length * 4, g.cum.length).set(g.cum)
  return buf
}

export function decodeDustGrid(buf: ArrayBuffer): DustGrid {
  const view = new DataView(buf)
  if (buf.byteLength < 16 || view.getUint32(0, true) !== MAGIC) throw new Error('bad dust grid magic')
  if (view.getUint32(4, true) !== VERSION) throw new Error('unsupported dust grid version')
  const nside = view.getUint32(8, true)
  const nNodes = view.getUint32(12, true)
  const npix = 12 * nside * nside
  if (buf.byteLength < 16 + nNodes * 4 + nNodes * npix * 4) throw new Error('dust grid truncated')
  return {
    nside,
    nodes: new Float32Array(buf, 16, nNodes),
    cum: new Float32Array(buf, 16 + nNodes * 4, nNodes * npix),
  }
}

/**
 * Cumulative extinction E along galactic direction (l, b) out to `distPc`.
 * Nearest pixel in angle, linear in distance, clamped (not extrapolated) past the last node.
 */
export function cumulativeE(g: DustGrid, l: number, b: number, distPc: number): number {
  const pix = ang2pixNest(g.nside, Math.PI / 2 - b, l)
  const npix = 12 * g.nside * g.nside
  const nodes = g.nodes
  const last = nodes.length - 1
  if (distPc <= nodes[0]) return g.cum[pix]
  if (distPc >= nodes[last]) return g.cum[last * npix + pix]
  // nodes are short (tens of entries) and the march walks outward, so a linear scan is fine
  let j = 1
  while (j < last && nodes[j] < distPc) j++
  const t = (distPc - nodes[j - 1]) / (nodes[j] - nodes[j - 1])
  const a = g.cum[(j - 1) * npix + pix]
  return a + t * (g.cum[j * npix + pix] - a)
}

// ---- HEALPix NESTED indexing ---------------------------------------------------------------
//
// Direct port of the standard HEALPix ang2pix_nest / pix2ang_nest geometry (Górski et al. 2005),
// written out here rather than pulled in as a dependency — it is ~60 lines and the project has no
// other use for a HEALPix library. The sphere is tiled by 12 equal-area base faces: faces 0-3 cap
// the north, 4-7 straddle the equator, 8-11 cap the south. Within a face, the NESTED index
// interleaves the two face-local coordinates bit by bit (ix on even bits, iy on odd), which is
// what makes pixel p at nside n decompose into exactly 4p..4p+3 at nside 2n.

/** Interleave the low 16 bits of v into even bit positions ("Morton spread"). */
function spreadBits(v: number): number {
  let x = v & 0xffff
  x = (x | (x << 8)) & 0x00ff00ff
  x = (x | (x << 4)) & 0x0f0f0f0f
  x = (x | (x << 2)) & 0x33333333
  x = (x | (x << 1)) & 0x55555555
  return x >>> 0
}

/** Inverse of spreadBits: gather the even bits of v back into the low bits. */
function compressBits(v: number): number {
  let x = v & 0x55555555
  x = (x | (x >>> 1)) & 0x33333333
  x = (x | (x >>> 2)) & 0x0f0f0f0f
  x = (x | (x >>> 4)) & 0x00ff00ff
  x = (x | (x >>> 8)) & 0x0000ffff
  return x >>> 0
}

/** theta = colatitude (0 at the north pole), phi = longitude, both radians. */
export function ang2pixNest(nside: number, theta: number, phi: number): number {
  const z = Math.cos(theta)
  const za = Math.abs(z)
  let tt = (phi % (2 * Math.PI)) / (Math.PI / 2) // in [0,4)
  if (tt < 0) tt += 4
  let face: number, ix: number, iy: number

  if (za <= 2 / 3) {
    // equatorial belt: the face boundaries are the two families of 45-degree lines
    const temp1 = nside * (0.5 + tt)
    const temp2 = nside * z * 0.75
    const jp = Math.floor(temp1 - temp2) // ascending edge line index
    const jm = Math.floor(temp1 + temp2) // descending edge line index
    const ifp = Math.floor(jp / nside)
    const ifm = Math.floor(jm / nside)
    if (ifp === ifm) face = (ifp & 3) + 4
    else if (ifp < ifm) face = ifp & 3
    else face = (ifm & 3) + 8
    ix = jm & (nside - 1)
    iy = nside - (jp & (nside - 1)) - 1
  } else {
    // polar caps: the face-local coordinates come from the two edges of the collapsing triangle
    const ntt = Math.min(3, Math.floor(tt))
    const tp = tt - ntt
    const tmp = nside * Math.sqrt(3 * (1 - za))
    let jp = Math.floor(tp * tmp)
    let jm = Math.floor((1 - tp) * tmp)
    if (jp >= nside) jp = nside - 1
    if (jm >= nside) jm = nside - 1
    if (z >= 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1 }
    else { face = ntt + 8; ix = jp; iy = jm }
  }
  return face * nside * nside + (spreadBits(ix) | (spreadBits(iy) << 1))
}

/** Centre of NESTED pixel `ipix` as [theta, phi], radians. */
export function pix2angNest(nside: number, ipix: number): [number, number] {
  const npface = nside * nside
  const face = Math.floor(ipix / npface)
  const p = ipix - face * npface
  const ix = compressBits(p)
  const iy = compressBits(p >>> 1)

  // Face-local (ix, iy) -> the global "ring-style" coordinates jr (ring index) and jp (in-ring).
  // JRLL/JPLL are the standard per-face offsets of the face centres in those coordinates.
  const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
  const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]
  const jr = JRLL[face] * nside - ix - iy - 1
  const nl4 = 4 * nside
  let nr: number, z: number, kshift: number
  if (jr < nside) {
    nr = jr
    z = 1 - (nr * nr) / (3 * nside * nside)
    kshift = 0
  } else if (jr > 3 * nside) {
    nr = nl4 - jr
    z = (nr * nr) / (3 * nside * nside) - 1
    kshift = 0
  } else {
    nr = nside
    z = ((2 * nside - jr) * 2) / (3 * nside)
    kshift = (jr - nside) & 1
  }
  let jp = (JPLL[face] * nr + ix - iy + 1 + kshift) / 2
  if (jp > nl4) jp -= nl4
  if (jp < 1) jp += nl4
  const phi = ((jp - (kshift + 1) * 0.5) * (Math.PI / 2)) / nr
  return [Math.acos(z), phi]
}
