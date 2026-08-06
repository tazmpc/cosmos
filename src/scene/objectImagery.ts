import * as THREE from 'three'
import { angularFovDeg } from '../data/angularSize'
import { AU_PER_LY, PC_TO_AU } from '../data/units'
import type { GalaxySpriteLayer, DeepSkySpriteLayer } from './galaxySprites'

/** A curated object (galaxy or deep-sky object) that can lazily upgrade its glow sprite to a
 * real hips2fits photo. Normalizes galaxies (diameterKly/distMpc) and DSOs (diameterLy/distPc)
 * to the same shape so the fetch/swap logic below doesn't care which catalog an object came from. */
export interface ImageTarget {
  id: string
  raHours: number
  decDeg: number
  diameterLy: number
  distPc: number
  sprite: THREE.Sprite
  truePos: THREE.Vector3
}

/** Minimal interface satisfied by THREE.TextureLoader — narrowed so tests can inject a fake. */
export interface HipsTextureLoader {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress: undefined,
    onError: (err: unknown) => void,
  ): void
}

function defaultLoader(): HipsTextureLoader {
  const loader = new THREE.TextureLoader()
  loader.crossOrigin = 'anonymous'
  return loader
}

/** Proximity check cadence — "cheap, once a second" per the plan, not every frame: with ~40
 * curated objects this is a trivial loop, but there's no reason to run it 60x/sec. */
const CHECK_INTERVAL_S = 1
/** Fetch trigger radius: camera within this many object-diameters counts as "approaching". */
const PROXIMITY_DIAMETERS = 20

type FetchState = 'idle' | 'loading' | 'done' | 'failed'

export function hipsUrl(raHours: number, decDeg: number, fovDeg: number): string {
  const raDeg = raHours * 15
  return (
    'https://alasky.cds.unistra.fr/hips-image-services/hips2fits' +
    `?hips=CDS%2FP%2FDSS2%2Fcolor&ra=${raDeg}&dec=${decDeg}&fov=${fovDeg}` +
    '&width=512&height=512&format=jpg&projection=TAN'
  )
}

/** Vignette shape: full strength out to VIGNETTE_INNER, faded to nothing by VIGNETTE_OUTER, both
 * measured in units of HALF the image width (so 1.0 is the edge midpoint and ~1.41 is a corner —
 * corners therefore vanish well before the edge midpoints do, which is what makes the frame read
 * as round rather than as a clipped square). */
const VIGNETTE_INNER = 0.62
const VIGNETTE_OUTER = 0.98

/** Radial vignette multiplier at normalized radius `r` (half-widths from the image centre). */
export function vignetteFalloff(r: number): number {
  if (r <= VIGNETTE_INNER) return 1
  if (r >= VIGNETTE_OUTER) return 0
  const t = (r - VIGNETTE_INNER) / (VIGNETTE_OUTER - VIGNETTE_INNER)
  return 1 - t * t * (3 - 2 * t) // smoothstep, so there's no visible ring where the falloff starts
}

/** Returns a copy of `source` with a radial vignette multiplied in, or `source` itself if the
 * image can't be processed (no DOM, no decoded bitmap, tainted canvas).
 *
 * hips2fits cutouts are square TAN projections, and these sprites blend ADDITIVELY — so an
 * unvignetted photo announces itself as a glowing rectangle pasted onto the sky, worst of all
 * near the galactic plane where the background it's added to is already bright. RGB is multiplied
 * toward black rather than the alpha being faded because additive blending ignores alpha's usual
 * "let the background through" meaning: what has to go to zero is the emitted colour itself. */
function vignetteTexture(source: THREE.Texture): THREE.Texture {
  const img = source.image as (CanvasImageSource & { width?: number; height?: number }) | undefined
  if (typeof document === 'undefined' || !img || !img.width || !img.height) return source
  try {
    const w = img.width
    const h = img.height
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return source
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    const px = data.data
    const cx = w / 2
    const cy = h / 2
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / cx
        const dy = (y + 0.5 - cy) / cy
        const f = vignetteFalloff(Math.hypot(dx, dy))
        if (f >= 1) continue
        const i = (y * w + x) * 4
        px[i] *= f
        px[i + 1] *= f
        px[i + 2] *= f
      }
    }
    ctx.putImageData(data, 0, 0)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  } catch (err) {
    console.warn('objectImagery: vignette failed, using the raw photo texture.', err)
    return source
  }
}

