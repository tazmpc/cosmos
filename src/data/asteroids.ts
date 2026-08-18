/**
 * The named minor planets — the handful out of MPCORB's ~1.55M that are searchable, flyable, and
 * carry a hand-written info card. Everything else in public/asteroids.bin is an anonymous point
 * in the belt (see src/scene/asteroidField.ts).
 *
 * `mpcNumber` is the permanent IAU minor-planet number, which is how these are matched against
 * the baked binary: scripts/build-asteroids.ts writes public/asteroidnames.json mapping this
 * number to the object's index in asteroids.bin. Positions come from propagating that object's
 * own MPCORB elements, so a card's fly-to target MOVES as sim time advances.
 *
 * Bennu, Ryugu and Apophis are small near-Earth objects that fail the binary's H < 17 and
 * a > 1.5 AU cuts; the build script force-includes every entry in this list regardless.
 */
export interface FamousAsteroid {
  /** IAU minor-planet number — the join key against public/asteroidnames.json. */
  mpcNumber: number
  /** Stable search/focus key. */
  id: string
  name: string
  facts: Record<string, string>
}

export const FAMOUS_ASTEROIDS: FamousAsteroid[] = [
  {
    mpcNumber: 1, id: 'ceres', name: 'Ceres',
    facts: {
      Diameter: '940 km',
      Discovered: '1801 by Giuseppe Piazzi — the first asteroid found',
      Note: 'A dwarf planet holding about a quarter of the entire belt\'s mass. NASA\'s Dawn orbited it in 2015 and found bright sodium-carbonate salt deposits in Occator crater, left by briny water reaching the surface.',
    },
  },
  {
    mpcNumber: 2, id: 'pallas', name: 'Pallas',
    facts: {
      Diameter: '512 km',
      Discovered: '1802 by Heinrich Olbers',
      Note: 'The third-largest asteroid, on a strikingly tilted orbit — 34.9° to the ecliptic, far steeper than its neighbours. No spacecraft has ever visited it.',
    },
  },
  {
    mpcNumber: 3, id: 'juno', name: 'Juno',
    facts: {
      Diameter: '250 km',
      Discovered: '1804 by Karl Harding',
      Note: 'One of the largest stony (S-type) asteroids, and the third object ever found in the belt.',
    },
  },
  {
    mpcNumber: 4, id: 'vesta', name: 'Vesta',
    facts: {
      Diameter: '525 km',
      Discovered: '1807 by Heinrich Olbers',
      Note: 'The brightest asteroid seen from Earth — occasionally visible to the naked eye. Dawn orbited it in 2011-12 and confirmed it is differentiated, with an iron core; the enormous Rheasilvia basin at its south pole is the source of the HED meteorites found on Earth.',
    },
  },
  {
    mpcNumber: 10, id: 'hygiea', name: 'Hygiea',
    facts: {
      Diameter: '434 km',
      Discovered: '1849 by Annibale de Gasparis',
      Note: 'The fourth-largest asteroid and the biggest of the dark carbonaceous ones. VLT imaging in 2019 showed it is nearly round, which would make it the smallest dwarf planet in the solar system.',
    },
  },
  {
    mpcNumber: 15, id: 'eunomia', name: 'Eunomia',
    facts: {
      Diameter: '270 km',
      Discovered: '1851 by Annibale de Gasparis',
      Note: 'The largest of the stony S-type asteroids, and the namesake of the Eunomia family — a cluster of fragments left by an ancient collision.',
    },
  },
  {
    mpcNumber: 243, id: 'ida', name: 'Ida',
    facts: {
      Diameter: '31 km long',
      'Visited by': 'Galileo flyby, 1993',
      Note: 'The first asteroid discovered to have a moon of its own — the 1.4 km Dactyl, spotted in Galileo\'s images months after the flyby.',
    },
  },
  {
    mpcNumber: 433, id: 'eros', name: 'Eros',
    facts: {
      Diameter: '17 km long',
      'Visited by': 'NEAR Shoemaker, 2000-2001',
      Note: 'A peanut-shaped near-Earth asteroid, and the first ever orbited by a spacecraft — NEAR Shoemaker then touched down on it in 2001, the first landing on an asteroid.',
    },
  },
  {
    mpcNumber: 951, id: 'gaspra', name: 'Gaspra',
    facts: {
      Diameter: '18 km long',
      'Visited by': 'Galileo flyby, 1991',
      Note: 'The first asteroid ever photographed close-up, when Galileo passed within 1,600 km of it on its way to Jupiter.',
    },
  },
  {
    mpcNumber: 99942, id: 'apophis', name: 'Apophis',
    facts: {
      Diameter: '340 m',
      'Close approach': '13 April 2029',
      Note: 'Will pass about 32,000 km above Earth in 2029 — closer than our geostationary satellites, and bright enough to watch with the naked eye. Early observations gave it a small impact chance; radar has since ruled out any impact for at least a century.',
    },
  },
  {
    mpcNumber: 101955, id: 'bennu', name: 'Bennu',
    facts: {
      Diameter: '490 m',
      'Visited by': 'OSIRIS-REx, 2018-2021',
      Note: 'A carbon-rich rubble pile whose surface proved so loosely packed the sampling arm sank into it. Its 121-gram sample returned to Earth in September 2023 and contains clays, carbon and amino acids.',
    },
  },
  {
    mpcNumber: 162173, id: 'ryugu', name: 'Ryugu',
    facts: {
      Diameter: '900 m',
      'Visited by': 'Hayabusa2, 2018-2019',
      Note: 'A spinning-top-shaped rubble pile. Japan\'s Hayabusa2 fired a copper impactor into it to expose fresh material, and delivered 5.4 grams to Earth in December 2020 — the first subsurface sample from an asteroid.',
    },
  },
]
