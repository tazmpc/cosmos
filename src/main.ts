import { createEngine } from './engine/renderer'

const engine = createEngine(document.getElementById('app')!)

function frame() {
  engine.renderer.render(engine.scene, engine.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
