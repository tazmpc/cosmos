import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import { getRenderPixelRatio } from '../engine/renderer'
import { interpolateTrajectory } from '../sim/trajectory'
import { dateToJd } from '../sim/kepler'

/** One row of public/spacecraft.json (scripts/build-spacecraft.ts) — a JPL Horizons position
 *  history for one spacecraft, heliocentric EQJ AU, plus hand-written facts. */
export interface SpacecraftDef {
  id: string
  name: string
  jdSamples: number[]
  xyz: number[] // flat [x0,y0,z0, x1,y1,z1, ...], same length semantics as jdSamples
  launchDate: string
  facts: Record<string, string>
}

/** Closest allowed camera approach, AU (~1,500 km) — these are all a few meters to tens of
 *  meters across, far below one pixel at any sane framing distance, so this is about not letting
 *  the camera clip through the trajectory line rather than clearing real geometry. */
export const SPACECRAFT_MIN_APPROACH_AU = 1e-5

/** Fly-to arrival distance, AU (~75,000 km) — close enough to read as "arrived", far enough that
 *  the trajectory polyline is still visible around the craft. */
export const SPACECRAFT_ARRIVE_AU = 5e-4

async function loadDefs(): Promise<SpacecraftDef[]> {
  const res = await fetch(import.meta.env.BASE_URL + 'spacecraft.json')
  if (!res.ok) throw new Error(`spacecraft.json fetch failed: HTTP ${res.status}`)
  return (await res.json()) as SpacecraftDef[]
}

/** Solves one craft's position at Julian Date `jd`, AU, heliocentric EQJ. Pure — no THREE — so
 *  cards and Focusables can call it directly. */
export function spacecraftPositionAt(def: SpacecraftDef, jd: number): THREE.Vector3 {
  const p = interpolateTrajectory(def.jdSamples, def.xyz, jd)
  return new THREE.Vector3(p.x, p.y, p.z)
}

/** Heliocentric EQJ origin — the Sun sits at (0,0,0) in this project's frame. Returned as a shared
 *  reference (never mutated) for spacecraftFocusable's aimAnchor: the fly-to auto-aim reads it
 *  once, synchronously, on arrival — see FlyToAnimator.update. */
const SUN_ORIGIN = new THREE.Vector3(0, 0, 0)

/** A Focusable that re-solves the trajectory from clock.now() every time it's asked where the
 *  craft is — same pattern as the asteroid belt's asteroidFocusable, so a fly-to chases (and a
 *  parked camera keeps tracking) a spacecraft exactly as sim time advances. */
export function spacecraftFocusable(def: SpacecraftDef, getDate: () => Date): Focusable {
  return {
    name: def.name,
    getPosition: (out) => out.copy(spacecraftPositionAt(def, dateToJd(getDate()))),
    minApproachAu: SPACECRAFT_MIN_APPROACH_AU,
    // Auto-aim uses the Sun as the spacecraft's "parent" — same idea as a moon's parent planet.
    aimAnchor: () => SUN_ORIGIN,
  }
}

// ---- glyph texture ------------------------------------------------------------------------

/** Draws a bright dot with a short antenna-dish tick — a minimal, recognizably-not-a-star glyph,
 *  used as the point sprite texture for every craft (one shared texture, one draw call for all
 *  four — there are only ever a handful of spacecraft, but the pattern matches the other point
 *  layers in this project, which all use exactly one texture/material for their whole layer). */
function makeGlyphTexture(): THREE.CanvasTexture {
  const SIZE = 32
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d')!
  const cx = SIZE / 2
  const cy = SIZE / 2

  // Soft core, same radial-gradient recipe as the other glow sprites in this project.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.28)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.5, 'rgba(220,235,255,0.75)')
  core.addColorStop(1, 'rgba(220,235,255,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Antenna-dish tick: a short bright line off to one side, just enough to read as "a probe",
  // not a star. Angle is arbitrary — the sprite billboards to the camera, so there is no real
  // orientation to preserve.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = SIZE * 0.06
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + SIZE * 0.34, cy - SIZE * 0.30)
  ctx.stroke()

  const tex = new THREE.CanvasTexture(c)
  tex.needsUpdate = true
  return tex
}

// ---- shader: fixed-pixel-size point, honest depth ------------------------------------------
// Unlike the asteroid belt / bright-star halos (which are also THREE.Points but skip or fake
// depth), spacecraft render with THREE's normal depth test left on ("keep depth honest" per the
// plan) — there are only 4 of them, so there is no batching reason to disable it, and a probe
// really should be occluded by a planet it happens to pass behind.

