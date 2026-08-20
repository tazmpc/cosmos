import * as THREE from 'three'
import { aimOrientation, easeInOutCubic, flyDuration, logLerp } from './flyMath'
import type { Focusable, FocusOrbitControls } from './cameraControls'

/**
 * Animates controls.focus from its current subject to a target:
 * focus point lerps linearly (target tracked live — planets move),
 * distance lerps in log space. Never a teleport.
 */
export class FlyToAnimator {
  private active = false
  private t = 0
  private dur = 0
  private startFocusPos = new THREE.Vector3()
  private startDist = 0
  private target: Focusable | null = null
  private arriveDist = 0
  private virtualFocus = new THREE.Vector3()
  private tmp = new THREE.Vector3()
  private aimAnchorPos = new THREE.Vector3()
  private aimDir = new THREE.Vector3()

  constructor(private controls: FocusOrbitControls) {}

  start(target: Focusable, arriveDist: number): void {
    this.controls.focus.getPosition(this.startFocusPos)
    this.startDist = this.controls.distance
    this.target = target
    this.arriveDist = Math.max(arriveDist, target.minApproachAu)
    this.dur = flyDuration(this.startDist, this.arriveDist)
    this.t = 0
    this.active = true
    // while flying, the controls' focus is a virtual point we move each frame
    const vf = this.virtualFocus
    this.controls.setFocus({
      name: target.name,
      getPosition: (out) => out.copy(vf),
      minApproachAu: 1e-9,
    })
  }

  isActive(): boolean { return this.active }

  /** Aborts an in-flight animation, leaving controls.focus wherever the virtual focus last was
   * (sky-view entry calls this — the orbit focus/distance state doesn't matter again until the
   * user exits sky view, at which point it's simply whatever it was left as). */
  cancel(): void {
    this.active = false
    this.target = null
  }

  update(dtSeconds: number): void {
    if (!this.active || !this.target) return
    this.t = Math.min(1, this.t + dtSeconds / this.dur)
    const s = easeInOutCubic(this.t)
    this.target.getPosition(this.tmp) // live target position
    this.virtualFocus.lerpVectors(this.startFocusPos, this.tmp, s)
    this.controls.distance = logLerp(this.startDist, this.arriveDist, s)
    if (this.t >= 1) {
      this.active = false
      // Auto-aim: point the camera's offset direction (see FocusOrbitControls.getOffset) along
      // anchor -> target, so the camera sits beyond the target with its context anchor (a moon's
      // parent planet, an asteroid/spacecraft's Sun) framed behind it. Must run BEFORE setFocus
      // below — setOrientation only changes yaw/pitch, setFocus below re-clamps distance.
      if (this.target.aimAnchor) {
        this.aimAnchorPos.copy(this.target.aimAnchor())
        this.aimDir.copy(this.tmp).sub(this.aimAnchorPos)
        if (this.aimDir.lengthSq() > 1e-30) {
          this.aimDir.normalize()
          const { yaw, pitch } = aimOrientation(this.aimDir)
          this.controls.setOrientation(yaw, pitch)
        }
      }
      this.controls.setFocus(this.target, this.arriveDist)
      this.target = null
    }
  }
}
