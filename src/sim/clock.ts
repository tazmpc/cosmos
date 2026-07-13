export class SimClock {
  private simMs: number
  private rate = 1
  private paused = false
  private lastRealMs: number | null = null

  constructor(start: Date) { this.simMs = start.getTime() }

  /** Call once per frame with a real-time ms timestamp (e.g. performance.now()). */
  tick(realMs: number): void {
    if (this.lastRealMs !== null && !this.paused) {
      this.simMs += (realMs - this.lastRealMs) * this.rate
    }
    this.lastRealMs = realMs
  }

  now(): Date { return new Date(this.simMs) }
  getRate(): number { return this.rate }
  setRate(rate: number): void { this.rate = rate }
  isPaused(): boolean { return this.paused }
  setPaused(p: boolean): void { this.paused = p }
  setDate(d: Date): void { this.simMs = d.getTime() }
}
