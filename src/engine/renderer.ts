import * as THREE from 'three'

export interface Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
}

export function createEngine(container: HTMLElement): Engine {
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000004)

  // near/far span planet-surface to interstellar; log depth buffer makes this workable
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1e-7, 1e12)
  camera.up.set(0, 0, 1) // EQJ: +Z = celestial north

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  return { renderer, scene, camera }
}
