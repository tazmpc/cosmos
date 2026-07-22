import * as THREE from 'three'
import { KM_PER_AU } from '../data/units'

const KM = 1 / KM_PER_AU
const INNER = 74500 * KM
const OUTER = 140180 * KM

/** Ring mesh, child of Saturn's mesh so floating origin is inherited. UVs remapped radially. */
export function addSaturnRings(saturnMesh: THREE.Mesh): void {
  const geo = new THREE.RingGeometry(INNER, OUTER, 128)
  // map U to radius so the strip texture reads correctly
  const posAttr = geo.attributes.position
  const uv = geo.attributes.uv
  const v = new THREE.Vector3()
  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i)
    uv.setXY(i, (v.length() - INNER) / (OUTER - INNER), 1)
  }
  const tex = new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'textures/2k_saturn_ring_alpha.png')
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, transparent: true })
  const ring = new THREE.Mesh(geo, mat)
  // saturnMesh is already rotated x+90°; ring in the mesh's local XY plane = equatorial
  saturnMesh.add(ring)
}
