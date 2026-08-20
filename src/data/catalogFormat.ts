const MAGIC = 0x43534d53 // "CSMS"

/** v1: positions + absMag + colorIndex. */
const VERSION_V1 = 1
/** v2: v1 plus a per-point velocity vector (proper motion), appended after the v1 payload. */
const VERSION_V2 = 2

/** Bytes per point in a v1 payload: 3 floats of position + absMag + colorIndex. */
const V1_STRIDE = 20
/** Bytes per point in a v2 payload: the v1 stride plus 3 floats of velocity. */
const V2_STRIDE = 32

const HEADER = 12

export interface StarCatalog {
  count: number
  positions: Float32Array  // [x,y,z]*count, parsecs, EQJ
  absMag: Float32Array
  colorIndex: Float32Array // B−V (HYG) or BP−RP (Gaia); consumed the same way
  /**
   * [vx,vy,vz]*count, PARSECS PER YEAR, EQJ — the same axes and the same interleaving as
   * `positions`, so a star's position at year t from the catalog epoch is simply
   * `positions + velocities * t`. Interleaved rather than three separate arrays so the decoded
   * buffer can be handed straight to a `vec3` GPU attribute with no repacking.
   *
   * Optional on the ENCODE side: passing it selects format v2, omitting it keeps v1 (which is
   * what every catalog but stars.bin does — a galaxy's proper motion is unmeasurable). On the
   * DECODE side it is always present: a v1 file decodes to an all-zero velocity array, so every
   * consumer sees one shape and the shared point shader needs no per-layer branch.
   */
  velocities?: Float32Array
}

export function encodeCatalog(c: StarCatalog): ArrayBuffer {
  if (c.positions.length !== c.count * 3 || c.absMag.length !== c.count || c.colorIndex.length !== c.count) {
    throw new Error('catalog arrays inconsistent with count')
  }
  if (c.velocities !== undefined && c.velocities.length !== c.count * 3) {
    throw new Error('catalog velocity array inconsistent with count')
  }
  const version = c.velocities !== undefined ? VERSION_V2 : VERSION_V1
  const stride = version === VERSION_V2 ? V2_STRIDE : V1_STRIDE
  const buf = new ArrayBuffer(HEADER + c.count * stride)
  const view = new DataView(buf)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, version, true)
  view.setUint32(8, c.count, true)
  new Float32Array(buf, HEADER, c.count * 3).set(c.positions)
  new Float32Array(buf, HEADER + c.count * 12, c.count).set(c.absMag)
  new Float32Array(buf, HEADER + c.count * 16, c.count).set(c.colorIndex)
  if (c.velocities !== undefined) {
    new Float32Array(buf, HEADER + c.count * V1_STRIDE, c.count * 3).set(c.velocities)
  }
  return buf
}

export function decodeCatalog(buf: ArrayBuffer): StarCatalog {
  const view = new DataView(buf)
  if (buf.byteLength < HEADER || view.getUint32(0, true) !== MAGIC) throw new Error('bad catalog magic')
  const version = view.getUint32(4, true)
  if (version !== VERSION_V1 && version !== VERSION_V2) throw new Error(`unsupported catalog version ${version}`)
  const count = view.getUint32(8, true)
  // Sized per version: a v2 file truncated after its v1 payload would otherwise pass a v1-sized
  // check and hand out a velocity view running off the end of the buffer.
  const stride = version === VERSION_V2 ? V2_STRIDE : V1_STRIDE
  if (buf.byteLength < HEADER + count * stride) {
    throw new Error(`catalog buffer truncated: have ${buf.byteLength} bytes, need ${HEADER + count * stride}`)
  }
  return {
    count,
    positions: new Float32Array(buf, HEADER, count * 3),
    absMag: new Float32Array(buf, HEADER + count * 12, count),
    colorIndex: new Float32Array(buf, HEADER + count * 16, count),
    // v1 predates proper motions: a zero vector is the honest value (the format carries no
    // measurement), and it keeps the runtime single-path — see the field's doc comment.
    velocities: version === VERSION_V2
      ? new Float32Array(buf, HEADER + count * V1_STRIDE, count * 3)
      : new Float32Array(count * 3),
  }
}