const VERT = /* glsl */ `
  uniform vec3 uCamAu;
  uniform float uPixelSize; // fixed on-screen size, framebuffer px
  uniform float uPixelRatio;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec3 relAu = position - uCamAu;
    vec4 mv = modelViewMatrix * vec4(relAu, 1.0);
    gl_Position = projectionMatrix * mv;

    #include <logdepthbuf_vertex>

    gl_PointSize = uPixelSize * uPixelRatio;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlpha;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(tex.rgb, a);

    #include <logdepthbuf_fragment>
  }
`

/** Fixed on-screen glyph size, framebuffer px — the plan's "~10 px". */
const GLYPH_PIXEL_SIZE = 10

const TRAJECTORY_COLOR = 0x6a8aaa
const TRAJECTORY_OPACITY = 0.5

export interface SpacecraftField {
  defs: SpacecraftDef[]
  byId: Map<string, SpacecraftDef>
  /** Sets which craft's trajectory polyline is drawn (its id), or null to hide all of them —
   *  called on fly-to / on returning to some other focus. Per the plan, trajectories are visible
   *  only while a spacecraft is the current focus, to avoid cluttering the inner solar system
   *  with four permanent lines. */
  setFocused(id: string | null): void
  /** Per-frame: repositions the glyphs and the focused trajectory line. `simDate` is the sim
   *  clock's current time; `camTruePosAu` the camera's heliocentric position. */
  update(simDate: Date, camTruePosAu: THREE.Vector3): void
}

export async function loadSpacecraftField(scene: THREE.Scene): Promise<SpacecraftField> {
  const defs = await loadDefs()
  const byId = new Map(defs.map((d) => [d.id, d]))

  const texture = makeGlyphTexture()

  // ---- glyph points: one draw call for all craft -----------------------------------------
  const positions = new Float32Array(defs.length * 3)
  const posAttr = new THREE.BufferAttribute(positions, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', posAttr)

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamAu: { value: new THREE.Vector3() },
      uPixelSize: { value: GLYPH_PIXEL_SIZE },
      uPixelRatio: { value: getRenderPixelRatio() },
      uMap: { value: texture },
      uAlpha: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // depthTest stays at its default (true): "keep depth honest" — a probe passing behind a
    // planet should actually be occluded, unlike the belt/halo layers which trade that away for
    // batching thousands of points.
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // only 4 points, camera-relative — not worth a bounds check
  points.matrixAutoUpdate = false
  scene.add(points)

  // ---- trajectory polylines: one THREE.Line per craft, all hidden until focused ------------
  const lineMat = new THREE.LineBasicMaterial({
    color: TRAJECTORY_COLOR, transparent: true, opacity: TRAJECTORY_OPACITY,
  })
  const lines = new Map<string, THREE.Line>()
  for (const def of defs) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < def.jdSamples.length; i++) {
      pts.push(new THREE.Vector3(def.xyz[i * 3], def.xyz[i * 3 + 1], def.xyz[i * 3 + 2]))
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat)
    line.visible = false
    scene.add(line)
    lines.set(def.id, line)
  }

  let focusedId: string | null = null
  const truePos = new THREE.Vector3()

  return {
    defs, byId,

    setFocused(id) {
      focusedId = id
      for (const [lineId, line] of lines) line.visible = lineId === focusedId
    },

    update(simDate, camTruePosAu) {
      ;(mat.uniforms.uCamAu.value as THREE.Vector3).copy(camTruePosAu)
      mat.uniforms.uPixelRatio.value = getRenderPixelRatio()
      const jd = dateToJd(simDate)
      defs.forEach((def, i) => {
        truePos.copy(spacecraftPositionAt(def, jd))
        positions[i * 3] = truePos.x
        positions[i * 3 + 1] = truePos.y
        positions[i * 3 + 2] = truePos.z
      })
      posAttr.needsUpdate = true

      // The trajectory line's own vertices are baked in true heliocentric AU (Sun-centered, like
      // the planet orbit lines in orbits.ts), so re-expressing it camera-relative is just an
      // offset of the whole line by -camera, same as updateOrbitLines.
      const focused = focusedId ? lines.get(focusedId) : undefined
      if (focused) focused.position.set(-camTruePosAu.x, -camTruePosAu.y, -camTruePosAu.z)
    },
  }
}
