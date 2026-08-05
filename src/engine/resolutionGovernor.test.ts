import { describe, it, expect } from 'vitest'
import { ResolutionGovernor } from './resolutionGovernor'

describe('ResolutionGovernor', () => {
  it('steps down only on the 60th consecutive slow frame', () => {
    const gov = new ResolutionGovernor() // default initialRatio 1.5 (cap)
    let result: number | null = null
    for (let i = 0; i < 59; i++) {
      result = gov.update(100) // dt=100ms holds EMA pinned at exactly 100 (>22 slow threshold)
      expect(result).toBeNull()
    }
    result = gov.update(100) // 60th consecutive slow frame
    expect(result).toBe(1.25)
    expect(gov.ratio).toBe(1.25)
  })

  it('a single non-slow frame mid-streak resets the consecutive-slow counter', () => {
    const gov = new ResolutionGovernor()
    // 40 slow frames at dt=22.5 (just above the 22ms threshold) — first call pins EMA exactly
    // at 22.5 (no null-start convergence lag), well short of the 60-frame trigger.
    for (let i = 0; i < 40; i++) {
      expect(gov.update(22.5)).toBeNull()
    }
    // One frame with dt=0 pulls EMA from 22.5 down to 22.5 + 0.05*(0-22.5) = 21.375, which is
    // <= 22 — this frame does NOT count as slow, so it must reset the streak to 0.
    expect(gov.update(0)).toBeNull()

    // If the 40-frame progress had survived the reset, feeding 60 more slow-ish frames would
    // clearly overshoot the 60-frame requirement (40+60=100) and trigger well before the 60th.
    // Because EMA takes a few frames to climb back above 22 after the dip (asymptotic recovery
    // toward the 22.5 fixed point), the *effective* streak start is delayed — so a plain 60-frame
    // refill must NOT be enough on its own if the reset genuinely happened.
    let stepped = false
    for (let i = 0; i < 60; i++) {
      if (gov.update(22.5) !== null) { stepped = true; break }
    }
    expect(stepped).toBe(false)

    // But it does eventually re-trigger once EMA has recovered above threshold and run a fresh
    // full 60-frame streak — well within a generous extra window.
    for (let i = 0; i < 40; i++) {
      const r = gov.update(22.5)
      if (r !== null) { stepped = true; break }
    }
    expect(stepped).toBe(true)
    expect(gov.ratio).toBe(1.25)
  })

  it('steps up only on the 300th consecutive fast frame', () => {
    const gov = new ResolutionGovernor({ initialRatio: 1.0 })
    let result: number | null = null
    for (let i = 0; i < 299; i++) {
      result = gov.update(5) // dt=5ms holds EMA pinned at exactly 5 (<12 fast threshold)
      expect(result).toBeNull()
    }
    result = gov.update(5) // 300th consecutive fast frame
    expect(result).toBe(1.25)
    expect(gov.ratio).toBe(1.25)
  })

  it('never steps below the floor (1.0)', () => {
    const gov = new ResolutionGovernor({ initialRatio: 1.0 })
    for (let i = 0; i < 200; i++) {
      expect(gov.update(100)).toBeNull() // stays null forever — already at floor
    }
    expect(gov.ratio).toBe(1.0)
  })

  it('never steps above the cap (1.5)', () => {
    const gov = new ResolutionGovernor({ initialRatio: 1.5 })
    for (let i = 0; i < 500; i++) {
      expect(gov.update(5)).toBeNull() // stays null forever — already at cap
    }
    expect(gov.ratio).toBe(1.5)
  })

  it('smooths a single spike without triggering a step', () => {
    const gov = new ResolutionGovernor()
    // steady fast frames first (EMA pinned at 8, well below the 22ms slow threshold)
    for (let i = 0; i < 10; i++) {
      expect(gov.update(8)).toBeNull()
    }
    // one big hitch (e.g. an asset load stall) — EMA moves to 8 + 0.05*(500-8) = 32.6, not 500
    expect(gov.update(500)).toBeNull()
    // recovery: steady frames pull EMA back down well before any 60-frame slow streak could
    // accumulate (EMA re-crosses back under 22 within ~11 frames given alpha=0.05)
    for (let i = 0; i < 20; i++) {
      expect(gov.update(8)).toBeNull()
    }
    expect(gov.ratio).toBe(1.5) // unchanged — the spike never came close to firing a step
  })

  it('rejects an initialRatio that is not one of the valid steps', () => {
    expect(() => new ResolutionGovernor({ initialRatio: 1.3 })).toThrow()
  })
})
