import * as THREE from 'three'
import { PLANETS, type PlanetDef } from '../data/planets'
import { bodyPosition } from '../sim/ephemeris'
import { addSaturnRings } from './rings'

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
    if (def.id === 'saturn') addSaturnRings(mesh)
    if (def.id === 'sun') {
      const c = document.createElement('canvas'); c.width = c.height = 128
      const ctx = c.getContext('2d')!
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(255,240,210,0.9)'); g.addColorStop(0.3, 'rgba(255,200,120,0.35)')
      g.addColorStop(1, 'rgba(255,180,80,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      sprite.scale.setScalar(def.radiusAu * 6)
      mesh.add(sprite)
    }
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
