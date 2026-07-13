import * as THREE from 'three'
import { PLANETS } from '../data/planets'
import { bodyPosition } from '../sim/ephemeris'

/** One LineLoop per orbiting body, sampled over one period around `epoch`. Heliocentric AU. */
export function createOrbitLines(scene: THREE.Scene, epoch: Date): THREE.Group {
  const group = new THREE.Group()
  const mat = new THREE.LineBasicMaterial({ color: 0x2e4a6b, transparent: true, opacity: 0.55 })
  for (const def of PLANETS) {
    if (!def.periodDays || def.parent) continue // skip Sun and the Moon (moon orbit too small to draw at scale)
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < 192; i++) {
      const d = new Date(epoch.getTime() + (i / 192) * def.periodDays * 86400e3)
      const p = bodyPosition(def.id, d)
      pts.push(new THREE.Vector3(p.x, p.y, p.z))
    }
    group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat))
  }
  scene.add(group)
  return group
}

/** Re-express heliocentric lines camera-relative (they are Sun-centered, so just offset by −camera). */
export function updateOrbitLines(group: THREE.Group, camTruePos: THREE.Vector3): void {
  group.position.set(-camTruePos.x, -camTruePos.y, -camTruePos.z)
}
