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

  it('encodes a catalog with no velocities as version 1', () => {
    const buf = encodeCatalog({
      count: 2,
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      absMag: new Float32Array([1, 2]),
      colorIndex: new Float32Array([0.5, 0.6]),
    })
    expect(new DataView(buf).getUint32(4, true)).toBe(1)
    expect(buf.byteLength).toBe(12 + 2 * 20)
  })

  it('encodes a catalog WITH velocities as version 2 and round-trips them', () => {
    const positions = new Float32Array([1.5, -2.5, 3.25, 0.1, 0.2, 0.3])
    const absMag = new Float32Array([1.42, -1.46])
    const colorIndex = new Float32Array([0.65, 0.0])
    // Barnard-scale numbers: pc/yr velocities are ~1e-5, well inside f32 range but small
    const velocities = new Float32Array([-1.5e-6, 9.1e-5, 7.4e-6, 0, 0, 0])
    const buf = encodeCatalog({ count: 2, positions, absMag, colorIndex, velocities })
    expect(new DataView(buf).getUint32(4, true)).toBe(2)
    expect(buf.byteLength).toBe(12 + 2 * 32)
    const d = decodeCatalog(buf)
    expect(d.count).toBe(2)
    expect(Array.from(d.positions)).toEqual(Array.from(positions))
    expect(Array.from(d.absMag)).toEqual(Array.from(absMag))
    expect(Array.from(d.colorIndex)).toEqual(Array.from(colorIndex))
    expect(Array.from(d.velocities!)).toEqual(Array.from(velocities))
  })

  it('decodes a v1 buffer with zero velocities (backward compatible)', () => {
    const buf = encodeCatalog({
      count: 2,
      positions: new Float32Array([1.5, -2.5, 3.25, 0.1, 0.2, 0.3]),
      absMag: new Float32Array([1.42, -1.46]),
      colorIndex: new Float32Array([0.65, 0.0]),
    })
    const d = decodeCatalog(buf)
    expect(d.velocities).toBeInstanceOf(Float32Array)
    expect(d.velocities!.length).toBe(6)
    expect(Array.from(d.velocities!)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('leaves the v1 region byte-identical when velocities are added', () => {
    const positions = new Float32Array([1.5, -2.5, 3.25, 0.1, 0.2, 0.3])
    const absMag = new Float32Array([1.42, -1.46])
    const colorIndex = new Float32Array([0.65, 0.0])
    const v1 = new Uint8Array(encodeCatalog({ count: 2, positions, absMag, colorIndex }))
    const v2 = new Uint8Array(encodeCatalog({
      count: 2, positions, absMag, colorIndex,
      velocities: new Float32Array([1, 2, 3, 4, 5, 6]),
    }))
    // everything after the header's version field, up to the end of the v1 payload
    expect(Array.from(v2.subarray(8, 12 + 2 * 20))).toEqual(Array.from(v1.subarray(8, 12 + 2 * 20)))
  })

  it('rejects a v2 buffer truncated inside the velocity block', () => {
    const full = encodeCatalog({
      count: 2,
      positions: new Float32Array([1, 2, 3, 4, 5, 6]),
      absMag: new Float32Array([1, 2]),
      colorIndex: new Float32Array([0.5, 0.6]),
      velocities: new Float32Array([1, 2, 3, 4, 5, 6]),
    })
    // exactly the size a v1 catalog of this count would be: passes the v1 check, must fail the v2 one
    const short = full.slice(0, 12 + 2 * 20)
    expect(() => decodeCatalog(short)).toThrow(/truncated/)
  })

  it('rejects a velocity array inconsistent with count', () => {
    expect(() =>
      encodeCatalog({
        count: 2,
        positions: new Float32Array([1, 2, 3, 4, 5, 6]),
        absMag: new Float32Array([1, 2]),
        colorIndex: new Float32Array([0.5, 0.6]),
        velocities: new Float32Array([1, 2, 3]), // too short: needs count*3 = 6
      }),
    ).toThrow(/inconsistent/)
  })

  it('rejects an unknown future version', () => {
    const buf = new ArrayBuffer(12 + 2 * 32)
    const view = new DataView(buf)
    view.setUint32(0, 0x43534d53, true)
    view.setUint32(4, 3, true)
    view.setUint32(8, 2, true)
    expect(() => decodeCatalog(buf)).toThrow(/version/i)
  })

})
