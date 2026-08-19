/**
 * Phase-calibrates src/data/moonElements.ts's M0Deg values against JPL Horizons.
 *
 * BACKGROUND: an independent Horizons cross-check found that JPL SSD's "Planetary Satellite Mean
 * Elements" table (the source for moonElements.ts — see its and moonOrbit.ts's doc comments) gives
 * an M0 that does NOT actually osculate at the epoch the table prints next to it, for 7 of this
 * project's 9 moons. The orbit ORIENTATION derived from the table (i, Omega, omega, pole) is
 * correct — only the mean-anomaly PHASE at epoch is wrong, by 50-175° for the affected moons.
 * This script fixes that by solving for the M0 that actually reproduces a real Horizons position
 * vector at the table's own epoch, instead of trusting the table's printed value.
 *
 * For each moon: fetch a Horizons VECTORS ephemeris (target = the moon's NAIF id, center = the
 * parent planet's body center, e.g. 500@699 for Saturn) at exactly the epoch moonElements.ts uses
 * (JD 2451545.0 = 2000-01-01 12:00 TDB for all nine, but read from the data file rather than
 * hardcoded, so this script keeps working if that ever changes). The returned EQJ vector is
 * rotated into the SAME (Omega, i, omega, pole) frame moonOrbit.ts's moonOffsetEqjAu propagates
 * in — via eqjToLaplace (exact inverse of laplaceToEqj) then the inverse of the perifocal->Laplace
 * 3-1-3 rotation — giving a perifocal-plane position whose polar angle IS the true anomaly at
 * epoch. True anomaly -> eccentric anomaly -> mean anomaly is the standard closed-form conversion
 * (no iteration needed, unlike the M->E direction solveKepler handles at runtime).
 *
 * Responses are cached verbatim in scripts/cache/horizons-moon-<id>.txt (gitignored) — re-running
 * from a warm cache reproduces byte-identical output, same convention as build-spacecraft.ts.
 *
 * Output: src/data/moonPhase.json — {moonId: {tableM0Deg, calibratedM0Deg, deltaDeg}} — a
 * provenance record of what changed and by how much. The actual fix (moonElements.ts's M0Deg
 * fields) is applied by hand from this script's report, with the original table value kept in a
 * comment on each row — this file is small, hand-curated data, not a generated artifact loaded at
 * runtime, so there's no reason to add a JSON fetch + parse step to the app for it.
 *
 * Gate: for every moon, recomputing the position from the CALIBRATED M0 (via the real runtime
 * moonOffsetEqjAu, not a copy of its math) and comparing its direction to the Horizons vector must
 * agree within 1.0° — this is exactly the check that was missing before (the original test suite
 * verified orientation and period, never phase against an external reference).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MOON_ELEMENTS, type MoonV2Id } from '../src/data/moonElements'
import { eqjToLaplace, moonOffsetEqjAu, type MoonMeanElements } from '../src/sim/moonOrbit'

const CACHE_DIR = 'scripts/cache'
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

interface MoonSpec {
  id: MoonV2Id
  naifId: string
  parentNaifId: string
}

const MOON_SPECS: MoonSpec[] = [
  { id: 'titan', naifId: '606', parentNaifId: '699' },
  { id: 'rhea', naifId: '605', parentNaifId: '699' },
  { id: 'iapetus', naifId: '608', parentNaifId: '699' },
  { id: 'enceladus', naifId: '602', parentNaifId: '699' },
  { id: 'triton', naifId: '801', parentNaifId: '899' },
  { id: 'titania', naifId: '703', parentNaifId: '799' },
  { id: 'oberon', naifId: '704', parentNaifId: '799' },
  { id: 'phobos', naifId: '401', parentNaifId: '499' },
  { id: 'deimos', naifId: '402', parentNaifId: '499' },
]

// ---- fetch (cached) -----------------------------------------------------------------------

function jdToHorizonsTime(jd: number): string {
  return `JD${jd.toFixed(4)}`
}

function buildUrl(spec: MoonSpec, epochJd: number): string {
  const params: Record<string, string> = {
    format: 'text',
    COMMAND: `'${spec.naifId}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'500@${spec.parentNaifId}'`,
    REF_PLANE: 'FRAME',
    REF_SYSTEM: 'ICRF',
    VEC_TABLE: '1',
    OUT_UNITS: 'KM-D',
    START_TIME: `'${jdToHorizonsTime(epochJd)}'`,
    STOP_TIME: `'${jdToHorizonsTime(epochJd + 1)}'`,
    STEP_SIZE: "'1d'",
  }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${qs}`
}

async function fetchCached(spec: MoonSpec, epochJd: number): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = `${CACHE_DIR}/horizons-moon-${spec.id}.txt`
  if (existsSync(cachePath)) {
    console.log(`  ${spec.id}: using cached response (${cachePath})`)
    return readFileSync(cachePath, 'utf8')
  }
  const url = buildUrl(spec, epochJd)
  console.log(`  ${spec.id}: fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Horizons fetch failed for ${spec.id}: HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('$$SOE') || !text.includes('$$EOE')) {
    throw new Error(`Horizons response for ${spec.id} has no $$SOE/$$EOE ephemeris block:\n${text.slice(0, 500)}`)
  }
  writeFileSync(cachePath, text)
  return text
}

/** Parses the $$SOE...$$EOE VEC_TABLE=1 block and returns the FIRST sample only — that's the one
 *  at exactly the requested epoch (START_TIME), which is all this script needs. */
