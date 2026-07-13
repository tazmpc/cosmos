import { describe, it, expect } from 'vitest'
import { SimClock } from './clock'

const T0 = new Date('2026-07-13T00:00:00Z')

describe('SimClock', () => {
  it('advances at 1x by default', () => {
    const c = new SimClock(T0)
    c.tick(1000); c.tick(3500)
    expect(c.now().getTime()).toBe(T0.getTime() + 2500)
  })

  it('honors rate multiplier', () => {
    const c = new SimClock(T0)
    c.tick(0); c.setRate(86400) // 1 day per second
    c.tick(2000)
    expect(c.now().getTime()).toBe(T0.getTime() + 2 * 86400 * 1000)
  })

  it('pauses and resumes without jumping', () => {
    const c = new SimClock(T0)
    c.tick(0); c.setPaused(true); c.tick(5000)
    expect(c.now().getTime()).toBe(T0.getTime())
    c.setPaused(false); c.tick(6000)
    expect(c.now().getTime()).toBe(T0.getTime() + 1000)
  })

  it('setDate jumps the sim time', () => {
    const c = new SimClock(T0)
    const target = new Date('2030-01-01T00:00:00Z')
    c.setDate(target)
    expect(c.now().getTime()).toBe(target.getTime())
  })
})
