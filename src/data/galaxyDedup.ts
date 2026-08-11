/** Pure dedup for the merged galaxy catalog (SDSS + 2MRS + 6dFGS + Cosmicflows-4).
 *  Two rows from DIFFERENT surveys are the same galaxy when they're within 1 degree on the
 *  sky AND their cz or distance roughly agree — this only fires cross-survey (each source
 *  catalog is already internally deduplicated by its own survey team; two SDSS entries a
 *  few Mpc apart along the line of sight in the same 1-degree patch are routinely two
 *  genuinely different galaxies in a cluster, not a duplicate). Spatial hash on 1x1 degree
 *  cells keeps this near-linear even at the hundreds-of-thousands-of-rows scale of the
 *  merged catalog. */

export interface GalaxyRow {
  raDeg: number
  decDeg: number
  distMpc: number
  czKms: number
  absMag: number
  colorIndex: number
  source: 'cf4' | 'sdss' | '6df' | '2mrs'
}

/** Lower number = kept over a higher number at the same position. */
const PREFERENCE: Record<GalaxyRow['source'], number> = { cf4: 0, sdss: 1, '6df': 2, '2mrs': 3 }

const SEP_THRESHOLD_DEG = 1
const COS_SEP_THRESHOLD = Math.cos((SEP_THRESHOLD_DEG * Math.PI) / 180)
const CZ_THRESHOLD_KMS = 600
const DIST_THRESHOLD_MPC = 2
const DEC_BINS = 180 // 1 degree bins covering [-90, 90)

function raCellIndex(raDeg: number): number {
  return Math.floor((((raDeg % 360) + 360) % 360))
}

function decCellIndex(decDeg: number): number {
  return Math.min(DEC_BINS - 1, Math.max(0, Math.floor(decDeg + 90)))
}

/** How many RA cells (each 1 degree wide) to search either side to guarantee covering
 *  everything within SEP_THRESHOLD_DEG true angular degrees at this declination — widens
 *  automatically near the poles where a fixed +-1 RA-cell search would miss real duplicates. */
function raSearchRadius(decDeg: number): number {
  const cosDec = Math.max(Math.cos((decDeg * Math.PI) / 180), 1e-6)
  return Math.min(180, Math.ceil(SEP_THRESHOLD_DEG / cosDec))
}

function cellKey(raIdx: number, decIdx: number): number {
  return decIdx * 360 + raIdx
}

export function dedupe(rows: GalaxyRow[]): { kept: GalaxyRow[]; removedBySource: Record<string, number> } {
  const n = rows.length

  // Preference order first (cf4 > sdss > 6df > 2mrs), original order as a stable tiebreak.
  const order = rows.map((_, i) => i).sort((a, b) => {
    const pref = PREFERENCE[rows[a].source] - PREFERENCE[rows[b].source]
    return pref !== 0 ? pref : a - b
  })

  // Unit vectors, precomputed once — turns the great-circle-separation check into a single
  // dot product compared against cos(threshold), avoiding a trig inverse per pair.
  const ux = new Float64Array(n)
  const uy = new Float64Array(n)
  const uz = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const raRad = (rows[i].raDeg * Math.PI) / 180
    const decRad = (rows[i].decDeg * Math.PI) / 180
    const cd = Math.cos(decRad)
    ux[i] = cd * Math.cos(raRad)
    uy[i] = cd * Math.sin(raRad)
    uz[i] = Math.sin(decRad)
  }

  const grid = new Map<number, number[]>()
  const kept: GalaxyRow[] = []
  const removedBySource: Record<string, number> = {}

  for (const i of order) {
    const row = rows[i]
    const raIdx = raCellIndex(row.raDeg)
    const decIdx = decCellIndex(row.decDeg)
    const raRadius = raSearchRadius(row.decDeg)

    // Local-Group win: a CF4 row with negative (blueshifted) cz is never removed by the
    // dedup rule — these are the whole point of pulling in CF4 (measured, not redshift,
    // distances), and two genuinely distinct nearby dwarfs can share near-zero cz.
    const immune = row.source === 'cf4' && row.czKms < 0

    let isDup = false
    if (!immune) {
      searchLoop: for (let dDec = -1; dDec <= 1; dDec++) {
        const nDecIdx = decIdx + dDec
        if (nDecIdx < 0 || nDecIdx >= DEC_BINS) continue
        for (let dRa = -raRadius; dRa <= raRadius; dRa++) {
          const nRaIdx = ((raIdx + dRa) % 360 + 360) % 360
          const bucket = grid.get(cellKey(nRaIdx, nDecIdx))
          if (!bucket) continue
          for (const j of bucket) {
            if (rows[j].source === row.source) continue // only cross-survey pairs are "the same galaxy seen twice"
            const dot = ux[i] * ux[j] + uy[i] * uy[j] + uz[i] * uz[j]
            if (dot < COS_SEP_THRESHOLD) continue // >= 1 degree apart, not a candidate
            const dCz = Math.abs(row.czKms - rows[j].czKms)
            const dDist = Math.abs(row.distMpc - rows[j].distMpc)
            // Both signals must agree: at cosmological (SDSS/6dFGS) depth, 1 degree on the
            // sky spans many Mpc transverse, so an OR here matches "same cluster/filament"
            // far more often than "same galaxy" (empirically ~32% of all SDSS rows against
            // CF4 alone — collapsing real cluster members onto one point). Requiring both
            // keeps the rule doing cross-survey identification instead of structure removal.
            if (dCz < CZ_THRESHOLD_KMS && dDist < DIST_THRESHOLD_MPC) {
              isDup = true
              break searchLoop
            }
          }
        }
      }
    }

    if (isDup) {
      removedBySource[row.source] = (removedBySource[row.source] ?? 0) + 1
      continue
    }

    kept.push(row)
    const key = cellKey(raIdx, decIdx)
    const bucket = grid.get(key)
    if (bucket) bucket.push(i)
    else grid.set(key, [i])
  }

  return { kept, removedBySource }
}
