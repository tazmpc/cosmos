import * as THREE from 'three'
import { createEngine } from './engine/renderer'
import { ResolutionGovernor } from './engine/resolutionGovernor'
import { FocusOrbitControls, type Focusable } from './engine/cameraControls'
import { SkyViewControls } from './engine/skyViewControls'
import { createSolarSystem, updatePositions, repositionMeshes, updateEarthNight, type PlanetNode } from './scene/solarSystem'
import { SimClock } from './sim/clock'
import { formatDistance } from './ui/format'
import { loadStarField, loadPointLayer, type StarField, type PointLayer } from './scene/starField'
import { createBrightStarHalos, HALO_MAG_LIMIT, type BrightStarHalos } from './scene/brightStars'
import { loadGalaxyField, type GalaxyField } from './scene/galaxyField'
import { createGalaxySprites, createDeepSkySprites, createStandaloneGlowSprite } from './scene/galaxySprites'
import { createObjectImagery, galaxyImageTargets, deepSkyImageTargets, type ImageTarget } from './scene/objectImagery'
import { layerAlphas } from './scene/layerAlphas'
import { showBanner, hideBanner, showToast } from './ui/banner'
import { apparentMagnitude, raDecDistToXyz } from './data/starMath'
import { angularFovDegFromArcmin } from './data/angularSize'
import { createOrbitLines, updateOrbitLines } from './scene/orbits'
import { loadConstellations, type ConstellationLines } from './scene/constellations'
import { search, type SearchEntry } from './ui/search'
import { FlyToAnimator } from './engine/flyTo'
import { starFocusable, starTruePosAu } from './scene/starFocus'
import { galaxyFocusable, GALAXY_ARRIVE_AU } from './scene/galaxyFocus'
import { deepSkyFocusable, deepSkyMinApproachAu } from './scene/deepSkyFocus'
import { GALAXIES } from './data/galaxies'
import { DEEP_SKY } from './data/deepSky'
import { loadOpenNgc, openNgcFocusable, openNgcMinApproachAu, openNgcDiameterLy, type OpenNgcObject } from './data/openNgc'
import { setupTimeControls } from './ui/timeControls'
import { showPlanetCard, showStarCard, showGalaxyCard, showDeepSkyCard, showOpenNgcCard, showAsteroidCard, showSpacecraftCard, showExoplanetHostCard, hideCard } from './ui/infoCard'
import {
  loadAsteroidField, asteroidFocusable, famousAsteroidEntries, asteroidOrbitSummary,
  ASTEROID_ARRIVE_AU, type AsteroidField,
} from './scene/asteroidField'
import {
  loadSpacecraftField, spacecraftFocusable, spacecraftPositionAt,
  SPACECRAFT_ARRIVE_AU, type SpacecraftField, type SpacecraftDef,
} from './scene/spacecraft'
import type { FamousAsteroid } from './data/asteroids'
import { KPC_TO_AU, MPC_TO_AU, PC_TO_AU } from './data/units'
import { pickNearest, placeLabel, HOVER_PRIORITY, type HoverCandidate, type HoverKind } from './ui/hoverPick'
import { dateToJd } from './sim/kepler'
import { loadExoplanets, hostForStarName, type ExoplanetCatalog, type ExoplanetHost } from './data/exoplanets'
import { decodeViewState, encodeViewState, type FocusRef, type ViewState } from './ui/urlState'

const engine = createEngine(document.getElementById('app')!)

// --- Deep links: read the incoming URL before anything is built ------------------------------
// Parsed exactly once, here, so the clock can be constructed at the shared simulation date
// rather than jumped to it a frame later (a jump would make every ephemeris-driven layer
// visibly re-solve). Everything else the link carries — mode, camera, focus — is applied
// further down, once the objects that own that state exist. Null means "no link, default view".
// decodeViewState never throws and never half-applies junk; see src/ui/urlState.ts.
const initialView = decodeViewState(location.hash)

const clock = new SimClock(initialView?.t ? new Date(initialView.t) : new Date())
// setupTimeControls applies the step it starts on to the clock, so the rate and its label can
// never disagree — no separate clock.setRate needed here. The handle it returns lets a link
// arriving LATER (a hash edit in an already-open tab) move the ladder the same way.
const timeControls = setupTimeControls(clock, initialView?.rate)

// --- Deep time -------------------------------------------------------------------------------
// Every star in stars.bin carries a measured proper motion, and the point shader moves it by
// `velocity * uYearsFromEpoch`. That epoch is Gaia DR3's, J2016.0 — the reference date the
// catalog's positions and proper motions are quoted at. (The ~700 HYG stars are quoted at J2000;
// the 16-year difference moves even Barnard's Star only 0.0015 pc, ~200x below the point size it
// is drawn at, so the two are treated as one epoch rather than carrying a per-star epoch column.)
const GAIA_EPOCH_MS = Date.UTC(2016, 0, 1, 12, 0, 0)
const MS_PER_JULIAN_YEAR = 365.25 * 86400 * 1000

/** Hard limit on how far the linear extrapolation is allowed to run, in years either side of the
 *  epoch. Proper motion is a straight-line fit to a velocity measured over a few years: it has no
 *  galactic orbit in it, no gravity, and no radial term, so past a few hundred millennia it stops
 *  being a projection and becomes a drawing. 200,000 years is roughly where the nearby stars have
 *  rearranged the constellations completely but the sky is still recognisably a model of THIS
 *  galaxy. Beyond it the clock keeps running and the planets keep moving — only the stars freeze,
 *  which is the honest failure: the app stops claiming to know where they are. */
const MAX_YEARS_FROM_EPOCH = 200_000

function yearsFromEpoch(simDate: Date): number {
  const y = (simDate.getTime() - GAIA_EPOCH_MS) / MS_PER_JULIAN_YEAR
  return Math.max(-MAX_YEARS_FROM_EPOCH, Math.min(MAX_YEARS_FROM_EPOCH, y))
}

/** Constellation figures are a J2000 human artifact — the lines join stars that LOOK adjacent
 *  from Earth right now. Once proper motion has moved the stars, the lines stop landing on them
 *  and the figures become false. They are hidden past this many years from J2000 rather than
 *  redrawn, because there is nothing to redraw them from: no catalog of "what people would have
 *  seen in 12,000 AD" exists. ±5,000 yr is about where the Big Dipper's bowl visibly opens up. */
