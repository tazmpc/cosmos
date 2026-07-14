import { Body, HelioVector, JupiterMoons } from 'astronomy-engine'

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
  | 'io' | 'europa' | 'ganymede' | 'callisto'

type GalileanMoon = 'io' | 'europa' | 'ganymede' | 'callisto'
const GALILEAN_MOONS: readonly GalileanMoon[] = ['io', 'europa', 'ganymede', 'callisto']
function isGalileanMoon(id: BodyId): id is GalileanMoon {
  return (GALILEAN_MOONS as readonly BodyId[]).includes(id)
}

const AE_BODY: Record<Exclude<BodyId, 'sun' | GalileanMoon>, Body> = {
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
 *
 * The Galilean moons have no Body enum entry — astronomy-engine exposes them
 * via JupiterMoons(date), which returns jovicentric EQJ StateVectors. Add
 * those to Jupiter's own heliocentric position to get a heliocentric vector.
 */
export function bodyPosition(id: BodyId, date: Date): Xyz {
  if (id === 'sun') return { x: 0, y: 0, z: 0 }
  if (isGalileanMoon(id)) {
    const j = HelioVector(Body.Jupiter, date)
    const m = JupiterMoons(date)[id]
    return { x: j.x + m.x, y: j.y + m.y, z: j.z + m.z }
  }
  const v = HelioVector(AE_BODY[id], date)
  return { x: v.x, y: v.y, z: v.z }
}
