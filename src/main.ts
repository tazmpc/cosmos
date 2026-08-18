import * as THREE from 'three'
import { createEngine } from './engine/renderer'
import { ResolutionGovernor } from './engine/resolutionGovernor'
import { FocusOrbitControls, type Focusable } from './engine/cameraControls'
import { SkyViewControls } from './engine/skyViewControls'
import { createSolarSystem, updatePositions, repositionMeshes, updateEarthNight, type PlanetNode } from './scene/solarSystem'
import { SimClock } from './sim/clock'
import { formatDistance } from './ui/format'
import { loadStarField, loadPointLayer, type StarField, type PointLayer } from './scene/starField'
import { createBrightStarHalos, type BrightStarHalos } from './scene/brightStars'
import { loadGalaxyField, type GalaxyField } from './scene/galaxyField'
import { createGalaxySprites, createDeepSkySprites, createStandaloneGlowSprite } from './scene/galaxySprites'
import { createObjectImagery, galaxyImageTargets, deepSkyImageTargets, type ImageTarget } from './scene/objectImagery'
import { layerAlphas } from './scene/layerAlphas'
import { showBanner, hideBanner } from './ui/banner'
import { apparentMagnitude } from './data/starMath'
import { angularFovDegFromArcmin } from './data/angularSize'
import { createOrbitLines, updateOrbitLines } from './scene/orbits'
import { loadConstellations, type ConstellationLines } from './scene/constellations'
import { search, type SearchEntry } from './ui/search'
import { FlyToAnimator } from './engine/flyTo'
import { starFocusable } from './scene/starFocus'
import { galaxyFocusable, GALAXY_ARRIVE_AU } from './scene/galaxyFocus'
import { deepSkyFocusable, deepSkyMinApproachAu } from './scene/deepSkyFocus'
import { GALAXIES } from './data/galaxies'
import { DEEP_SKY } from './data/deepSky'
import { loadOpenNgc, openNgcFocusable, openNgcMinApproachAu, openNgcDiameterLy, type OpenNgcObject } from './data/openNgc'
import { setupTimeControls } from './ui/timeControls'
import { showPlanetCard, showStarCard, showGalaxyCard, showDeepSkyCard, showOpenNgcCard, showAsteroidCard, hideCard } from './ui/infoCard'
import {
  loadAsteroidField, asteroidFocusable, famousAsteroidEntries, asteroidOrbitSummary,
  ASTEROID_ARRIVE_AU, type AsteroidField,
} from './scene/asteroidField'
import type { FamousAsteroid } from './data/asteroids'
import { PC_TO_AU } from './data/units'

const engine = createEngine(document.getElementById('app')!)
const clock = new SimClock(new Date())
setupTimeControls(clock)
const { nodes: planets, sunLight } = createSolarSystem(engine.scene)
const orbits = createOrbitLines(engine.scene, clock.now())

let stars: StarField | null = null
let brightStars: BrightStarHalos | null = null

// OpenNGC (~12.4k deep-sky objects, public/openngc.json — see scripts/build-openngc.ts) loads in
// parallel with everything else and merges its search entries in once both it and the star field
// (which owns search setup) are ready. Silent degrade on failure, like the other lazy catalogs:
// no banner, just fewer search results.
const openNgcPromise = loadOpenNgc().catch((err) => {
  console.warn('OpenNGC catalog failed to load:', err)
  return [] as OpenNgcObject[]
})
let openNgcById = new Map<string, OpenNgcObject>()
// Glow sprites for OpenNGC objects the user has actually focused, created lazily — see
// focusOpenNgcImagery below. Position-follows-camera is handled per-frame in frame() since these
// aren't part of a managed sprite group like the curated galaxy/deep-sky ones.
const openNgcSpriteFollowers: { sprite: THREE.Sprite; truePos: THREE.Vector3 }[] = []

// Asteroid belt — ~486k MPCORB orbits propagated live (see src/scene/asteroidField.ts). This is
// the only layer deliberately gated on a rendered frame having already happened: asteroids.bin is
// 17 MB, and decoding it plus building its buffers is pure startup cost for a layer that matters
// only once the user is looking at the inner solar system. Kicked from frame() on the first
// frame, then deferred again to requestIdleCallback. Silent degrade on failure, like the other
// lazy catalogs — no banner, just no belt.
let asteroids: AsteroidField | null = null
let asteroidLoadStarted = false
let resolveAsteroids!: (f: AsteroidField | null) => void
const asteroidPromise = new Promise<AsteroidField | null>((res) => { resolveAsteroids = res })
/** id -> the famous-asteroid definition and its index in the binary; populated once loaded. */
const asteroidByKey = new Map<string, { def: FamousAsteroid; index: number }>()

