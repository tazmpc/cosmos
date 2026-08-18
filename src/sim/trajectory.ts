/**
 * Cubic Hermite (Catmull-Rom tangent) interpolation over a small set of discrete position
 * samples — used by the spacecraft layer (src/scene/spacecraft.ts) to turn ~800-2000 baked
 * Horizons vectors (public/spacecraft.json, scripts/build-spacecraft.ts) into a smooth,
 * continuously-queryable trajectory, the same role elementsToHeliocentricEqj plays for the
 * Keplerian asteroid belt — except spacecraft trajectories (powered flight, gravity assists, a
 * station-keeping halo orbit at L2) have no closed-form model, so the only option is to fit a
 * curve through the ephemeris samples themselves.
 *
 * Non-uniform-time Catmull-Rom: the tangent at each interior sample is the central finite
 * difference (P[k+1] - P[k-1]) / (t[k+1] - t[k-1]), scaled to the local segment's time span; the
 * two end samples use a one-sided (secant) tangent instead, since there is no P[-1] or P[n]. This
 * is exact for a linear trajectory (the finite-difference tangent equals the true slope
 * regardless of sample spacing) and interpolates through every sample exactly (Hermite basis
 * functions are 1/0 at their own endpoint and 0 elsewhere).
 */

export interface Xyz {
  x: number
  y: number
  z: number
}

/** Finds the index i such that jd[i] <= target <= jd[i+1] (clamped to [0, n-2]) via binary
 *  search. `jdSamples` must be sorted ascending. */
function findSegment(jdSamples: number[], jd: number): number {
  const n = jdSamples.length
  let lo = 0
  let hi = n - 1
  // Standard upper-bound search: find the first index whose sample is > jd, then step back one.
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (jdSamples[mid] <= jd) lo = mid + 1
    else hi = mid
  }
  // lo is now the first index with jdSamples[lo] > jd (or n if none). The segment start is
  // one before that, clamped so the last sample still resolves to the final segment.
  return Math.max(0, Math.min(n - 2, lo - 1))
}

function at(xyz: number[], i: number): Xyz {
  return { x: xyz[i * 3], y: xyz[i * 3 + 1], z: xyz[i * 3 + 2] }
}

/** Tangent at sample index k (as a plain per-day rate, i.e. dP/dt), for the segment [k, k+1]
 *  whose span is `segSpanDays`. Interior points use the central Catmull-Rom difference; endpoints
 *  (k == 0 or k == n-1) fall back to the one-sided secant into their only neighbour. */
function tangent(jdSamples: number[], xyz: number[], k: number): Xyz {
  const n = jdSamples.length
  if (k > 0 && k < n - 1) {
    const span = jdSamples[k + 1] - jdSamples[k - 1]
    const p0 = at(xyz, k - 1)
    const p2 = at(xyz, k + 1)
    return { x: (p2.x - p0.x) / span, y: (p2.y - p0.y) / span, z: (p2.z - p0.z) / span }
  }
  if (k === 0) {
    const span = jdSamples[1] - jdSamples[0]
    const p0 = at(xyz, 0)
    const p1 = at(xyz, 1)
    return { x: (p1.x - p0.x) / span, y: (p1.y - p0.y) / span, z: (p1.z - p0.z) / span }
  }
  // k === n - 1
  const span = jdSamples[n - 1] - jdSamples[n - 2]
  const p0 = at(xyz, n - 2)
  const p1 = at(xyz, n - 1)
  return { x: (p1.x - p0.x) / span, y: (p1.y - p0.y) / span, z: (p1.z - p0.z) / span }
}

/**
 * Interpolates a position at Julian Date `jd` from parallel sample arrays: `jdSamples` (sorted
 * ascending, length n) and `xyz` (flat, length 3n — [x0,y0,z0, x1,y1,z1, ...]).
 *
 * Outside [jdSamples[0], jdSamples[n-1]] the result clamps to the nearest endpoint sample rather
 * than extrapolating — a spacecraft trajectory fit has no business being asked to guess where a
 * probe was before its baked data starts or after it ends.
 */
export function interpolateTrajectory(jdSamples: number[], xyz: number[], jd: number): Xyz {
  const n = jdSamples.length
  if (n === 0) throw new Error('interpolateTrajectory: no samples')
  if (n === 1 || jd <= jdSamples[0]) return at(xyz, 0)
  if (jd >= jdSamples[n - 1]) return at(xyz, n - 1)

  const i = findSegment(jdSamples, jd)
  const t1 = jdSamples[i]
  const t2 = jdSamples[i + 1]
  const span = t2 - t1
  const s = (jd - t1) / span

  const p1 = at(xyz, i)
  const p2 = at(xyz, i + 1)
  // Tangents scaled from per-day rates to per-segment (the Hermite basis below is parameterised
  // by s in [0,1] over this one segment, so dP/ds = dP/dt * span).
  const m1raw = tangent(jdSamples, xyz, i)
  const m2raw = tangent(jdSamples, xyz, i + 1)
  const m1 = { x: m1raw.x * span, y: m1raw.y * span, z: m1raw.z * span }
  const m2 = { x: m2raw.x * span, y: m2raw.y * span, z: m2raw.z * span }

  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2

  return {
    x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
    y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
    z: h00 * p1.z + h10 * m1.z + h01 * p2.z + h11 * m2.z,
  }
}
