import { describe, it, expect } from 'vitest'
import { raDecDistToXyz, absoluteMagnitude, apparentMagnitude, eqjToGalactic, polyfit, polyval } from './starMath'

describe('polyval', () => {
  it('evaluates ascending-order coefficients', () => {
    expect(polyval([1, 2, 3], 2)).toBe(1 + 4 + 12) // 1 + 2x + 3x²
    expect(polyval([5], 99)).toBe(5)
  })
})

describe('polyfit', () => {
  it('recovers a line exactly from noiseless points', () => {
    const xs = [0, 1, 2, 3, 4], ys = xs.map(x => 0.7045 * x + 0.0709)
    const c = polyfit(xs, ys, 1)
    expect(c[0]).toBeCloseTo(0.0709, 6)
    expect(c[1]).toBeCloseTo(0.7045, 6)
  })
  it('recovers a cubic exactly from noiseless points', () => {
    const truth = [-0.05, 1.04, -0.18, 0.011]
    const xs = [-0.5, 0, 0.4, 0.9, 1.5, 2.1, 2.8, 3.4]
    const c = polyfit(xs, xs.map(x => polyval(truth, x)), 3)
    for (let i = 0; i < truth.length; i++) expect(c[i]).toBeCloseTo(truth[i], 5)
  })
  it('averages through symmetric noise rather than interpolating it', () => {
    const xs: number[] = [], ys: number[] = []
    for (let i = 0; i < 100; i++) { xs.push(i / 10); ys.push(2 * (i / 10) + 1 + (i % 2 ? 0.5 : -0.5)) }
    const c = polyfit(xs, ys, 1)
    expect(c[0]).toBeCloseTo(1, 1)
    expect(c[1]).toBeCloseTo(2, 2)
  })
  it('rejects degenerate input', () => {
    expect(() => polyfit([1, 2], [1], 1)).toThrow(/mismatch/)
    expect(() => polyfit([1, 2], [1, 2], 3)).toThrow(/not enough points/)
  })
})

describe('eqjToGalactic', () => {
  const DEG = Math.PI / 180
  it('maps Sgr A* to its known small offset from the galactic origin', () => {
    // Sgr A* sits at l = 359.944, b = -0.046 — the IAU frame origin is defined by the 1958
    // radio-frame convention, not by the black hole, so a ~0.05 deg offset is the right answer.
    const [l, b] = eqjToGalactic(266.41683, -29.00781)
    expect(l / DEG).toBeCloseTo(-0.056, 2)
    expect(b / DEG).toBeCloseTo(-0.046, 2)
  })
  it('maps the north galactic pole to b=+90', () => {
    const [, b] = eqjToGalactic(192.85948, 27.12825)
    expect(b / DEG).toBeCloseTo(90, 2)
  })
  it('maps the south galactic pole to b=-90', () => {
    const [, b] = eqjToGalactic(12.85948, -27.12825)
    expect(b / DEG).toBeCloseTo(-90, 2)
  })
  it('puts the galactic anticentre at l=180, b=0', () => {
    const [l, b] = eqjToGalactic(86.41683, 28.93617)
    expect(Math.abs(l / DEG)).toBeCloseTo(180, 0)
    expect(b / DEG).toBeCloseTo(0, 0)
  })
  it('returns l in [-pi, pi] and b in [-pi/2, pi/2]', () => {
    for (let i = 0; i < 200; i++) {
      const [l, b] = eqjToGalactic((i * 37) % 360, ((i * 53) % 180) - 90)
      expect(l).toBeGreaterThanOrEqual(-Math.PI)
      expect(l).toBeLessThanOrEqual(Math.PI)
      expect(Math.abs(b)).toBeLessThanOrEqual(Math.PI / 2 + 1e-12)
    }
  })
})

describe('raDecDistToXyz', () => {
  // Sirius: RA 6.7525 h, Dec −16.7161°, dist 2.637 pc (HYG values)
  it('places Sirius correctly in EQJ parsecs', () => {
    const [x, y, z] = raDecDistToXyz(6.7525, -16.7161, 2.637)
    expect(Math.hypot(x, y, z)).toBeCloseTo(2.637, 3)
    expect(x).toBeCloseTo(-0.494, 2)
    expect(y).toBeCloseTo(2.477, 2)
    expect(z).toBeCloseTo(-0.758, 2)
  })

  // Polaris: RA 2.5303 h, Dec +89.2641° → almost exactly +Z
  it('places Polaris near the north celestial pole', () => {
    const [x, y, z] = raDecDistToXyz(2.5303, 89.2641, 132.6)
    expect(z / Math.hypot(x, y, z)).toBeGreaterThan(0.999)
  })
})

describe('apparentMagnitude', () => {
  // Sirius: absMag 1.454, dist 2.637 pc → apparent mag ≈ −1.44 (precise inverse of absoluteMagnitude)
  it('computes apparent magnitude for Sirius', () => {
    expect(apparentMagnitude(1.454, 2.637)).toBeCloseTo(-1.44, 2)
  })

  it('round-trips with absoluteMagnitude', () => {
    const absMag = 1.454
    const distPc = 2.637
    const appMag = apparentMagnitude(absMag, distPc)
    expect(absoluteMagnitude(appMag, distPc)).toBeCloseTo(absMag, 6)
  })
})
