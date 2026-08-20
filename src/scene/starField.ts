import * as THREE from 'three'
import { decodeCatalog, type StarCatalog } from '../data/catalogFormat'
import { chunkCatalog, type ChunkInfo } from '../data/chunkCatalog'
import { colorIndexToRgb } from '../data/starColor'
import { PC_TO_AU } from '../data/units'
import { getRenderPixelRatio } from '../engine/renderer'

export interface StarField extends PointLayer {
  /** Star name -> index into `catalog`, already remapped onto the chunk-reordered catalog. */
  names: Record<string, number>
}

/** Configures a point-cloud layer (stars, galaxies, …) sharing the same shader. */
export interface PointLayerConfig {
  unitToAu: number  // conversion factor from the catalog's position units to AU (e.g. parsecs or megaparsecs)
  unitToPc: number  // conversion factor from the catalog's position units to parsecs (true apparent magnitude)
  scale: number      // point size scale
  faintMag: number   // apparent mag at/below which a point is full-alpha; fainter points fade toward the discard cutoff
  alphaCap: number   // max intrinsic alpha before the LOD crossfade multiply; <1 tames additive saturation
  minSize: number
  maxSize: number
}

const VERT = /* glsl */ `
  uniform vec3 uCamPc;       // camera position, in catalog position units
  uniform float uUnitToAu;   // catalog position units -> AU
  uniform float uUnitToPc;   // catalog position units -> parsecs (true apparent magnitude)
  uniform float uScale;      // point size scale
  uniform float uFaintMag;   // apparent mag at/below which a point is full-alpha; fainter points fade toward the discard cutoff
  uniform float uAlphaCap;   // max intrinsic alpha; <1 tames additive saturation in dense layers
  uniform float uMinSize;
  uniform float uMaxSize;
  uniform float uPixelRatio;
  uniform float uLayerAlpha;
  attribute float absMag;
  attribute vec3 starColor;
  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vec3 relAu = (position - uCamPc) * uUnitToAu;
    vec4 mv = modelViewMatrix * vec4(relAu, 1.0);
    gl_Position = projectionMatrix * mv;

    #include <logdepthbuf_vertex>

    float distUnits = max(length(position - uCamPc), 1e-6);
    float appMag = absMag + 5.0 * (log(distUnits * uUnitToPc) / 2.302585 - 1.0);
    gl_PointSize = clamp(uScale * pow(10.0, -0.2 * appMag), uMinSize, uMaxSize) * uPixelRatio;
    vAlpha = clamp(pow(10.0, -0.4 * (appMag - uFaintMag)), 0.0, 1.0);
    vAlpha = min(vAlpha, uAlphaCap) * uLayerAlpha;
    vColor = starColor;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float edge = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vColor, vAlpha * edge);
    if (gl_FragColor.a < 0.003) discard;

    #include <logdepthbuf_fragment>
  }
`

/** Builds the shared position/absMag/color geometry for a CSMS-format point catalog (stars or galaxies). */
export function buildPointGeometry(catalog: StarCatalog): THREE.BufferGeometry {
  const colors = new Float32Array(catalog.count * 3)
  for (let i = 0; i < catalog.count; i++) {
    const [r, g, b] = colorIndexToRgb(catalog.colorIndex[i])
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(catalog.positions, 3))
  geo.setAttribute('absMag', new THREE.BufferAttribute(catalog.absMag, 1))
  geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3))
  return geo
}

export function makePointMaterial(cfg: PointLayerConfig): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamPc: { value: new THREE.Vector3() },
      uUnitToAu: { value: cfg.unitToAu },
      uUnitToPc: { value: cfg.unitToPc },
      uScale: { value: cfg.scale },
      uFaintMag: { value: cfg.faintMag },
      uAlphaCap: { value: cfg.alphaCap },
      uMinSize: { value: cfg.minSize },
      uMaxSize: { value: cfg.maxSize },
      uPixelRatio: { value: getRenderPixelRatio() },
      uLayerAlpha: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
}

