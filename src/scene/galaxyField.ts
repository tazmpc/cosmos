import * as THREE from 'three'
import { loadPointLayer, type PointLayer } from './starField'
import { MPC_TO_AU } from '../data/units'

/** The bulk galaxy point cloud is a plain point layer — same shader, same chunked frustum
 *  culling — so this is just loadPointLayer with the galaxy tuning. */
export type GalaxyField = PointLayer

const GALAXY_UNIT_TO_AU = MPC_TO_AU // Mpc -> AU

export async function loadGalaxyField(scene: THREE.Scene): Promise<GalaxyField> {
  return loadPointLayer(scene, import.meta.env.BASE_URL + 'galaxies.bin', {
    unitToAu: GALAXY_UNIT_TO_AU, unitToPc: 1e6, scale: 1600, faintMag: 15, alphaCap: 0.45, minSize: 1.5, maxSize: 8,
  })
}
