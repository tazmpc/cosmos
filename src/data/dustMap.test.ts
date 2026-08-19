import { describe, it, expect } from 'vitest'
import {
  ang2pixNest, pix2angNest, encodeDustGrid, decodeDustGrid, cumulativeE, type DustGrid,
} from './dustMap'
import { eqjToGalactic } from './starMath'

const DEG = Math.PI / 180

describe('ang2pixNest', () => {
  // At nside=1 there is exactly one pixel per HEALPix base face, and the NEST index IS the face
  // number. The 12 face centers are fixed by the HEALPix definition: four north-cap faces at
  // z = +2/3 and phi = 45,135,225,315; four equatorial faces at z = 0 and phi = 0,90,180,270;
  // four south-cap faces at z = -2/3 and the north-cap longitudes. Pinning these pins the face
  // numbering AND the north/south + longitude conventions — the things a flipped or transposed
  // map read would get wrong.
  it('maps the 12 base-face centers to face indices 0..11 at nside=1', () => {
    const north = Math.acos(2 / 3), equator = Math.acos(0), south = Math.acos(-2 / 3)
    const cases: [number, number, number][] = [
      [north, 45 * DEG, 0], [north, 135 * DEG, 1], [north, 225 * DEG, 2], [north, 315 * DEG, 3],
      [equator, 0, 4], [equator, 90 * DEG, 5], [equator, 180 * DEG, 6], [equator, 270 * DEG, 7],
      [south, 45 * DEG, 8], [south, 135 * DEG, 9], [south, 225 * DEG, 10], [south, 315 * DEG, 11],
    ]
    for (const [theta, phi, face] of cases) expect(ang2pixNest(1, theta, phi)).toBe(face)
  })

  it('puts the north pole on face 0..3 and the south pole on face 8..11', () => {
    expect(ang2pixNest(1, 1e-9, 0)).toBeLessThan(4)
    expect(ang2pixNest(1, Math.PI - 1e-9, 0)).toBeGreaterThanOrEqual(8)
  })

  it('always returns an in-range pixel index', () => {
    for (const nside of [1, 4, 16, 256]) {
      for (let i = 0; i < 500; i++) {
        const theta = Math.acos(2 * ((i * 0.6180339887) % 1) - 1)
        const phi = 2 * Math.PI * ((i * 0.7548776662) % 1)
        const p = ang2pixNest(nside, theta, phi)
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThan(12 * nside * nside)
        expect(Number.isInteger(p)).toBe(true)
      }
    }
  })
})

describe('pix2angNest / ang2pixNest round trip', () => {
  it('recovers every pixel from its own centre', () => {
    for (const nside of [1, 2, 4, 8, 16]) {
      const npix = 12 * nside * nside
      for (let p = 0; p < npix; p++) {
        const [theta, phi] = pix2angNest(nside, p)
        expect(ang2pixNest(nside, theta, phi)).toBe(p)
      }
    }
  })
})

describe('NEST hierarchy', () => {
  // The angular downsampling averages sibling pixels 4p..4p+3 at nside=2n into pixel p at
  // nside=n. That is only valid if NEST nesting works exactly that way — assert it directly.
  it('pixel p at nside n contains pixels 4p..4p+3 at nside 2n', () => {
    for (const nside of [1, 2, 4, 8]) {
      const npixFine = 12 * (2 * nside) * (2 * nside)
      for (let child = 0; child < npixFine; child++) {
        const [theta, phi] = pix2angNest(2 * nside, child)
        expect(ang2pixNest(nside, theta, phi)).toBe(Math.floor(child / 4))
      }
    }
  })
})