function startAsteroidLoad(): void {
  if (asteroidLoadStarted) return
  asteroidLoadStarted = true
  const kick = (): void => {
    loadAsteroidField(engine.scene)
      .then((f) => {
        asteroids = f
        for (const e of famousAsteroidEntries(f)) asteroidByKey.set(e.def.id, e)
        resolveAsteroids(f)
      })
      .catch((err) => {
        console.warn('Asteroid belt failed to load:', err)
        resolveAsteroids(null)
      })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => kick())
  else setTimeout(kick, 0)
}

showBanner('Loading star catalog…')
loadStarField(engine.scene)
  .then(s => {
    stars = s
    hideBanner()
    // Glare halos (soft core + 4 diffraction spikes) on the ~200 brightest stars as seen from
    // Earth — the point shader clamps every star to the same maximum dot, so without this Sirius
    // looks exactly like any other star.
    brightStars = createBrightStarHalos(engine.scene, s.catalog)
    const searchEntries: SearchEntry[] = [
      ...planets.map(p => ({
        name: p.def.name, kind: 'planet' as const, key: p.def.id, mag: -30,
        label: p.def.id === 'sun' ? 'star' : p.def.parent != null ? 'moon' : undefined,
      })),
      // mag is a constant tie so equal-rank galaxy matches fall back to alphabetical (stable sort)
      ...[...GALAXIES].sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({ name: g.name, kind: 'galaxy' as const, key: g.id, mag: -26 })),
      ...[...DEEP_SKY].sort((a, b) => a.name.localeCompare(b.name))
        .map(d => ({ name: d.name, kind: 'dso' as const, key: d.id, mag: -26, label: 'deep sky' })),
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

    // OpenNGC entries append in once loaded (usually already resolved by the time the star
    // catalog is — it's a much smaller fetch). `searchEntries` is the same array `search()` reads
    // on every keystroke (setupSearch closed over this exact reference), so pushing into it later
    // is enough — no re-setup needed. mag defaults to 12 when V-Mag is unknown, which ranks below
    // every curated dso/galaxy (mag -26) but roughly among real stars, which is the intent: these
    // are real but mostly faint/uncatalogued-brightness objects, not landmarks.
    openNgcPromise.then((rows) => {
      openNgcById = new Map(rows.map((r) => [r.id, r]))
      const dsoEntries: SearchEntry[] = rows.map((r) => ({
        name: r.name, kind: 'dso' as const, key: r.id, mag: r.vmag ?? 12, label: 'deep sky',
      }))
      searchEntries.push(...dsoEntries)
    })

    // Named asteroids append in the same way once the belt loads. mag -26 puts them in the same
    // rank tier as the curated galaxies and deep-sky objects — all of them are landmark objects
    // whose "brightness" isn't comparable to a star's, so they tie and fall back to match rank.
    asteroidPromise.then((field) => {
      if (!field) return
      searchEntries.push(...famousAsteroidEntries(field).map(({ def }) => ({
        name: def.name, kind: 'asteroid' as const, key: def.id, mag: -26, label: 'asteroid',
      })))
    })
  })
  .catch(() => showBanner('Star catalog failed to load — solar system only.'))

// Startup load stagger. Each point layer ends its load with one synchronous ~140 ms chunkCatalog
// pass (loadPointLayer already yields to requestIdleCallback first, but that only moves the pass
// out of the current task — it can't stop three catalogs finishing their fetches within a few ms
// of each other and then chunking back-to-back inside one frame burst). Stars go first and
// unthrottled: it's the layer the camera is actually looking at from the starting vantage. The
// Milky Way (interior + exterior) and galaxy catalogs are only visible from kpc/Mpc away, so
// nothing is missing while they wait, and spacing their starts ~800 ms apart keeps their chunking
// passes off the same frames as each other and as the star catalog's.
const MILKY_WAY_LOAD_DELAY_MS = 800
const MILKY_WAY_EXT_LOAD_DELAY_MS = 1600
const GALAXY_LOAD_DELAY_MS = 2400

