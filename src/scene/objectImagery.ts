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
        material.map = texture
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
