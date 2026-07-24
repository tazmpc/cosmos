import type { PlanetDef } from '../data/planets'
import type { StarCatalog } from '../data/catalogFormat'
import type { GalaxyDef } from '../data/galaxies'
import type { DeepSkyDef } from '../data/deepSky'
import { apparentMagnitude } from '../data/starMath'
import { PC_TO_LY, PC_TO_AU } from '../data/units'
import { formatDistance } from './format'

export function showPlanetCard(def: PlanetDef): void {
  render(def.name, def.facts)
}

export function showGalaxyCard(def: GalaxyDef): void {
  render(def.name, {
    Distance: `${(def.distMpc * PC_TO_LY).toFixed(1)} Mly`,
    Type: def.type,
    ...def.facts,
  })
}

export function showDeepSkyCard(def: DeepSkyDef): void {
  render(def.name, {
    Distance: formatDistance(def.distPc * PC_TO_AU),
    Diameter: `${def.diameterLy.toLocaleString('en-US')} ly`,
    Type: def.type,
    ...def.facts,
  })
}

export function showStarCard(catalog: StarCatalog, index: number, name: string): void {
  const x = catalog.positions[index * 3], y = catalog.positions[index * 3 + 1], z = catalog.positions[index * 3 + 2]
  const distPc = Math.hypot(x, y, z)
  const absMag = catalog.absMag[index]
  const appMag = apparentMagnitude(absMag, distPc)
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