let galaxies: GalaxyField | null = null
setTimeout(() => {
  loadGalaxyField(engine.scene)
    .then(g => { galaxies = g })
    .catch(() => showBanner('Galaxy catalog failed to load.'))
}, GALAXY_LOAD_DELAY_MS)

// Curated galaxies (M31/Andromeda, M33, …) rendered as landmark glow sprites on top of the bulk
// galaxies.bin point cloud — that catalog's redshift pipeline correctly omits the (blueshifted)
// Local Group, so without this, flying to Andromeda arrives at visually empty space.
const galaxySprites = createGalaxySprites(engine.scene)

// Curated deep-sky objects (Orion Nebula, Pleiades, …) — same landmark role, but living at
// star-field distances inside the Milky Way rather than out among the galaxies.
const deepSkySprites = createDeepSkySprites(engine.scene)

// Lazy hips2fits photo upgrades for every curated galaxy + deep-sky-object glow sprite: fetches
// a real DSS2 cutout on first focus or camera approach, swaps it in, and silently keeps the glow
// on failure. See objectImagery.ts.
const objectImagery = createObjectImagery([
  ...galaxyImageTargets(galaxySprites),
  ...deepSkyImageTargets(deepSkySprites),
])

// OpenNGC's register-on-focus path (objectImagery.register — see its doc comment): unlike the
// curated catalogs above, an OpenNGC object gets a glow sprite and joins objectImagery only the
// first time it's actually focused (search fly-to). Idempotent per id, so re-focusing the same
// object later just re-triggers objectImagery.focus (itself a no-op once loaded/loading).
const openNgcRegistered = new Set<string>()
function focusOpenNgcImagery(obj: OpenNgcObject): void {
  if (!openNgcRegistered.has(obj.id)) {
    openNgcRegistered.add(obj.id)
    const diameterLy = openNgcDiameterLy(obj)
    const { sprite, truePos } = createStandaloneGlowSprite(engine.scene, obj.raHours, obj.decDeg, obj.distPc, diameterLy)
    openNgcSpriteFollowers.push({ sprite, truePos })
    const target: ImageTarget = {
      id: obj.id, raHours: obj.raHours, decDeg: obj.decDeg, diameterLy, distPc: obj.distPc, sprite, truePos,
    }
    // A real MajAx measurement is strictly more accurate for the hips2fits FOV than deriving it
    // from diameterLy/distPc, since distPc here is only ever a type-based placeholder (see
    // src/data/openNgc.ts's doc comment).
    if (obj.majAxArcmin != null) target.fovDegOverride = angularFovDegFromArcmin(obj.majAxArcmin)
    objectImagery.register(target)
  }
  objectImagery.focus(obj.id)
}

// Milky Way bridge layer — real Gaia sky-plane density, modeled depth. Optional garnish: no
// loading banner and no error banner on failure, just a console warning.
//
// Rendered as unresolved surface-brightness GLOW, not as individually-real stars: the layer
// must stay visible across 3 orders of magnitude of camera distance (inside the disk out to
// ~181 kpc and beyond), and per-point apparent magnitude can't carry that — a synthetic
// absMag-5 point at 181 kpc has appMag ≈ 26, alpha ≈ 0 at any sane faintMag. So faintMag 30
// effectively disables the per-point magnitude fade (every point renders) and a low alphaCap
// keeps each point subtle enough that 1M additively-blended points read as a soft glow whose
// brightness IS the density map (the real Gaia sky data). layerAlphas still gates the whole
// layer in/out by camera distance.
//
// alphaCap 0.055: the 2x stride in build-milkyway.ts halved the point count, which by itself
// argued for doubling 0.05 -> 0.10 to conserve total additive energy. Measured against the dust
// lanes this build adds, though, 0.10 is too hot — the band saturates toward white and washes
// the new dark rift back out, which is the whole point of the dust model. 0.055 was picked by
// comparing both at the edge-on 40 kly vantage: it keeps the rift's contrast while leaving the
// band's overall brightness close to the pre-stride look.
let milkyWay: PointLayer | null = null
setTimeout(() => {
  loadPointLayer(engine.scene, import.meta.env.BASE_URL + 'milkyway.bin', {
    unitToAu: PC_TO_AU, unitToPc: 1, scale: 3, faintMag: 30, alphaCap: 0.055, minSize: 0.75, maxSize: 2,
  })
    .then(m => { milkyWay = m })
    .catch((err) => console.warn('Milky Way layer failed to load:', err))
}, MILKY_WAY_LOAD_DELAY_MS)

