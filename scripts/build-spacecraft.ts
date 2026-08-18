/**
 * Builds public/spacecraft.json from the JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`)
 * — heliocentric position vectors for four human-made spacecraft, sampled from launch to
 * 2046-01-01: Voyager 1 (-31), Voyager 2 (-32), New Horizons (-98), James Webb Space Telescope
 * (-170).
 *
 * Query shape, one call per craft:
 *   format=text&COMMAND='<id>'&OBJ_DATA=NO&MAKE_EPHEM=YES&EPHEM_TYPE=VECTORS
 *   &CENTER='500@10'&REF_PLANE=FRAME&REF_SYSTEM=ICRF&VEC_TABLE=1&OUT_UNITS=AU-D
 *   &START_TIME='<launch+1d>'&STOP_TIME='2046-01-01'&STEP_SIZE='<30d|5d>'
 *
 * CENTER=500@10 is the Sun's body center — VECTORS from there are already heliocentric, no
 * barycentric-to-heliocentric shift needed. REF_PLANE=FRAME + REF_SYSTEM=ICRF requests the
 * International Celestial Reference Frame directly, which every other position in this project's
 * scene (astronomy-engine's EQJ, the MPCORB asteroid propagator's EQJ output) is aligned with to
 * ~0.02 arcsec — i.e. this IS the project's EQJ frame for rendering purposes. Verified empirically
 * below (see the JWST-Earth distance gate): a body sitting at Sun-Earth L2 must sit ~0.01 AU from
 * Earth's own astronomy-engine EQJ position, and it does.
 *
 * Responses are cached verbatim in scripts/cache/horizons-<id>.txt (gitignored) — the whole
 * pipeline downstream of the cached text is a pure function of it, so re-running the script from
 * a warm cache reproduces byte-identical output (see the manual determinism check this script's
 * doc comment at the bottom describes).
 *
 * VEC_TABLE=1 asks for position only (X/Y/Z, AU) — no velocity, which this project has no use for
 * (trajectories are re-derived by cubic Hermite interpolation over the position samples, see
 * src/sim/trajectory.ts).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { HelioVector, Body } from 'astronomy-engine'
import { dateToJd } from '../src/sim/kepler'

const CACHE_DIR = 'scripts/cache'
const STOP_TIME = '2046-01-01'

interface CraftSpec {
  id: string
  name: string
  horizonsId: string // Horizons COMMAND value, e.g. '-31'
  launchDate: string // ISO date, YYYY-MM-DD
  stepSize: string // Horizons STEP_SIZE value, e.g. '30d'
  /** Overrides the shared STOP_TIME. JWST needs this: Horizons' predicted ephemeris for it runs
   *  out on 2031-08-17 (station-keeping burns aren't planned that far ahead), well short of the
   *  2046 horizon the other three (whose remaining trajectory is unpowered/ballistic and so
   *  predictable much further out) support. */
  stopTime?: string
  facts: Record<string, string>
}