const CONSTELLATION_EPOCH_HALF_LIFE_YEARS = 5000
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0)
function constellationsValidAt(simDate: Date): boolean {
  return Math.abs((simDate.getTime() - J2000_MS) / MS_PER_JULIAN_YEAR) < CONSTELLATION_EPOCH_HALF_LIFE_YEARS
}
const { nodes: planets, sunLight } = createSolarSystem(engine.scene)
const orbits = createOrbitLines(engine.scene, clock.now())

let stars: StarField | null = null
let brightStars: BrightStarHalos | null = null
/** Named stars eligible to be hover-labelled, filled in once the star catalog loads — see the
 *  hover-label section near the bottom of this file. */
let starHoverList: { name: string; idx: number; entry: SearchEntry }[] = []

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

// Spacecraft — Voyager 1/2, New Horizons, JWST (see src/scene/spacecraft.ts). Unlike the asteroid
// belt (17 MB, deliberately deferred past first paint) public/spacecraft.json is ~115 KB — small
// enough to load eagerly alongside OpenNGC rather than behind requestIdleCallback. Silent degrade
// on failure, same as the other lazy catalogs: no banner, just no spacecraft.
const spacecraftPromise = loadSpacecraftField(engine.scene).catch((err) => {
  console.warn('Spacecraft layer failed to load:', err)
  return null as SpacecraftField | null
})
let spacecraft: SpacecraftField | null = null
spacecraftPromise.then((f) => { spacecraft = f })

// Exoplanet hosts (NASA Exoplanet Archive, ~900 KB, see src/data/exoplanets.ts and
// scripts/build-exoplanets.ts) — loaded lazily on browser idle rather than eagerly like
// spacecraft.json: nothing on screen needs it before a star card is actually opened. Silent
// degrade on failure, same as the other lazy catalogs: no banner, cards just lack a "Known
// planets" line and the three card-only famous-host search entries never appear.
let exoplanets: ExoplanetCatalog | null = null
const exoplanetsPromise = new Promise<ExoplanetCatalog | null>((resolve) => {
  const kick = (): void => {
    loadExoplanets()
      .then((c) => { exoplanets = c; resolve(c) })
      .catch((err) => { console.warn('Exoplanet catalog failed to load:', err); resolve(null) })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => kick())
  else setTimeout(kick, 0)
})

// Famous exoplanet hosts too faint for this project's star catalog (see src/data/exoplanets.ts's
// and src/ui/infoCard.ts's doc comments on the "never synthesize a star point" honesty rule).
// `archiveHostname` is the NASA Exoplanet Archive's own `hostname` key in public/exoplanets.json;
// `displayName` is what the search box and card show — they differ only for Kepler-90, whose
// sole default_flag=1 row in the current Archive snapshot is filed under "KOI-351" (see
// src/data/exoplanetAliases.ts's doc comment for why). Populated into search entries once both
// the star catalog (for the "already a real star?" guard below) and the exoplanet catalog have
// loaded — see the exoplanetsPromise.then block inside loadStarField's callback.
const FAMOUS_UNMATCHED_HOSTS: { displayName: string; archiveHostname: string }[] = [
  { displayName: 'TRAPPIST-1', archiveHostname: 'TRAPPIST-1' },
  { displayName: 'Kepler-90', archiveHostname: 'KOI-351' },
  { displayName: 'HD 209458', archiveHostname: 'HD 209458' },
]
/** display name -> its exoplanet host record, for the three entries above only — populated once
 *  exoplanets.json loads. Looked up in focusEntry to show a card without a fly-to. */
const exoplanetHostByKey = new Map<string, ExoplanetHost>()

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
    const starEntries: SearchEntry[] = Object.entries(s.names).map(([name, idx]) => ({
      name, kind: 'star' as const, key: idx,
      // apparent magnitude (distance in pc): ties rank by how bright the star actually looks
      mag: apparentMagnitude(s.catalog.absMag[idx], Math.hypot(
        s.catalog.positions[idx * 3],
        s.catalog.positions[idx * 3 + 1],
        s.catalog.positions[idx * 3 + 2])),
    }))
    // Named-star hover candidates (see the hover-label section further down). Same entries the
    // search box ranks, paired with their catalog index, built once here so the per-pointermove
    // pass allocates nothing extra. WHICH of them actually get a label is decided per pass by
    // apparent magnitude from the CAMERA (not from Earth) — see hoverCandidates().
    starHoverList = starEntries.map((e) => ({ name: e.name, idx: e.key as number, entry: e }))
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
      ...starEntries,
    ]
    setupSearch(searchEntries)
    // Same array reference every later catalog pushes into (see below) — the deep-link resolver
    // polls it to find the object a shared URL names, whenever that object's catalog lands.
    allSearchEntries = searchEntries

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

    // Spacecraft append in the same way once loaded. Same rank tier (-26) as the other curated
    // non-star landmarks — a probe's "brightness" isn't a real quantity either.
    spacecraftPromise.then((field) => {
      if (!field) return
      searchEntries.push(...field.defs.map((def) => ({
        name: def.name, kind: 'spacecraft' as const, key: def.id, mag: -26, label: 'spacecraft',
      })))
    })

    // Famous exoplanet-host card-only entries append the same way once exoplanets.json loads.
    // kind stays 'star' (per the plan — same search/rank tier as every other named star) but the
    // key is the display NAME (a string) rather than a catalog index (a number): that's what lets
    // focusEntry's star branch below tell a card-only entry apart from a real, flyable star
    // without a dedicated SearchEntry field. mag 8 is an arbitrary faint-ish placeholder (these
    // aren't catalog stars with a real apparent magnitude) that ranks them below most named
    // stars on a tied match, appropriate for objects that are "real but not directly visible here".
    exoplanetsPromise.then((catalog) => {
      if (!catalog) return
      const entries: SearchEntry[] = []
      for (const { displayName, archiveHostname } of FAMOUS_UNMATCHED_HOSTS) {
        const host = catalog.hosts[archiveHostname]
        if (!host) continue // the Archive snapshot doesn't have this host this time — skip silently
        // Never let a card-only entry shadow a real, flyable star of the same name (verified
        // absent for all three at write time, but stay honest if the catalog ever changes).
        if (s.names[displayName] !== undefined) continue
        exoplanetHostByKey.set(displayName, host)
        entries.push({ name: displayName, kind: 'star' as const, key: displayName, mag: 8, label: 'exoplanet host' })
      }
      searchEntries.push(...entries)
    })
  })
  .catch(() => showBanner('Star catalog failed to load — solar system only.'))

