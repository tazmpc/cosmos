import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import type { GalaxyDef } from '../data/galaxies'
import { raDecDistToXyz } from '../data/starMath'
import { MPC_TO_AU } from '../data/units'

export const GALAXY_MIN_APPROACH_AU = 5e9
/** Fly-to arrival distance: 0.35 Mpc back — frames a galaxy region without sitting inside it. */
export const GALAXY_ARRIVE_AU = 0.35 * MPC_TO_AU

export function galaxyFocusable(def: GalaxyDef): Focusable {
  const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distMpc)
  return {
    name: def.name,
    getPosition: (out: THREE.Vector3) => out.set(x * MPC_TO_AU, y * MPC_TO_AU, z * MPC_TO_AU),
    minApproachAu: GALAXY_MIN_APPROACH_AU,
  }
}
