import { readFileSync, writeFileSync } from 'node:fs'
import { raDecDistToXyz } from '../src/data/starMath'

// d3-celestial constellations.lines.json (BSD-3, Olaf Frohn): GeoJSON FeatureCollection,
// one MultiLineString per constellation, coordinates [ra, dec] in DEGREES with RA in
// [-180, 180] (verified by inspecting the raw file's min/max: -177.91..179.91) — NOT the
// [0, 360) convention. Normalize to [0, 360) here so downstream consumers get one convention.
interface ConstellationGeoJSON {
  type: 'FeatureCollection'
  features: {
    id: string
    geometry: { type: 'MultiLineString'; coordinates: [number, number][][] }
  }[]
}

const raw: ConstellationGeoJSON = JSON.parse(
  readFileSync('scripts/cache/constellations.lines.json', 'utf8'),
)

function normalizeRa(ra: number): number {
  const r = ra % 360
  return r < 0 ? r + 360 : r
}

/** Angular separation (degrees) between two ra/dec points, via the 3D unit-vector dot product —
 * NOT 2D RA/Dec arithmetic, which is wrong near the poles and across the RA 0/360 seam. This is
 * the same convention the renderer uses (raDecDistToXyz), so it validates what actually gets drawn:
 * a 3D chord on the celestial sphere, which is correct whether or not a segment "crosses" RA 0. */
function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const [x1, y1, z1] = raDecDistToXyz(ra1 / 15, dec1, 1)
  const [x2, y2, z2] = raDecDistToXyz(ra2 / 15, dec2, 1)
  const dot = Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2))
  return Math.acos(dot) * 180 / Math.PI
}

const segments: [number, number, number, number][] = []
let featureCount = 0

for (const feature of raw.features) {
  featureCount++
  for (const line of feature.geometry.coordinates) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ra1raw, dec1] = line[i]
      const [ra2raw, dec2] = line[i + 1]
      const ra1 = normalizeRa(ra1raw)
      const ra2 = normalizeRa(ra2raw)
      segments.push([ra1, dec1, ra2, dec2])
    }
  }
}

// ---- Sanity gates ----
let raOk = true
let decOk = true
let angOk = true
let maxAng = 0
for (const [ra1, dec1, ra2, dec2] of segments) {
  if (!(ra1 >= 0 && ra1 < 360) || !(ra2 >= 0 && ra2 < 360)) raOk = false
  if (!(dec1 >= -90 && dec1 <= 90) || !(dec2 >= -90 && dec2 <= 90)) decOk = false
  const ang = angularSeparationDeg(ra1, dec1, ra2, dec2)
  if (ang > maxAng) maxAng = ang
  if (ang >= 60) angOk = false
}

console.log(`constellations: ${featureCount} features, ${segments.length} segments`)
console.log(`gate RA in [0,360): ${raOk ? 'PASS' : 'FAIL'}`)
console.log(`gate Dec in [-90,90]: ${decOk ? 'PASS' : 'FAIL'}`)
console.log(`gate angular length < 60deg (max seen: ${maxAng.toFixed(2)}deg): ${angOk ? 'PASS' : 'FAIL'}`)

if (!raOk || !decOk || !angOk) {
  throw new Error('Sanity gate failed — see log above. Refusing to write public/constellations.json.')
}

writeFileSync('public/constellations.json', JSON.stringify({ segments }))
console.log(`wrote public/constellations.json (${segments.length} segments)`)
