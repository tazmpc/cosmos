import type { PlanetDef } from '../data/planets'
import type { StarCatalog } from '../data/catalogFormat'
import type { GalaxyDef } from '../data/galaxies'
import type { DeepSkyDef } from '../data/deepSky'
import type { OpenNgcObject } from '../data/openNgc'
import type { FamousAsteroid } from '../data/asteroids'
import type { SpacecraftDef } from '../scene/spacecraft'
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

/** OpenNGC objects have no hand-written facts and (almost always) no measured distance — the
 * card is built entirely from the catalog row instead of a static facts blob. distEstimated is
 * always true for this dataset (see src/data/openNgc.ts), so Distance is always caveated. */
export function showOpenNgcCard(obj: OpenNgcObject): void {
  const facts: Record<string, string> = { Type: obj.type }
  if (obj.majAxArcmin != null) facts['Apparent size'] = `${obj.majAxArcmin.toFixed(2)}′`
  if (obj.vmag != null) facts['V magnitude'] = obj.vmag.toFixed(2)
  facts.Distance = obj.distEstimated
    ? `~${formatDistance(obj.distPc * PC_TO_AU)} (estimated by type)`
    : formatDistance(obj.distPc * PC_TO_AU)
  if (obj.messier != null) facts.Messier = `M${obj.messier}`
  render(obj.name, facts)
}

/** Named minor planets. `facts` is hand-written (src/data/asteroids.ts); the orbital numbers are
 *  read live from the MPCORB elements in asteroids.bin so the card can't drift from what the
 *  renderer is actually propagating. */
export function showAsteroidCard(def: FamousAsteroid, orbit: { aAu: number; e: number; iDeg: number; periodYears: number }): void {
  render(def.name, {
    ...def.facts,
    'Orbital period': `${orbit.periodYears.toFixed(2)} years`,
    'Distance from Sun': `${orbit.aAu.toFixed(3)} AU (semi-major axis)`,
    'Orbit shape': `eccentricity ${orbit.e.toFixed(3)}, inclination ${orbit.iDeg.toFixed(1)}°`,
    Orbit: 'propagated from MPC orbital elements (two-body)',
  })
}

/** Named spacecraft (src/data comes from public/spacecraft.json — see scripts/build-spacecraft.ts).
 *  `facts` is baked from Horizons-independent hand-written text; the two distances are LIVE,
 *  computed at card-show time from the interpolated trajectory (src/sim/trajectory.ts) and the
 *  current Earth position, so they stay correct as sim time advances rather than being baked. */
export function showSpacecraftCard(def: SpacecraftDef, distSunAu: number, distEarthAu: number): void {
  render(def.name, {
    ...def.facts,
    'Distance from Sun': formatDistance(distSunAu),
    'Distance from Earth': formatDistance(distEarthAu),
    Trajectory: 'interpolated from JPL Horizons position vectors',
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
