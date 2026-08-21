import * as THREE from 'three'
import type { Engine } from '../engine/renderer'

/**
 * In-app rendering-diagnostics harness — a layer bisector for artifacts that only appear in one
 * browser.
 *
 * Motivation: on WebKit/Safari only, teal/green blocky speckles appear in a shell around the Sun
 * at the Sun close-up vantage (`#mode=orbit&focus=planet:sun&d=0.04`); Chromium renders the
 * identical scene at the identical size cleanly, and dropping the composer target's MSAA on
 * WebKit (fda4f55) did not cure it. Safari can't be screenshotted from the dev machine, so the
 * page has to diagnose itself: count the offending pixels, hide one layer at a time, and report
 * which layer's absence makes the count collapse.
 *
 * Entirely inert unless the page URL carries a `diag` query param — main.ts reads it, and only
 * then calls runDiag(). The param's value is the URL the JSON report is POSTed to; the same JSON
 * is also printed to the console and drawn into a fixed overlay, so a human reading the screen on
 * a phone/other machine gets the numbers even when the POST is blocked.
 *
 * Reads the DEFAULT framebuffer (not an offscreen target) with gl.readPixels, so what it counts
 * is exactly what the user sees after OutputPass — tone mapping, color-space encoding and all.
 * That requires the context to have been created with preserveDrawingBuffer: true, which main.ts
 * passes through createEngine when (and only when) the diag param is present.
 */

/** Live accessors for everything the bisector can hide. Getters, not values: most of these
 *  layers load asynchronously (stars, galaxies, the two Milky Way catalogs, the asteroid belt,
 *  spacecraft, constellations), so a snapshot taken at startup would be all nulls. A getter
 *  returning null simply means "that layer isn't in the scene", and it's reported as such. */
export interface DiagHandles {
  engine: Engine
  sunGlow: () => THREE.Object3D | null
  planets: () => THREE.Object3D[]
  stars: () => THREE.Object3D | null
  milkyWayInterior: () => THREE.Object3D | null
  milkyWayExt: () => THREE.Object3D | null
  galaxies: () => THREE.Object3D | null
  asteroids: () => THREE.Object3D | null
  brightStars: () => THREE.Object3D | null
  spacecraft: () => THREE.Object3D[]
  orbitLines: () => THREE.Object3D | null
  constellations: () => THREE.Object3D | null
  galaxySprites: () => THREE.Object3D | null
  deepSkySprites: () => THREE.Object3D | null
}

/** How long to let the app settle before the first measurement. The deep link the harness is
 *  driven with has to resolve (its poll retries at 500 ms), the staggered catalog loads have to
 *  land and chunk, and the resolution governor has to stop stepping the pixel ratio around. */
const SETTLE_MS = 10_000
/** Frames a candidate stays hidden before its teal count is read. More than one because a hidden
 *  layer can take a frame to leave the screen (a layer's own per-frame update runs before the
 *  render, and bloom carries brightness from the previous frame's mip chain). */
const HIDDEN_FRAMES = 5
/** Frames to let the scene return to baseline after a candidate is restored. */
const RESTORE_FRAMES = 2

/** A pixel is "teal" when green clearly dominates red and blue is also above red — the signature
 *  of the reported artifact, which is green-cyan on a scene whose real content near the Sun is
 *  overwhelmingly warm (white/yellow/orange). */
function isTeal(r: number, g: number, b: number): boolean {
  return g > 50 && g > r * 1.4 && b > r * 1.1 && g > b * 0.8
}

/** Sampling stride, both axes — 1/16 of the pixels. The artifact is described as blocky speckles
 *  covering a whole shell, so it is far larger than a 4 px grid can miss entirely. */
const SAMPLE_STRIDE = 4

