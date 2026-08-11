import * as THREE from 'three'
import type { Focusable } from '../engine/cameraControls'
import { raDecDistToXyz } from './starMath'
import { AU_PER_LY, PC_TO_AU } from './units'

/** One row of public/openngc.json (built by scripts/build-openngc.ts from the OpenNGC project's
 *  NGC.csv, CC-BY-SA-4.0) — the ~12.4k "everything else" deep-sky objects sitting under the 15
 *  hand-curated ones (deepSky.ts) and ~26 curated galaxies (galaxies.ts). Position (RA/Dec) is
 *  exact; distPc is always a type-based placeholder (distEstimated is always `true` — the base
 *  OpenNGC CSV carries no distance column at all), so diameterLy derived from it is a placeholder
 *  too where MajAx isn't known, but the sky position and, where present, the true angular size
 *  (majAxArcmin) are real measurements. */
export interface OpenNgcObject {
  id: string
  name: string
  messier: number | null
  raHours: number
  decDeg: number
  distPc: number
  distEstimated: true
  diameterLy: number | null
  majAxArcmin: number | null
  type: string
  vmag: number | null
}

/** Fetches + parses public/openngc.json. Throws on HTTP/parse failure — callers should .catch
 *  the same way the other lazy catalogs do (warn and degrade, not block startup). */
export async function loadOpenNgc(): Promise<OpenNgcObject[]> {
  const res = await fetch(import.meta.env.BASE_URL + 'openngc.json')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as OpenNgcObject[]
}

// Fallback diameters (ly) for objects with no MajAx in the source catalog, keyed by the human
// type label already baked into openngc.json. Rough category medians — same spirit as the
// type-based placeholder distances in build-openngc.ts, just for angular size instead of
// distance. Only affects minApproach/sprite sizing for the ~4k objects with no MajAx measurement.
const DEFAULT_DIAMETER_LY_BY_TYPE: Record<string, number> = {
  galaxy: 100_000,
  'galaxy pair': 100_000,
  'galaxy triplet': 120_000,
  'galaxy group': 150_000,
  'globular cluster': 150,
  'open cluster': 20,
  'open cluster with nebulosity': 30,
  'planetary nebula': 2,
  nebula: 50,
  'nebula (H II region)': 50,
  'emission nebula': 50,
  'reflection nebula': 20,
  'supernova remnant': 15,
  object: 50,
}
const FALLBACK_DIAMETER_LY = 50

export function openNgcDiameterLy(obj: OpenNgcObject): number {
  return obj.diameterLy ?? DEFAULT_DIAMETER_LY_BY_TYPE[obj.type] ?? FALLBACK_DIAMETER_LY
}

/** Same shape as deepSkyMinApproachAu (src/scene/deepSkyFocus.ts), but the diameter falls back to
 *  a type default when the object has no measured MajAx instead of always having one. */
export function openNgcMinApproachAu(obj: OpenNgcObject): number {
  return Math.max(2 * openNgcDiameterLy(obj) * AU_PER_LY, 1e6)
}

export function openNgcFocusable(obj: OpenNgcObject): Focusable {
  const [x, y, z] = raDecDistToXyz(obj.raHours, obj.decDeg, obj.distPc)
  return {
    name: obj.name,
    getPosition: (out: THREE.Vector3) => out.set(x * PC_TO_AU, y * PC_TO_AU, z * PC_TO_AU),
    minApproachAu: openNgcMinApproachAu(obj),
  }
}
