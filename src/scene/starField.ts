import * as THREE from 'three'
import { decodeCatalog, type StarCatalog } from '../data/catalogFormat'
import { colorIndexToRgb } from '../data/starColor'

export interface StarField {
  points: THREE.Points
  catalog: StarCatalog
  names: Record<string, number>
  /** Call each frame with the camera's true heliocentric position in AU. */
  update(camTruePosAu: THREE.Vector3): void
}

const PC_TO_AU = 206264.806

const VERT = /* glsl */ `
  uniform vec3 uCamPc;       // camera position, parsecs
  uniform float uScale;      // point size scale
  uniform float uFaintMag;   // apparent mag at/below which a star is full-alpha; fainter stars fade toward the discard cutoff
  uniform float uPixelRatio;
  attribute float absMag;
  attribute vec3 starColor;
  varying vec3 vColor;
  varying float vAlpha;

  #include <logdepthbuf_pars_vertex>

  void main() {
    vec3 relAu = (position - uCamPc) * ${PC_TO_AU.toFixed(3)};
    vec4 mv = modelViewMatrix * vec4(relAu, 1.0);
    gl_Position = projectionMatrix * mv;

    #include <logdepthbuf_vertex>

    float distPc = max(length(position - uCamPc), 1e-6);
    float appMag = absMag + 5.0 * (log(distPc) / 2.302585 - 1.0);
    gl_PointSize = clamp(uScale * pow(10.0, -0.2 * appMag), 0.75, 14.0) * uPixelRatio;
    vAlpha = clamp(pow(10.0, -0.4 * (appMag - uFaintMag)), 0.0, 1.0);
    vColor = starColor;
  }
`

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  #include <logdepthbuf_pars_fragment>

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float edge = smoothstep(0.5, 0.1, d);
    gl_FragColor = vec4(vColor, vAlpha * edge);
    if (gl_FragColor.a < 0.003) discard;

    #include <logdepthbuf_fragment>
  }
`

export async function loadStarField(scene: THREE.Scene): Promise<StarField> {
  const [binRes, namesRes] = await Promise.all([fetch('/stars.bin'), fetch('/starnames.json')])
  if (!binRes.ok || !namesRes.ok) throw new Error('star catalog fetch failed')
  const catalog = decodeCatalog(await binRes.arrayBuffer())
  const names = (await namesRes.json()) as Record<string, number>

  const colors = new Float32Array(catalog.count * 3)
  for (let i = 0; i < catalog.count; i++) {
    const [r, g, b] = colorIndexToRgb(catalog.colorIndex[i])
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(catalog.positions, 3))
  geo.setAttribute('absMag', new THREE.BufferAttribute(catalog.absMag, 1))
  geo.setAttribute('starColor', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uCamPc: { value: new THREE.Vector3() },
      uScale: { value: 9.0 },
      uFaintMag: { value: 6.5 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // shader-space positions; three's culling would use wrong bounds
  points.matrixAutoUpdate = false
  scene.add(points)

  return {
    points, catalog, names,
    update(camTruePosAu) {
      ;(mat.uniforms.uCamPc.value as THREE.Vector3)
        .set(camTruePosAu.x / PC_TO_AU, camTruePosAu.y / PC_TO_AU, camTruePosAu.z / PC_TO_AU)
    },
  }
}
