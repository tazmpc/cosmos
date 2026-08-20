import * as THREE from 'three'
import type { StarCatalog } from '../data/catalogFormat'
import { colorIndexToRgb } from '../data/starColor'
import { apparentMagnitude } from '../data/starMath'
import { PC_TO_AU } from '../data/units'

/** Only stars this bright (apparent magnitude AS SEEN FROM EARTH) get a halo. ~mag 3.5 is where
 *  a star stops reading as "a named thing you'd point at" — below it the sky just has a lot of
 *  stars, and haloing them all turns the view into a lens-flare field. */
export const HALO_MAG_LIMIT = 3.5
/** Hard cap on halo count, in case a catalog has far more bright entries than expected. */
export const HALO_MAX_COUNT = 300

export interface BrightStarPick {
  index: number   // index into the catalog (already chunk-reordered by loadPointLayer)
  appMag: number  // apparent magnitude from Earth
}

/** Picks the brightest-from-Earth stars in a catalog, brightest first. Pure — no THREE, no DOM —
 *  so the selection rule is unit-testable on its own. */
export function pickBrightStars(
  catalog: StarCatalog,
  magLimit: number = HALO_MAG_LIMIT,
  maxCount: number = HALO_MAX_COUNT,
): BrightStarPick[] {
  const picks: BrightStarPick[] = []
  for (let i = 0; i < catalog.count; i++) {
    const distPc = Math.hypot(
      catalog.positions[i * 3], catalog.positions[i * 3 + 1], catalog.positions[i * 3 + 2])
    if (!(distPc > 0)) continue // a zero-distance entry has no defined apparent magnitude
    const appMag = apparentMagnitude(catalog.absMag[i], distPc)
    if (!Number.isFinite(appMag) || appMag > magLimit) continue
    picks.push({ index: i, appMag })
  }
  picks.sort((a, b) => a.appMag - b.appMag || a.index - b.index)
  return picks.slice(0, maxCount)
}

/** Angular diameter of a size-factor-1.0 halo, in radians (~1.7 deg). Halos are a fixed ANGULAR
 *  size, not a fixed world size: a halo is a rendering of glare, which is a property of the eye
 *  and the optics, not of the star — so it must not grow as the camera flies toward the star. */
export const HALO_ANGULAR_RAD = 0.030
const HALO_MIN_OPACITY = 0.05
const HALO_MAX_OPACITY = 0.5
/** gl_PointSize ceiling (framebuffer px). Well under the ~1024 hardware minimum guarantee, and
 *  keeps a very wide FOV / very tall framebuffer from blowing a halo up into a screen-filling blob. */
const HALO_MAX_PIXELS = 160

/** Halo opacity from apparent magnitude. Deliberately a FLUX ramp, not a linear-in-magnitude one:
 *  over the -1.5..3.5 range these halos span, a linear ramp varies by less than 2x, so every halo
 *  would carry nearly the same weight and 200 of them would read as a lens-flare circus. On a flux
 *  ramp Sirius/Canopus/Vega/Arcturus visibly sparkle and a mag-3 star is a faint dot of glow. */
export function haloOpacity(appMag: number): number {
  const v = HALO_MAX_OPACITY * Math.pow(10, -0.28 * (appMag + 1.5))
  return Math.min(HALO_MAX_OPACITY, Math.max(HALO_MIN_OPACITY, v))
}

/** Size factor from opacity — brighter stars get a modestly wider halo as well as a brighter one
 *  (0.55x .. 1.45x), which is what makes the top few stars stand out as individuals. */
function haloSizeFactor(opacity: number): number {
  return 0.55 + 0.9 * (opacity / HALO_MAX_OPACITY)
}

const TEX_SIZE = 128

/** Soft radial core plus four thin cross spikes, drawn straight into an ImageData buffer.
 *  Canvas gradients can do the core but not a gaussian-thin spike, and at 128x128 (16k px) the
 *  per-pixel loop is far cheaper than the texture upload it feeds. */
function makeHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TEX_SIZE
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE)
  const px = img.data
  const c = TEX_SIZE / 2
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const dx = (x + 0.5 - c) / c // -1..1
      const dy = (y + 0.5 - c) / c
      const r = Math.hypot(dx, dy)
      const core = Math.exp(-((r / 0.085) ** 2)) + 0.32 * Math.exp(-((r / 0.26) ** 2))
      const spikeH = Math.exp(-((dy / 0.018) ** 2)) * Math.exp(-((dx / 0.60) ** 2))
      const spikeV = Math.exp(-((dx / 0.018) ** 2)) * Math.exp(-((dy / 0.60) ** 2))
      const a = Math.min(1, core + 0.5 * (spikeH + spikeV))
      const i = (y * TEX_SIZE + x) * 4
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255
      px[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

const VERT = /* glsl */ `
  uniform vec3 uCamPc;      // camera position, in parsecs
  uniform float uUnitToAu;  // parsecs -> AU
  uniform float uPixelSize; // framebuffer px for a halo of size factor 1.0
  uniform float uMaxPixels;
  uniform float uLayerAlpha;
  uniform float uYearsFromEpoch; // sim time minus the catalog's astrometric epoch, in years
  attribute vec3 haloColor;
  attribute vec3 starVel;   // proper motion, parsecs per year — keeps a halo on its own star
  attribute float haloOpacity;
  attribute float haloSize;
  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // Same proper-motion step as the star shader, and it has to be the same or a halo would stay
    // parked at its star's epoch position while the star itself drifted away from it.
    vec3 relAu = (position + starVel * uYearsFromEpoch - uCamPc) * uUnitToAu;
    vec4 mv = modelViewMatrix * vec4(relAu, 1.0);
    gl_Position = projectionMatrix * mv;

    #include <logdepthbuf_vertex>

    gl_PointSize = min(uPixelSize * haloSize, uMaxPixels);
    vColor = haloColor;
    vAlpha = haloOpacity * uLayerAlpha;
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor, a);

    #include <logdepthbuf_fragment>
  }
`

export interface BrightStarHalos {
  points: THREE.Points
  count: number
  /** Call each frame with the camera's true heliocentric position (AU), the star layer's
   *  crossfade alpha (halos ride `la.stars`), the camera (for its current vertical FOV — sky view
   *  zooms it), the framebuffer height in px (for the fixed-angular-size -> gl_PointSize
   *  conversion; it changes with window size AND with the dynamic-resolution governor), and the
   *  sim time in years from the catalog's astrometric epoch (so a halo rides its star's proper
   *  motion). */
  update(camTruePosAu: THREE.Vector3, layerAlpha: number, camera: THREE.PerspectiveCamera,
         drawingBufferHeight: number, yearsFromEpoch?: number): void
}

/** Adds glare halos — a soft core plus four thin diffraction spikes — to the brightest stars as
 *  seen from Earth. Drawn as ONE THREE.Points (a single draw call) rather than ~200 sprites: at
 *  this count sprites would roughly double the scene's per-frame draw-call submission cost for a
 *  purely decorative layer.
 *
 *  Sirius, Canopus, Vega and Arcturus are the intended payoff — the star field renders every star
 *  as a same-shaped dot clamped to the same 14 px maximum, so before this the brightest stars in
 *  the sky were visually indistinguishable from ordinary ones. */
export function createBrightStarHalos(scene: THREE.Scene, catalog: StarCatalog): BrightStarHalos {
  const picks = pickBrightStars(catalog)

  const positions = new Float32Array(picks.length * 3)
  const velocities = new Float32Array(picks.length * 3)
  const colors = new Float32Array(picks.length * 3)
  const opacities = new Float32Array(picks.length)
  const sizes = new Float32Array(picks.length)

  picks.forEach((p, n) => {
    positions[n * 3] = catalog.positions[p.index * 3]
    positions[n * 3 + 1] = catalog.positions[p.index * 3 + 1]
    positions[n * 3 + 2] = catalog.positions[p.index * 3 + 2]
    if (catalog.velocities !== undefined) {
      velocities[n * 3] = catalog.velocities[p.index * 3]
      velocities[n * 3 + 1] = catalog.velocities[p.index * 3 + 1]
      velocities[n * 3 + 2] = catalog.velocities[p.index * 3 + 2]
    }
    const [r, g, b] = colorIndexToRgb(catalog.colorIndex[p.index])
    colors[n * 3] = r; colors[n * 3 + 1] = g; colors[n * 3 + 2] = b
    const op = haloOpacity(p.appMag)
    opacities[n] = op
    sizes[n] = haloSizeFactor(op)
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('starVel', new THREE.BufferAttribute(velocities, 3))
  geo.setAttribute('haloColor', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('haloOpacity', new THREE.BufferAttribute(opacities, 1))
  geo.setAttribute('haloSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamPc: { value: new THREE.Vector3() },
      uUnitToAu: { value: PC_TO_AU },
      uPixelSize: { value: 32 },
      uMaxPixels: { value: HALO_MAX_PIXELS },
      uLayerAlpha: { value: 1 },
      uYearsFromEpoch: { value: 0 },
      uMap: { value: makeHaloTexture() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const points = new THREE.Points(geo, material)
  points.frustumCulled = false // positions are computed in the shader; three's bounds would be wrong
  points.matrixAutoUpdate = false
  points.visible = false
  scene.add(points)

  const camPc = new THREE.Vector3()

  return {
    points,
    count: picks.length,
    update(camTruePosAu, layerAlpha, camera, drawingBufferHeight, yearsFromEpoch = 0) {
      const visible = layerAlpha > 0.002 && picks.length > 0
      points.visible = visible
      if (!visible) return
      camPc.set(camTruePosAu.x / PC_TO_AU, camTruePosAu.y / PC_TO_AU, camTruePosAu.z / PC_TO_AU)
      ;(material.uniforms.uCamPc.value as THREE.Vector3).copy(camPc)
      material.uniforms.uLayerAlpha.value = layerAlpha
      material.uniforms.uYearsFromEpoch.value = yearsFromEpoch
      // Fixed angular size -> pixels: the vertical FOV spans drawingBufferHeight px, so
      // px-per-radian is height / fovRadians (the small-angle form is exact enough at ~1.7 deg).
      const fovRad = camera.fov * (Math.PI / 180)
      material.uniforms.uPixelSize.value = (HALO_ANGULAR_RAD / fovRad) * drawingBufferHeight
    },
  }
}
