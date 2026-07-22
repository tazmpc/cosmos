import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export interface Engine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  composer: EffectComposer
  bloom: UnrealBloomPass
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

  // Bloom composer: RenderPass draws the scene, UnrealBloomPass adds glow around bright
  // pixels (Sun, planet limbs), OutputPass applies renderer.outputColorSpace + tone mapping —
  // required last since EffectComposer's intermediate render targets are linear and bypass
  // the renderer's automatic output-encoding step that a direct renderer.render() would do.
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.5, 0.7)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(window.innerWidth, window.innerHeight)
    // setPixelRatio (not setSize) so the composer's render targets pick up a devicePixelRatio
    // change too (e.g. dragging the window to a different-DPI display) — setSize alone would
    // reuse the stale ratio captured at composer construction time.
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    composer.setSize(window.innerWidth, window.innerHeight)
  })

  return { renderer, scene, camera, composer, bloom }
}