function parseFirstVector(text: string, id: string): { jd: number; x: number; y: number; z: number } {
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe < 0 || eoe < 0 || eoe < soe) throw new Error(`${id}: malformed $$SOE/$$EOE block`)
  const lines = text.slice(soe + 5, eoe).split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const jdLine = lines[0]
  const vecLine = lines[1]
  if (!jdLine || !vecLine) throw new Error(`${id}: expected at least one JD+vector line pair`)

  const jdMatch = jdLine.match(/^(\d+\.\d+)\s*=/)
  if (!jdMatch) throw new Error(`${id}: unparseable JD line: "${jdLine}"`)
  const vecMatch = vecLine.match(
    /X\s*=\s*([+-]?\d+\.\d+E[+-]\d+)\s*Y\s*=\s*([+-]?\d+\.\d+E[+-]\d+)\s*Z\s*=\s*([+-]?\d+\.\d+E[+-]\d+)/,
  )
  if (!vecMatch) throw new Error(`${id}: unparseable vector line: "${vecLine}"`)
  const jd = Number(jdMatch[1])
  const x = Number(vecMatch[1])
  const y = Number(vecMatch[2])
  const z = Number(vecMatch[3])
  if (![jd, x, y, z].every(Number.isFinite)) throw new Error(`${id}: non-finite sample`)
  return { jd, x, y, z }
}

// ---- EQJ vector -> mean anomaly at epoch ---------------------------------------------------

function normalize360(deg: number): number {
  let d = deg % 360
  if (d < 0) d += 360
  return d
}

/** Signed a-b wrapped into (-180, 180], for reporting the calibration delta. */
function angleDeltaDeg(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  else if (d <= -180) d += 360
  return d
}

/**
 * Solves for the mean anomaly M (degrees, [0,360)) that places a two-body orbit with elements
 * `el` (only e, iDeg, omegaDeg, OmegaDeg, poleRaDeg, poleDecDeg are used — a, M0, period, epoch
 * are irrelevant to a pure direction/phase solve) at EQJ position (x,y,z) — any consistent units.
 */
