import type { SimClock } from '../sim/clock'

export interface RateStep { rate: number; label: string }

/** The app's time-rate ladder. Exported because it is also the set a deep link's `rate=` is
 *  snapped to (see src/ui/urlState.ts) — the URL can only ever name a rate this UI can display. */
export const RATE_STEPS: RateStep[] = [
  { rate: 1, label: 'real time' },
  { rate: 60, label: '1 min/s' },
  { rate: 3600, label: '1 hr/s' },
  { rate: 86400, label: '1 day/s' },
  { rate: 86400 * 7, label: '1 wk/s' },
  { rate: 86400 * 30, label: '1 mo/s' },
  { rate: 86400 * 365.25, label: '1 yr/s' },
]

/** Just the rate values, in ladder order. */
export const RATES: number[] = RATE_STEPS.map((s) => s.rate)

const STEPS = RATE_STEPS

/** The handle setupTimeControls returns, for callers that need to move the ladder from outside
 *  the widget — today that is only the deep-link apply path in main.ts. */
export interface TimeControlsHandle {
  /** Jump the ladder to `rate` (must be one of RATES; anything else is ignored), applying it to
   *  the clock and updating the label so the two can never disagree. */
  setRate(rate: number): void
}

/** `initialRate` (a deep link's restored rate — already snapped to a real step by
 *  decodeViewState) starts the ladder at that step so the label matches the clock. */
export function setupTimeControls(clock: SimClock, initialRate?: number): TimeControlsHandle {
  let stepIdx = initialRate === undefined ? 0 : Math.max(0, STEPS.findIndex((s) => s.rate === initialRate))
  const pauseBtn = document.getElementById('time-pause')!
  const rateEl = document.getElementById('time-rate')!
  const dateEl = document.getElementById('sim-date')!

  const apply = () => {
    clock.setRate(STEPS[stepIdx].rate)
    rateEl.textContent = STEPS[stepIdx].label
  }
  document.getElementById('time-faster')!.onclick = () => { stepIdx = Math.min(stepIdx + 1, STEPS.length - 1); apply() }
  document.getElementById('time-slower')!.onclick = () => { stepIdx = Math.max(stepIdx - 1, 0); apply() }
  pauseBtn.onclick = () => {
    clock.setPaused(!clock.isPaused())
    pauseBtn.textContent = clock.isPaused() ? '▶' : '⏸'
  }
  document.getElementById('time-now')!.onclick = () => { clock.setDate(new Date()); stepIdx = 0; apply() }

  setInterval(() => {
    dateEl.textContent = clock.now().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  }, 100)
  apply()

  return {
    setRate(rate: number): void {
      const i = STEPS.findIndex((s) => s.rate === rate)
      if (i < 0) return // not a step this ladder can show — leave the UI truthful
      stepIdx = i
      apply()
    },
  }
}