describe('dust grid encode/decode', () => {
  const grid: DustGrid = {
    nside: 2,
    nodes: new Float32Array([0, 500, 1000]),
    cum: new Float32Array(3 * 12 * 4).map((_, i) => i * 0.001),
  }
  it('round-trips through the binary format', () => {
    const back = decodeDustGrid(encodeDustGrid(grid))
    expect(back.nside).toBe(grid.nside)
    expect(Array.from(back.nodes)).toEqual(Array.from(grid.nodes))
    expect(Array.from(back.cum)).toEqual(Array.from(grid.cum))
  })
  it('rejects a buffer with the wrong magic', () => {
    const bad = new ArrayBuffer(64)
    expect(() => decodeDustGrid(bad)).toThrow(/magic/)
  })
})

describe('cumulativeE', () => {
  // One pixel per base face at nside=1; face 4 (l=0, b=0) gets a ramp, the rest stay at zero.
  const nodes = new Float32Array([0, 500, 1000])
  const cum = new Float32Array(3 * 12)
  cum[12 * 1 + 4] = 1.0 // node 1 (500 pc), face 4
  cum[12 * 2 + 4] = 1.5 // node 2 (1000 pc), face 4
  const grid: DustGrid = { nside: 1, nodes, cum }

  it('is zero at zero distance', () => {
    expect(cumulativeE(grid, 0, 0, 0)).toBe(0)
  })
  it('interpolates linearly between distance nodes', () => {
    expect(cumulativeE(grid, 0, 0, 250)).toBeCloseTo(0.5, 6)
    expect(cumulativeE(grid, 0, 0, 500)).toBeCloseTo(1.0, 6)
    expect(cumulativeE(grid, 0, 0, 750)).toBeCloseTo(1.25, 6)
  })
  it('clamps beyond the last node instead of extrapolating', () => {
    expect(cumulativeE(grid, 0, 0, 5000)).toBeCloseTo(1.5, 6)
  })
  it('is monotonically non-decreasing in distance', () => {
    let prev = -1
    for (let s = 0; s <= 1200; s += 25) {
      const v = cumulativeE(grid, 0, 0, s)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
  // The star catalog reddens a star by composing eqjToGalactic -> cumulativeE on its RA/Dec.
  // A one-hot grid makes that composition falsifiable end to end: put ALL the dust in the single
  // pixel containing Orion A, and only a star pointed at Orion A may pick any of it up. This is
  // the unit-level counterpart of the build's reddening-direction gate, and it catches a swapped
  // l/b, a sign flip, or a degrees/radians slip that a smooth real map could hide.
  it('reddens a star at Orion A from a one-hot pixel, and nothing 20 degrees away', () => {
    const nside = 32
    const npix = 12 * nside * nside
    const nodes = new Float32Array([0, 500, 1000])
    const cum = new Float32Array(3 * npix)
    // Orion A / M42 sits at RA 83.8, Dec -5.4 (galactic l = 209.0, b = -19.4)
    const [lOri, bOri] = eqjToGalactic(83.8, -5.4)
    const oriPix = ang2pixNest(nside, Math.PI / 2 - bOri, lOri)
    cum[1 * npix + oriPix] = 0.8
    cum[2 * npix + oriPix] = 1.2
    const oneHot: DustGrid = { nside, nodes, cum }

    expect(cumulativeE(oneHot, lOri, bOri, 1000)).toBeCloseTo(1.2, 6)
    expect(cumulativeE(oneHot, lOri, bOri, 500)).toBeCloseTo(0.8, 6)

    const [lOff, bOff] = eqjToGalactic(83.8, 14.6) // same RA, 20 deg north
    expect(cumulativeE(oneHot, lOff, bOff, 1000)).toBe(0)
  })

  it('reads the pixel the (l, b) direction actually falls in', () => {
    // (l=0, b=0) is the centre of base face 4; (l=90, b=0) is face 5, which is empty.
    expect(cumulativeE(grid, 0, 0, 1000)).toBeCloseTo(1.5, 6)
    expect(cumulativeE(grid, 90 * DEG, 0, 1000)).toBe(0)
    expect(cumulativeE(grid, 0, 60 * DEG, 1000)).toBe(0)
  })
})
