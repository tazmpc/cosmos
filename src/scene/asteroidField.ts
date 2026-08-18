import * as THREE from 'three'
import { decodeAsteroids, type AsteroidCatalog } from '../data/asteroidFormat'
import { elementsToHeliocentricEqjInto, dateToJd, type OrbitalElements, type Xyz } from '../sim/kepler'
import type { Focusable } from '../engine/cameraControls'
import { FAMOUS_ASTEROIDS } from '../data/asteroids'

/**
 * The asteroid belt: ~206k MPCORB orbits (public/asteroids.bin) propagated live.
 *
 * Unlike every other point layer in this project, these positions are NOT baked — each object's
 * place is solved from its Keplerian elements at the current sim time, so the belt actually
 * orbits, and shears (inner objects faster) when the clock is sped up.
 *
 * Solving 206k orbits every frame would cost ~15 ms, so the layer uses a ROLLING CURSOR: each
 * frame it walks a fixed slice of the catalog (CHUNK_PER_FRAME) and re-solves only the objects
 * in that slice whose last solution is more than RESOLVE_THRESHOLD_DAYS stale. A full sweep of
 * the catalog therefore takes ceil(count / CHUNK_PER_FRAME) frames — about 9 at 206k — which is
 * ~150 ms of lag on the freshest-vs-stalest object. At real-time rates that lag is invisible
 * (the belt moves ~0.0000002 AU in 150 ms); at 1 month/second it is the reason the belt shears
 * smoothly instead of stepping.
 *
 * The staleness test is what makes this cheap at normal speed: after the first sweep, every
 * object is fresh and the cursor's slice costs 25k float comparisons and zero Kepler solves
 * until sim time has moved half a day.
 */

/** Objects visited by the rolling cursor per frame. Sized so the worst case — every object in the
 *  slice needing a re-solve, which is what sustained fast time compression produces — stays inside
 *  a 2 ms budget. Measured on this machine at ~0.21 us per solve (10k solves came out at a 2.1 ms
 *  median, marginally over), so the slice is 8k — ~1.7 ms — and a full sweep of ~206k objects
 *  takes 26 frames.
 *
 *  That sweep length is a per-object position lag of up to 26 frames, i.e. ~13 sim-days at
 *  1 month/second. It is invisible rather than merely tolerable: the lag shifts each object along
 *  its own orbit, which is the direction the belt is already uniformly populated in, so it reads
 *  as nothing at all rather than as a moving seam. */
const CHUNK_PER_FRAME = 8_000

/** Re-solve an object once sim time has moved this far from its last solution. Half a day moves
 *  a main-belt asteroid ~0.002 AU — sub-pixel at any distance the belt is visible from. */
const RESOLVE_THRESHOLD_DAYS = 0.5

/** The layer is drawn only inside this heliocentric radius. Past ~100 AU the whole belt subtends
 *  a few pixels and contributes nothing but a smear, and skipping it also skips the propagation
 *  cost entirely while the camera is out among the stars. */
const VISIBLE_MAX_AU = 100

/** Sentinel "never solved" staleness, far beyond any real sim-time offset. */
const NEVER_SOLVED = -1e30

const VERT = /* glsl */ `
  uniform vec3 uCamAu;      // camera heliocentric position, AU
  uniform float uPixelRatio;
  attribute float aSize;    // screen-space point size in px, precomputed from H
  varying float vFade;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // Floating origin: the GL camera sits at the origin, so every position is submitted
    // camera-relative. Positions are already in AU, so unlike the star layers there is no unit
    // conversion here.
    vec3 relAu = position - uCamAu;
    vec4 mv = modelViewMatrix * vec4(relAu, 1.0);
    gl_Position = projectionMatrix * mv;

    #include <logdepthbuf_vertex>

    gl_PointSize = aSize * uPixelRatio;
    vFade = 1.0;
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vFade;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float edge = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(uColor, uAlpha * edge * vFade);
    if (gl_FragColor.a < 0.004) discard;

    #include <logdepthbuf_fragment>
  }
`

/** Rocky grey-tan. Asteroids are NOT stars — their H is an albedo-and-size measure in the
 *  asteroid (H, G) system, not a stellar luminosity, so the star shader's apparent-magnitude
 *  brightness model does not apply and this layer uses its own flat-colour material. */
