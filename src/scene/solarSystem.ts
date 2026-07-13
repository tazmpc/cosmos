import * as THREE from 'three'
import { PLANETS, type PlanetDef } from '../data/planets'
import { bodyPosition } from '../sim/ephemeris'

export interface PlanetNode {
  def: PlanetDef
  mesh: THREE.Mesh
  truePos: THREE.Vector3 // heliocentric EQJ AU, double precision (JS numbers)
}

export function createSolarSystem(scene: THREE.Scene): { nodes: PlanetNode[]; sunLight: THREE.PointLight } {
  const loader = new THREE.TextureLoader()
  const nodes: PlanetNode[] = []

  scene.add(new THREE.AmbientLight(0xffffff, 0.04))

  for (const def of PLANETS) {
    const tex = loader.load(`/textures/${def.texture}`)
    tex.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.SphereGeometry(def.radiusAu, 48, 24)
    const mat = def.id === 'sun'
      ? new THREE.MeshBasicMaterial({ map: tex })
      : new THREE.MeshLambertMaterial({ map: tex })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = Math.PI / 2 // sphere poles → +Z (EQJ north)
    mesh.userData.planetId = def.id
    scene.add(mesh)
    nodes.push({ def, mesh, truePos: new THREE.Vector3() })
  }

  const sunLight = new THREE.PointLight(0xffffff, 2.5, 0, 0) // decay 0: physically wrong, visually right at AU scales
  sunLight.name = 'sunLight'
  scene.add(sunLight)

  return { nodes, sunLight }
}

/** Recompute true heliocentric positions for the sim date. */
export function updatePositions(nodes: PlanetNode[], date: Date): void {
  for (const n of nodes) {
    const p = bodyPosition(n.def.id, date)
    n.truePos.set(p.x, p.y, p.z)
  }
}

/** Re-express meshes and sun light camera-relative (floating origin). */
export function repositionMeshes(nodes: PlanetNode[], sunLight: THREE.PointLight, camTruePos: THREE.Vector3): void {
  for (const n of nodes) n.mesh.position.copy(n.truePos).sub(camTruePos)
  sunLight.position.set(-camTruePos.x, -camTruePos.y, -camTruePos.z)
}
