import * as THREE from 'three'
import { decodeCatalog, type StarCatalog } from '../data/catalogFormat'
import { buildPointGeometry, makePointMaterial } from './starField'
import { MPC_TO_AU } from '../data/units'

export interface GalaxyField {
  points: THREE.Points
  catalog: StarCatalog
  /** Call each frame with the camera's true heliocentric position in AU, and this layer's crossfade alpha (0..1). */
  update(camTruePosAu: THREE.Vector3, layerAlpha?: number): void
}

const GALAXY_UNIT_TO_AU = MPC_TO_AU // Mpc -> AU

export async function loadGalaxyField(scene: THREE.Scene): Promise<GalaxyField> {
  const binRes = await fetch('/galaxies.bin')
  if (!binRes.ok) throw new Error('galaxy catalog fetch failed')
  const catalog = decodeCatalog(await binRes.arrayBuffer())

  const geo = buildPointGeometry(catalog)
  const mat = makePointMaterial({
    unitToAu: GALAXY_UNIT_TO_AU, unitToPc: 1e6, scale: 1600, faintMag: 15, alphaCap: 0.45, minSize: 1.5, maxSize: 8,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // shader-space positions; three's culling would use wrong bounds
  points.matrixAutoUpdate = false
  points.visible = mat.uniforms.uLayerAlpha.value > 0.002 // consistent with the default uLayerAlpha (1.0)
  scene.add(points)

  return {
    points, catalog,
    update(camTruePosAu, layerAlpha = 1) {
      ;(mat.uniforms.uCamPc.value as THREE.Vector3)
        .set(camTruePosAu.x / GALAXY_UNIT_TO_AU, camTruePosAu.y / GALAXY_UNIT_TO_AU, camTruePosAu.z / GALAXY_UNIT_TO_AU)
      mat.uniforms.uLayerAlpha.value = layerAlpha
      // Below-threshold layers cost full vertex work every frame even at alpha 0 (no per-point
      // gating in the shader) — three.js skips the draw call entirely when a Points is invisible,
      // so this is the actual perf win, not just a visual nicety.
      points.visible = layerAlpha > 0.002
    },
  }
}
