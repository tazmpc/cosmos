import { describe, it, expect } from 'vitest'
import { raDecDistToXyz, absoluteMagnitude, apparentMagnitude, eqjToGalactic, polyfit, polyval, tangentialVelocityPcYr } from './starMath'

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

describe('tangentialVelocityPcYr', () => {
  // Local sky unit vectors at (ra, dec) in EQJ, repeated here independently of the implementation
  // so the direction assertions below are not checking the code against itself.
  const east = (raDeg: number): [number, number, number] => {
    const a = (raDeg * Math.PI) / 180
    return [-Math.sin(a), Math.cos(a), 0]
  }
  const north = (raDeg: number, decDeg: number): [number, number, number] => {
    const a = (raDeg * Math.PI) / 180
    const d = (decDeg * Math.PI) / 180
    return [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)]
  }
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2])

  // Barnard's Star: the largest proper motion of any known star, 10.39"/yr at 1.83 pc.
  // mu_total = hypot(802.8, 10362.5) = 10393.5 mas/yr = 10.3935"/yr
  // v = 10.3935 * 4.848136811e-6 rad/yr * 1.83 pc = 9.221e-5 pc/yr
  const BARNARD = { ra: 269.45, dec: 4.66, dist: 1.83, pmra: -802.8, pmdec: 10362.5 }

  it("matches Barnard's Star's measured tangential speed", () => {
    const v = tangentialVelocityPcYr(BARNARD.ra, BARNARD.dec, BARNARD.dist, BARNARD.pmra, BARNARD.pmdec)
    expect(norm(v)).toBeCloseTo(9.221e-5, 8)
  })

  it("points Barnard's Star almost due celestial north", () => {
    const v = tangentialVelocityPcYr(BARNARD.ra, BARNARD.dec, BARNARD.dist, BARNARD.pmra, BARNARD.pmdec)
    expect(dot(v, north(BARNARD.ra, BARNARD.dec)) / norm(v)).toBeGreaterThan(0.99)
  })

  it('is purely tangential — no radial component', () => {
    const v = tangentialVelocityPcYr(BARNARD.ra, BARNARD.dec, BARNARD.dist, BARNARD.pmra, BARNARD.pmdec)
    const [x, y, z] = raDecDistToXyz(BARNARD.ra / 15, BARNARD.dec, 1)
    expect(Math.abs(dot(v, [x, y, z]))).toBeLessThan(1e-18)
  })

  it('maps a pure-east proper motion onto the east unit vector', () => {
    // 1000 mas/yr = 1"/yr of mu_alpha* at 10 pc -> 1 * 4.848136811e-6 * 10 = 4.848137e-5 pc/yr
    const v = tangentialVelocityPcYr(30, 0, 10, 1000, 0)
    const e = east(30)
    expect(norm(v)).toBeCloseTo(4.848136811e-5, 10)
    expect(dot(v, e) / norm(v)).toBeCloseTo(1, 10)
  })

  it('maps a pure-north proper motion onto the north unit vector', () => {
    const v = tangentialVelocityPcYr(200, -35, 4, 0, 500)
    const n = north(200, -35)
    expect(dot(v, n) / norm(v)).toBeCloseTo(1, 10)
    expect(norm(v)).toBeCloseTo(0.5 * 4.848136811e-6 * 4, 12)
  })

  it('treats pmra as mu_alpha* — no extra cos(dec) is applied near the pole', () => {
    // Polaris-like: at dec 89.264 a raw-mu_alpha reading would be ~77x larger than mu_alpha*.
    // The speed must depend only on the quoted numbers, not on how close to the pole the star is.
    const nearPole = tangentialVelocityPcYr(2.53 * 15, 89.264, 132.6, 44.22, -11.74)
    const onEquator = tangentialVelocityPcYr(2.53 * 15, 0, 132.6, 44.22, -11.74)
    expect(norm(nearPole)).toBeCloseTo(norm(onEquator), 12)
  })

  it('returns a zero vector for zero proper motion', () => {
    // `===` rather than toEqual: the components come out as signed zeros (-0 for a term whose
    // trig factor is negative), which is the same number but a different value to toEqual.
    const v = tangentialVelocityPcYr(123.4, -56.7, 42, 0, 0)
    expect(v.length).toBe(3)
    expect(v.every((c) => c === 0)).toBe(true)
  })

  it('scales linearly with distance', () => {
    const near = tangentialVelocityPcYr(100, 20, 5, 300, -200)
    const far = tangentialVelocityPcYr(100, 20, 50, 300, -200)
    expect(norm(far)).toBeCloseTo(10 * norm(near), 12)
  })
})
