import { describe, it, expect } from 'vitest'
import { formatDistance } from './format'
import { AU_PER_LY } from '../data/units'

describe('formatDistance', () => {
  it('uses km below 0.01 AU', () => expect(formatDistance(0.001)).toBe('149,598 km'))
  it('uses AU in the solar system range', () => expect(formatDistance(5.2)).toBe('5.20 AU'))
  it('uses light-years beyond 63,241 AU', () => expect(formatDistance(AU_PER_LY * 2.64)).toBe('2.64 ly'))
  it('uses megalight-years beyond 1e6 ly', () => expect(formatDistance(AU_PER_LY * 2_500_000)).toBe('2.50 Mly'))
})