const CRAFT: CraftSpec[] = [
  {
    id: 'voyager1', name: 'Voyager 1', horizonsId: '-31', launchDate: '1977-09-05', stepSize: '30d',
    facts: {
      Launched: 'September 5, 1977',
      Status: 'The farthest human-made object from Earth',
      'Interstellar space': 'Entered August 2012',
      Speed: '~17 km/s (~61,000 km/h) relative to the Sun',
      Note: 'Carries the Golden Record, a phonograph disc with sounds and images of Earth intended for any spacefaring civilization that might one day find it.',
    },
  },
  {
    id: 'voyager2', name: 'Voyager 2', horizonsId: '-32', launchDate: '1977-08-20', stepSize: '30d',
    facts: {
      Launched: 'August 20, 1977',
      Status: 'The only spacecraft to have visited Uranus and Neptune',
      'Interstellar space': 'Entered November 2018',
      Note: 'Launched 16 days before its twin Voyager 1, on a slower trajectory that let it complete a Grand Tour flyby of all four giant planets: Jupiter, Saturn, Uranus and Neptune.',
    },
  },
  {
    id: 'newhorizons', name: 'New Horizons', horizonsId: '-98', launchDate: '2006-01-19', stepSize: '30d',
    facts: {
      Launched: 'January 19, 2006',
      'Pluto flyby': 'July 14, 2015',
      'Arrokoth flyby': 'January 1, 2019',
      Note: 'The first spacecraft to explore Pluto and its moons up close, then flew on nearly 1.6 billion km further to Arrokoth — the most distant object ever visited, a contact-binary relic from the solar system\'s formation.',
    },
  },
  {
    // "(JWST)" suffix is deliberate, not decorative: search is a plain substring match on `name`
    // (src/ui/search.ts), so without it typing the far more common abbreviation "JWST" would find
    // nothing.
    id: 'jwst', name: 'James Webb Space Telescope (JWST)', horizonsId: '-170', launchDate: '2021-12-25', stepSize: '5d',
    stopTime: '2031-08-15',
    facts: {
      Launched: 'December 25, 2021',
      Location: 'Orbits the Sun-Earth L2 point, about 1.5 million km beyond Earth',
      'Mirror diameter': '6.5 m, 18 hexagonal gold-coated segments',
      Note: 'Observes primarily in infrared light, letting it see through dust clouds and look further back in cosmic time than any prior telescope. Its halo orbit around L2 is unstable and needs periodic station-keeping burns.',
    },
  },
]

// ---- fetch (cached) -----------------------------------------------------------------------

function addOneDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function buildUrl(spec: CraftSpec): string {
  const start = addOneDay(spec.launchDate)
  const params: Record<string, string> = {
    format: 'text',
    COMMAND: `'${spec.horizonsId}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    REF_PLANE: 'FRAME',
    REF_SYSTEM: 'ICRF',
    VEC_TABLE: '1',
    OUT_UNITS: 'AU-D',
    START_TIME: `'${start}'`,
    STOP_TIME: `'${spec.stopTime ?? STOP_TIME}'`,
    STEP_SIZE: `'${spec.stepSize}'`,
  }
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${qs}`
}

async function fetchCached(spec: CraftSpec): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = `${CACHE_DIR}/horizons-${spec.id}.txt`
  if (existsSync(cachePath)) {
    console.log(`  ${spec.name}: using cached response (${cachePath})`)
    return readFileSync(cachePath, 'utf8')
  }
  const url = buildUrl(spec)
  console.log(`  ${spec.name}: fetching ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Horizons fetch failed for ${spec.name}: HTTP ${res.status}`)
  const text = await res.text()
  if (!text.includes('$$SOE') || !text.includes('$$EOE')) {
    throw new Error(`Horizons response for ${spec.name} has no $$SOE/$$EOE ephemeris block:\n${text.slice(0, 500)}`)
  }
  writeFileSync(cachePath, text)
  return text
}

// ---- parse ----------------------------------------------------------------------------------

interface Sample {
  jd: number
  x: number
  y: number
  z: number
}

/** Parses the $$SOE...$$EOE VEC_TABLE=1 block: alternating lines
 *    "2461253.500000000 = A.D. 2026-Aug-01 00:00:00.0000 TDB "
 *    " X =-3.209008776558914E+01 Y =-1.643344048236816E+02 Z = 3.627358707352585E+01"
 */
function parseVectors(text: string, craftName: string): Sample[] {
  const soe = text.indexOf('$$SOE')
  const eoe = text.indexOf('$$EOE')
  if (soe < 0 || eoe < 0 || eoe < soe) {
    throw new Error(`${craftName}: malformed $$SOE/$$EOE block`)
  }
  const block = text.slice(soe + 5, eoe)
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  const samples: Sample[] = []
  for (let i = 0; i < lines.length; i += 2) {
    const jdLine = lines[i]
    const vecLine = lines[i + 1]
    if (vecLine === undefined) throw new Error(`${craftName}: dangling JD line with no vector line: "${jdLine}"`)

    const jdMatch = jdLine.match(/^(\d+\.\d+)\s*=/)
    if (!jdMatch) throw new Error(`${craftName}: unparseable JD line: "${jdLine}"`)
    const jd = Number(jdMatch[1])

    const vecMatch = vecLine.match(
      /X\s*=\s*([+-]?\d+\.\d+E[+-]\d+)\s*Y\s*=\s*([+-]?\d+\.\d+E[+-]\d+)\s*Z\s*=\s*([+-]?\d+\.\d+E[+-]\d+)/,
    )
    if (!vecMatch) throw new Error(`${craftName}: unparseable vector line: "${vecLine}"`)
    const x = Number(vecMatch[1])
    const y = Number(vecMatch[2])
    const z = Number(vecMatch[3])
    if (![jd, x, y, z].every(Number.isFinite)) {
      throw new Error(`${craftName}: non-finite sample at "${jdLine}"`)
    }
    samples.push({ jd, x, y, z })
  }
  return samples
}

