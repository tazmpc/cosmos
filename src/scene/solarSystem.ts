import * as THREE from 'three'
import { PLANETS, type PlanetDef } from '../data/planets'
import { bodyPosition } from '../sim/ephemeris'
import { addSaturnRings } from './rings'

export interface PlanetNode {
  def: PlanetDef
  mesh: THREE.Mesh
  truePos: THREE.Vector3 // heliocentric EQJ AU, double precision (JS numbers)
}

// Atmosphere rim shader: additive fresnel glow, BackSide so the visible fragments are the far
// hemisphere of the shell (grazing the limb from the camera's POV). Mandatory
// #include <common> + the four logdepthbuf chunks, placed exactly as starField.ts — any custom
// ShaderMaterial in this scene fails to compile / breaks depth without them.
const ATMOSPHERE_VERT = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vNormalView = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;

    #include <logdepthbuf_vertex>
  }
`

const ATMOSPHERE_FRAG = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float d = dot(normalize(vViewDir), normalize(vNormalView));
    // clamp before pow: pow() with a negative base is undefined in GLSL, and 1.0 - d can exceed
    // 1.0 on the shell's far side once BackSide flips which triangles are rasterized.
    float intensity = pow(clamp(1.0 - d, 0.0, 1.0), 3.0) * 0.6;
    gl_FragColor = vec4(vec3(0.35, 0.55, 1.0) * intensity, intensity);

    #include <logdepthbuf_fragment>
  }
`

// Module-level state for the Earth night-lights uniform, updated once per frame from
// updateEarthNight(). Only one Earth is ever created per app session so a module singleton is
// simpler than threading a handle through PlanetNode / the frame-loop call sites.
let earthNightState: { node: PlanetNode; uSunDirView: THREE.Vector3 } | null = null
const _sunDirWorld = new THREE.Vector3()

export function createSolarSystem(scene: THREE.Scene): { nodes: PlanetNode[]; sunLight: THREE.PointLight } {
  const loader = new THREE.TextureLoader()
  const nodes: PlanetNode[] = []

  scene.add(new THREE.AmbientLight(0xffffff, 0.04))

  for (const def of PLANETS) {
    const geo = new THREE.SphereGeometry(def.radiusAu, 48, 24)
    let mat: THREE.Material
    if (!def.texture) {
      mat = new THREE.MeshLambertMaterial({ color: def.color ?? 0x888888 })
    } else {
      const tex = loader.load(`${import.meta.env.BASE_URL}textures/${def.texture}`)
      tex.colorSpace = THREE.SRGBColorSpace
      mat = def.id === 'sun'
        ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshLambertMaterial({ map: tex })
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = Math.PI / 2 // sphere poles → +Z (EQJ north)
    mesh.userData.planetId = def.id
    scene.add(mesh)
    if (def.id === 'saturn') addSaturnRings(mesh)
    let earthNightUniforms: { uSunDirView: THREE.Vector3 } | null = null
    if (def.id === 'earth') earthNightUniforms = addEarthExtras(mesh, def, mat as THREE.MeshLambertMaterial, loader)
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
    const node: PlanetNode = { def, mesh, truePos: new THREE.Vector3() }
    nodes.push(node)
    if (earthNightUniforms) earthNightState = { node, uSunDirView: earthNightUniforms.uSunDirView }
  }

  const sunLight = new THREE.PointLight(0xffffff, 2.5, 0, 0) // decay 0: physically wrong, visually right at AU scales
  sunLight.name = 'sunLight'
  scene.add(sunLight)

  return { nodes, sunLight }
}

/** Clouds, atmosphere rim, and night-lights for Earth. Called once from createSolarSystem's
 * per-planet loop. Returns the night-lights uniform handle so the caller can wire it into
 * earthNightState once the PlanetNode exists (after nodes.push). */
function addEarthExtras(
  earthMesh: THREE.Mesh, def: PlanetDef, dayMat: THREE.MeshLambertMaterial, loader: THREE.TextureLoader,
): { uSunDirView: THREE.Vector3 } {
  // Clouds: second sphere, slightly larger radius, alpha-mapped so only the cloud texture's
  // bright pixels are opaque.
  const cloudsTex = loader.load(`${import.meta.env.BASE_URL}textures/2k_earth_clouds.jpg`)
  const cloudsGeo = new THREE.SphereGeometry(def.radiusAu * 1.008, 48, 24)
  const cloudsMat = new THREE.MeshLambertMaterial({
    color: 0xffffff, alphaMap: cloudsTex, transparent: true, depthWrite: false,
  })
  earthMesh.add(new THREE.Mesh(cloudsGeo, cloudsMat))

  // Atmosphere rim: third sphere, additive fresnel glow, BackSide.
  const atmoGeo = new THREE.SphereGeometry(def.radiusAu * 1.025, 48, 24)
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  })
  earthMesh.add(new THREE.Mesh(atmoGeo, atmoMat))

  // Night lights: injected into the day material via onBeforeCompile rather than a second
  // pass, so it composites correctly with Lambert's existing diffuse/emissive pipeline.
  // uSunDirView is the direction from Earth to the Sun, in VIEW space, recomputed each frame
  // by updateEarthNight() — simpler and more robust than deriving a world-space sun direction
  // from the floating-origin scene graph inside the shader itself.
  const nightTex = loader.load(`${import.meta.env.BASE_URL}textures/2k_earth_nightmap.jpg`)
  nightTex.colorSpace = THREE.SRGBColorSpace
  const uSunDirView = new THREE.Vector3(0, 0, 1)
  dayMat.onBeforeCompile = (shader) => {
    shader.uniforms.uNightMap = { value: nightTex }
    shader.uniforms.uSunDirView = { value: uSunDirView }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uNightMap;\nuniform vec3 uSunDirView;')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
#ifdef USE_MAP
  vec3 nightColor = texture2D( uNightMap, vMapUv ).rgb;
  // dot > 0 = facing the sun (dayside); ramp to full night lights just past the terminator.
  float nightSide = 1.0 - smoothstep(-0.08, 0.12, dot(normalize(vNormal), uSunDirView));
  totalEmissiveRadiance += nightColor * nightSide * 0.9;
#endif`)
  }
  dayMat.needsUpdate = true

  return { uSunDirView }
}

/** Updates the Earth night-lights sun direction for the current frame. Call once per frame
 * after the camera's transform for this frame is finalized (camera.matrixWorld / matrixWorldInverse
 * must be current — call camera.updateMatrixWorld() first if it hasn't run yet this frame). */
export function updateEarthNight(camera: THREE.Camera): void {
  if (!earthNightState) return
  // Sun-to-Earth direction is translation-invariant under the floating-origin camera-relative
  // scene graph: heliocentric truePos already IS the direction from the Sun (fixed at the true
  // origin) to Earth, so no camTruePos term is needed here.
  _sunDirWorld.copy(earthNightState.node.truePos).negate().normalize()
  earthNightState.uSunDirView.copy(_sunDirWorld).transformDirection(camera.matrixWorldInverse)
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