interface PixelCounts { teal: number; lit: number; sampled: number }

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Forces an Object3D invisible in a way the app's own per-frame code cannot undo.
 *
 * A plain `obj.visible = false` is not enough here: almost every layer in this scene rewrites its
 * own visibility every frame from a distance-driven alpha (starField/galaxyField/Milky Way's
 * `group.visible = alpha > 0.002`, asteroidField's distance gate, brightStars, galaxySprites), so
 * the assignment would be reverted before the next render. Replacing the property with a
 * read-only accessor lets those writes happen and be ignored. Returns the restore function, which
 * puts the original data property (and its original value) back.
 */
function lockHidden(obj: THREE.Object3D): () => void {
  const saved = obj.visible
  Object.defineProperty(obj, 'visible', {
    get: () => false,
    set: () => { /* swallow the layer's own per-frame write */ },
    configurable: true,
    enumerable: true,
  })
  return () => {
    delete (obj as unknown as Record<string, unknown>).visible
    obj.visible = saved
  }
}

/** lockHidden over a list, skipping nulls; returns one restore for the whole batch. */
function lockAllHidden(objs: (THREE.Object3D | null | undefined)[]): () => void {
  const restores = objs.filter((o): o is THREE.Object3D => !!o).map(lockHidden)
  return () => { for (const r of restores) r() }
}

/**
 * Reads the whole default framebuffer and counts teal + lit pixels on a strided grid.
 *
 * renderer.setRenderTarget(null) first: the composer leaves the default framebuffer bound after
 * OutputPass, but a layer's own update() could in principle have bound something else, and
 * re-binding null is free and never clears.
 */
function measure(renderer: THREE.WebGLRenderer, buf: Uint8Array, w: number, h: number): PixelCounts {
  renderer.setRenderTarget(null)
  const gl = renderer.getContext()
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  let teal = 0
  let lit = 0
  let sampled = 0
  for (let y = 0; y < h; y += SAMPLE_STRIDE) {
    const row = y * w * 4
    for (let x = 0; x < w; x += SAMPLE_STRIDE) {
      const i = row + x * 4
      const r = buf[i]
      const g = buf[i + 1]
      const b = buf[i + 2]
      sampled++
      if (r > 20 || g > 20 || b > 20) lit++
      if (isTeal(r, g, b)) teal++
    }
  }
  return { teal, lit, sampled }
}

/** Drawing-buffer-sized scratch, reallocated whenever the resolution governor (or a resize)
 *  changes the buffer under us mid-run. */
class PixelBuffer {
  private buf = new Uint8Array(0)
  private w = 0
  private h = 0

  read(renderer: THREE.WebGLRenderer): PixelCounts & { width: number; height: number } {
    const canvas = renderer.domElement
    const w = canvas.width
    const h = canvas.height
    if (w !== this.w || h !== this.h || this.buf.length < w * h * 4) {
      this.buf = new Uint8Array(w * h * 4)
      this.w = w
      this.h = h
    }
    return { ...measure(renderer, this.buf, w, h), width: w, height: h }
  }
}

interface DiagReport {
  ua: string
  dpr: number
  drawingBufferSize: { width: number; height: number }
  cssSize: { width: number; height: number }
  hash: string
  baselineTeal: number
  baselineLit: number
  sampledPixels: number
  /** name -> teal count measured while that layer was hidden, or null when the layer isn't in
   *  the scene at all (a lazy catalog that never loaded, constellations in orbit mode, …). */
  perLayer: Record<string, number | null>
  /** The same passes' LIT counts. This is the harness's own sanity check, and the reason the
   *  report is readable rather than just suggestive: a layer whose lit count is unchanged from
   *  baseline contributed nothing visible to this vantage, so its teal count being unchanged
   *  proves nothing. Only a layer that measurably darkened the frame AND left the teal count
   *  alone has actually been ruled out. */
  perLayerLit: Record<string, number | null>
  webglVendor: string
  webglRenderer: string
  contextAttributes: WebGLContextAttributes | null
  targetSamples: number | null
  isWebKitUA: boolean
  elapsedMs: number
}

function webglInfo(renderer: THREE.WebGLRenderer): { vendor: string; renderer: string } {
  const gl = renderer.getContext()
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  if (dbg) {
    return {
      vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)),
      renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)),
    }
  }
  return { vendor: String(gl.getParameter(gl.VENDOR)), renderer: String(gl.getParameter(gl.RENDERER)) }
}

let overlayEl: HTMLPreElement | null = null

/** The on-screen copy of the report. Deliberately a plain <pre> pinned to the top-left: the whole
 *  point is that it survives the POST failing, so it must not depend on anything but the DOM. */
function showOverlay(text: string): void {
  if (!overlayEl) {
    overlayEl = document.createElement('pre')
    overlayEl.id = 'diag-overlay'
    overlayEl.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'z-index:9999',
      'max-width:min(560px,95vw)', 'max-height:90vh', 'overflow:auto',
      'margin:8px', 'padding:8px 10px',
      'background:rgba(0,0,0,0.88)', 'border:1px solid #3a4a5a', 'border-radius:6px',
      'color:#9fe0c0', 'font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
      'white-space:pre-wrap', 'word-break:break-word', '-webkit-user-select:text', 'user-select:text',
    ].join(';')
    document.body.appendChild(overlayEl)
  }
  overlayEl.textContent = text
}

/**
 * Runs the bisection and reports. Fire-and-forget: main.ts does not await it, and every failure
 * path is swallowed into the overlay/console rather than allowed to break the app.
 *
 * @param reportUrl the `diag` query param's value — where the JSON report is POSTed.
 */
export function runDiag(reportUrl: string, handles: DiagHandles): void {
  void bisect(reportUrl, handles).catch((err) => {
    console.error('[diag] failed:', err)
    showOverlay(`[diag] failed: ${String(err)}`)
  })
}

