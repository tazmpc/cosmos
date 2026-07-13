import type { PlanetDef } from '../data/planets'
import type { StarCatalog } from '../data/catalogFormat'

const PC_TO_LY = 3.26156

export function showPlanetCard(def: PlanetDef): void {
  render(def.name, def.facts)
}

export function showStarCard(catalog: StarCatalog, index: number, name: string): void {
  const x = catalog.positions[index * 3], y = catalog.positions[index * 3 + 1], z = catalog.positions[index * 3 + 2]
  const distPc = Math.hypot(x, y, z)
  const absMag = catalog.absMag[index]
  const appMag = absMag + 5 * (Math.log10(distPc) - 1)
  const ci = catalog.colorIndex[index]
  render(name, {
    'Distance from Sun': `${(distPc * PC_TO_LY).toFixed(1)} ly`,
    'Apparent magnitude': appMag.toFixed(2),
    'Absolute magnitude': absMag.toFixed(2),
    Color: colorClass(ci),
  })
}

function colorClass(ci: number): string {
  if (ci < 0.0) return 'blue'
  if (ci < 0.3) return 'blue-white'
  if (ci < 0.6) return 'white'
  if (ci < 1.0) return 'yellow-white'
  if (ci < 1.5) return 'orange'
  return 'red'
}

export function hideCard(): void {
  document.getElementById('info-card')!.style.display = 'none'
}

function render(title: string, facts: Record<string, string>): void {
  const card = document.getElementById('info-card')!
  card.querySelector('h2')!.textContent = title
  const dl = card.querySelector('dl')!
  dl.innerHTML = ''
  for (const [k, v] of Object.entries(facts)) {
    const dt = document.createElement('dt'); dt.textContent = k
    const dd = document.createElement('dd'); dd.textContent = v
    dl.append(dt, dd)
  }
  card.style.display = 'block'
  ;(card.querySelector('.close') as HTMLElement).onclick = hideCard
}