// Exterior Milky Way — the SAME galaxy, sampled volumetrically from the density model instead of
// reconstructed along Gaia sight lines (build-milkyway.ts --exterior). The interior catalog above
// inherits Gaia's real sky map, which is what makes the band and the Great Rift correct from
// Earth — and also what makes it wrong from outside, where that same concentration reads as a
// bright straight streak through the core with the spiral arms buried under it. This layer has no
// preferred direction, so from outside it shows the four arms and the inter-arm dust lanes.
// layerAlphas hands the two over as one complementary split, so they are never both full.
//
// alphaCap 0.075 vs the interior layer's 0.055: matched by eye at the ~20 kpc handoff, where both
// are near half weight. The exterior catalog spreads the same 1M points over the whole galaxy
// rather than concentrating ~13% of them into the pencil beam toward the centre, so its projected
// density — and therefore its additive brightness — is lower for the same per-point alpha.
let milkyWayExt: PointLayer | null = null
setTimeout(() => {
  loadPointLayer(engine.scene, import.meta.env.BASE_URL + 'milkyway-ext.bin', {
    unitToAu: PC_TO_AU, unitToPc: 1, scale: 3, faintMag: 30, alphaCap: 0.075, minSize: 0.75, maxSize: 2,
  })
    .then(m => { milkyWayExt = m })
    .catch((err) => console.warn('Exterior Milky Way layer failed to load:', err))
}, MILKY_WAY_EXT_LOAD_DELAY_MS)

// Constellation lines — sky-view-only overlay (d3-celestial line data). Loaded at startup so
// they're ready the first time sky mode is entered; loadConstellations already warns + degrades
// gracefully on failure, so no .catch needed here.
let constellations: ConstellationLines | null = null
loadConstellations(engine.scene).then(c => {
  constellations = c
  if (mode === 'sky') c.setVisible(true) // in case sky mode was entered before this resolved
})

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

// --- Sky view mode: "stand on Earth, look up". ---------------------------------------------
// Both control classes stay attached to the canvas for the whole session; only one is
// `enabled` at a time so their pointer/wheel listeners don't fight over drag state.
const skyControls = new SkyViewControls(engine.renderer.domElement)
skyControls.enabled = false
let mode: 'orbit' | 'sky' = 'orbit'
const skyToggleBtn = document.getElementById('sky-toggle')!
const skyHint = document.getElementById('sky-hint')!
const hud = document.getElementById('hud')!
const skyViewDir = new THREE.Vector3()
let infoCardWasVisible = false

function enterSky(): void {
  if (mode === 'sky') return
  mode = 'sky'
  flyer.cancel()
  controls.enabled = false
  skyControls.enabled = true
  earth.mesh.visible = false // children (clouds, atmosphere) hide with the parent mesh
  infoCardWasVisible = document.getElementById('info-card')!.style.display === 'block'
  hideCard()
  hud.style.display = 'none'
  skyHint.style.display = 'block'
  skyToggleBtn.classList.add('active')
  constellations?.setVisible(true)
}

function exitSky(): void {
  if (mode === 'orbit') return
  mode = 'orbit'
  skyControls.enabled = false
  controls.enabled = true
  earth.mesh.visible = true
  engine.camera.fov = 55
  engine.camera.updateProjectionMatrix()
  if (infoCardWasVisible) document.getElementById('info-card')!.style.display = 'block'
  hud.style.display = 'block'
  skyHint.style.display = 'none'
  skyToggleBtn.classList.remove('active')
  constellations?.setVisible(false)
}

function toggleSky(): void {
  if (mode === 'sky') exitSky(); else enterSky()
}

skyToggleBtn.addEventListener('click', toggleSky)
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || mode !== 'sky') return
  // The search input has its own Escape handler (closes the dropdown + calls searchInput.blur()).
  // That handler runs first — input is the dispatch target, so it always fires before this
  // ancestor (window) listener during bubble — and its synchronous blur() call already changes
  // document.activeElement by the time we get here, so activeElement can't be used to detect
  // "this keydown started in the search box". ev.target is unaffected by that side effect (it
  // stays pinned to the original dispatch target through the whole bubble phase), so it's the
  // deterministic check: if this Escape originated in the search input, let its own handler own
  // it (close the dropdown) and don't also exit sky mode on the same press.
  if (ev.target === searchInput) return
  exitSky()
})
// -----------------------------------------------------------------------------------------

