import type { SimClock } from '../sim/clock'

interface RateStep { rate: number; label: string }

const STEPS: RateStep[] = [
  { rate: 1, label: 'real time' },
  { rate: 60, label: '1 min/s' },
  { rate: 3600, label: '1 hr/s' },
  { rate: 86400, label: '1 day/s' },
  { rate: 86400 * 7, label: '1 wk/s' },
  { rate: 86400 * 30, label: '1 mo/s' },
  { rate: 86400 * 365.25, label: '1 yr/s' },
]

export function setupTimeControls(clock: SimClock): void {
  let stepIdx = 0
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
}