// ---- output row -------------------------------------------------------------------------------

interface SpacecraftRow {
  id: string
  name: string
  jdSamples: number[]
  xyz: number[]
  launchDate: string
  facts: Record<string, string>
}

// Rounded to keep public/spacecraft.json small without discarding any meaningful precision: 1e-6
// AU is ~150 km, far below anything this trajectory-fit layer needs to resolve (samples are 5-30
// days apart to begin with). JD is rounded to 1e-6 day (~0.1 s) for the same reason — Horizons
// already returns exact half-day-aligned values, so this changes nothing but string length.
function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

async function buildCraft(spec: CraftSpec): Promise<SpacecraftRow> {
  const text = await fetchCached(spec)
  const samples = parseVectors(text, spec.name)

  // Gate: monotonic JD, finite positions (parseVectors already threw on non-finite, this is a
  // second explicit check on the assembled array so the gate reads as its own assertion).
  for (let i = 1; i < samples.length; i++) {
    if (!(samples[i].jd > samples[i - 1].jd)) {
      throw new Error(`${spec.name}: JD samples not strictly increasing at index ${i}`)
    }
  }
  if (samples.length < 100) {
    throw new Error(`${spec.name}: only ${samples.length} samples — expected >= 100`)
  }

  const jdSamples = samples.map((s) => round(s.jd, 6))
  const xyz: number[] = []
  for (const s of samples) xyz.push(round(s.x, 6), round(s.y, 6), round(s.z, 6))

  return { id: spec.id, name: spec.name, jdSamples, xyz, launchDate: spec.launchDate, facts: spec.facts }
}

// ---- main -----------------------------------------------------------------------------------

console.log('Fetching JPL Horizons vectors for 4 spacecraft...')
const rows: SpacecraftRow[] = []
for (const spec of CRAFT) {
  const row = await buildCraft(spec)
  console.log(`  ${row.name}: ${row.jdSamples.length} samples, JD ${row.jdSamples[0]} - ${row.jdSamples[row.jdSamples.length - 1]}`)
  rows.push(row)
}

// ---- gates ------------------------------------------------------------------------------------

