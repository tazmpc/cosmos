import * as THREE from 'three'
import { createEngine } from './engine/renderer'
import { FocusOrbitControls, type Focusable } from './engine/cameraControls'
import { createSolarSystem, updatePositions, repositionMeshes, type PlanetNode } from './scene/solarSystem'
import { SimClock } from './sim/clock'
import { formatDistance } from './ui/format'
import { loadStarField, loadPointLayer, type StarField, type PointLayer } from './scene/starField'
import { loadGalaxyField, type GalaxyField } from './scene/galaxyField'
import { createGalaxySprites } from './scene/galaxySprites'
import { layerAlphas } from './scene/layerAlphas'
import { showBanner, hideBanner } from './ui/banner'
import { apparentMagnitude } from './data/starMath'
import { createOrbitLines, updateOrbitLines } from './scene/orbits'
import { search, type SearchEntry } from './ui/search'
import { FlyToAnimator } from './engine/flyTo'
import { starFocusable } from './scene/starFocus'
import { galaxyFocusable, GALAXY_ARRIVE_AU } from './scene/galaxyFocus'
import { GALAXIES } from './data/galaxies'
import { setupTimeControls } from './ui/timeControls'
import { showPlanetCard, showStarCard, showGalaxyCard } from './ui/infoCard'
import { PC_TO_AU } from './data/units'

const engine = createEngine(document.getElementById('app')!)
const clock = new SimClock(new Date())
setupTimeControls(clock)
const { nodes: planets, sunLight } = createSolarSystem(engine.scene)
const orbits = createOrbitLines(engine.scene, clock.now())

let stars: StarField | null = null
showBanner('Loading star catalog…')
loadStarField(engine.scene)
  .then(s => {
    stars = s
    hideBanner()
    const searchEntries: SearchEntry[] = [
      ...planets.map(p => ({
        name: p.def.name, kind: 'planet' as const, key: p.def.id, mag: -30,
        label: p.def.id === 'sun' ? 'star' : p.def.parent != null ? 'moon' : undefined,
      })),
      // mag is a constant tie so equal-rank galaxy matches fall back to alphabetical (stable sort)
      ...[...GALAXIES].sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({ name: g.name, kind: 'galaxy' as const, key: g.id, mag: -26 })),
      ...Object.entries(s.names).map(([name, idx]) => ({
        name, kind: 'star' as const, key: idx,
        // apparent magnitude (distance in pc): ties rank by how bright the star actually looks
        mag: apparentMagnitude(s.catalog.absMag[idx], Math.hypot(
          s.catalog.positions[idx * 3],
          s.catalog.positions[idx * 3 + 1],
          s.catalog.positions[idx * 3 + 2])),
      })),
    ]
    setupSearch(searchEntries)
  })
  .catch(() => showBanner('Star catalog failed to load — solar system only.'))

let galaxies: GalaxyField | null = null
loadGalaxyField(engine.scene)
  .then(g => { galaxies = g })
  .catch(() => showBanner('Galaxy catalog failed to load.'))

// Curated galaxies (M31/Andromeda, M33, …) rendered as landmark glow sprites on top of the bulk
// galaxies.bin point cloud — that catalog's redshift pipeline correctly omits the (blueshifted)
// Local Group, so without this, flying to Andromeda arrives at visually empty space.
const galaxySprites = createGalaxySprites(engine.scene)

// Milky Way bridge layer — real Gaia sky-plane density, modeled depth. Optional garnish: no
// loading banner and no error banner on failure, just a console warning.
//
// Rendered as unresolved surface-brightness GLOW, not as individually-real stars: the layer
// must stay visible across 3 orders of magnitude of camera distance (inside the disk out to
// ~181 kpc and beyond), and per-point apparent magnitude can't carry that — a synthetic
// absMag-5 point at 181 kpc has appMag ≈ 26, alpha ≈ 0 at any sane faintMag. So faintMag 30
// effectively disables the per-point magnitude fade (every point renders) and alphaCap 0.05
// keeps each point subtle enough that 2M additively-blended points read as a soft glow whose
// brightness IS the density map (the real Gaia sky data). layerAlphas still gates the whole
// layer in/out by camera distance.
let milkyWay: PointLayer | null = null
loadPointLayer(engine.scene, import.meta.env.BASE_URL + 'milkyway.bin', {
  unitToAu: PC_TO_AU, unitToPc: 1, scale: 3, faintMag: 30, alphaCap: 0.05, minSize: 0.75, maxSize: 2,
})
  .then(m => { milkyWay = m })
  .catch((err) => console.warn('Milky Way layer failed to load:', err))

export function planetFocusable(n: PlanetNode): Focusable {
  return {
    name: n.def.name,
    getPosition: (out) => out.copy(n.truePos),
    minApproachAu: n.def.radiusAu * 1.4,
  }
}

const earth = planets.find(p => p.def.id === 'earth')!
const controls = new FocusOrbitControls(
  engine.renderer.domElement, planetFocusable(earth), earth.def.radiusAu * 40)

const hudName = document.querySelector('#hud .focus-name')!
const hudDist = document.querySelector('#hud .focus-dist')!
const camTruePos = new THREE.Vector3()

