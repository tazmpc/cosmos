import * as THREE from 'three'
import { decodeCatalog, type StarCatalog } from '../data/catalogFormat'
import { colorIndexToRgb } from '../data/starColor'

export interface StarField {
  points: THREE.Points
  catalog: StarCatalog
  names: Record<string, number>
  /** Call each frame with the camera's true heliocentric position in AU, and this layer's crossfade alpha (0..1). */
  update(camTruePosAu: THREE.Vector3, layerAlpha?: number): void
}

/** Configures a point-cloud layer (stars, galaxies, …) sharing the same shader. */
export interface PointLayerConfig {
  unitToAu: number  // conversion factor from the catalog's position units to AU (e.g. parsecs or megaparsecs)
  scale: number      // point size scale
  faintMag: number   // apparent mag at/below which a point is full-alpha; fainter points fade toward the discard cutoff
  minSize: number
  maxSize: number
}

const VERT = /* glsl */ `
  uniform vec3 uCamPc;       // camera position, in catalog position units
  uniform float uUnitToAu;   // catalog position units -> AU
  uniform float uScale;      // point size scale
  uniform float uFaintMag;   // apparent mag at/below which a point is full-alpha; fainter points fade toward the discard cutoff
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
    float appMag = absMag + 5.0 * (log(distUnits) / 2.302585 - 1.0);
    gl_PointSize = clamp(uScale * pow(10.0, -0.2 * appMag), uMinSize, uMaxSize) * uPixelRatio;
    vAlpha = clamp(pow(10.0, -0.4 * (appMag - uFaintMag)), 0.0, 1.0) * uLayerAlpha;
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
      uScale: { value: cfg.scale },
      uFaintMag: { value: cfg.faintMag },
      uMinSize: { value: cfg.minSize },
      uMaxSize: { value: cfg.maxSize },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uLayerAlpha: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
}

const STAR_UNIT_TO_AU = 206264.806

export async function loadStarField(scene: THREE.Scene): Promise<StarField> {
  const [binRes, namesRes] = await Promise.all([fetch('/stars.bin'), fetch('/starnames.json')])
  if (!binRes.ok || !namesRes.ok) throw new Error('star catalog fetch failed')
  const catalog = decodeCatalog(await binRes.arrayBuffer())
  const names = (await namesRes.json()) as Record<string, number>

  const geo = buildPointGeometry(catalog)
  const mat = makePointMaterial({
    unitToAu: STAR_UNIT_TO_AU, scale: 9, faintMag: 6.5, minSize: 0.75, maxSize: 14,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // shader-space positions; three's culling would use wrong bounds
  points.matrixAutoUpdate = false
  scene.add(points)

  return {
    points, catalog, names,
    update(camTruePosAu, layerAlpha = 1) {
      ;(mat.uniforms.uCamPc.value as THREE.Vector3)
        .set(camTruePosAu.x / STAR_UNIT_TO_AU, camTruePosAu.y / STAR_UNIT_TO_AU, camTruePosAu.z / STAR_UNIT_TO_AU)
      mat.uniforms.uLayerAlpha.value = layerAlpha
    },
  }
}
