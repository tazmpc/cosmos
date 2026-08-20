/** JavaScript's maximum representable Date, in ms either side of the Unix epoch: ±8.64e15 ms,
 *  i.e. April 271821 BC to September 275760 AD. One millisecond outside it, `new Date(ms)` is an
 *  Invalid Date and every `.toISOString()` downstream throws RangeError. At the ladder's top rate
 *  (10,000 yr/s) the clock covers that whole span in 27 seconds of wall time, so this is not a
 *  theoretical edge — it is roughly half a minute away whenever the top rate is selected. */
const MAX_REPRESENTABLE_MS = 8.64e15

const clampMs = (ms: number): number =>
  Math.max(-MAX_REPRESENTABLE_MS, Math.min(MAX_REPRESENTABLE_MS, ms))

export class SimClock {
  private simMs: number
  private rate = 1
  private paused = false
  private lastRealMs: number | null = null

  constructor(start: Date) { this.simMs = clampMs(start.getTime()) }

  /** Call once per frame with a real-time ms timestamp (e.g. performance.now()). */
  tick(realMs: number): void {
    if (this.lastRealMs !== null && !this.paused) {
      this.simMs = clampMs(this.simMs + (realMs - this.lastRealMs) * this.rate)
    }
    this.lastRealMs = realMs
  }

  now(): Date { return new Date(this.simMs) }
  getRate(): number { return this.rate }
  setRate(rate: number): void { this.rate = rate }
  isPaused(): boolean { return this.paused }
  setPaused(p: boolean): void { this.paused = p }
  setDate(d: Date): void { this.simMs = clampMs(d.getTime()) }
}
