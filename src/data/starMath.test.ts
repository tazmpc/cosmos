import { describe, it, expect } from 'vitest'
import { raDecDistToXyz, absoluteMagnitude, apparentMagnitude } from './starMath'

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