const STAR_UNIT_TO_AU = PC_TO_AU

/** Chunk budget per point layer. chunkCatalog subdivides adaptively, so the real chunk count comes
 *  out ~1.5-2x this (≈200-250 for the three catalogs). Measured on stars.bin at a 55° FOV from the
 *  Sun: 64 -> 42% of vertices drawn, 128 -> 30%, 256 -> 22%, 512 -> 16%. Past ~128 the returns
 *  shrink while the visible-chunk (draw call) count keeps climbing, so 128 is the knee. */
const CHUNK_TARGET = 128

/** Frustum-test slop for a chunk's bounding sphere. gl_PointSize draws each point as a screen-space
 *  square centered on its vertex, so a point whose vertex is just outside the frustum can still
 *  paint pixels. `radius * 1.05` covers chunk-local slop; the `+ 0.02 * distance` term covers the
 *  point's own angular half-width — the widest point is 14 px * 1.5 dpr, i.e. ~10 px of half-width,
 *  which at a 55° FOV on a ~900 px-tall viewport is ~1.2% of the distance to the chunk (less at
 *  narrower FOVs), so 2% is comfortably conservative. Without the distance term a far-away chunk
 *  with a tiny radius would get almost no margin at all. Verified: culled-vs-uncelled renders are
 *  pixel-identical (0 of 1.7M pixels differ) across 15 vantages and FOVs from 15° to 90°. */
const CULL_RADIUS_SCALE = 1.05
const CULL_DISTANCE_SLOP = 0.02

export interface PointLayer {
  /** Container holding one THREE.Points per spatial chunk, plus a last child that draws the whole
   *  catalog in one call for frames where nothing culls (all share one set of attributes and one
   *  material). Hidden wholesale when the layer's crossfade alpha is ~0. */
  group: THREE.Group
  /** The chunk-reordered catalog actually uploaded to the GPU — NOT the on-disk point order. */
  catalog: StarCatalog
  chunks: ChunkInfo[]
  /** newIndexOf[onDiskIndex] = index in `catalog`. Any sidecar that indexes the on-disk catalog
   *  (e.g. starnames.json) MUST be remapped through this — see loadStarField. */
  newIndexOf: Uint32Array
  /** Call each frame with the camera's true heliocentric position in AU, this layer's crossfade
   *  alpha (0..1), and (optionally) the camera — passing the camera enables per-chunk frustum
   *  culling and requires the camera's matrixWorldInverse to already reflect this frame. */
  update(camTruePosAu: THREE.Vector3, layerAlpha?: number, camera?: THREE.Camera): void
}

// Per-frame scratch — shared across all layers (culling is strictly synchronous), so per-frame
// culling allocates nothing.
const scratchViewProj = new THREE.Matrix4()
const scratchFrustum = new THREE.Frustum()
const scratchSphere = new THREE.Sphere()
const scratchCamPos = new THREE.Vector3()

/** Dev-only per-frame culling counters, surfaced as window.__cosmosStats. Stripped from prod
 *  builds: `import.meta.env.DEV` is a compile-time constant, so the whole body folds away. */
interface CosmosStats {
  chunksVisible: number
  chunksTotal: number
  byLayer: Record<string, { visible: number; total: number }>
}
function reportChunkStats(layer: string, visible: number, total: number): void {
  if (!import.meta.env.DEV) return
  const w = window as unknown as { __cosmosStats?: CosmosStats }
  const s = w.__cosmosStats ?? (w.__cosmosStats = { chunksVisible: 0, chunksTotal: 0, byLayer: {} })
  s.byLayer[layer] = { visible, total }
  s.chunksVisible = 0; s.chunksTotal = 0
  for (const v of Object.values(s.byLayer)) { s.chunksVisible += v.visible; s.chunksTotal += v.total }
}

