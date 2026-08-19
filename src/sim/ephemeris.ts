import { Body, HelioVector, JupiterMoons } from 'astronomy-engine'
import { dateToJd } from './kepler'
import { moonOffsetEqjAu } from './moonOrbit'
import { MOON_ELEMENTS, type MoonV2Id } from '../data/moonElements'

export type BodyId =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
  | 'io' | 'europa' | 'ganymede' | 'callisto'
  | MoonV2Id

type GalileanMoon = 'io' | 'europa' | 'ganymede' | 'callisto'
const GALILEAN_MOONS: readonly GalileanMoon[] = ['io', 'europa', 'ganymede', 'callisto']
function isGalileanMoon(id: BodyId): id is GalileanMoon {
  return (GALILEAN_MOONS as readonly BodyId[]).includes(id)
}

/** The nine moons propagated from JPL mean orbital elements (src/data/moonElements.ts) via the
 *  Laplace-plane Kepler solver in src/sim/moonOrbit.ts — everything astronomy-engine has no
 *  ephemeris for beyond the four Galilean moons above. Each maps to the parent planet whose
 *  astronomy-engine heliocentric position their offset gets added to. */
const MOON_V2_PARENT: Record<MoonV2Id, 'saturn' | 'neptune' | 'uranus' | 'mars'> = {
  titan: 'saturn', rhea: 'saturn', iapetus: 'saturn', enceladus: 'saturn',
  triton: 'neptune',
  titania: 'uranus', oberon: 'uranus',
  phobos: 'mars', deimos: 'mars',
}
function isMoonV2(id: BodyId): id is MoonV2Id {
  return Object.prototype.hasOwnProperty.call(MOON_V2_PARENT, id)
}

const AE_BODY: Record<Exclude<BodyId, 'sun' | GalileanMoon | MoonV2Id>, Body> = {
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
 *
 * The nine "moons v2" (Titan, Rhea, Iapetus, Enceladus, Triton, Titania, Oberon, Phobos, Deimos)
 * likewise have no astronomy-engine ephemeris — their parent-centered offset is propagated from
 * JPL mean orbital elements (src/sim/moonOrbit.ts) and added to the parent planet's own
 * astronomy-engine heliocentric position, same composition pattern as the Galilean moons above.
 */
export function bodyPosition(id: BodyId, date: Date): Xyz {
  if (id === 'sun') return { x: 0, y: 0, z: 0 }
  if (isGalileanMoon(id)) {
    const j = HelioVector(Body.Jupiter, date)
    const m = JupiterMoons(date)[id]
    return { x: j.x + m.x, y: j.y + m.y, z: j.z + m.z }
  }
  if (isMoonV2(id)) {
    const parent = HelioVector(AE_BODY[MOON_V2_PARENT[id]], date)
    const off = moonOffsetEqjAu(MOON_ELEMENTS[id], dateToJd(date))
    return { x: parent.x + off.x, y: parent.y + off.y, z: parent.z + off.z }
  }
  const v = HelioVector(AE_BODY[id], date)
  return { x: v.x, y: v.y, z: v.z }
}
