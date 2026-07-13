import * as THREE from 'three'
import { createEngine } from './engine/renderer'
import { FocusOrbitControls, type Focusable } from './engine/cameraControls'
import { createSolarSystem, updatePositions, repositionMeshes, type PlanetNode } from './scene/solarSystem'
import { SimClock } from './sim/clock'
import { formatDistance } from './ui/format'
import { loadStarField, type StarField } from './scene/starField'
import { showBanner } from './ui/banner'

const engine = createEngine(document.getElementById('app')!)
const clock = new SimClock(new Date())
const { nodes: planets, sunLight } = createSolarSystem(engine.scene)

let stars: StarField | null = null
loadStarField(engine.scene)
  .then(s => { stars = s })
  .catch(() => showBanner('Star catalog failed to load — solar system only.'))

export function planetFocusable(n: PlanetNode): Focusable {
  return {
    name: n.def.name,
    getPosition: (out) => out.copy(n.truePos),
    minApproachAu: n.def.radiusAu * 1.4,
  }
}

const earth = planets.find(p => p.def.id === 'earth')!
const controls = new FocusOrbitControls(
  engine.renderer.domElement, planetFocusable(earth), earth.def.radiusAu * 40)

const hudName = document.querySelector('#hud .focus-name')!
const hudDist = document.querySelector('#hud .focus-dist')!
const camTruePos = new THREE.Vector3()

function frame(realMs: number) {
  clock.tick(realMs)
  updatePositions(planets, clock.now())
  controls.getCameraTruePos(camTruePos)
  stars?.update(camTruePos)
  repositionMeshes(planets, sunLight, camTruePos)
  controls.applyToCamera(engine.camera)

  hudName.textContent = controls.focus.name
  hudDist.textContent = formatDistance(controls.distance)

  engine.renderer.render(engine.scene, engine.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