function focusEntry(e: SearchEntry): void {
  if (mode === 'sky') exitSky() // a search fly-to exits sky view first
  if (e.kind === 'planet') {
    const node = planets.find(p => p.def.id === e.key)!
    flyer.start(planetFocusable(node), node.def.radiusAu * 8)
    showPlanetCard(node.def)
  } else if (e.kind === 'galaxy') {
    const def = GALAXIES.find(g => g.id === e.key)!
    flyer.start(galaxyFocusable(def), GALAXY_ARRIVE_AU)
    showGalaxyCard(def)
    objectImagery.focus(def.id)
  } else if (e.kind === 'asteroid') {
    // The Focusable re-solves the orbit from clock.now() every frame it's asked, so the fly-to
    // chases a moving target and the camera keeps tracking it afterwards as time runs.
    const hit = asteroidByKey.get(e.key as string)
    if (hit && asteroids) {
      flyer.start(asteroidFocusable(asteroids, hit.index, hit.def.name, () => clock.now()), ASTEROID_ARRIVE_AU)
      showAsteroidCard(hit.def, asteroidOrbitSummary(asteroids, hit.index))
    }
  } else if (e.kind === 'dso') {
    // 'dso' covers both the 15 curated deep-sky objects and the ~12.4k OpenNGC ones (they share
    // a kind so search ranks/labels them together — see main.ts's searchEntries construction and
    // search.ts's KIND_ORDER). Curated ids never collide with OpenNGC ones (build-openngc.ts
    // excludes every curated NGC/IC number from the baked catalog), so this lookup order is
    // unambiguous: curated wins on the (never-occurring) collision case too.
    const def = DEEP_SKY.find(d => d.id === e.key)
    if (def) {
      // Arrive a bit beyond the minimum approach so the object is framed, not sat inside — same
      // "frame it, don't clip it" idea as the galaxy/planet arrival distances above.
      flyer.start(deepSkyFocusable(def), deepSkyMinApproachAu(def) * 4)
      showDeepSkyCard(def)
      objectImagery.focus(def.id)
    } else {
      const obj = openNgcById.get(e.key as string)!
      flyer.start(openNgcFocusable(obj), openNgcMinApproachAu(obj) * 4)
      showOpenNgcCard(obj)
      focusOpenNgcImagery(obj)
    }
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
  if (mode === 'sky') return // click-to-focus is disabled entirely in sky mode
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
// Dynamic resolution governor: steps engine.renderer's pixel ratio down under sustained load
// (EMA frame time > 22ms for 60 consecutive frames) and back up once comfortably fast again
// (EMA < 12ms for 300 consecutive frames) — see resolutionGovernor.ts for the pure step logic.
const resolutionGovernor = new ResolutionGovernor()

function frame(realMs: number) {
  const dt = lastMs ? (realMs - lastMs) / 1000 : 0
  lastMs = realMs
  if (dt > 0) {
    const newRatio = resolutionGovernor.update(dt * 1000)
    if (newRatio !== null) engine.setPixelRatio(newRatio)
  }
  flyer.update(dt)

  clock.tick(realMs)
  const simNow = clock.now()
  updatePositions(planets, simNow)
  if (mode === 'sky') camTruePos.copy(earth.truePos)
  else controls.getCameraTruePos(camTruePos)
  const la = layerAlphas(camTruePos.length())
  if (mode === 'sky') {
    // At 1 AU the real MW crossfade ramp is 0 (it's tuned for galactic-scale distances) — but
    // the band genuinely is visible in the night sky from Earth, so sky view overrides it to a
    // fixed value rather than using the ramp's (wrong, for this case) answer.
    //
    // Sky view uses the INTERIOR layer only, and explicitly zeroes the exterior one. Standing on
    // Earth is the vantage the Gaia reconstruction exists for: the band, its star clouds and the
    // Great Rift are the real measured sky there. The exterior layer is the model's idealised
    // galaxy — from inside it would overlay a second, smoother, subtly-misaligned band on top of
    // the real one. (The ramp already gives it 0 at 1 AU; this is belt-and-braces so a future
    // change to the handoff band can't leak it into sky view.)
    la.milkyWay = 0.6
    la.milkyWayExt = 0
  }
  galaxySprites.update(camTruePos, la.galaxies)
  // Deep-sky objects are exempt from the stars/galaxies LOD crossfade entirely: they're tiny
  // (tens to low hundreds of ly across) compared to what those ramps are tuned for, so their own
  // angular size already makes them naturally invisible from galactic-scale distances — no fade
  // needed. Using la.stars here was wrong: that ramp keys off camera-distance-from-Sun, which
  // dims a DSO sprite even while sitting right at its own arrival point (e.g. Omega Centauri at
  // ~5.2 kpc lands mid-ramp, alpha ≈0.41 — visibly dimmer on arrival for no reason).
  deepSkySprites.update(camTruePos, 1.0)
  // OpenNGC glow sprites (created lazily, one per focused object — see focusOpenNgcImagery)
  // aren't part of a managed group with its own update(), so their camera-relative position is
  // maintained here directly, same "position = truePos - camTruePos" rule as the curated groups.
  for (const f of openNgcSpriteFollowers) f.sprite.position.copy(f.truePos).sub(camTruePos)
  objectImagery.update(camTruePos, dt)
  repositionMeshes(planets, sunLight, camTruePos)
  updateOrbitLines(orbits, camTruePos)
  if (mode === 'sky') {
    engine.camera.position.set(0, 0, 0)
    engine.camera.lookAt(skyControls.getViewDir(skyViewDir))
    engine.camera.fov = skyControls.fov
    engine.camera.updateProjectionMatrix()
  } else {
    controls.applyToCamera(engine.camera)
  }
  // matrixWorldInverse must reflect this frame's camera transform before deriving the
  // view-space sun direction for Earth's night lights — renderer.render() would refresh it
  // too, but only after updateEarthNight() needs to read it.
  engine.camera.updateMatrixWorld()
  updateEarthNight(engine.camera)

  // Point layers update AFTER the camera transform block above (and its updateMatrixWorld): each
  // one frustum-culls its spatial chunks against camera.projectionMatrix * matrixWorldInverse, so
  // it needs THIS frame's orientation/FOV, not the previous frame's. Nothing between the old call
  // site and here reads the layers (they only write shader uniforms + per-chunk visibility), so
  // the move is behaviour-neutral apart from the culling being one frame fresher.
  stars?.update(camTruePos, la.stars, engine.camera)
  // Halos ride the star layer's own crossfade, and need the CURRENT fov (sky view zooms it) plus
  // the framebuffer height (window resize / dynamic-resolution governor) to hold a fixed angular size.
  brightStars?.update(camTruePos, la.stars, engine.camera, engine.renderer.domElement.height)
  milkyWay?.update(camTruePos, la.milkyWay, engine.camera)
  milkyWayExt?.update(camTruePos, la.milkyWayExt, engine.camera)
  galaxies?.update(camTruePos, la.galaxies, engine.camera)
  // Asteroids are exempt from layerAlphas: the belt is a solar-system-scale object, not a
  // galactic one, so it gets its own hard 100 AU distance gate inside the layer rather than a
  // crossfade tuned for kpc-scale ramps.
  asteroids?.update(simNow, camTruePos)

  hudName.textContent = controls.focus.name
  hudDist.textContent = formatDistance(controls.distance)

  engine.composer.render()
  // Kicked only once (the call is guarded): the belt's 7 MB fetch and buffer build wait until a
  // frame has actually been presented, so they can never delay first paint.
  startAsteroidLoad()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// Dev-only camera hook, alongside the existing __cosmosStats counters in starField.ts. The visual
// gates for this scene ("does the Milky Way show spiral arms from 300 kly", "is the dust rift
// visible edge-on from 40 kly") are only checkable from a specific vantage, and the only way to
// reach one through the UI is a long stream of drag/wheel gestures that lands somewhere slightly
// different every time. This makes those vantages addressable and repeatable. `import.meta.env.DEV`
// is a compile-time constant, so the whole block folds away in a production build.
if (import.meta.env.DEV) {
  ;(window as unknown as { __cosmosDev?: unknown }).__cosmosDev = {
    /** Park the camera `distanceAu` from the focus at the given orbit angles (radians). A pitch of
     *  ±PI/2 looks down on the galactic plane from the pole; a pitch of 0 is edge-on to it. */
    setView(distanceAu: number, yaw?: number, pitch?: number) {
      flyer.cancel()
      controls.distance = distanceAu
      controls.setOrientation(yaw ?? 0.5, pitch ?? 0.4)
    },
    controls,
    engine,
    get layerAlphas() { return layerAlphas(camTruePos.length()) },
    get camDistAu() { return camTruePos.length() },
  }
}
