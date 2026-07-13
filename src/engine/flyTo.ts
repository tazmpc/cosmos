import * as THREE from 'three'
import { easeInOutCubic, flyDuration, logLerp } from './flyMath'
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

  update(dtSeconds: number): void {
    if (!this.active || !this.target) return
    this.t = Math.min(1, this.t + dtSeconds / this.dur)
    const s = easeInOutCubic(this.t)
    this.target.getPosition(this.tmp) // live target position
    this.virtualFocus.lerpVectors(this.startFocusPos, this.tmp, s)
    this.controls.distance = logLerp(this.startDist, this.arriveDist, s)
    if (this.t >= 1) {
      this.active = false
      this.controls.setFocus(this.target, this.arriveDist)
      this.target = null
    }
  }
}
