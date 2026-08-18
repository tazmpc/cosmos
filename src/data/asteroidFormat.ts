/**
 * "CAST" — the binary container for public/asteroids.bin (built by scripts/build-asteroids.ts
 * from MPCORB). A sibling of catalogFormat.ts's "CSMS", but carrying ORBITAL ELEMENTS rather
 * than fixed positions: asteroid positions are solved per frame from these (see
 * src/scene/asteroidField.ts), because unlike stars they visibly move.
 *
 * Layout (little-endian):
 *   0   u32  magic "CAST"
 *   4   u32  version
 *   8   u32  count
 *   12  u32  padding (keeps the f64 below 8-byte aligned)
 *   16  f64  base epoch, Julian Date
 *   24  f32[count] x 9, in CAST_FIELD_ORDER — one contiguous array per field (SoA)
 *
 * Per-object epochs vary, but the MPC re-epochs its whole database to one standard epoch every
 * few months, so ~99.8% of objects share a single value. Storing that once as an f64 and giving
 * each object an f32 offset in DAYS costs 4 bytes/object instead of 8.
 *
 * Precision: the widest offset present is 30,589 days (892 objects carry epochs back to ~1942),
 * where the f32 ulp is 2^-9 d ~= 169 s. So the worst stored epoch error is under 3 minutes, which
 * for a main-belt mean motion of ~0.2 deg/day is a mean-anomaly error of ~4e-4 degrees — orders
 * of magnitude below the two-body model's own error, and exactly 0 for the 99.8% of objects
 * sitting at offset 0.
 */

export const CAST_MAGIC = 0x54534143 // "CAST" little-endian
export const CAST_VERSION = 1
export const CAST_HEADER_BYTES = 24
/** Number of f32 arrays that follow the header. */
export const CAST_FIELDS = 9

/** Field order in the file. Used by the encoder (build-asteroids.ts) and the decoder below. */
export const CAST_FIELD_ORDER = [
  'a', 'e', 'i', 'Omega', 'omega', 'M0', 'nDegDay', 'H', 'epochOffsetDays',
] as const

export interface AsteroidCatalog {
  count: number
  /** Julian Date the per-object `epochOffsetDays` are measured from. */
  baseEpochJd: number
  /** Semi-major axis, AU. */
  a: Float32Array
  /** Eccentricity. */
  e: Float32Array
  /** Inclination to the J2000 ecliptic, degrees. */
  i: Float32Array
  /** Longitude of ascending node, degrees. */
  Omega: Float32Array
  /** Argument of perihelion, degrees. */
  omega: Float32Array
  /** Mean anomaly at the object's own epoch, degrees. */
  M0: Float32Array
  /** Mean motion, degrees/day. */
  nDegDay: Float32Array
  /** Absolute magnitude in the asteroid (H, G) system. */
  H: Float32Array
  /** This object's epoch minus `baseEpochJd`, days. */
  epochOffsetDays: Float32Array
}

export function decodeAsteroids(buf: ArrayBuffer): AsteroidCatalog {
  const view = new DataView(buf)
  if (buf.byteLength < CAST_HEADER_BYTES || view.getUint32(0, true) !== CAST_MAGIC) {
    throw new Error('bad asteroid catalog magic')
  }
  if (view.getUint32(4, true) !== CAST_VERSION) throw new Error('unsupported asteroid catalog version')
  const count = view.getUint32(8, true)
  const need = CAST_HEADER_BYTES + count * CAST_FIELDS * 4
  if (buf.byteLength < need) {
    throw new Error(`asteroid catalog truncated: have ${buf.byteLength} bytes, need ${need}`)
  }
  const baseEpochJd = view.getFloat64(16, true)
  const field = (k: number): Float32Array =>
    new Float32Array(buf, CAST_HEADER_BYTES + k * count * 4, count)
  return {
    count, baseEpochJd,
    a: field(0), e: field(1), i: field(2), Omega: field(3), omega: field(4),
    M0: field(5), nDegDay: field(6), H: field(7), epochOffsetDays: field(8),
  }
}
