import { describe, it, expect } from 'vitest'
import { formatDistance } from './format'

describe('formatDistance', () => {
  it('uses km below 0.01 AU', () => expect(formatDistance(0.001)).toBe('149,598 km'))
  it('uses AU in the solar system range', () => expect(formatDistance(5.2)).toBe('5.20 AU'))
  it('uses light-years beyond 63,241 AU', () => expect(formatDistance(63241.077 * 2.64)).toBe('2.64 ly'))
})