function meanAnomalyFromEqjDirection(el: MoonMeanElements, x: number, y: number, z: number): number {
  // EQJ -> Laplace-plane frame (exact inverse of laplaceToEqj).
  const L = eqjToLaplace(x, y, z, el.poleRaDeg, el.poleDecDeg)

  // Laplace-plane frame -> perifocal: the inverse (transpose) of moonOffsetEqjAu's forward
  // perifocal -> Laplace-plane 3-1-3 rotation matrix. Derived once in this script's own commit
  // message / PR description; the matrix is the classical perifocal-to-inertial rotation
  // R = Rz(Omega) Rx(i) Rz(omega), and since it's orthogonal, inertial -> perifocal is R^T.
  const co = Math.cos(el.omegaDeg * D2R), so = Math.sin(el.omegaDeg * D2R)
  const cO = Math.cos(el.OmegaDeg * D2R), sO = Math.sin(el.OmegaDeg * D2R)
  const ci = Math.cos(el.iDeg * D2R), si = Math.sin(el.iDeg * D2R)
  const R11 = cO * co - sO * so * ci
  const R21 = sO * co + cO * so * ci
  const R31 = so * si
  const R12 = -(cO * so + sO * co * ci)
  const R22 = -sO * so + cO * co * ci
  const R32 = co * si
  const xp = R11 * L.x + R21 * L.y + R31 * L.z
  const yp = R12 * L.x + R22 * L.y + R32 * L.z

  // True anomaly is just the polar angle in the perifocal plane — independent of the table's `a`,
  // so it's unaffected by any small mismatch between the mean-element `a` and the instantaneous
  // (osculating, perturbed) Horizons radius.
  const nu = Math.atan2(yp, xp)
  const e = el.e
  const E = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu))
  const M = E - e * Math.sin(E)
  return normalize360(M * R2D)
}

// ---- main -----------------------------------------------------------------------------------

interface CalibrationRow {
  tableM0Deg: number
  calibratedM0Deg: number
  deltaDeg: number
}

const report: Record<string, CalibrationRow> = {}

console.log('Phase-calibrating 9 moons against JPL Horizons...')
for (const spec of MOON_SPECS) {
  const el = MOON_ELEMENTS[spec.id]
  const text = await fetchCached(spec, el.epochJd)
  const sample = parseFirstVector(text, spec.id)
  if (Math.abs(sample.jd - el.epochJd) > 1e-6) {
    throw new Error(`${spec.id}: Horizons returned JD ${sample.jd}, expected epoch ${el.epochJd}`)
  }

  const calibratedM0Deg = meanAnomalyFromEqjDirection(el, sample.x, sample.y, sample.z)
  const deltaDeg = angleDeltaDeg(calibratedM0Deg, el.M0Deg)
  report[spec.id] = { tableM0Deg: el.M0Deg, calibratedM0Deg: Math.round(calibratedM0Deg * 1e4) / 1e4, deltaDeg: Math.round(deltaDeg * 100) / 100 }

  // ---- gate: recompute from the CALIBRATED M0 via the REAL runtime function and compare
  // direction to the Horizons vector. ----
  const calibratedEl: MoonMeanElements = { ...el, M0Deg: calibratedM0Deg }
  const p = moonOffsetEqjAu(calibratedEl, el.epochJd)
  const pLen = Math.hypot(p.x, p.y, p.z)
  const hLen = Math.hypot(sample.x, sample.y, sample.z)
  const dot = (p.x * sample.x + p.y * sample.y + p.z * sample.z) / (pLen * hLen)
  const angleErrDeg = Math.acos(Math.min(1, Math.max(-1, dot))) * R2D
  if (!(angleErrDeg < 1.0)) {
    throw new Error(`Gate failed: ${spec.id} direction error ${angleErrDeg.toFixed(3)}° >= 1.0° after calibration`)
  }

  console.log(
    `  ${spec.id.padEnd(10)} table M0=${el.M0Deg.toFixed(2).padStart(8)}°  calibrated M0=${calibratedM0Deg.toFixed(2).padStart(8)}°  ` +
    `delta=${deltaDeg.toFixed(2).padStart(8)}°  direction error after calibration=${angleErrDeg.toFixed(3)}°`,
  )
}

mkdirSync('src/data', { recursive: true })
writeFileSync('src/data/moonPhase.json', JSON.stringify(report, null, 2) + '\n')
console.log('\nWrote src/data/moonPhase.json (provenance record).')
console.log('Apply calibratedM0Deg to each row\'s M0Deg in src/data/moonElements.ts by hand,')
console.log('keeping the original tableM0Deg in a comment.')
