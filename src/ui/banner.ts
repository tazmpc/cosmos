export function showBanner(msg: string): void {
  const el = document.getElementById('banner')!
  el.textContent = msg
  el.style.display = 'block'
  el.onclick = () => { el.style.display = 'none' }
}

export function hideBanner(): void {
  document.getElementById('banner')!.style.display = 'none'
}

let toastTimer: number | undefined

/**
 * Transient centred confirmation — used by the 🔗 share button ("Link copied"), and by its
 * fallback, which shows the URL itself when the clipboard is unavailable.
 *
 * Faded with opacity rather than display, for the same reason the hover label is (see
 * index.html): a display:none element can't run its transition. Re-showing while one is already
 * up restarts the timer instead of stacking, so a double-click doesn't hide it early.
 */
export function showToast(msg: string, ms = 1500): void {
  const el = document.getElementById('toast')!
  el.textContent = msg
  el.style.opacity = '1'
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { el.style.opacity = '0' }, ms)
}
