// Dynamic resolution governor: watches an EMA of frame time and steps the render pixel
// ratio down under sustained load, then cautiously back up once things are comfortably fast
// again. Pure logic only — no THREE/DOM dependency — so it can be unit-tested in isolation and
// wired into main.ts's frame loop by whoever owns renderer/composer.setPixelRatio calls.

const STEPS = [1.0, 1.25, 1.5] // ascending: index 0 = floor, last = cap

export interface ResolutionGovernorOptions {
  /** Ratio to start at. Must be one of STEPS. Default 1.5 (cap). */
  initialRatio?: number
  /** EMA smoothing factor, 0-1. Default 0.05. */
  alpha?: number
  /** EMA threshold (ms) above which a frame counts toward a step-down. Default 22. */
  slowThresholdMs?: number
  /** EMA threshold (ms) below which a frame counts toward a step-up. Default 12. */
  fastThresholdMs?: number
  /** Consecutive slow frames required to step down. Default 60. */
  slowFrames?: number
  /** Consecutive fast frames required to step up. Default 300. */
  fastFrames?: number
}

/**
 * Feed it a frame's dt (milliseconds) via update(). It maintains an EMA of dt and returns the
 * new pixel ratio when a step fires (up or down), or null otherwise. Consecutive-frame counters
 * reset on any frame that doesn't satisfy the current streak's condition — a single fast frame
 * in the middle of a slow streak resets the slow counter to 0, and vice versa.
 */
export class ResolutionGovernor {
  private readonly alpha: number
  private readonly slowThresholdMs: number
  private readonly fastThresholdMs: number
  private readonly slowFrames: number
  private readonly fastFrames: number

  private ema: number | null = null
  private slowStreak = 0
  private fastStreak = 0
  private stepIndex: number

  constructor(options: ResolutionGovernorOptions = {}) {
    this.alpha = options.alpha ?? 0.05
    this.slowThresholdMs = options.slowThresholdMs ?? 22
    this.fastThresholdMs = options.fastThresholdMs ?? 12
    this.slowFrames = options.slowFrames ?? 60
    this.fastFrames = options.fastFrames ?? 300

    const initialRatio = options.initialRatio ?? STEPS[STEPS.length - 1]
    const idx = STEPS.indexOf(initialRatio)
    if (idx === -1) throw new Error(`initialRatio ${initialRatio} must be one of ${STEPS.join(', ')}`)
    this.stepIndex = idx
  }

  /** Current pixel ratio (last value returned by update(), or the initial ratio). */
  get ratio(): number {
    return STEPS[this.stepIndex]
  }

  /** Feed one frame's dt in milliseconds. Returns the new ratio if a step just fired, else null. */
  update(dtMs: number): number | null {
    this.ema = this.ema === null ? dtMs : this.ema + this.alpha * (dtMs - this.ema)

    if (this.ema > this.slowThresholdMs) {
      this.slowStreak++
      this.fastStreak = 0
    } else if (this.ema < this.fastThresholdMs) {
      this.fastStreak++
      this.slowStreak = 0
    } else {
      this.slowStreak = 0
      this.fastStreak = 0
    }

    if (this.slowStreak >= this.slowFrames) {
      this.slowStreak = 0
      this.fastStreak = 0
      return this.step(-1)
    }

    if (this.fastStreak >= this.fastFrames) {
      this.slowStreak = 0
      this.fastStreak = 0
      return this.step(1)
    }

    return null
  }

  private step(direction: 1 | -1): number | null {
    const next = this.stepIndex + direction
    if (next < 0 || next >= STEPS.length) return null // floor/cap already reached
    this.stepIndex = next
    return STEPS[this.stepIndex]
  }
}
