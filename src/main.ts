import * as THREE from 'three'
import { createEngine } from './engine/renderer'
import { createSolarSystem, updateSolarSystem } from './scene/solarSystem'
import { SimClock } from './sim/clock'

const engine = createEngine(document.getElementById('app')!)
const clock = new SimClock(new Date())
const planets = createSolarSystem(engine.scene)

// temporary: hover 40 planet-radii from Earth looking at it
const camTruePos = new THREE.Vector3()

function frame(realMs: number) {
  clock.tick(realMs)
  const date = clock.now()

  const earth = planets.find(p => p.def.id === 'earth')!
  updateSolarSystem(planets, engine.scene, date, camTruePos) // first pass to get truePos
  camTruePos.copy(earth.truePos).add(new THREE.Vector3(0, -earth.def.radiusAu * 40, earth.def.radiusAu * 10))
  updateSolarSystem(planets, engine.scene, date, camTruePos) // re-express relative to camera
  engine.camera.position.set(0, 0, 0)
  engine.camera.lookAt(earth.mesh.position)

  engine.renderer.render(engine.scene, engine.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
