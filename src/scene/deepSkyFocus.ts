import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import type { DeepSkyDef } from '../data/deepSky'
import { raDecDistToXyz } from '../data/starMath'
import { AU_PER_LY, PC_TO_AU } from '../data/units'

/** Deep-sky objects span light-years to hundreds of light-years across (vs. galaxies' kilo-
 * light-years), so a fixed minApproachAu would either clip into small nebulae or leave huge
 * ones (Carina, Rosette) approached from absurdly close in. Scale to the object instead. */
export function deepSkyMinApproachAu(def: DeepSkyDef): number {
  return Math.max(2 * def.diameterLy * AU_PER_LY, 1e6)
}

/** Fly-to arrival distance: frame the object with headroom beyond the minimum approach. */
export function deepSkyFocusable(def: DeepSkyDef): Focusable {
  const [x, y, z] = raDecDistToXyz(def.raHours, def.decDeg, def.distPc)
  return {
    name: def.name,
    getPosition: (out: THREE.Vector3) => out.set(x * PC_TO_AU, y * PC_TO_AU, z * PC_TO_AU),
    minApproachAu: deepSkyMinApproachAu(def),
  }
}
