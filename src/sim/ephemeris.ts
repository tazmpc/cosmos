import { Body, GeoVector, HelioVector } from 'astronomy-engine'

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

const AE_BODY: Record<Exclude<BodyId, 'sun' | 'moon'>, Body> = {
  mercury: Body.Mercury, venus: Body.Venus, earth: Body.Earth, mars: Body.Mars,
  jupiter: Body.Jupiter, saturn: Body.Saturn, uranus: Body.Uranus, neptune: Body.Neptune,
}

export interface Xyz { x: number; y: number; z: number }

/** Heliocentric position, J2000 equatorial frame, AU. */
export function bodyPosition(id: BodyId, date: Date): Xyz {
  if (id === 'sun') return { x: 0, y: 0, z: 0 }
  if (id === 'moon') {
    const e = HelioVector(Body.Earth, date)
    const m = GeoVector(Body.Moon, date, true)
    return { x: e.x + m.x, y: e.y + m.y, z: e.z + m.z }
  }
  const v = HelioVector(AE_BODY[id], date)
  return { x: v.x, y: v.y, z: v.z }
}