// Startup load stagger. Each point layer ends its load with one synchronous ~140 ms chunkCatalog
// pass (loadPointLayer already yields to requestIdleCallback first, but that only moves the pass
// out of the current task — it can't stop three catalogs finishing their fetches within a few ms
// of each other and then chunking back-to-back inside one frame burst). Stars go first and
// unthrottled: it's the layer the camera is actually looking at from the starting vantage. The
// interior Milky Way and galaxy catalogs are only visible from kpc/Mpc away, so nothing is missing
// while they wait, and spacing their starts ~800 ms apart keeps their chunking passes off the same
// frames as each other and as the star catalog's. The EXTERIOR Milky Way has no fixed delay at
// all — see startMilkyWayExtLoad below — it loads lazily, triggered by camera distance instead.
const MILKY_WAY_LOAD_DELAY_MS = 800
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
//
// Lazy load: nothing needs this layer below the interior<->exterior handoff band (12-28 kpc,
// layerAlphas.ts), so unlike every other layer above it has no fixed startup delay at all — it
// loads only once the camera has actually gone somewhere that needs it. Triggered from frame()'s
// ~1 Hz throttled check below, one-shot (loadStarted latches, same pattern as startAsteroidLoad).
let milkyWayExt: PointLayer | null = null
let milkyWayExtLoadStarted = false
/** Trigger radius: 8 kpc, well below the 12 kpc handoff band start — the fetch + chunking pass
 *  needs a head start so the layer is actually ready by the time the crossfade wants it, not
 *  triggered exactly as it's needed. */
const MILKY_WAY_EXT_TRIGGER_AU = 8 * KPC_TO_AU

function startMilkyWayExtLoad(): void {
  if (milkyWayExtLoadStarted) return
  milkyWayExtLoadStarted = true
  loadPointLayer(engine.scene, import.meta.env.BASE_URL + 'milkyway-ext.bin', {
    unitToAu: PC_TO_AU, unitToPc: 1, scale: 3, faintMag: 30, alphaCap: 0.075, minSize: 0.75, maxSize: 2,
  })
    .then(m => { milkyWayExt = m })
    .catch((err) => console.warn('Exterior Milky Way layer failed to load:', err))
}

// Constellation lines — sky-view-only overlay (d3-celestial line data). Loaded at startup so
// they're ready the first time sky mode is entered; loadConstellations already warns + degrades
// gracefully on failure, so no .catch needed here.
let constellations: ConstellationLines | null = null
loadConstellations(engine.scene).then(c => {
  constellations = c
  // in case sky mode was entered before this resolved — and only if the sim date is still inside
  // the figures' epoch window (constellationsShown is the latch the per-frame check maintains)
  if (mode === 'sky') c.setVisible(constellationsShown)
})

export function planetFocusable(n: PlanetNode): Focusable {
  // Moons get an aimAnchor pointing at their parent planet's live position — see FlyToAnimator's
  // arrival "auto-aim": on arriving at a moon, the camera orients so the parent lands in frame
  // behind it. Planets/the Sun (parent === null) have no meaningful anchor and get none.
  const parentNode = n.def.parent != null ? planets.find(p => p.def.id === n.def.parent) : undefined
  return {
    name: n.def.name,
    getPosition: (out) => out.copy(n.truePos),
    minApproachAu: n.def.radiusAu * 1.4,
    aimAnchor: parentNode ? () => parentNode.truePos : undefined,
  }
}

const earth = planets.find(p => p.def.id === 'earth')!
const controls = new FocusOrbitControls(
  engine.renderer.domElement, planetFocusable(earth), earth.def.radiusAu * 40)

const hudName = document.querySelector('#hud .focus-name')!
const hudDist = document.querySelector('#hud .focus-dist')!
const camTruePos = new THREE.Vector3()
/** Per-frame scratch for star positions in the hover pass (which runs over ~700 named stars every
 *  throttled pick) — reused so the pass keeps allocating nothing. */
const scratchStarPos = new THREE.Vector3()

const flyer = new FlyToAnimator(controls)

// --- Sky view mode: "stand on Earth, look up". ---------------------------------------------
// Both control classes stay attached to the canvas for the whole session; only one is
// `enabled` at a time so their pointer/wheel listeners don't fight over drag state.
const skyControls = new SkyViewControls(engine.renderer.domElement)
skyControls.enabled = false
let mode: 'orbit' | 'sky' = 'orbit'
const skyToggleBtn = document.getElementById('sky-toggle')!
const skyHint = document.getElementById('sky-hint')!
const SKY_HINT_BASE = skyHint.textContent ?? 'Sky view'
const SKY_HINT_EPOCH_LOCKED = SKY_HINT_BASE +
  ' — constellation figures are epoch-locked; beyond ±5,000 yr the stars have moved'
/** Mirrors what the constellation group's visibility currently is, so the per-frame epoch check
 *  only touches the scene (and the hint text) on an actual transition. */
let constellationsShown = false
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
  // The per-frame sky path below owns visibility from here on; seed the latch from the current
  // sim date so entering sky view in deep time never flashes the lines for one frame.
  constellationsShown = constellationsValidAt(clock.now())
  constellations?.setVisible(constellationsShown)
  skyHint.textContent = constellationsShown ? SKY_HINT_BASE : SKY_HINT_EPOCH_LOCKED
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
  constellationsShown = false
  constellations?.setVisible(false)
}

/** The user-driven mode switch (the 🔭 button and Escape both land here). Distinct from the
 *  enterSky/exitSky pair, which a deep link also calls: only the user's own switch abandons a
 *  link that is still resolving — otherwise it would fly them somewhere seconds later. */
function toggleSky(): void {
  cancelPendingDeepLink()
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
  toggleSky() // mode is 'sky' here, so this exits — via the user-driven path (see toggleSky)
})
// -----------------------------------------------------------------------------------------

/**
 * Camera placement for a deep link's arrival: no fly-to, just be there. A shared link is opened
 * to LOOK at something, and a 6-second cinematic sweep on every open — with the auto-aim then
 * overwriting the angles the link carefully recorded — is exactly the wrong behaviour. All
 * three fields are optional; anything absent keeps the target's own default (arrival distance,
 * current angles).
 */