/** Fetches a CSMS-format point catalog from `url` and builds a shader-driven Points layer sharing
 * the star/galaxy/Milky Way point shader. Reused by loadStarField (which adds the names sidecar),
 * loadGalaxyField, and any other bare point-cloud layer (e.g. the Milky Way bridge layer).
 *
 * The catalog is spatially chunk-sorted at load time and rendered as one THREE.Points per chunk,
 * so each frame only submits the chunks whose bounding sphere intersects the view frustum. Every
 * chunk geometry SHARES the single set of BufferAttributes (one GPU upload for the whole catalog)
 * and differs only in its drawRange. */
export async function loadPointLayer(scene: THREE.Scene, url: string, config: PointLayerConfig): Promise<PointLayer> {
  const binRes = await fetch(url)
  if (!binRes.ok) throw new Error(`${url} fetch failed`)
  const decoded = decodeCatalog(await binRes.arrayBuffer())

  // Yield the main thread before chunking. chunkCatalog is a single synchronous ~140 ms pass on a
  // 1M-point catalog, and a fetch resolving mid-gesture would otherwise run it inside whatever
  // frame the user is currently interacting with — a visible hitch right at startup, which is
  // exactly when the user is first grabbing the camera. requestIdleCallback defers it to a moment
  // the browser reports as idle; setTimeout(0) is the Safari fallback (still a fresh task, so the
  // pending input/render work in the current task gets to finish first).
  await new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve())
    else setTimeout(resolve, 0)
  })

  const { catalog, chunks, newIndexOf } = chunkCatalog(decoded, CHUNK_TARGET)

  const geo = buildPointGeometry(catalog)
  const mat = makePointMaterial(config)

  const group = new THREE.Group()
  group.matrixAutoUpdate = false
  group.visible = mat.uniforms.uLayerAlpha.value > 0.002 // consistent with the default uLayerAlpha (1.0)

  const posAttr = geo.getAttribute('position')
  const magAttr = geo.getAttribute('absMag')
  const colAttr = geo.getAttribute('starColor')
  const chunkPoints = chunks.map((c) => {
    // A drawRange is per-geometry, so each chunk needs its own BufferGeometry — but they all
    // reference the SAME BufferAttribute objects, so three uploads each attribute exactly once
    // and the extra geometries cost only their (tiny) JS wrappers plus one VAO each.
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', posAttr)
    g.setAttribute('absMag', magAttr)
    g.setAttribute('starColor', colAttr)
    g.setDrawRange(c.start, c.count)
    const p = new THREE.Points(g, mat)
    p.frustumCulled = false // shader-space positions; three's culling would use wrong bounds — we cull manually below
    p.matrixAutoUpdate = false
    // Explicit safe default: nothing is drawn until the first update() decides what's visible.
    // Otherwise the state between "layer added to the scene" and "first update()" depends on
    // microtask/frame ordering, and in the window where it lands, EVERY chunk would draw the same
    // vertices the whole-catalog child also draws — the full catalog rendered ~250 times over.
    p.visible = false
    group.add(p)
    return p
  })
  // Fast path for views where nothing culls (e.g. the whole galaxy on screen): one draw over the
  // full attribute range instead of ~250 per-chunk draws. Same buffers, no extra memory — and it
  // matters, because ~250 chunk draws cost ~0.2 ms of CPU submission time each frame while saving
  // no GPU work at all when every chunk is on screen. Added last so children[i] stays chunk i.
  const wholePoints = new THREE.Points(geo, mat)
  wholePoints.frustumCulled = false
  wholePoints.matrixAutoUpdate = false
  wholePoints.visible = false
  group.add(wholePoints)
  scene.add(group)

  const unitToAu = config.unitToAu
  const layerName = url.split('/').pop()?.replace(/\.bin$/, '') ?? 'layer'

  const drawWhole = (): void => {
    wholePoints.visible = true
    for (const p of chunkPoints) p.visible = false
  }

  const layer: PointLayer = {
    group, catalog, chunks, newIndexOf,
    update(camTruePosAu, layerAlpha = 1, camera) {
      scratchCamPos.set(camTruePosAu.x / unitToAu, camTruePosAu.y / unitToAu, camTruePosAu.z / unitToAu)
      ;(mat.uniforms.uCamPc.value as THREE.Vector3).copy(scratchCamPos)
      mat.uniforms.uLayerAlpha.value = layerAlpha
      // Read every frame, not just at material creation: the resolution governor (or a window
      // drag to a different-DPI display) can change the applied ratio at any time — see
      // renderer.ts's getRenderPixelRatio doc comment.
      mat.uniforms.uPixelRatio.value = getRenderPixelRatio()
      // Below-threshold layers cost full vertex work every frame even at alpha 0 (no per-point
      // gating in the shader) — three.js skips the draw call entirely when the group is invisible,
      // so this is the actual perf win, not just a visual nicety.
      const visible = layerAlpha > 0.002
      group.visible = visible
      if (!visible) { reportChunkStats(layerName, 0, chunks.length); return }

      if (!camera) { // no camera passed: draw everything in one call (pre-culling behaviour)
        drawWhole()
        reportChunkStats(layerName, chunks.length, chunks.length)
        return
      }

      // The vertex shader places points at (position - uCamPc) * unitToAu and the object matrix is
      // identity, so chunk bounds live in the same space the camera's view-projection matrix
      // consumes (the GL camera itself always sits at the origin).
      scratchFrustum.setFromProjectionMatrix(
        scratchViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      let nVisible = 0
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]
        scratchSphere.center.set(
          (c.center[0] - scratchCamPos.x) * unitToAu,
          (c.center[1] - scratchCamPos.y) * unitToAu,
          (c.center[2] - scratchCamPos.z) * unitToAu)
        scratchSphere.radius = c.radius * unitToAu * CULL_RADIUS_SCALE
          + scratchSphere.center.length() * CULL_DISTANCE_SLOP
        const vis = scratchFrustum.intersectsSphere(scratchSphere)
        chunkPoints[i].visible = vis
        if (vis) nVisible++
      }
      if (nVisible === chunks.length) drawWhole()
      else wholePoints.visible = false
      reportChunkStats(layerName, nVisible, chunks.length)
    },
  }
  return layer
}

