import * as THREE from 'three'

export interface Focusable {
  name: string
  /** True heliocentric EQJ position in AU (doubles). */
  getPosition(out: THREE.Vector3): THREE.Vector3
  /** Closest allowed camera distance in AU (planet: ~1.4 radii; star: 500). */
  minApproachAu: number
}

const MAX_DIST_AU = 4e14 // ~1.9 Gpc, just beyond the deepest galaxy in the catalog

export class FocusOrbitControls {
  focus: Focusable
  distance: number
  // false while sky view owns the canvas (SkyViewControls is enabled instead) — listeners
  // stay attached but no-op, so re-enabling on sky-view exit resumes exactly where it left off.
  enabled = true
  private yaw = 0.5
  private pitch = 0.4 // radians from equatorial plane, clamped
  private dragging = false
  private lastX = 0; private lastY = 0
  private tmpFocus = new THREE.Vector3()

  constructor(canvas: HTMLElement, focus: Focusable, distance: number) {
    this.focus = focus
    this.distance = distance
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.dragging) return
      this.yaw -= (e.clientX - this.lastX) * 0.005
      this.pitch += (e.clientY - this.lastY) * 0.005
      // ±1.52 rad ≈ 87.1°: lookAt-based orientation becomes roll-unstable as the view direction approaches camera.up (+Z)
      this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch))
      this.lastX = e.clientX; this.lastY = e.clientY
    })
    canvas.addEventListener('pointerup', () => { this.dragging = false })
    canvas.addEventListener('pointercancel', () => { this.dragging = false })
    canvas.addEventListener('lostpointercapture', () => { this.dragging = false })
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return
      e.preventDefault()
      // zoom speed proportional to current distance: works at every scale
      this.distance *= Math.exp(e.deltaY * 0.0012)
      this.clampDistance()
    }, { passive: false })
  }

  setFocus(f: Focusable, distance?: number): void {
    this.focus = f
    if (distance !== undefined) this.distance = distance
    this.clampDistance()
  }

  private clampDistance(): void {
    this.distance = Math.max(this.focus.minApproachAu, Math.min(MAX_DIST_AU, this.distance))
  }

  /** Camera offset from focus, EQJ AU. */
  getOffset(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return out.set(
      this.distance * cp * Math.cos(this.yaw),
      this.distance * cp * Math.sin(this.yaw),
      this.distance * Math.sin(this.pitch),
    )
  }

  /** True camera position = focus position + offset (doubles). */
  getCameraTruePos(out: THREE.Vector3): THREE.Vector3 {
    this.focus.getPosition(this.tmpFocus)
    return this.getOffset(out).add(this.tmpFocus)
  }

  /** Orient the GL camera (which always sits at the GL origin) to look at the focus. */
  applyToCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(0, 0, 0)
    const toFocus = this.getOffset(new THREE.Vector3()).negate()
    camera.lookAt(toFocus)
  }
}