interface InstantView { d?: number; yaw?: number; pitch?: number }

/** The kind+key a deep link would use for the CURRENT focus, or null when nothing shareable is
 *  focused. Maintained by focusEntry (and the raycast planet-click fallback), read by the URL
 *  writer — the reverse of the resolver's lookup. Starts at the app's own default focus. */
let currentFocusRef: FocusRef | null = { kind: 'planet', key: 'earth' }

/**
 * The stable deep-link identity of a search entry, or null if it isn't linkable.
 *
 * Stars are the one kind whose SearchEntry.key is NOT usable: it's an index into stars.bin, a
 * build artefact free to be reordered by the next catalog rebuild, so the link records the star's
 * NAME instead. A star entry whose key is already a string is a card-only exoplanet host (see
 * FAMOUS_UNMATCHED_HOSTS) — there is no point in the scene to fly to, so it is not linkable.
 */
function deepLinkRefFor(e: SearchEntry): FocusRef | null {
  if (e.kind === 'star') return typeof e.key === 'number' ? { kind: 'star', key: e.name } : null
  return { kind: e.kind, key: String(e.key) }
}

function focusEntry(e: SearchEntry, instant?: InstantView): void {
  // A hand-picked destination outranks a link that is still hunting for its catalog — without
  // this, searching for something while a slow link resolves would have the camera stolen back
  // seconds later. `instant` is set only by the resolver itself, which must not cancel itself.
  if (!instant) cancelPendingDeepLink()
  if (mode === 'sky') exitSky() // a search fly-to exits sky view first
  const ref = deepLinkRefFor(e)
  /**
   * Start the camera move for this entry — a fly-to normally, an immediate placement when a
   * deep link is being restored. The instant path deliberately bypasses FlyToAnimator entirely
   * rather than fast-forwarding it: the animator's arrival auto-aim would overwrite the yaw and
   * pitch the link is trying to restore.
   */
  const go = (target: Focusable, arriveDist: number): void => {
    currentFocusRef = ref
    if (!instant) { flyer.start(target, arriveDist); return }
    flyer.cancel()
    controls.setFocus(target, instant.d ?? arriveDist) // setFocus re-clamps to minApproachAu
    if (instant.yaw !== undefined || instant.pitch !== undefined) {
      controls.setOrientation(instant.yaw ?? controls.getYaw(), instant.pitch ?? controls.getPitch())
    }
  }
  // Spacecraft trajectory polylines are visible only while a spacecraft is the current focus
  // (see spacecraft.ts's doc comment) — cleared unconditionally here, then re-set below if the
  // new focus IS a spacecraft, so navigating away from one always hides its line.
  spacecraft?.setFocused(null)
  if (e.kind === 'planet') {
    const node = planets.find(p => p.def.id === e.key)!
    go(planetFocusable(node), node.def.radiusAu * 8)
    showPlanetCard(node.def)
  } else if (e.kind === 'galaxy') {
    const def = GALAXIES.find(g => g.id === e.key)!
    go(galaxyFocusable(def), GALAXY_ARRIVE_AU)
    showGalaxyCard(def)
    objectImagery.focus(def.id)
  } else if (e.kind === 'asteroid') {
    // The Focusable re-solves the orbit from clock.now() every frame it's asked, so the fly-to
    // chases a moving target and the camera keeps tracking it afterwards as time runs.
    const hit = asteroidByKey.get(e.key as string)
    if (hit && asteroids) {
      go(asteroidFocusable(asteroids, hit.index, hit.def.name, () => clock.now()), ASTEROID_ARRIVE_AU)
      showAsteroidCard(hit.def, asteroidOrbitSummary(asteroids, hit.index))
    }
  } else if (e.kind === 'spacecraft') {
    // Same live-tracking Focusable pattern as asteroids: the fly-to and the post-arrival camera
    // both re-solve the trajectory from clock.now() every frame.
    const def = spacecraft?.byId.get(e.key as string)
    if (def && spacecraft) {
      go(spacecraftFocusable(def, () => clock.now()), SPACECRAFT_ARRIVE_AU)
      spacecraft.setFocused(def.id)
      const pos = spacecraftPositionAt(def, dateToJd(clock.now()))
      showSpacecraftCard(def, pos.length(), pos.distanceTo(earth.truePos))
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
      go(deepSkyFocusable(def), deepSkyMinApproachAu(def) * 4)
      showDeepSkyCard(def)
      objectImagery.focus(def.id)
    } else {
      const obj = openNgcById.get(e.key as string)!
      go(openNgcFocusable(obj), openNgcMinApproachAu(obj) * 4)
      showOpenNgcCard(obj)
      focusOpenNgcImagery(obj)
    }
  } else if (e.kind === 'star' && typeof e.key === 'string') {
    // Card-only exoplanet-host entry (see FAMOUS_UNMATCHED_HOSTS above) — a string key is what
    // distinguishes it from a real star's SearchEntry (whose key is always its catalog index, a
    // number). Deliberately no flyer.start: these stars are below the catalog's magnitude cut,
    // so there is no point in the scene to fly to.
    const host = exoplanetHostByKey.get(e.key)
    if (host) showExoplanetHostCard(e.name, host)
  } else if (stars) {
    const exo = exoplanets ? hostForStarName(exoplanets, e.name) : undefined
    go(starFocusable(stars.catalog, e.key as number, e.name, () => yearsFromEpoch(clock.now())), 2000)
    showStarCard(stars.catalog, e.key as number, e.name, exo)
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

// --- Deep links: apply the incoming URL, then keep it current ---------------------------------
// The encode/decode half is pure and tested (src/ui/urlState.ts). This half is the part that has
// to deal with time: the catalogs a link may reference load asynchronously, on schedules that
// range from "already resolved" (curated galaxies and DSOs are compiled in) to "waits for the
// first rendered frame and then for browser idle" (the 17 MB asteroid belt). So a link is not
// resolved once at startup — it is retried until its target exists, or until it clearly never
// will.

/** Every search entry the app knows about, assigned once loadStarField sets search up. This is
 *  the same array every later catalog (OpenNGC, asteroids, spacecraft, exoplanet hosts) pushes
 *  into, so polling it sees new kinds appear as their loads land. */
let allSearchEntries: SearchEntry[] = []

const DEEP_LINK_RETRY_MS = 500
/** Long enough to cover the slowest path to a linkable object on a cold cache: the asteroid belt
 *  is gated on a rendered frame, then on requestIdleCallback, then a 17 MB fetch and decode. */
const DEEP_LINK_TIMEOUT_MS = 20_000

/** True while a link is still waiting for its catalog. The URL writer stays silent until it
 *  clears — otherwise the 1 Hz writer would overwrite the very URL being resolved with the
 *  default Earth view, and the link would destroy itself before it could be applied. */
let deepLinkPending = false

/** Bumped every time a pending resolve is superseded. A resolve can be waiting up to 20 seconds,
 *  during which the user may search for something else, click a planet, or paste a different
 *  link — and a stale poll that fired afterwards would yank the camera off whatever they chose.
 *  Each resolve captures the generation it started in and gives up the moment it goes stale. */
let deepLinkGeneration = 0

/** Abandons any in-flight deep-link resolve. Called by every path that represents a NEWER
 *  intention than the pending link: a fresh link, or the user navigating by hand. */
function cancelPendingDeepLink(): void {
  deepLinkGeneration++
  deepLinkPending = false
}

/**
 * The entry a link points at, if it has loaded yet.
 *
 * Two passes, because links get hand-edited and hand-typed. The first is the exact match on the
 * canonical key this app emits ('asteroid:ceres'). The second accepts the object's display NAME
 * or its id, case-insensitively — so 'asteroid:Ceres' and 'planet:Saturn' resolve to the same
 * place, and the writer then rewrites the fragment into canonical form. Exact-first matters:
 * a loose match must never beat a real, exact one.
 */
function findEntryByRef(ref: FocusRef): SearchEntry | undefined {
  for (const e of allSearchEntries) {
    const r = deepLinkRefFor(e)
    if (r && r.kind === ref.kind && r.key === ref.key) return e
  }
  const loose = ref.key.toLowerCase()
  for (const e of allSearchEntries) {
    const r = deepLinkRefFor(e)
    if (!r || r.kind !== ref.kind) continue
    if (r.key.toLowerCase() === loose || e.name.toLowerCase() === loose) return e
  }
  return undefined
}

/** Polls for the linked object until it exists, then places the camera on it instantly. */
function resolveDeepLinkFocus(ref: FocusRef, view: ViewState): void {
  cancelPendingDeepLink() // this link supersedes whatever was still waiting
  const generation = deepLinkGeneration
  deepLinkPending = true
  const deadline = performance.now() + DEEP_LINK_TIMEOUT_MS
  const attempt = (): void => {
    if (generation !== deepLinkGeneration) return // superseded — say nothing, touch nothing
    const entry = findEntryByRef(ref)
    if (entry) {
      focusEntry(entry, { d: view.d, yaw: view.yaw, pitch: view.pitch })
      deepLinkPending = false
      return
    }
    if (performance.now() >= deadline) {
      console.warn(
        `Deep link: no ${ref.kind} "${ref.key}" in any loaded catalog after ` +
        `${DEEP_LINK_TIMEOUT_MS / 1000}s — staying at the default view.`)
      deepLinkPending = false
      return
    }
    setTimeout(attempt, DEEP_LINK_RETRY_MS)
  }
  attempt() // the first try is synchronous — curated targets can resolve without any delay
}

/** Camera-only restore, for an orbit link with no focus (or one whose focus never resolved). */
function applyOrbitCamera(view: ViewState): void {
  if (view.d !== undefined) controls.setFocus(controls.focus, view.d)
  if (view.yaw !== undefined || view.pitch !== undefined) {
    controls.setOrientation(view.yaw ?? controls.getYaw(), view.pitch ?? controls.getPitch())
  }
}

/**
 * Put the app into the state a link describes. The single apply path: startup and a hash edit in
 * an already-open tab go through exactly this, so the two can never drift apart.
 *
 * Order matters. The clock is set before the camera so that whatever the camera lands on is
 * solved at the shared instant rather than at "now" for one frame first.
 */
function applyViewState(view: ViewState): void {
  if (view.t) clock.setDate(new Date(view.t))
  // Pause is deliberately NOT part of the URL and is left alone here: a paused clock stays
  // paused, now sitting at the shared date, which is what someone studying a moment wants.
  if (view.rate !== undefined) timeControls.setRate(view.rate)

  if (view.mode === 'sky') {
    // Sky view owns the camera outright (position pinned to Earth, orientation and FOV straight
    // from skyControls), so there is nothing to wait for — no catalog is involved in aiming.
    cancelPendingDeepLink() // an orbit link still resolving must not surface behind sky view
    enterSky() // no-op if already in sky mode
    skyControls.setOrientation(view.yaw ?? 0, view.pitch ?? 0)
    if (view.fov !== undefined) skyControls.fov = view.fov
  } else {
    exitSky() // no-op if already in orbit mode
    if (view.focus) resolveDeepLinkFocus(view.focus, view)
    else { cancelPendingDeepLink(); applyOrbitCamera(view) }
  }
}

if (initialView) applyViewState(initialView)

/** The view as it stands right now, in the form a URL records. */
function currentViewState(): ViewState {
  const s: ViewState = { mode, t: clock.now().toISOString(), rate: clock.getRate() }
  if (mode === 'sky') {
    s.yaw = skyControls.getYaw()
    s.pitch = skyControls.getPitch()
    s.fov = skyControls.fov
  } else {
    if (currentFocusRef) s.focus = currentFocusRef
    s.d = controls.distance
    s.yaw = controls.getYaw()
    s.pitch = controls.getPitch()
  }
  return s
}

let lastWrittenHash = ''

/**
 * Writes the current view into the address bar with replaceState — the fragment only, as a
 * RELATIVE url, so the deployment subpath (GitHub Pages serves this at /cosmos/) is untouched.
 * replaceState rather than pushState: this fires once a second, and burying the back button
 * under a thousand camera positions would make leaving the page impossible.
 *
 * Normally suppressed mid-drag and mid-fly — those are transitional states nobody means to
 * share, and rewriting the URL 60 times during a fly-to is pure noise. `force` is the 🔗
 * button's path: an explicit share means "this instant", whatever the camera is doing.
 */
function updateUrl(force = false): void {
  if (!force) {
    if (deepLinkPending || flyer.isActive()) return
    if (controls.isDragging() || skyControls.isDragging()) return
  }
  const hash = encodeViewState(currentViewState())
  if (hash === lastWrittenHash) return
  lastWrittenHash = hash
  history.replaceState(null, '', '#' + hash)
}

document.getElementById('share-link')!.addEventListener('click', () => {
  updateUrl(true) // the address bar may be up to a second stale, or never written at all
  const url = location.href
  // A click is a user gesture, so the clipboard permission is satisfied — but the API itself is
  // absent outside a secure context (plain http on a LAN address, say). Both the missing-API and
  // rejected-promise paths fall back to showing the URL in the toast, which is at least
  // selectable and copyable by hand.
  const copied = navigator.clipboard?.writeText(url)
  if (copied) copied.then(() => showToast('Link copied'), () => showToast(url, 8000))
  else showToast(url, 8000)
})

/**
 * A link pasted into the address bar of an ALREADY-OPEN tab.
 *
 * Changing only the fragment is a same-document navigation: nothing reloads, this module never
 * re-runs, and without this listener the pasted link would sit there for up to a second and then
 * be silently overwritten by the writer — the app would look broken in the one case a user is
 * most likely to try by hand.
 *
 * replaceState does not fire hashchange, so the writer cannot trigger this. The lastWrittenHash
 * comparison is belt-and-braces on that, and additionally makes re-entering the identical URL a
 * no-op instead of a pointless re-apply. An undecodable fragment is ignored outright rather than
 * yanking the user out of a view they are looking at — that case is only reachable by someone
 * hand-editing the URL into nonsense, and leaving the app where it is is the kinder answer.
 */
window.addEventListener('hashchange', () => {
  if (location.hash.replace(/^#/, '') === lastWrittenHash) return
  const view = decodeViewState(location.hash)
  if (!view) return
  applyViewState(view)
})
// ----------------------------------------------------------------------------------------------

// --- Hover labels for notable objects ------------------------------------------------------
// Cursor proximity reveals a floating name label for the things this project treats as landmarks:
// every planet and moon, the four spacecraft, the twelve famous asteroids, the curated galaxies
// and deep-sky objects, and named stars that are actually BRIGHT from where the camera is.
//
// Explicitly NOT labelled: OpenNGC (12.4k objects), galaxies.bin, the 486k-asteroid belt, the
// Milky Way layers, and the 728k unnamed/faint stars. Those are bulk texture, not destinations —
// labelling them would turn every pointer move into a wall of text. The candidate set built here
// is ~380 objects at its largest, so the whole pass is a few hundred vector projections.
//
// The label is also the click target: whatever is labelled is what a click focuses (see the click
// handler below), so "what you see is what you get" holds instead of the label and the click
// disagreeing about what the cursor is over.

/** A hover candidate plus the SearchEntry focusing it would use — clicking a label therefore takes
 *  exactly the same code path as picking the object out of the search box (focusEntry). */
type HoverTarget = HoverCandidate & { entry: SearchEntry }

const HOVER_RADIUS_PX = 16
/** ~30 Hz. Cheap enough that the cap is about not doing pointless work on a high-rate mouse
 *  (pointermove can fire at the display's refresh rate or faster), not about cost pressure. */
const HOVER_THROTTLE_MS = 33
/** A named star gets a label only when it is at least this bright FROM THE CAMERA. Deliberately
 *  the same cutoff as the glare halos (brightStars.ts): the stars that visibly sparkle are exactly
 *  the ones the user means by "major stars close by". Being camera-relative (not Earth-relative)
 *  is what makes this behave correctly after flying somewhere else — a star you have approached
 *  becomes hoverable, and from a Mpc out nothing stellar is. */
const HOVER_STAR_MAG_LIMIT = HALO_MAG_LIMIT

// Static true positions (heliocentric EQJ AU), computed once — these objects never move.
const galaxyHoverTargets = GALAXIES.map((def) => {
  const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distMpc)
  return {
    pos: new THREE.Vector3(x * MPC_TO_AU, y * MPC_TO_AU, z * MPC_TO_AU),
    entry: { name: def.name, kind: 'galaxy' as const, key: def.id, mag: -26 },
  }
})
const deepSkyHoverTargets = DEEP_SKY.map((def) => {
  const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distPc)
  return {
    pos: new THREE.Vector3(x * PC_TO_AU, y * PC_TO_AU, z * PC_TO_AU),
    entry: { name: def.name, kind: 'dso' as const, key: def.id, mag: -26 },
  }
})
const planetHoverTargets = planets.map((node) => ({
  node,
  // The Sun keeps planet PRIORITY (it is a solid body you fly to, not a catalog point) but is
  // labelled "star", matching how the search box labels it.
  kind: (node.def.parent != null ? 'moon' : 'planet') as HoverKind,
  label: node.def.id === 'sun' ? 'star' : node.def.parent != null ? 'moon' : 'planet',
  entry: { name: node.def.name, kind: 'planet' as const, key: node.def.id, mag: -30 },
}))
// The live-position layers join once their (deferred) loads land, same pattern as their search
// entries: an empty array until then, so hover simply has fewer candidates early on.
const asteroidHoverTargets: { index: number; entry: SearchEntry }[] = []
asteroidPromise.then((field) => {
  if (!field) return
  for (const { def, index } of famousAsteroidEntries(field)) {
    asteroidHoverTargets.push({ index, entry: { name: def.name, kind: 'asteroid', key: def.id, mag: -26 } })
  }
})
const spacecraftHoverTargets: { def: SpacecraftDef; entry: SearchEntry }[] = []
spacecraftPromise.then((field) => {
  if (!field) return
  for (const def of field.defs) {
    spacecraftHoverTargets.push({ def, entry: { name: def.name, kind: 'spacecraft', key: def.id, mag: -26 } })
  }
})

const hoverProj = new THREE.Vector3() // reused by every projection in the pass — no allocation

/** Projects one true heliocentric position (AU) to CSS pixels and appends it as a candidate.
 *  Drops anything behind the camera, and anything that projects to a non-finite point — which is
 *  what happens to a body sitting exactly at the camera (Earth in sky view: clip w = 0). */
function pushHoverCandidate(
  out: HoverTarget[], tx: number, ty: number, tz: number,
  name: string, kind: HoverKind, entry: SearchEntry, label?: string,
): void {
  hoverProj.set(tx - camTruePos.x, ty - camTruePos.y, tz - camTruePos.z).project(engine.camera)
  if (hoverProj.z > 1) return
  const sx = (hoverProj.x * 0.5 + 0.5) * window.innerWidth
  const sy = (-hoverProj.y * 0.5 + 0.5) * window.innerHeight
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
  out.push({ name, kind, label, sx, sy, priority: HOVER_PRIORITY[kind], entry })
}

const hoverScratch = new THREE.Vector3()

/** Builds this pass's candidate set: everything notable that is currently on screen. */
function hoverCandidates(): HoverTarget[] {
  const out: HoverTarget[] = []
  for (const t of planetHoverTargets) {
    const p = t.node.truePos
    pushHoverCandidate(out, p.x, p.y, p.z, t.node.def.name, t.kind, t.entry, t.label)
  }
  for (const t of spacecraftHoverTargets) {
    const p = spacecraftPositionAt(t.def, dateToJd(clock.now()))
    pushHoverCandidate(out, p.x, p.y, p.z, t.def.name, 'spacecraft', t.entry)
  }
  if (asteroids) {
    const jd = dateToJd(clock.now())
    for (const t of asteroidHoverTargets) {
      const p = asteroids.positionAt(t.index, jd, hoverScratch)
      pushHoverCandidate(out, p.x, p.y, p.z, t.entry.name, 'asteroid', t.entry)
    }
  }
  for (const t of galaxyHoverTargets) {
    pushHoverCandidate(out, t.pos.x, t.pos.y, t.pos.z, t.entry.name, 'galaxy', t.entry)
  }
  for (const t of deepSkyHoverTargets) {
    pushHoverCandidate(out, t.pos.x, t.pos.y, t.pos.z, t.entry.name, 'dso', t.entry, 'deep sky')
  }
  if (stars) {
    const absMag = stars.catalog.absMag
    // Through starTruePosAu, not catalog.positions: a hover label has to sit on the star as the
    // shader draws it, which at 10 kyr/s is somewhere quite different from its epoch position.
    const years = yearsFromEpoch(clock.now())
    for (const t of starHoverList) {
      starTruePosAu(stars.catalog, t.idx, years, scratchStarPos)
      const { x, y, z } = scratchStarPos
      const distPc = Math.hypot(x - camTruePos.x, y - camTruePos.y, z - camTruePos.z) / PC_TO_AU
      const appMag = apparentMagnitude(absMag[t.idx], distPc)
      if (!Number.isFinite(appMag) || appMag > HOVER_STAR_MAG_LIMIT) continue
      pushHoverCandidate(out, x, y, z, t.name, 'star', t.entry)
    }
  }
  return out
}

const hoverLabel = document.getElementById('hover-label')!
const hoverNameEl = hoverLabel.querySelector('.hover-name')!
const hoverKindEl = hoverLabel.querySelector('.hover-kind')!
let hoverPointerDown = false
let hoverInside = false // is the cursor over the canvas at all?
let hoverMx = 0
let hoverMy = 0
let lastHoverMs = 0
let hoverShown = false
// Measuring the label costs a forced layout, so its size is cached and only re-measured when the
// text actually changes — which is on the order of once per hovered object, not once per pass.
let hoverMeasuredText = ''
let hoverW = 0
let hoverH = 0

function hideHoverLabel(): void {
  if (!hoverShown) return // idempotent: the per-frame path calls this on most frames
  hoverShown = false
  hoverLabel.style.opacity = '0'
  engine.renderer.domElement.style.cursor = ''
}

function updateHoverLabel(mx: number, my: number): void {
  const pick = pickNearest(hoverCandidates(), mx, my, HOVER_RADIUS_PX)
  if (!pick) { hideHoverLabel(); return }
  const text = `${pick.name} · ${pick.label ?? pick.kind}`
  if (text !== hoverMeasuredText) {
    hoverNameEl.textContent = pick.name
    hoverKindEl.textContent = ` · ${pick.label ?? pick.kind}`
    hoverMeasuredText = text
    hoverW = hoverLabel.offsetWidth
    hoverH = hoverLabel.offsetHeight
  }
  const { x, y } = placeLabel(pick.sx, pick.sy, hoverW, hoverH, window.innerWidth, window.innerHeight)
  hoverLabel.style.left = `${x}px`
  hoverLabel.style.top = `${y}px`
  if (!hoverShown) {
    hoverShown = true
    hoverLabel.style.opacity = '1'
    engine.renderer.domElement.style.cursor = 'pointer'
  }
}

/** One hover pass at the last known cursor position, subject to the throttle and the suppression
 *  rules. Driven BOTH by pointermove (so the label reacts immediately to the cursor) and by
 *  frame() (so it keeps up with a moving target — a moon at 1 day/s, a spacecraft, the whole sky
 *  settling after a fly-to — under a cursor that is not moving at all). */
function refreshHover(): void {
  // No labels mid-drag (the cursor is steering the camera, not pointing at anything) or during a
  // fly-to (the whole scene is sweeping past — every label would be noise, and stale by the time
  // it is drawn).
  if (!hoverInside || hoverPointerDown || flyer.isActive()) { hideHoverLabel(); return }
  const now = performance.now()
  if (now - lastHoverMs < HOVER_THROTTLE_MS) return
  lastHoverMs = now
  updateHoverLabel(hoverMx, hoverMy)
}

engine.renderer.domElement.addEventListener('pointermove', (ev) => {
  hoverInside = true
  hoverMx = ev.clientX; hoverMy = ev.clientY
  refreshHover()
})
engine.renderer.domElement.addEventListener('pointerleave', () => {
  hoverInside = false
  hideHoverLabel()
})
window.addEventListener('pointerup', () => { hoverPointerDown = false })
window.addEventListener('pointercancel', () => { hoverPointerDown = false })
// -------------------------------------------------------------------------------------------

// click-to-focus: whatever the hover label is offering (see above); planets via raycast otherwise
const raycaster = new THREE.Raycaster()
// camera drags synthesize a click on release — suppress those (>5 px pointer travel)
let downX = 0
let downY = 0
engine.renderer.domElement.addEventListener('pointerdown', (ev) => {
  downX = ev.clientX; downY = ev.clientY
  hoverPointerDown = true
  hideHoverLabel()
})
engine.renderer.domElement.addEventListener('click', (ev) => {
  if (mode === 'sky') return // click-to-focus is disabled entirely in sky mode
  if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 5) return
  if (flyer.isActive()) return
  // Hover pick first, re-run at the click's own coordinates: the label and the click must never
  // disagree about what the cursor is over. This subsumes the old named-star proximity loop that
  // used to live at the bottom of this handler, and additionally makes moons, spacecraft, famous
  // asteroids, curated galaxies and deep-sky objects clickable — everything the label offers.
  const pick = pickNearest(hoverCandidates(), ev.clientX, ev.clientY, HOVER_RADIUS_PX)
  if (pick) {
    hideHoverLabel()
    // focusEntry already clears the spacecraft trajectory focus, shows the right card and starts
    // the right fly-to per kind. Re-focusing what is already focused would just re-fly in place.
    if (pick.name !== controls.focus.name) focusEntry(pick.entry)
    return
  }
  const ndc = new THREE.Vector2(
    (ev.clientX / window.innerWidth) * 2 - 1,
    -(ev.clientY / window.innerHeight) * 2 + 1)
  // Fallback: a planet whose disc is under the cursor but whose CENTRE is more than the hover
  // radius away — i.e. you have flown close enough that it fills a good part of the screen.
  raycaster.setFromCamera(ndc, engine.camera)
  const hit = raycaster.intersectObjects(planets.map(p => p.mesh))[0]
  if (hit) {
    const node = planets.find(p => p.mesh === hit.object)!
    if (node.def.name !== controls.focus.name) {
      cancelPendingDeepLink() // disc-raycast fallback is user navigation too — abandon any pending link
      spacecraft?.setFocused(null)
      flyer.start(planetFocusable(node), node.def.radiusAu * 8)
      currentFocusRef = { kind: 'planet', key: node.def.id } // keep the shareable URL truthful
      showPlanetCard(node.def)
    }
    return
  }
})

let lastMs = 0
// Dynamic resolution governor: steps engine.renderer's pixel ratio down under sustained load
// (EMA frame time > 22ms for 60 consecutive frames) and back up once comfortably fast again
// (EMA < 12ms for 300 consecutive frames) — see resolutionGovernor.ts for the pure step logic.
const resolutionGovernor = new ResolutionGovernor()

// ~1 Hz throttle for the exterior-Milky-Way lazy-load check (startMilkyWayExtLoad above) — cheap
// enough to run every frame, but there's no reason to re-check camera distance 60x/sec for a
// one-shot trigger. Same throttle shape as objectImagery's own proximity sweep.
let milkyWayExtCheckAccumS = 0
const MILKY_WAY_EXT_CHECK_INTERVAL_S = 1

// ~1 Hz throttle for the deep-link URL writer (updateUrl above). Its own accumulator rather than
// sharing the Milky Way one: that check latches off permanently after the exterior layer loads,
// and the URL has to keep tracking for the whole session.
let urlWriteAccumS = 0
const URL_WRITE_INTERVAL_S = 1

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
  milkyWayExtCheckAccumS += dt
  if (milkyWayExtCheckAccumS >= MILKY_WAY_EXT_CHECK_INTERVAL_S) {
    milkyWayExtCheckAccumS = 0
    if (!milkyWayExtLoadStarted && camTruePos.length() > MILKY_WAY_EXT_TRIGGER_AU) startMilkyWayExtLoad()
  }
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
    // Constellation figures only mean anything near their own epoch — see constellationsValidAt.
    // Two cheap comparisons per frame, and the hint says why the lines went away rather than
    // leaving the user to wonder whether something broke.
    const figuresValid = constellationsValidAt(simNow)
    if (figuresValid !== constellationsShown) {
      constellationsShown = figuresValid
      constellations?.setVisible(figuresValid)
      skyHint.textContent = figuresValid ? SKY_HINT_BASE : SKY_HINT_EPOCH_LOCKED
    }
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

  // Hover labels re-pick every frame (throttled inside refreshHover), not only on pointermove, so
  // a label stays glued to a target that is moving under a stationary cursor — a moon at 1 day/s,
  // a spacecraft, or the whole scene settling at the end of a fly-to. Placed here because it
  // projects with THIS frame's camera matrices (updateMatrixWorld above refreshes
  // matrixWorldInverse, which Vector3.project reads).
  refreshHover()

  // Point layers update AFTER the camera transform block above (and its updateMatrixWorld): each
  // one frustum-culls its spatial chunks against camera.projectionMatrix * matrixWorldInverse, so
  // it needs THIS frame's orientation/FOV, not the previous frame's. Nothing between the old call
  // site and here reads the layers (they only write shader uniforms + per-chunk visibility), so
  // the move is behaviour-neutral apart from the culling being one frame fresher.
  // One number drives proper motion for every point layer. The star layer's velocities are real
  // and it deforms; the galaxy and Milky Way catalogs are format v1, so their velocity attribute
  // is all zeros and the same uniform multiplies out to nothing — same shader, no branch.
  const simYears = yearsFromEpoch(simNow)
  stars?.update(camTruePos, la.stars, engine.camera, simYears)
  // Halos ride the star layer's own crossfade, and need the CURRENT fov (sky view zooms it) plus
  // the framebuffer height (window resize / dynamic-resolution governor) to hold a fixed angular
  // size — and the same epoch offset, so a halo stays on its star.
  brightStars?.update(camTruePos, la.stars, engine.camera, engine.renderer.domElement.height, simYears)
  milkyWay?.update(camTruePos, la.milkyWay, engine.camera, simYears)
  milkyWayExt?.update(camTruePos, la.milkyWayExt, engine.camera, simYears)
  galaxies?.update(camTruePos, la.galaxies, engine.camera, simYears)
  // Asteroids are exempt from layerAlphas: the belt is a solar-system-scale object, not a
  // galactic one, so it gets its own hard 100 AU distance gate inside the layer rather than a
  // crossfade tuned for kpc-scale ramps.
  asteroids?.update(simNow, camTruePos)
  spacecraft?.update(simNow, camTruePos)

  hudName.textContent = controls.focus.name
  hudDist.textContent = formatDistance(controls.distance)

  // Keep the address bar shareable. Placed after the camera/controls work above so it records
  // THIS frame's view, and throttled to 1 Hz — updateUrl additionally no-ops when the encoded
  // state is byte-identical to the last one written, so a parked camera with a paused clock
  // stops touching history entirely.
  urlWriteAccumS += dt
  if (urlWriteAccumS >= URL_WRITE_INTERVAL_S) {
    urlWriteAccumS = 0
    updateUrl()
  }

  engine.composer.render()
  // Kicked only once (the call is guarded): the belt's 17 MB fetch and buffer build wait until a
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
