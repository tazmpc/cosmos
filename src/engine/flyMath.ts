import { PITCH_LIMIT } from './cameraControls'

/** Converts a normalized direction `d` into the (yaw, pitch) FocusOrbitControls.setOrientation
 *  expects, such that the controls' camera OFFSET (see getOffset) points along `d`. Used by
 *  FlyToAnimator's arrival "auto-aim": with d = normalize(targetPos − anchorPos), the camera ends
 *  up beyond the target along the anchor→target line, framing the anchor behind it. Pure — no
 *  THREE dependency — so the trig is unit-testable directly against plain {x,y,z} vectors.
 *  Pitch is clamped to the same PITCH_LIMIT the controls themselves enforce (poles unreachable). */
export function aimOrientation(d: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const yaw = Math.atan2(d.y, d.x)
  const rawPitch = Math.asin(Math.max(-1, Math.min(1, d.z)))
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rawPitch))
  return { yaw, pitch }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Interpolate a positive scalar in log space: t=0.5 gives the geometric mean. */
export function logLerp(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) * (1 - t) + Math.log(b) * t)
}

/** Seconds for a fly-to, scaled by orders of magnitude traversed, clamped 2–6 s. */
export function flyDuration(d0: number, d1: number): number {
  const decades = Math.abs(Math.log10(Math.max(d0, d1) / Math.min(d0, d1)))
  return Math.min(6, Math.max(2, 1 + 0.5 * decades))
}