const ASTEROID_COLOR = new THREE.Color(0.74, 0.68, 0.57)
const ASTEROID_ALPHA = 0.55

/** Screen-space size in px from absolute magnitude: brighter (smaller H) = bigger, clamped to
 *  1-3 px. H 5 -> 3 px (the handful of giants), H 10 -> 2 px, H >= 15 -> 1 px (the bulk). */
function sizeFromH(H: number): number {
  return Math.max(1, Math.min(3, 4 - 0.2 * H))
}

export interface AsteroidField {
  points: THREE.Points
  catalog: AsteroidCatalog
  /** IAU minor-planet number -> index into `catalog`, for the named few (asteroidnames.json). */
  indexByMpcNumber: Map<number, number>
  /** Heliocentric EQJ position (AU) of one object at a given Julian Date, solved on demand.
   *  Independent of the cadence buffer, so a focus target is always exactly current. */
  positionAt(index: number, jd: number, out: THREE.Vector3): THREE.Vector3
  /** Per-frame: advances the rolling cursor and updates the camera uniform.
   *  `simDate` is the sim clock's current time; `camTruePosAu` the camera's heliocentric position. */
  update(simDate: Date, camTruePosAu: THREE.Vector3): void
}

export async function loadAsteroidField(scene: THREE.Scene): Promise<AsteroidField> {
  const [binRes, namesRes] = await Promise.all([
    fetch(import.meta.env.BASE_URL + 'asteroids.bin'),
    fetch(import.meta.env.BASE_URL + 'asteroidnames.json'),
  ])
  if (!binRes.ok) throw new Error('asteroids.bin fetch failed')
  if (!namesRes.ok) throw new Error('asteroidnames.json fetch failed')
  const catalog = decodeAsteroids(await binRes.arrayBuffer())
  const diskNames = (await namesRes.json()) as Record<string, number>

  const indexByMpcNumber = new Map<number, number>()
  for (const [num, idx] of Object.entries(diskNames)) {
    if (idx >= 0 && idx < catalog.count) indexByMpcNumber.set(Number(num), idx)
  }

  const count = catalog.count
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  for (let i = 0; i < count; i++) sizes[i] = sizeFromH(catalog.H[i])

  const posAttr = new THREE.BufferAttribute(positions, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', posAttr)
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamAu: { value: new THREE.Vector3() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uColor: { value: ASTEROID_COLOR },
      uAlpha: { value: ASTEROID_ALPHA },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const points = new THREE.Points(geo, mat)
  // Positions are rewritten continuously and are camera-relative only inside the shader, so
  // three's own bounding-sphere culling would be both stale and computed in the wrong space.
  points.frustumCulled = false
  points.matrixAutoUpdate = false
  points.visible = false // until the first update() decides
  scene.add(points)

  // Per-object staleness, stored as an offset from the catalog's base epoch rather than as a raw
  // Julian Date: a JD is ~2.46e6, and an f32 only resolves that to ~0.25 day — coarser than the
  // 0.5-day threshold being tested. Offsets are small, so the same f32 keeps sub-second precision.
  const lastSolvedOffset = new Float32Array(count).fill(NEVER_SOLVED)

  // Reused scratch — see elementsToHeliocentricEqjInto's doc comment. One elements object and one
  // result object for the whole layer, so the per-frame propagation allocates nothing.
  const scratchEl: OrbitalElements = {
    a: 0, e: 0, i: 0, Omega: 0, omega: 0, M0: 0, epochJd: 0, nDegDay: 0,
  }
  const scratchOut: Xyz = { x: 0, y: 0, z: 0 }

  function loadElements(index: number): OrbitalElements {
    scratchEl.a = catalog.a[index]
    scratchEl.e = catalog.e[index]
    scratchEl.i = catalog.i[index]
    scratchEl.Omega = catalog.Omega[index]
    scratchEl.omega = catalog.omega[index]
    scratchEl.M0 = catalog.M0[index]
    scratchEl.nDegDay = catalog.nDegDay[index]
    scratchEl.epochJd = catalog.baseEpochJd + catalog.epochOffsetDays[index]
    return scratchEl
  }

  let cursor = 0

  return {
    points, catalog, indexByMpcNumber,

    positionAt(index, jd, out) {
      elementsToHeliocentricEqjInto(loadElements(index), jd, scratchOut)
      return out.set(scratchOut.x, scratchOut.y, scratchOut.z)
    },

    update(simDate, camTruePosAu) {
      ;(mat.uniforms.uCamAu.value as THREE.Vector3).copy(camTruePosAu)
      const visible = camTruePosAu.length() < VISIBLE_MAX_AU
      points.visible = visible
      // Hidden means no propagation at all — the layer's whole cost drops to this length check
      // while the camera is out among the stars. Positions go stale, but the cursor re-solves
      // every object within one full sweep (~9 frames) of becoming visible again.
      if (!visible) return

      const jd = dateToJd(simDate)
      const simOffset = jd - catalog.baseEpochJd
      const t0 = import.meta.env.DEV ? performance.now() : 0

      const start = cursor
      const n = Math.min(CHUNK_PER_FRAME, count)
      let solved = 0
      for (let k = 0; k < n; k++) {
        let i = start + k
        if (i >= count) i -= count
        if (Math.abs(simOffset - lastSolvedOffset[i]) <= RESOLVE_THRESHOLD_DAYS) continue
        elementsToHeliocentricEqjInto(loadElements(i), jd, scratchOut)
        positions[i * 3] = scratchOut.x
        positions[i * 3 + 1] = scratchOut.y
        positions[i * 3 + 2] = scratchOut.z
        lastSolvedOffset[i] = simOffset
        solved++
      }

      if (solved > 0) {
        // Upload only the slice the cursor walked (element units, not vertices), splitting into
        // two ranges when the slice wraps past the end of the buffer. Uploading the whole 2.5 MB
        // position buffer every frame instead is measurably worse for no benefit.
        const end = start + n
        if (end <= count) {
          posAttr.addUpdateRange(start * 3, n * 3)
        } else {
          posAttr.addUpdateRange(start * 3, (count - start) * 3)
          posAttr.addUpdateRange(0, (end - count) * 3)
        }
        posAttr.needsUpdate = true
      }

      cursor = (start + n) % count

      if (import.meta.env.DEV) {
        const w = window as unknown as { __cosmosAsteroids?: Record<string, number> }
        w.__cosmosAsteroids = {
          count, chunk: n, solvedThisFrame: solved,
          solveMs: Number((performance.now() - t0).toFixed(3)),
          sweepFrames: Math.ceil(count / CHUNK_PER_FRAME),
        }
      }
    },
  }
}

/** Closest allowed camera approach, AU. These bodies are 0.3-940 km across — far below one pixel
 *  at any distance — so the limit is about framing the belt around the target, not clearing
 *  geometry. ~1.5e5 km. */
export const ASTEROID_MIN_APPROACH_AU = 1e-3

/** Fly-to arrival distance, AU (~3M km): close enough that the target is unambiguous, far enough
 *  that its neighbours in the belt are still in frame. */
export const ASTEROID_ARRIVE_AU = 0.02

/**
 * A Focusable that re-solves the asteroid's orbit every time it is asked where it is — so the
 * camera tracks the body as sim time advances, exactly like the planets' live ephemeris
 * Focusables, rather than freezing at the position it had when the fly-to started.
 */
export function asteroidFocusable(
  field: AsteroidField, index: number, name: string, getDate: () => Date,
): Focusable {
  return {
    name,
    getPosition: (out) => field.positionAt(index, dateToJd(getDate()), out),
    minApproachAu: ASTEROID_MIN_APPROACH_AU,
  }
}

/** Orbit numbers for an info card, read straight out of the binary the renderer is propagating
 *  (rather than duplicated by hand in asteroids.ts, where they could silently drift from it). */
export function asteroidOrbitSummary(field: AsteroidField, index: number): {
  aAu: number; e: number; iDeg: number; periodYears: number
} {
  const c = field.catalog
  return {
    aAu: c.a[index],
    e: c.e[index],
    iDeg: c.i[index],
    periodYears: 360 / c.nDegDay[index] / 365.25,
  }
}

/** The famous asteroids actually present in the loaded binary, paired with their catalog index. */
export function famousAsteroidEntries(field: AsteroidField): { def: (typeof FAMOUS_ASTEROIDS)[number]; index: number }[] {
  return FAMOUS_ASTEROIDS
    .map((def) => ({ def, index: field.indexByMpcNumber.get(def.mpcNumber) }))
    .filter((x): x is { def: (typeof FAMOUS_ASTEROIDS)[number]; index: number } => x.index !== undefined)
}
