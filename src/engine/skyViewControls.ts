import * as THREE from 'three'

// ±1.52 rad ≈ 87.1°: same lookAt-instability margin FocusOrbitControls uses near camera.up (+Z).
const PITCH_LIMIT = 1.52

/**
 * Pure yaw/pitch -> unit view direction. Same spherical convention as
 * FocusOrbitControls.getOffset (up = +Z): yaw rotates in the XY plane, pitch tilts toward +Z.
 */
export function viewDirFromYawPitch(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch)
  return out.set(Math.cos(yaw) * cp, Math.sin(yaw) * cp, Math.sin(pitch))
}

/**
 * Sky-view look-around controls: pointer drag rotates a view DIRECTION (not an orbit focus),
 * wheel adjusts camera.fov. Mirrors FocusOrbitControls' pointer handling (drag bookkeeping,
 * pointercancel/lostpointercapture guards) but has no focus/distance state of its own.
 *
 * Both control classes stay attached to the canvas for the app's lifetime; only one is
 * `enabled` at a time (main.ts's mode machine flips the flags on sky-view entry/exit) so
 * their listeners can coexist without fighting over drag state.
 */
export class SkyViewControls {
  enabled = true
  fov = 55
  private yaw = 0
  private pitch = 0
  private dragging = false
  private lastX = 0
  private lastY = 0

  constructor(canvas: HTMLElement) {
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (!this.enabled) return
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.enabled || !this.dragging) return
      this.yaw -= (e.clientX - this.lastX) * 0.005
      this.pitch += (e.clientY - this.lastY) * 0.005
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch))
      this.lastX = e.clientX; this.lastY = e.clientY
    })
    canvas.addEventListener('pointerup', () => { this.dragging = false })
    canvas.addEventListener('pointercancel', () => { this.dragging = false })
    canvas.addEventListener('lostpointercapture', () => { this.dragging = false })
    canvas.addEventListener('wheel', (e: WheelEvent) => {
      if (!this.enabled) return
      e.preventDefault()
      // same exp zoom-speed shape as FocusOrbitControls' distance zoom, applied to fov instead
      this.fov = Math.max(15, Math.min(90, this.fov * Math.exp(e.deltaY * 0.0008)))
    }, { passive: false })
  }

  getViewDir(out: THREE.Vector3): THREE.Vector3 {
    return viewDirFromYawPitch(this.yaw, this.pitch, out)
  }
}
