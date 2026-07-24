import * as THREE from 'three'
import { raDecDistToXyz } from '../data/starMath'

interface ConstellationsJSON {
  segments: [number, number, number, number][]
}

export interface ConstellationLines {
  group: THREE.Group
  setVisible(v: boolean): void
}

/** Loads d3-celestial constellation line segments (public/constellations.json, built by
 * scripts/build-constellations.ts) and renders them as a single THREE.LineSegments on the
 * celestial sphere. Each vertex is a unit RA/Dec direction scaled far out (1e6 AU) — with the
 * group parked at the GL origin, this is camera-relative by construction (sky view pins the
 * camera to (0,0,0) each frame), so no per-frame update is needed. Hidden until sky mode
 * explicitly shows it. On fetch/parse failure: warn and leave sky view working without lines. */
export async function loadConstellations(scene: THREE.Scene): Promise<ConstellationLines> {
  const group = new THREE.Group()
  group.visible = false
  group.matrixAutoUpdate = false
  scene.add(group)

  try {
    const res = await fetch(import.meta.env.BASE_URL + 'constellations.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: ConstellationsJSON = await res.json()

    const positions = new Float32Array(data.segments.length * 6)
    let i = 0
    for (const [ra1, dec1, ra2, dec2] of data.segments) {
      const [x1, y1, z1] = raDecDistToXyz(ra1 / 15, dec1, 1)
      const [x2, y2, z2] = raDecDistToXyz(ra2 / 15, dec2, 1)
      positions[i++] = x1 * 1e6; positions[i++] = y1 * 1e6; positions[i++] = z1 * 1e6
      positions[i++] = x2 * 1e6; positions[i++] = y2 * 1e6; positions[i++] = z2 * 1e6
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.LineBasicMaterial({
      color: 0x3a5a7a, transparent: true, opacity: 0.5, depthWrite: false,
    })
    const lines = new THREE.LineSegments(geometry, material)
    lines.matrixAutoUpdate = false
    group.add(lines)
  } catch (err) {
    console.warn('Constellation lines failed to load:', err)
  }

  return {
    group,
    setVisible(v: boolean) { group.visible = v },
  }
}
