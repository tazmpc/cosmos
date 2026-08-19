/**
 * Hover picking: given a set of already-projected screen-space candidates, which one (if any) is
 * the cursor over?
 *
 * Deliberately pure and DOM-free — the caller owns projection, candidate assembly and the label
 * element, so the selection rule itself stays unit-testable. See main.ts's hoverCandidates() for
 * the assembly side, including the rule that the bulk catalogs (OpenNGC, galaxies.bin, the
 * asteroid belt, the Milky Way layers, and every star fainter than the halo cutoff) are never
 * candidates: hover labels are for NOTABLE objects only.
 */

/** What a hovered object is, for both the label's suffix and the tie-break priority below. */
export type HoverKind = 'planet' | 'moon' | 'spacecraft' | 'asteroid' | 'galaxy' | 'dso' | 'star'

/**
 * Tie-break ranking when two candidates are the same distance from the cursor. Ordered by "how
 * much does the user mean THAT one when both are under the cursor": a planet or moon is a solid,
 * deliberately-approached body and wins over a probe near it, which wins over an asteroid, which
 * wins over a background galaxy/DSO, which wins over a star. dso ties with galaxy (both curated
 * extragalactic/nebular landmarks) and moon ties with planet (a moon under the cursor while its
 * planet is too is almost always the intended target, and the nearer-wins rule already separates
 * them in practice).
 */
export const HOVER_PRIORITY: Record<HoverKind, number> = {
  planet: 5, moon: 5, spacecraft: 4, asteroid: 3, galaxy: 2, dso: 2, star: 1,
}

export interface HoverCandidate {
  /** Display name, e.g. "Sirius". */
  name: string
  kind: HoverKind
  /** Suffix shown after the name, e.g. "star". Defaults to `kind` at the call site. */
  label?: string
  /** Screen position in CSS pixels, origin top-left. */
  sx: number
  sy: number
  /** HOVER_PRIORITY[kind], passed in so pickNearest stays a pure function of its inputs. */
  priority: number
}

/**
 * Nearest candidate to (mx, my) within `radiusPx`, or null. Ties on distance are broken by higher
 * `priority`; ties on both keep the earlier candidate (stable, so assembly order is the final
 * tiebreak). Distances are compared squared — no sqrt in the hot path.
 */
export function pickNearest<T extends HoverCandidate>(
  candidates: readonly T[], mx: number, my: number, radiusPx: number,
): T | null {
  const r2 = radiusPx * radiusPx
  let best: T | null = null
  let bestD2 = Infinity
  for (const cand of candidates) {
    const dx = cand.sx - mx
    const dy = cand.sy - my
    const d2 = dx * dx + dy * dy
    if (d2 > r2) continue
    if (best === null || d2 < bestD2 || (d2 === bestD2 && cand.priority > best.priority)) {
      best = cand
      bestD2 = d2
    }
  }
  return best
}