const flyer = new FlyToAnimator(controls)

function focusEntry(e: SearchEntry): void {
  if (e.kind === 'planet') {
    const node = planets.find(p => p.def.id === e.key)!
    flyer.start(planetFocusable(node), node.def.radiusAu * 8)
    showPlanetCard(node.def)
  } else if (e.kind === 'galaxy') {
    const def = GALAXIES.find(g => g.id === e.key)!
    flyer.start(galaxyFocusable(def), GALAXY_ARRIVE_AU)
    showGalaxyCard(def)
  } else if (stars) {
    flyer.start(starFocusable(stars.catalog, e.key as number, e.name), 2000)
    showStarCard(stars.catalog, e.key as number, e.name)
  }
  ;(document.getElementById('search') as HTMLInputElement).value = ''
  renderResults([])
}

const searchInput = document.getElementById('search') as HTMLInputElement
const resultsEl = document.getElementById('search-results')!
let currentResults: SearchEntry[] = []
let selIdx = 0

function renderResults(rs: SearchEntry[]): void {
  currentResults = rs; selIdx = 0
  resultsEl.innerHTML = ''
  rs.forEach((e, i) => {
    const li = document.createElement('li')
    li.textContent = `${e.name}  ·  ${e.label ?? e.kind}`
    li.className = i === selIdx ? 'sel' : ''
    li.onclick = () => focusEntry(e)
    resultsEl.appendChild(li)
  })
}

function setupSearch(entries: SearchEntry[]): void {
  searchInput.addEventListener('input', () => renderResults(search(entries, searchInput.value)))
  searchInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { selIdx = Math.min(selIdx + 1, currentResults.length - 1) }
    else if (ev.key === 'ArrowUp') { selIdx = Math.max(selIdx - 1, 0) }
    else if (ev.key === 'Enter' && currentResults[selIdx]) { focusEntry(currentResults[selIdx]); return }
    else if (ev.key === 'Escape') { renderResults([]); searchInput.blur(); return }
    else return
    ev.preventDefault()
    Array.from(resultsEl.children).forEach((c, i) => (c as HTMLElement).className = i === selIdx ? 'sel' : '')
  })
}

// click-to-focus: planets via raycast; named stars via screen-space proximity
const raycaster = new THREE.Raycaster()
// camera drags synthesize a click on release — suppress those (>5 px pointer travel)
let downX = 0
let downY = 0
engine.renderer.domElement.addEventListener('pointerdown', (ev) => {
  downX = ev.clientX; downY = ev.clientY
})
engine.renderer.domElement.addEventListener('click', (ev) => {
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) return
  if (flyer.isActive()) return
  const ndc = new THREE.Vector2(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, engine.camera)
  const hit = raycaster.intersectObjects(planets.map(p => p.mesh))[0]
  if (hit) {
    const node = planets.find(p => p.mesh === hit.object)!
    if (node.def.name !== controls.focus.name) {
      flyer.start(planetFocusable(node), node.def.radiusAu * 8)
      showPlanetCard(node.def)
    }
    return
  }
  if (!stars) return
  // project named stars, pick nearest within 14 px
  let best: { name: string; idx: number; d2: number } | null = null
  const v = new THREE.Vector3()
  for (const [name, idx] of Object.entries(stars.names)) {
    v.set(
      stars.catalog.positions[idx * 3] * PC_TO_AU - camTruePos.x,
      stars.catalog.positions[idx * 3 + 1] * PC_TO_AU - camTruePos.y,
      stars.catalog.positions[idx * 3 + 2] * PC_TO_AU - camTruePos.z,
    ).project(engine.camera)
    if (v.z > 1) continue // behind camera
    const dx = (v.x - ndc.x) * window.innerWidth / 2
    const dy = (v.y - ndc.y) * window.innerHeight / 2
    const d2 = dx * dx + dy * dy
    if (d2 < 14 * 14 && (!best || d2 < best.d2)) best = { name, idx, d2 }
  }
  if (best) {
    flyer.start(starFocusable(stars.catalog, best.idx, best.name), 2000)
    showStarCard(stars.catalog, best.idx, best.name)
  }
})

let lastMs = 0

function frame(realMs: number) {
  const dt = lastMs ? (realMs - lastMs) / 1000 : 0
  lastMs = realMs
  flyer.update(dt)

  clock.tick(realMs)
  updatePositions(planets, clock.now())
  controls.getCameraTruePos(camTruePos)
  const la = layerAlphas(camTruePos.length())
  stars?.update(camTruePos, la.stars)
  milkyWay?.update(camTruePos, la.milkyWay)
  galaxies?.update(camTruePos, la.galaxies)
  galaxySprites.update(camTruePos, la.galaxies)
  repositionMeshes(planets, sunLight, camTruePos)
  updateOrbitLines(orbits, camTruePos)
  controls.applyToCamera(engine.camera)

  hudName.textContent = controls.focus.name
  hudDist.textContent = formatDistance(controls.distance)

  engine.renderer.render(engine.scene, engine.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