export async function loadStarField(scene: THREE.Scene): Promise<StarField> {
  // Fetch + parse the names sidecar BEFORE loadPointLayer: loadPointLayer adds the Points mesh
  // to the scene as soon as stars.bin decodes, so if it ran concurrently with a names fetch
  // that then failed, the whole load would reject while the mesh stayed orphaned in the scene
  // (frozen at default uniforms, never updated or disposed). Sequencing guarantees nothing is
  // added to the scene unless the entire layer load succeeds — worth the small parallelism loss.
  const namesRes = await fetch(import.meta.env.BASE_URL + 'starnames.json')
  if (!namesRes.ok) throw new Error('star names fetch failed')
  const diskNames = (await namesRes.json()) as Record<string, number>

  const layer = await loadPointLayer(scene, import.meta.env.BASE_URL + 'stars.bin', {
    unitToAu: STAR_UNIT_TO_AU, unitToPc: 1, scale: 9, faintMag: 6.5, alphaCap: 1, minSize: 0.75, maxSize: 14,
  })

  // starnames.json indexes stars.bin's ON-DISK order; loadPointLayer spatially reorders the
  // catalog for chunk culling, so every name index must be remapped or every named star (search
  // results, click-to-focus, info cards, fly-to targets) would point at an unrelated star.
  const names: Record<string, number> = {}
  for (const [name, idx] of Object.entries(diskNames)) {
    if (idx >= 0 && idx < layer.newIndexOf.length) names[name] = layer.newIndexOf[idx]
  }

  return { ...layer, names }
}
