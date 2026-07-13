export function showBanner(msg: string): void {
  const el = document.getElementById('banner')!
  el.textContent = msg
  el.style.display = 'block'
  el.onclick = () => { el.style.display = 'none' }
}
