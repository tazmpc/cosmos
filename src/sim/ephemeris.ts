import { Body, HelioVector } from 'astronomy-engine'

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

const AE_BODY: Record<Exclude<BodyId, 'sun'>, Body> = {
  mercury: Body.Mercury, venus: Body.Venus, earth: Body.Earth, moon: Body.Moon,
  mars: Body.Mars, jupiter: Body.Jupiter, saturn: Body.Saturn,
  uranus: Body.Uranus, neptune: Body.Neptune,
}

export interface Xyz { x: number; y: number; z: number }

/**
 * Heliocentric position, J2000 equatorial frame (EQJ), AU.
 *
 * Positions are geometric — not corrected for light travel time or
 * aberration. This is deliberate: we are placing bodies in a 3D scene,
 * not computing apparent positions on an observer's sky.
 *
 * The Moon needs no special casing: astronomy-engine's HelioVector
 * internally computes Earth-heliocentric + geocentric Moon for Body.Moon.
 */
export function bodyPosition(id: BodyId, date: Date): Xyz {
  if (id === 'sun') return { x: 0, y: 0, z: 0 }
  const v = HelioVector(AE_BODY[id], date)
  return { x: v.x, y: v.y, z: v.z }
}