async function bisect(reportUrl: string, handles: DiagHandles): Promise<void> {
  const started = performance.now()
  const { engine } = handles
  const { renderer } = engine
  showOverlay(`[diag] settling ${SETTLE_MS / 1000}s before measuring…`)
  console.log('[diag] armed; report will be POSTed to', reportUrl)

  await new Promise((r) => setTimeout(r, SETTLE_MS))

  const pixels = new PixelBuffer()

  // Everything the bisector can turn off, in the order it is measured. Each entry hides its
  // objects (or, for bloom, flips the pass's own `enabled`) and returns a restore function.
  const candidates: { name: string; hide: () => (() => void) | null }[] = [
    {
      name: 'bloom',
      hide: () => {
        const saved = engine.bloom.enabled
        engine.bloom.enabled = false
        return () => { engine.bloom.enabled = saved }
      },
    },
    { name: 'sunGlow', hide: () => optional(handles.sunGlow()) },
    { name: 'planets', hide: () => optionalMany(handles.planets()) },
    { name: 'stars', hide: () => optional(handles.stars()) },
    { name: 'milkyWayInterior', hide: () => optional(handles.milkyWayInterior()) },
    { name: 'milkyWayExt', hide: () => optional(handles.milkyWayExt()) },
    { name: 'galaxies', hide: () => optional(handles.galaxies()) },
    { name: 'asteroids', hide: () => optional(handles.asteroids()) },
    { name: 'brightStars', hide: () => optional(handles.brightStars()) },
    { name: 'spacecraft', hide: () => optionalMany(handles.spacecraft()) },
    { name: 'orbitLines', hide: () => optional(handles.orbitLines()) },
    { name: 'constellations', hide: () => optional(handles.constellations()) },
    { name: 'galaxySprites', hide: () => optional(handles.galaxySprites()) },
    { name: 'deepSkySprites', hide: () => optional(handles.deepSkySprites()) },
  ]

  // Baseline. Measured a few frames in rather than on the very first one so that the awaited-rAF
  // chain has definitely settled BEHIND the app's own frame callback: the app re-registers its
  // next frame from inside frame(), so once one of our callbacks has run after one of theirs,
  // every later one does too — and only then are we reading a fully composited frame.
  for (let i = 0; i < HIDDEN_FRAMES; i++) await nextFrame()
  const base = pixels.read(renderer)

  const perLayer: Record<string, number | null> = {}
  const perLayerLit: Record<string, number | null> = {}
  for (const c of candidates) {
    const restore = c.hide()
    if (!restore) { // layer absent from the scene — nothing to measure, say so rather than lie
      perLayer[c.name] = null
      perLayerLit[c.name] = null
      continue
    }
    for (let i = 0; i < HIDDEN_FRAMES; i++) await nextFrame()
    const hidden = pixels.read(renderer)
    perLayer[c.name] = hidden.teal
    perLayerLit[c.name] = hidden.lit
    restore()
    for (let i = 0; i < RESTORE_FRAMES; i++) await nextFrame()
  }

  const final = pixels.read(renderer)
  const info = webglInfo(renderer)
  const composer = engine.composer as unknown as { renderTarget1?: THREE.WebGLRenderTarget }
  const report: DiagReport = {
    ua: navigator.userAgent,
    dpr: window.devicePixelRatio,
    drawingBufferSize: { width: final.width, height: final.height },
    cssSize: { width: window.innerWidth, height: window.innerHeight },
    hash: location.hash,
    baselineTeal: base.teal,
    baselineLit: base.lit,
    sampledPixels: base.sampled,
    perLayer,
    perLayerLit,
    webglVendor: info.vendor,
    webglRenderer: info.renderer,
    contextAttributes: renderer.getContext().getContextAttributes(),
    targetSamples: composer.renderTarget1?.samples ?? null,
    isWebKitUA: /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent),
    elapsedMs: Math.round(performance.now() - started),
  }

  const json = JSON.stringify(report, null, 2)
  console.log('[diag] report', report)
  showOverlay(json)

  // text/plain keeps this a CORS "simple request" — no preflight, so a bare `nc`/one-liner
  // listener on the other end is enough to receive it. A failed POST is expected and harmless:
  // the overlay above already carries the same JSON.
  try {
    await fetch(reportUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: json,
    })
    console.log('[diag] report POSTed to', reportUrl)
  } catch (err) {
    console.warn('[diag] POST failed (read the overlay instead):', err)
    showOverlay(`${json}\n\n[diag] POST to ${reportUrl} failed: ${String(err)}`)
  }
}

/** hide-helper for a single possibly-absent object. */
function optional(obj: THREE.Object3D | null): (() => void) | null {
  return obj ? lockHidden(obj) : null
}

/** hide-helper for a possibly-empty list of objects. */
function optionalMany(objs: THREE.Object3D[]): (() => void) | null {
  return objs.length ? lockAllHidden(objs) : null
}
