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
  /** Set the render pixel ratio (used by the dynamic-resolution governor, main.ts). Re-sizes
   *  the renderer, the composer, and re-applies the half-resolution bloom override. */
  setPixelRatio: (ratio: number) => void
}

const PIXEL_RATIO_CAP = 1.5 // 1.5 instead of full Retina 2.0: ~44% fewer fragments, visually near-identical for point fields

// Set by apply() below, every time the engine (re)applies a pixel ratio. This project creates
// exactly one Engine per session (see main.ts), so a module-level value is simpler than threading
// a handle through every material with a uPixelRatio uniform (starField/galaxyField/Milky Way's
// shared point shader, asteroidField, spacecraft glyphs) — each reads it in its own per-frame
// update() instead of snapshotting window.devicePixelRatio once at material-creation time, which
// went stale the moment the resolution governor (or a cross-display window drag) changed it.
let lastAppliedPixelRatio = PIXEL_RATIO_CAP

/** The pixel ratio actually applied to the renderer right now — reflecting both the resolution
 *  governor's throttling and the device's own devicePixelRatio cap. See lastAppliedPixelRatio. */
export function getRenderPixelRatio(): number {
  return lastAppliedPixelRatio
}

export interface EngineOptions {
  /** WebGL's `preserveDrawingBuffer`. Off by default (it can cost an extra full-screen copy per
   *  presented frame). The diagnostics harness — src/ui/diag.ts, active only when the page URL
   *  carries a `diag` query param — turns it on so it can gl.readPixels the DEFAULT framebuffer
   *  after the frame has been composited, which is the only way to count what the user actually
   *  sees (post OutputPass tone mapping and color-space encoding) rather than what an offscreen
   *  target holds. */
  preserveDrawingBuffer?: boolean
}

export function createEngine(container: HTMLElement, options: EngineOptions = {}): Engine {
  const renderer = new THREE.WebGLRenderer({
    // The composer's own render target (below) carries the MSAA instead — see composerTarget.
    // Canvas MSAA would only ever smooth the OutputPass's single full-screen quad, which has no
    // internal edges to smooth, so leaving it on here was pure wasted fragment/resolve cost.
    antialias: false,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  })

  // Ratio requested by the dynamic-resolution governor (main.ts), clamped every apply() against
  // the device's own devicePixelRatio (which can change if the window is dragged to another
  // display) — kept separate so a plain window resize never silently undoes governor throttling.
  let governorRatio = PIXEL_RATIO_CAP
  const dprCap = () => Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP)
  let pixelRatio = Math.min(governorRatio, dprCap())

  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // OutputPass (added below) is the only pass that ever renders to the canvas (renderTarget ===
  // null), and per WebGLRenderer's material-compile branch, tone mapping / output-color-space
  // encoding are only applied there — every other pass renders into an offscreen, Linear-space
  // target and skips both, so this is applied exactly once, at the very end of the chain.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
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
  //
  // The composer's own target carries 4x MSAA (r166's WebGLRenderer auto-resolves a `samples`
  // WebGLRenderTarget to a plain texture whenever the render target is switched away from, so
  // every downstream pass just samples an ordinary resolved texture) — this is what restores
  // planet-limb edge quality now that canvas antialias is off. Actual size doesn't matter here;
  // it's placeholder-sized and corrected by apply() below, right after all passes are added.
  // WebKit/Safari's WebGL-on-Metal has a long-standing weakness resolving MULTISAMPLED
  // half-float renderbuffers: bright regions can resolve to uninitialized-looking teal/green
  // blocks (user-reported on the Sun close-up; Chromium renders the identical scene cleanly).
  // Safari therefore gets samples: 0 — it keeps HalfFloat (bloom quality) and every other
  // feature; only the composer-target MSAA is dropped there. Edge softening via bloom remains.
  const isWebKit = /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent)
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: isWebKit ? 0 : 4,
  })
  const composer = new EffectComposer(renderer, composerTarget)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.4, 0.5, 0.7)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // EffectComposer.addPass()/setSize() always hand every pass the FULL effective (CSS size *
  // pixelRatio) resolution — there's no per-pass override hook, so UnrealBloomPass's own resize
  // logic (which halves whatever it's given for its mip-0 buffer) ends up processing at half of
  // full canvas resolution by default. Calling bloom.setSize() again ourselves, after the
  // composer's own setSize, with half the canvas resolution forces mip-0 down to a quarter of
  // full canvas res instead — an extra halving on top of the pass's own.
  const apply = () => {
    pixelRatio = Math.min(governorRatio, dprCap())
    lastAppliedPixelRatio = pixelRatio
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    // setPixelRatio (not just setSize) so the composer's render targets pick up a
    // devicePixelRatio change too (e.g. dragging the window to a different-DPI display) —
    // setSize alone would reuse the stale ratio captured at composer construction time.
    composer.setPixelRatio(pixelRatio)
    composer.setSize(window.innerWidth, window.innerHeight)
    bloom.setSize(
      Math.round(window.innerWidth * pixelRatio / 2),
      Math.round(window.innerHeight * pixelRatio / 2),
    )
  }
  apply() // establishes real sizes (composerTarget/passes were placeholder-sized above) and the half-res bloom override

  window.addEventListener('resize', apply)

  const setPixelRatio = (ratio: number) => {
    governorRatio = ratio
    apply()
  }

  return { renderer, scene, camera, composer, bloom, setPixelRatio }
}
