import type { BodyId } from '../sim/ephemeris'
import { KM_PER_AU } from './units'

export interface PlanetDef {
  id: BodyId
  name: string
  radiusAu: number
  texture: string
  periodDays: number      // orbital period, for orbit lines (0 = none)
  parent: BodyId | null   // 'earth' for the Moon, null for heliocentric bodies
  facts: Record<string, string>
}

const KM = 1 / KM_PER_AU

export const PLANETS: PlanetDef[] = [
  { id: 'sun', name: 'Sun', radiusAu: 696340 * KM, texture: '2k_sun.jpg', periodDays: 0, parent: null,
    facts: { Type: 'G2V main-sequence star', Radius: '696,340 km', 'Surface temp': '5,772 K', Age: '4.6 billion years' } },
  { id: 'mercury', name: 'Mercury', radiusAu: 2439.7 * KM, texture: '2k_mercury.jpg', periodDays: 87.97, parent: null,
    facts: { Radius: '2,440 km', Year: '88 days', Day: '59 Earth days', Moons: '0' } },
  { id: 'venus', name: 'Venus', radiusAu: 6051.8 * KM, texture: '2k_venus_surface.jpg', periodDays: 224.7, parent: null,
    facts: { Radius: '6,052 km', Year: '225 days', Day: '243 Earth days (retrograde)', Moons: '0' } },
  { id: 'earth', name: 'Earth', radiusAu: 6371.0 * KM, texture: '2k_earth_daymap.jpg', periodDays: 365.25, parent: null,
    facts: { Radius: '6,371 km', Year: '365.25 days', Day: '23.9 hours', Moons: '1' } },
  { id: 'moon', name: 'Moon', radiusAu: 1737.4 * KM, texture: '2k_moon.jpg', periodDays: 27.32, parent: 'earth',
    facts: { Radius: '1,737 km', 'Orbital period': '27.3 days', 'Distance from Earth': '384,400 km' } },
  { id: 'mars', name: 'Mars', radiusAu: 3389.5 * KM, texture: '2k_mars.jpg', periodDays: 686.98, parent: null,
    facts: { Radius: '3,390 km', Year: '687 days', Day: '24.6 hours', Moons: '2' } },
  { id: 'jupiter', name: 'Jupiter', radiusAu: 69911 * KM, texture: '2k_jupiter.jpg', periodDays: 4332.6, parent: null,
    facts: { Radius: '69,911 km', Year: '11.9 years', Day: '9.9 hours', Moons: '95' } },
  { id: 'saturn', name: 'Saturn', radiusAu: 58232 * KM, texture: '2k_saturn.jpg', periodDays: 10759, parent: null,
    facts: { Radius: '58,232 km', Year: '29.4 years', Day: '10.7 hours', Moons: '146' } },
  { id: 'uranus', name: 'Uranus', radiusAu: 25362 * KM, texture: '2k_uranus.jpg', periodDays: 30688, parent: null,
    facts: { Radius: '25,362 km', Year: '84 years', Day: '17.2 hours (retrograde)', Moons: '28' } },
  { id: 'neptune', name: 'Neptune', radiusAu: 24622 * KM, texture: '2k_neptune.jpg', periodDays: 60182, parent: null,
    facts: { Radius: '24,622 km', Year: '165 years', Day: '16.1 hours', Moons: '16' } },
]
