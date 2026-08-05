import type { StarCatalog } from './catalogFormat'

/** One spatially-contiguous run of points inside a chunked catalog, plus its bounding sphere
 *  (in the catalog's own position units — parsecs for stars/Milky Way, megaparsecs for galaxies). */
export interface ChunkInfo {
  /** First point index of the run. */
  start: number
  /** Number of points in the run. */
  count: number
  /** Bounding-sphere center, catalog units. */
  center: [number, number, number]
  /** Bounding-sphere radius, catalog units. Exact: no point in the run is farther than this. */
  radius: number
}

export interface ChunkedCatalog {
  /** A NEW catalog (same CSMS in-memory format) whose points are reordered so each chunk is contiguous. */
  catalog: StarCatalog
  chunks: ChunkInfo[]
  /** newIndexOf[originalIndex] = index of that same point in the reordered catalog. Needed to
   *  remap any external index sidecar (e.g. starnames.json) onto the reordered catalog. */
  newIndexOf: Uint32Array
}

/** Hard recursion cap. Only binds for pathological data: each level halves ONE axis, so the
 *  ~2000:1 dynamic range between the Milky Way's bulge and its outermost points needs ~25. */
const MAX_DEPTH = 32

/**
 * Sorts a point catalog into spatial chunks so the renderer can frustum-cull whole runs of points
 * instead of submitting the entire catalog every frame.
 *
 * Partitioning is an adaptive octree: recursively split a node's bounding box at the SPATIAL
 * MIDPOINT of its longest axis until the node holds at most ceil(count / targetChunks) points.
 * Two alternatives were measured against the real catalogs and both failed, for the same reason —
 * the camera normally sits at the dense center of these catalogs:
 *
 *  - a uniform grid over the bounding box: chunk counts are wildly unequal (the bounding box is
 *    set by a few far outliers, so ~95% of the points land in one or two central cells that are
 *    always on screen). Culled 21 of 64 star chunks but only 6% of the star VERTICES.
 *  - equal-count k-d median splits: every split plane passes near the density center, so every
 *    chunk is a long slab radiating from it, and each slab's bounding sphere engulfs the camera —
 *    77% of vertices drawn even at a 15° FOV.
 *
 * Midpoint splits keep cells cube-ish (compact bounding spheres) while adaptive depth keeps the
 * dense core finely divided, so chunk visibility actually tracks the view direction: ~18-38% of
 * star vertices drawn at a 55° FOV from the Sun, vs 100% before.
 *
 * Bounding spheres are computed from the points actually in the chunk, so they stay tight.
 *
 * @param targetChunks chunk budget: sets the per-chunk point cap to ceil(count / targetChunks).
 *   Adaptive subdivision emits somewhat MORE chunks than this (~1.5-2x for the real catalogs),
 *   since a cell is split until it is under the cap, not until a chunk count is hit.
 */
export function chunkCatalog(catalog: StarCatalog, targetChunks: number): ChunkedCatalog {
  const { count, positions, absMag, colorIndex } = catalog
  if (count === 0) {
    return {
      catalog: { count: 0, positions: new Float32Array(0), absMag: new Float32Array(0), colorIndex: new Float32Array(0) },
      chunks: [],
      newIndexOf: new Uint32Array(0),
    }
  }

  const leafMax = Math.max(1, Math.ceil(count / Math.max(1, targetChunks)))

  // `order` is permuted in place by the splits; order[newIndex] = original index.
  const order = new Uint32Array(count)
  for (let i = 0; i < count; i++) order[i] = i

  const leaves: [number, number][] = [] // [start, end) ranges into `order`
  const stack: [number, number, number][] = [[0, count, 0]] // [start, end, depth]

  while (stack.length > 0) {
    const [lo, hi, depth] = stack.pop()!
    if (hi - lo <= leafMax || depth >= MAX_DEPTH) { leaves.push([lo, hi]); continue }

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = lo; i < hi; i++) {
      const p = order[i] * 3
      const x = positions[p], y = positions[p + 1], z = positions[p + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
    const lo_ = axis === 0 ? minX : axis === 1 ? minY : minZ
    const hi_ = axis === 0 ? maxX : axis === 1 ? maxY : maxZ
    // Zero extent = every point in this node is identical; splitting could never separate them.
    if (!(hi_ > lo_)) { leaves.push([lo, hi]); continue }

    // Partition around the midpoint. The box's min and max are attained by real points, so both
    // sides are non-empty except for float edge cases — guarded below rather than assumed.
    const split = (lo_ + hi_) / 2
    let i = lo, j = hi - 1
    while (i <= j) {
      if (positions[order[i] * 3 + axis] < split) i++
      else { const t = order[i]; order[i] = order[j]; order[j] = t; j-- }
    }
    if (i === lo || i === hi) { leaves.push([lo, hi]); continue }
    stack.push([lo, i, depth + 1])
    stack.push([i, hi, depth + 1])
  }

  leaves.sort((a, b) => a[0] - b[0])

  // Restore ascending original order inside each chunk: the partition scrambles it, and keeping
  // the catalog's own order within a chunk makes the reorder minimally disruptive (and the
  // scatter reads below sequential-ish). Each sort covers only one chunk's worth of indices.
  for (const [lo, hi] of leaves) order.subarray(lo, hi).sort()

  // --- scatter into the reordered catalog ----------------------------------------------------
  const outPos = new Float32Array(count * 3)
  const outMag = new Float32Array(count)
  const outCol = new Float32Array(count)
  const newIndexOf = new Uint32Array(count)
  for (let j = 0; j < count; j++) {
    const i = order[j]
    newIndexOf[i] = j
    outPos[j * 3] = positions[i * 3]
    outPos[j * 3 + 1] = positions[i * 3 + 1]
    outPos[j * 3 + 2] = positions[i * 3 + 2]
    outMag[j] = absMag[i]
    outCol[j] = colorIndex[i]
  }

  // --- exact bounding sphere per chunk -------------------------------------------------------
  const chunks: ChunkInfo[] = []
  for (const [start, end] of leaves) {
    if (end <= start) continue
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity
    let bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity
    for (let i = start; i < end; i++) {
      const x = outPos[i * 3], y = outPos[i * 3 + 1], z = outPos[i * 3 + 2]
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x
      if (y < by0) by0 = y; if (y > by1) by1 = y
      if (z < bz0) bz0 = z; if (z > bz1) bz1 = z
    }
    // AABB center + max observed distance: not the minimal enclosing sphere, but exact (never
    // under-covers) and computed in one extra pass.
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, cz = (bz0 + bz1) / 2
    let r2 = 0
    for (let i = start; i < end; i++) {
      const dx = outPos[i * 3] - cx, dy = outPos[i * 3 + 1] - cy, dz = outPos[i * 3 + 2] - cz
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > r2) r2 = d2
    }
    chunks.push({ start, count: end - start, center: [cx, cy, cz], radius: Math.sqrt(r2) })
  }

  return {
    catalog: { count, positions: outPos, absMag: outMag, colorIndex: outCol },
    chunks,
    newIndexOf,
  }
}
