import { describe, it, expect } from 'vitest'
import { raDecDistToXyz } from './starMath'

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
