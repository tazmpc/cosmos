import * as THREE from 'three'

export interface Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
}

export function createEngine(container: HTMLElement): Engine {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  })
  // 1.5 instead of full Retina 2.0: ~44% fewer fragments, visually near-identical for point fields
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    const el = document.getElementById('banner')!
    el.textContent = 'Graphics context lost — reload the page to continue.'
    el.style.display = 'block'
  })

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000004)

  // near/far span planet-surface to interstellar; log depth buffer makes this workable
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1e-7, 1e12)
  camera.up.set(0, 0, 1) // EQJ: +Z = celestial north

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  return { renderer, scene, camera }
}
