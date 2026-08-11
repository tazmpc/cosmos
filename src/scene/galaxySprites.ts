import * as THREE from 'three'
import type { GalaxyDef } from '../data/galaxies'
import { GALAXIES } from '../data/galaxies'
import type { DeepSkyDef } from '../data/deepSky'
import { DEEP_SKY } from '../data/deepSky'
import { raDecDistToXyz } from '../data/starMath'
import { AU_PER_LY, MPC_TO_AU, PC_TO_AU } from '../data/units'

/** A single curated-galaxy glow sprite plus its true heliocentric position. */
export interface GalaxySprite {
  def: GalaxyDef
  sprite: THREE.Sprite
  truePos: THREE.Vector3 // heliocentric EQJ AU, double precision (JS numbers)
}

export interface GalaxySpriteLayer {
  group: THREE.Group
  sprites: GalaxySprite[]
  /** Call each frame with the camera's true heliocentric position in AU, and the galaxies layer's
   * crossfade alpha (0..1) — these ride the same layerAlphas.galaxies weight as galaxies.bin. */
  update(camTruePosAu: THREE.Vector3, layerAlpha?: number): void
}

/** A single curated deep-sky-object glow sprite plus its true heliocentric position. */
export interface DeepSkySprite {
  def: DeepSkyDef
  sprite: THREE.Sprite
  truePos: THREE.Vector3 // heliocentric EQJ AU, double precision (JS numbers)
}

export interface DeepSkySpriteLayer {
  group: THREE.Group
  sprites: DeepSkySprite[]
  /** Call each frame with the camera's true heliocentric position in AU, and the crossfade alpha
   * (0..1) to ride — deep-sky objects live at star-field distances, so callers pass layerAlphas'
   * `stars` weight (not `galaxies`, which only ramps up far beyond where any DSO sits). */
  update(camTruePosAu: THREE.Vector3, layerAlpha?: number): void
}

export const DEFAULT_DIAMETER_KLY = 100

/** Builds a soft radial-gradient glow texture, matching the sun-glow-sprite pattern in solarSystem.ts. */
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,245,230,0.85)')
  g.addColorStop(0.4, 'rgba(255,225,190,0.25)')
  g.addColorStop(1, 'rgba(255,225,190,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function isCluster(def: GalaxyDef): boolean {
  return def.type.toLowerCase().includes('cluster')
}

function isElliptical(def: GalaxyDef): boolean {
  // Matched by substring, not prefix: none of the curated type strings actually start with
  // "Elliptical"/"E" (e.g. "Giant elliptical (E2)", "Supergiant cD elliptical") — a startsWith
  // check would also misfire on unrelated types like "Edge-on spiral".
  return def.type.toLowerCase().includes('elliptical')
}

/** Renders the ~26 curated galaxies (galaxies.ts) as named glow sprites, drawn on top of the
 * bulk galaxies.bin point cloud. These originally existed to fill a real gap: galaxies.bin's
 * redshift-only sources (SDSS/2MRS/6dFGS) structurally can't carry the blueshifted Local Group,
 * so flying to e.g. Andromeda used to arrive at visually empty space.
 *
 * Since the galaxy catalog v2 merge (Cosmicflows-4, phase 9 task 29), M31/M33 and most other
 * curated galaxies also exist as real galaxies.bin points at (essentially) this same position —
 * CF4 carries measured, not redshift-derived, distances, so it's the one source that *does*
 * reach the Local Group. The sprite and the catalog point now co-render additively at the same
 * spot. This is intentional, not a leftover: the catalog point reads as the galaxy's bright
 * nucleus inside the sprite's glow/photo, which is the visually correct thing for a real nucleus
 * to look like — and suppressing genuine catalog data just to avoid a redundant-looking dot
 * would be hiding real information for no benefit. Kept as designed.
 *
 * Cluster entries are skipped: a cluster isn't a single object and has no one diameter to size
 * a glow from. */
export function createGalaxySprites(scene: THREE.Scene): GalaxySpriteLayer {
  const texture = makeGlowTexture()
  const group = new THREE.Group()
  const sprites: GalaxySprite[] = []

  for (const def of GALAXIES) {
    if (isCluster(def)) continue

    const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distMpc)
    const truePos = new THREE.Vector3(x * MPC_TO_AU, y * MPC_TO_AU, z * MPC_TO_AU)

    const material = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    })
    const sprite = new THREE.Sprite(material)

    const diameterAu = (def.diameterKly ?? DEFAULT_DIAMETER_KLY) * 1000 * AU_PER_LY
    const s = diameterAu
    if (isElliptical(def)) {
      sprite.scale.set(s * 0.8, s * 0.8, 1)
    } else {
      sprite.scale.set(s, s * 0.42, 1) // edge-on-ish lens look for spirals/irregulars
    }

    group.add(sprite)
    sprites.push({ def, sprite, truePos })
  }

  group.visible = false
  scene.add(group)

  return {
    group, sprites,
    update(camTruePosAu, layerAlpha = 1) {
      for (const { sprite, truePos } of sprites) {
        sprite.position.copy(truePos).sub(camTruePosAu)
        ;(sprite.material as THREE.SpriteMaterial).opacity = 0.5 * layerAlpha
      }
      group.visible = layerAlpha > 0.002
    },
  }
}

/** Renders the ~15 curated deep-sky objects (deepSky.ts — nebulae and star clusters) as named
 * glow sprites, the same landmark role as createGalaxySprites but for objects that live inside
 * the Milky Way (star-field distances, parsecs not megaparsecs) rather than out among the
 * galaxies. All rendered as simple round glows — unlike galaxies there's no consistent
 * elliptical/edge-on convention across nebula and cluster types worth encoding. */
export function createDeepSkySprites(scene: THREE.Scene): DeepSkySpriteLayer {
  const texture = makeGlowTexture()
  const group = new THREE.Group()
  const sprites: DeepSkySprite[] = []

  for (const def of DEEP_SKY) {
    const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distPc)
    const truePos = new THREE.Vector3(x * PC_TO_AU, y * PC_TO_AU, z * PC_TO_AU)

    const material = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    })
    const sprite = new THREE.Sprite(material)

    const diameterAu = def.diameterLy * AU_PER_LY
    sprite.scale.set(diameterAu, diameterAu, 1)

    group.add(sprite)
    sprites.push({ def, sprite, truePos })
  }

  group.visible = false
  scene.add(group)

  return {
    group, sprites,
    update(camTruePosAu, layerAlpha = 1) {
      for (const { sprite, truePos } of sprites) {
        sprite.position.copy(truePos).sub(camTruePosAu)
        ;(sprite.material as THREE.SpriteMaterial).opacity = 0.5 * layerAlpha
      }
      group.visible = layerAlpha > 0.002
    },
  }
}
