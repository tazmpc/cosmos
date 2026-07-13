import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import type { StarCatalog } from '../data/catalogFormat'
import { PC_TO_AU } from '../data/units'

export const STAR_MIN_APPROACH_AU = 500 // below this, f32 GPU jitter would show; stars are points anyway

export function starFocusable(catalog: StarCatalog, index: number, name: string): Focusable {
  const x = catalog.positions[index * 3] * PC_TO_AU
  const y = catalog.positions[index * 3 + 1] * PC_TO_AU
  const z = catalog.positions[index * 3 + 2] * PC_TO_AU
  return {
    name,
    getPosition: (out: THREE.Vector3) => out.set(x, y, z),
    minApproachAu: STAR_MIN_APPROACH_AU,
  }
}
