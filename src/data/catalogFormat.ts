const MAGIC = 0x43534d53 // "CSMS"
const VERSION = 1

export interface StarCatalog {
  count: number
  positions: Float32Array  // [x,y,z]*count, parsecs, EQJ
  absMag: Float32Array
  colorIndex: Float32Array // B−V (HYG) or BP−RP (Gaia); consumed the same way
}

export function encodeCatalog(c: StarCatalog): ArrayBuffer {
  if (c.positions.length !== c.count * 3 || c.absMag.length !== c.count || c.colorIndex.length !== c.count) {
    throw new Error('catalog arrays inconsistent with count')
  }
  const buf = new ArrayBuffer(12 + c.count * 5 * 4)
  const view = new DataView(buf)
  view.setUint32(0, MAGIC, true)
  view.setUint32(4, VERSION, true)
  view.setUint32(8, c.count, true)
  new Float32Array(buf, 12, c.count * 3).set(c.positions)
  new Float32Array(buf, 12 + c.count * 12, c.count).set(c.absMag)
  new Float32Array(buf, 12 + c.count * 16, c.count).set(c.colorIndex)
  return buf
}

export function decodeCatalog(buf: ArrayBuffer): StarCatalog {
  const view = new DataView(buf)
  if (buf.byteLength < 12 || view.getUint32(0, true) !== MAGIC) throw new Error('bad catalog magic')
  if (view.getUint32(4, true) !== VERSION) throw new Error('unsupported catalog version')
  const count = view.getUint32(8, true)
  if (buf.byteLength < 12 + count * 20) {
    throw new Error(`catalog buffer truncated: have ${buf.byteLength} bytes, need ${12 + count * 20}`)
  }
  return {
    count,
    positions: new Float32Array(buf, 12, count * 3),
    absMag: new Float32Array(buf, 12 + count * 12, count),
    colorIndex: new Float32Array(buf, 12 + count * 16, count),
  }
}
