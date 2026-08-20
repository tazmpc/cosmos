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

describe('SimClock — the representable-time rail', () => {
  // At 10,000 yr/s the clock gains 3.16e14 ms of sim time per real second, so it reaches
  // JavaScript's maximum representable Date (8.64e15 ms, September 275760 AD) in 27 seconds of
  // wall time. One millisecond past that, `new Date(ms)` is an Invalid Date and every
  // `.toISOString()` in the app — the date readout, the deep-link writer — throws RangeError
  // mid-frame. The clock therefore stops at the rail instead of running off it.
  const MAX = 8.64e15

  it('never advances past the maximum representable date', () => {
    const c = new SimClock(new Date(MAX - 1000))
    c.setRate(1e12)
    c.tick(0)
    c.tick(1000)
    expect(c.now().getTime()).toBe(MAX)
    expect(() => c.now().toISOString()).not.toThrow()
  })

  it('never retreats past the minimum representable date', () => {
    const c = new SimClock(new Date(-MAX + 1000))
    c.setRate(1e12)
    c.tick(0)
    c.tick(-1000) // a backwards real-time step drives sim time backwards at this rate
    expect(c.now().getTime()).toBe(-MAX)
    expect(() => c.now().toISOString()).not.toThrow()
  })

  it('clamps a setDate beyond the rail rather than storing an unrepresentable value', () => {
    const c = new SimClock(new Date(0))
    c.setDate(new Date(MAX))
    expect(c.now().getTime()).toBe(MAX)
  })

  it('leaves an ordinary date completely alone', () => {
    const t = Date.UTC(2026, 7, 19, 12)
    const c = new SimClock(new Date(t))
    c.tick(0)
    c.tick(1000)
    expect(c.now().getTime()).toBe(t + 1000)
  })
})
