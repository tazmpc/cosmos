import { describe, it, expect } from 'vitest'
import { encodeCatalog, decodeCatalog } from './catalogFormat'

describe('catalog binary format', () => {
  it('round-trips positions, magnitudes and color indices', () => {
    const positions = new Float32Array([1.5, -2.5, 3.25, 0.1, 0.2, 0.3])
    const absMag = new Float32Array([1.42, -1.46])
    const colorIndex = new Float32Array([0.65, 0.0])
    const buf = encodeCatalog({ count: 2, positions, absMag, colorIndex })
    const d = decodeCatalog(buf)
    expect(d.count).toBe(2)
    expect(Array.from(d.positions)).toEqual(Array.from(positions))
    expect(Array.from(d.absMag)).toEqual(Array.from(absMag))
    expect(Array.from(d.colorIndex)).toEqual(Array.from(colorIndex))
  })

  it('rejects a buffer with the wrong magic number', () => {
    expect(() => decodeCatalog(new ArrayBuffer(16))).toThrow(/magic/i)
  })

  it('rejects encoding when array lengths are inconsistent with count', () => {
    expect(() =>
      encodeCatalog({
        count: 2,
        positions: new Float32Array([1, 2, 3]), // too short: needs count*3 = 6
        absMag: new Float32Array([1.42, -1.46]),
        colorIndex: new Float32Array([0.65, 0.0]),
      }),
    ).toThrow(/inconsistent/)
  })

  it('rejects a truncated buffer with valid header', () => {
    const buf = new ArrayBuffer(32)
    const view = new DataView(buf)
    view.setUint32(0, 0x43534d53, true) // magic
    view.setUint32(4, 1, true) // version
    view.setUint32(8, 100, true) // count claims 100 stars, buffer far too small
    expect(() => decodeCatalog(buf)).toThrow(/truncated/)
  })
})