// Frame verification: REF_PLANE=FRAME + REF_SYSTEM=ICRF should give a frame aligned with this
// project's EQJ (astronomy-engine's J2000 equatorial) to well under a milli-AU. JWST sits in a
// halo orbit around the Sun-Earth L2 point, ~1.5 million km (~0.01 AU) beyond Earth as seen from
// the Sun — so at every JWST sample, its distance from Earth's OWN astronomy-engine EQJ position
// must be close to 0.01 AU. If the frames didn't actually agree (e.g. one were ecliptic and the
// other equatorial), this distance would be wildly wrong (up to ~1 AU, Earth's own orbital
// radius) instead of ~0.01 AU.
const jwst = rows.find((r) => r.id === 'jwst')!
// The very first ~7 weeks of samples are JWST's TRANSIT to L2 (launched 2021-12-25, arrived and
// began station-keeping around 2022-01-24) — its distance from Earth legitimately ramps up from
// near-zero during that phase, so the "stays near 0.01 AU" frame check only applies once it has
// settled into its halo orbit. HALO_ORBIT_START gives that a comfortable margin past the actual
// arrival date.
const HALO_ORBIT_START_JD = dateToJd(new Date('2022-02-15T00:00:00Z'))
let jwstMin = Infinity
let jwstMax = -Infinity
let jwstChecked = 0
for (let i = 0; i < jwst.jdSamples.length; i++) {
  const jd = jwst.jdSamples[i]
  if (jd < HALO_ORBIT_START_JD) continue
  // JD (TDB) -> JS Date. dateToJd's inverse, good enough at the sub-second precision that matters
  // here (TDB vs UTC differs by ~69s, five orders of magnitude below the ~0.01 AU scale checked).
  const date = new Date((jd - 2440587.5) * 86400000)
  const earth = HelioVector(Body.Earth, date)
  const dx = jwst.xyz[i * 3] - earth.x
  const dy = jwst.xyz[i * 3 + 1] - earth.y
  const dz = jwst.xyz[i * 3 + 2] - earth.z
  const d = Math.hypot(dx, dy, dz)
  jwstMin = Math.min(jwstMin, d)
  jwstMax = Math.max(jwstMax, d)
  jwstChecked++
}
console.log(`JWST-Earth distance range across ${jwstChecked} post-arrival samples: ${jwstMin.toFixed(5)} - ${jwstMax.toFixed(5)} AU`)
// Bounds widened slightly (0.0075-0.0125) from the plan's nominal 0.008-0.012 to comfortably
// cover the halo orbit's real amplitude (measured 0.00800-0.01172 AU across the whole baked
// range) without loosening the check's actual purpose: a wrong reference frame would put this
// distance off by up to ~1 AU (Earth's own heliocentric radius), not a few thousandths of an AU.
if (!(jwstMin >= 0.0075 && jwstMax <= 0.0125)) {
  throw new Error(`JWST-Earth distance out of the expected L2 halo-orbit range [0.0075, 0.0125] AU: min=${jwstMin}, max=${jwstMax} — frame may be wrong`)
}
console.log('gate: JWST stays ~0.01 AU from Earth throughout its halo orbit (frame verified) — OK')

// Voyager 1 distance near 2026-08-07 should be ~166-170 AU (NASA's real-time figure), asserted
// with margin (160-175) since the exact sample date won't land precisely on 2026-08-07.
const v1 = rows.find((r) => r.id === 'voyager1')!
const targetJd = dateToJd(new Date('2026-08-07T00:00:00Z'))
let nearestIdx = 0
let nearestDelta = Infinity
for (let i = 0; i < v1.jdSamples.length; i++) {
  const d = Math.abs(v1.jdSamples[i] - targetJd)
  if (d < nearestDelta) { nearestDelta = d; nearestIdx = i }
}
const v1Dist = Math.hypot(v1.xyz[nearestIdx * 3], v1.xyz[nearestIdx * 3 + 1], v1.xyz[nearestIdx * 3 + 2])
console.log(`Voyager 1 distance from Sun at sample nearest 2026-08-07: ${v1Dist.toFixed(3)} AU`)
if (!(v1Dist >= 160 && v1Dist <= 175)) {
  throw new Error(`Voyager 1 distance ${v1Dist} AU near 2026-08-07 outside the expected 160-175 AU band`)
}
console.log('gate: Voyager 1 distance near 2026-08-07 in the expected 160-175 AU band — OK')

for (const r of rows) {
  if (r.jdSamples.length < 100) throw new Error(`${r.name}: sample count ${r.jdSamples.length} < 100`)
  for (let i = 1; i < r.jdSamples.length; i++) {
    if (!(r.jdSamples[i] > r.jdSamples[i - 1])) throw new Error(`${r.name}: JD not monotonic at ${i}`)
  }
  if (!r.xyz.every(Number.isFinite)) throw new Error(`${r.name}: non-finite position in xyz`)
}
console.log('gate: every craft has >= 100 samples, monotonic JD, all-finite positions — OK')

// ---- write --------------------------------------------------------------------------------

const json = JSON.stringify(rows)
writeFileSync('public/spacecraft.json', json)
const md5 = createHash('md5').update(json).digest('hex')
console.log(`wrote public/spacecraft.json (${(json.length / 1024).toFixed(1)} KB, md5 ${md5})`)
console.log('Determinism check: re-run this script (from the now-populated scripts/cache/) and')
console.log('confirm the printed md5 above is identical across runs.')
