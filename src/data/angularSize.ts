import { PC_TO_LY } from './units'

const MIN_FOV_DEG = 0.05
const MAX_FOV_DEG = 10
/** hips2fits FOV padding: the object's true angular diameter times this, so the whole object
 * (plus a margin) sits inside the square cutout instead of exactly filling it edge-to-edge. */
const PADDING = 1.6

/** True angular diameter (degrees) of an object `diameterLy` across at `distPc` parsecs, via
 * the standard 2·atan((diameter/2)/dist) formula, padded 1.6x for the hips2fits FOV parameter
 * and clamped to [0.05°, 10°] — sane bounds for a single-cutout request (hips2fits itself allows
 * a wider range, but sub-arcminute or many-degree cutouts aren't useful for a billboard sprite). */
export function angularFovDeg(diameterLy: number, distPc: number): number {
  const radiusPc = diameterLy / PC_TO_LY / 2
  const angleDeg = 2 * Math.atan(radiusPc / distPc) * (180 / Math.PI) * PADDING
  return Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, angleDeg))
}

/** Same padding/clamp as angularFovDeg, but from a directly-measured angular size (arcmin, e.g.
 *  OpenNGC's MajAx) rather than derived from diameter+distance. Strictly more accurate whenever
 *  the catalog gives angular size directly — it skips round-tripping through a distance that, for
 *  OpenNGC, is only ever a type-based placeholder and would otherwise distort the FOV. */
export function angularFovDegFromArcmin(majAxArcmin: number): number {
  const angleDeg = (majAxArcmin / 60) * PADDING
  return Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, angleDeg))
}