export interface ObjectImagery {
  /** Call once per frame with the camera's true heliocentric position (AU) and the frame delta
   * (seconds) — internally throttles the actual proximity sweep to once per second. */
  update(camTruePosAu: THREE.Vector3, dtSeconds: number): void
  /** Force-trigger the fetch for one object immediately (e.g. on search fly-to), bypassing the
   * proximity check — the first hips2fits request can take several seconds, so starting it the
   * moment the user commits to flying there (rather than waiting for arrival) hides the latency. */
  focus(id: string): void
}

/** Wires lazy hips2fits photo fetches onto a set of curated-object glow sprites. Each object
 * fetches at most once (success or failure both latch — never retried): on load, the sprite's
 * texture and size are swapped to the real photo; on failure, a single console.warn fires and
 * the glow sprite is left exactly as it was. */
export function createObjectImagery(
  targets: ImageTarget[],
  loader: HipsTextureLoader = defaultLoader(),
): ObjectImagery {
  const states = new Map<string, FetchState>(targets.map(t => [t.id, 'idle']))
  const byId = new Map(targets.map(t => [t.id, t]))
  let accumS = 0

  function fetchFor(target: ImageTarget): void {
    if (states.get(target.id) !== 'idle') return
    states.set(target.id, 'loading')
    const fovDeg = angularFovDeg(target.diameterLy, target.distPc)
    const url = hipsUrl(target.raHours, target.decDeg, fovDeg)
    loader.load(
      url,
      (texture) => {
        // Codebase convention: the renderer outputs sRGB, so any loaded (non-generated) texture
        // must be tagged sRGB or it double-gammas — washed out, flat contrast. The procedural
        // glow canvas doesn't need this (it's drawn directly, not sampled from sRGB-encoded
        // source data), but every hips2fits JPEG does.
        texture.colorSpace = THREE.SRGBColorSpace
        texture.needsUpdate = true
        const material = target.sprite.material as THREE.SpriteMaterial
        material.map = vignetteTexture(texture)
        material.needsUpdate = true
        const distAu = target.distPc * PC_TO_AU
        const sizeAu = 2 * distAu * Math.tan((fovDeg / 2) * (Math.PI / 180))
        target.sprite.scale.set(sizeAu, sizeAu, 1)
        states.set(target.id, 'done')
      },
      undefined,
      (err) => {
        console.warn(`objectImagery: hips2fits fetch failed for "${target.id}", keeping glow sprite.`, err)
        states.set(target.id, 'failed')
      },
    )
  }

  return {
    update(camTruePosAu, dtSeconds) {
      accumS += dtSeconds
      if (accumS < CHECK_INTERVAL_S) return
      accumS = 0
      for (const target of targets) {
        if (states.get(target.id) !== 'idle') continue
        const diameterAu = target.diameterLy * AU_PER_LY
        const dist = camTruePosAu.distanceTo(target.truePos)
        if (dist < PROXIMITY_DIAMETERS * diameterAu) fetchFor(target)
      }
    },
    focus(id) {
      const target = byId.get(id)
      if (target) fetchFor(target)
    },
  }
}

/** Adapts a GalaxySpriteLayer's sprites (diameterKly/distMpc, kly/Mpc) into ImageTargets
 * (diameterLy/distPc) — see ImageTarget's doc comment for why the two catalogs get normalized. */
export function galaxyImageTargets(layer: GalaxySpriteLayer): ImageTarget[] {
  return layer.sprites.map(({ def, sprite, truePos }) => ({
    id: def.id,
    raHours: def.raHours,
    decDeg: def.decDeg,
    diameterLy: (def.diameterKly ?? 100) * 1000,
    distPc: def.distMpc * 1e6,
    sprite,
    truePos,
  }))
}

/** Adapts a DeepSkySpriteLayer's sprites (already diameterLy/distPc) into ImageTargets. */
export function deepSkyImageTargets(layer: DeepSkySpriteLayer): ImageTarget[] {
  return layer.sprites.map(({ def, sprite, truePos }) => ({
    id: def.id,
    raHours: def.raHours,
    decDeg: def.decDeg,
    diameterLy: def.diameterLy,
    distPc: def.distPc,
    sprite,
    truePos,
  }))
}
