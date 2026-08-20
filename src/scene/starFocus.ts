import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import type { StarCatalog } from '../data/catalogFormat'
import { PC_TO_AU } from '../data/units'

export const STAR_MIN_APPROACH_AU = 500 // below this, f32 GPU jitter would show; stars are points anyway

/**
 * A star's position at `yearsFromEpoch` years after the catalog's astrometric epoch, in AU —
 * the CPU-side twin of the `position + starVel * uYearsFromEpoch` line in the point shader.
 *
 * Anything that has to agree with where a star is actually drawn (fly-to targets, hover labels)
 * must go through this rather than reading `catalog.positions` directly, or it would keep aiming
 * at the star's year-2016 position while the star itself drifts away from it.
 */
export function starTruePosAu(
  catalog: StarCatalog,
  index: number,
  yearsFromEpoch: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const v = catalog.velocities
  const t = v === undefined ? 0 : yearsFromEpoch
  const vx = t === 0 ? 0 : v![index * 3] * t
  const vy = t === 0 ? 0 : v![index * 3 + 1] * t
  const vz = t === 0 ? 0 : v![index * 3 + 2] * t
  return out.set(
    (catalog.positions[index * 3] + vx) * PC_TO_AU,
    (catalog.positions[index * 3 + 1] + vy) * PC_TO_AU,
    (catalog.positions[index * 3 + 2] + vz) * PC_TO_AU,
  )
}

/** `yearsFromEpoch` is a getter, not a value: a fly-to re-asks its Focusable for the target
 *  position every frame, so a star warped to across deep time is tracked the same way a moon or a
 *  spacecraft is — the camera follows where the star is now, not where it was when you clicked. */
export function starFocusable(
  catalog: StarCatalog,
  index: number,
  name: string,
  yearsFromEpoch: () => number = () => 0,
): Focusable {
  return {
    name,
    getPosition: (out: THREE.Vector3) => starTruePosAu(catalog, index, yearsFromEpoch(), out),
    minApproachAu: STAR_MIN_APPROACH_AU,
  }
}
