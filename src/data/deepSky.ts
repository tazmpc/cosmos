/** Curated famous deep-sky objects (nebulae, star clusters — non-galaxy), positioned by real
 * J2000 RA/Dec + distance, same "landmark" role as galaxies.ts: searchable, fly-to-able, with
 * info cards. Distances and diameters for nebulae/clusters carry wider literature uncertainty
 * than galaxy distances (often quoted to only 1-2 significant figures) — values here are
 * commonly-cited literature figures, not single-paper measurements. `facts` excludes distance
 * and type (both shown separately by the card, like GalaxyDef). */
export interface DeepSkyDef {
  id: string
  name: string
  raHours: number   // J2000 (hours)
  decDeg: number    // J2000 (degrees)
  distPc: number
  diameterLy: number
  type: string
  facts: Record<string, string>
}

export const DEEP_SKY: DeepSkyDef[] = [
  {
    id: 'm42', name: 'Orion Nebula (M42)', raHours: 5.5881, decDeg: -5.3911,
    distPc: 412, diameterLy: 24, type: 'Emission nebula (H II region)',
    facts: {
      'Notable fact': 'Visible to the naked eye as the fuzzy "star" in Orion\'s Sword; a stellar nursery forming hundreds of new stars',
      'Central cluster': 'The Trapezium Cluster of hot young O and B stars illuminates the surrounding gas',
    },
  },
  {
    id: 'm45', name: 'Pleiades (M45)', raHours: 3.7900, decDeg: 24.1167,
    distPc: 136, diameterLy: 8, type: 'Open cluster',
    facts: {
      'Notable fact': 'The "Seven Sisters" — a young, hot cluster wrapped in a blue reflection nebula from an unrelated dust cloud it is passing through',
      Age: '~100 million years',
    },
  },
  {
    id: 'carina-nebula', name: 'Carina Nebula (NGC 3372)', raHours: 10.7524, decDeg: -59.8678,
    distPc: 2300, diameterLy: 300, type: 'Emission nebula (H II region)',
    facts: {
      'Notable fact': 'One of the largest and brightest nebulae in the sky, home to the hypergiant star Eta Carinae',
      'Star formation': 'Contains several of the most massive and luminous stars known',
    },
  },
  {
    id: 'm8', name: 'Lagoon Nebula (M8)', raHours: 18.0603, decDeg: -24.3867,
    distPc: 1250, diameterLy: 110, type: 'Emission nebula (H II region)',
    facts: {
      'Notable fact': 'Visible to the naked eye under dark skies as a hazy patch in Sagittarius; a large active star-forming region',
      Discoverer: 'Giovanni Battista Hodierna, before 1654',
    },
  },
  {
    id: 'm16', name: 'Eagle Nebula (M16)', raHours: 18.3133, decDeg: -13.8167,
    distPc: 1740, diameterLy: 70, type: 'Emission nebula / open cluster (H II region)',
    facts: {
      'Notable fact': 'Home to the "Pillars of Creation" — towering columns of gas and dust made famous by Hubble',
      Discoverer: 'Jean-Philippe de Chéseaux, 1745–46',
    },
  },
  {
    id: 'm20', name: 'Trifid Nebula (M20)', raHours: 18.0397, decDeg: -23.0300,
    distPc: 1250, diameterLy: 35, type: 'Emission and reflection nebula',
    facts: {
      'Notable fact': 'Named for the three dark dust lanes that split its glowing core into lobes',
      Discoverer: 'Charles Messier, 1764',
    },
  },
  {
    id: 'm57', name: 'Ring Nebula (M57)', raHours: 18.8931, decDeg: 33.0292,
    distPc: 700, diameterLy: 1.3, type: 'Planetary nebula',
    facts: {
      'Notable fact': 'A sun-like star\'s outer layers, shed near the end of its life, glowing around the exposed white-dwarf core',
      Discoverer: 'Antoine Darquier de Pellepoix, 1779',
    },
  },
  {
    id: 'm27', name: 'Dumbbell Nebula (M27)', raHours: 19.9934, decDeg: 22.7211,
    distPc: 400, diameterLy: 3, type: 'Planetary nebula',
    facts: {
      'Notable fact': 'The first planetary nebula ever discovered',
      Discoverer: 'Charles Messier, 1764',
    },
  },
  {
    id: 'm1', name: 'Crab Nebula (M1)', raHours: 5.5755, decDeg: 22.0144,
    distPc: 2000, diameterLy: 11, type: 'Supernova remnant',
    facts: {
      'Notable fact': 'The wreckage of a supernova recorded by Chinese and Arab astronomers in 1054 CE',
      'Central object': 'Powered by the Crab Pulsar, a neutron star spinning ~30 times per second',
    },
  },
  {
    id: 'helix', name: 'Helix Nebula (NGC 7293)', raHours: 22.4940, decDeg: -20.8372,
    distPc: 215, diameterLy: 2.5, type: 'Planetary nebula',
    facts: {
      'Notable fact': 'One of the closest planetary nebulae to Earth, nicknamed the "Eye of God" for its layered ring structure',
    },
  },
  {
    id: 'rosette', name: 'Rosette Nebula (NGC 2237)', raHours: 6.5383, decDeg: 5.0667,
    distPc: 1600, diameterLy: 130, type: 'Emission nebula with embedded open cluster',
    facts: {
      'Notable fact': 'A flower-shaped ring of glowing gas surrounding the young open cluster NGC 2244, whose stellar winds carved the central cavity',
    },
  },
  {
    id: 'm13', name: 'Hercules Cluster (M13)', raHours: 16.6948, decDeg: 36.4599,
    distPc: 6800, diameterLy: 145, type: 'Globular cluster',
    facts: {
      'Notable fact': 'The finest globular cluster in the northern sky, containing several hundred thousand stars',
      Discoverer: 'Edmond Halley, 1714',
    },
  },
  {
    id: 'omega-centauri', name: 'Omega Centauri (NGC 5139)', raHours: 13.4461, decDeg: -47.4769,
    distPc: 5200, diameterLy: 150, type: 'Globular cluster',
    facts: {
      'Notable fact': 'The largest and brightest globular cluster orbiting the Milky Way, with roughly 10 million stars — possibly the stripped core of a dwarf galaxy',
    },
  },
  {
    id: '47-tucanae', name: '47 Tucanae (NGC 104)', raHours: 0.4015, decDeg: -72.0814,
    distPc: 4500, diameterLy: 120, type: 'Globular cluster',
    facts: {
      'Notable fact': 'Second-brightest globular cluster in the sky after Omega Centauri, with a dense, bright core',
    },
  },
  {
    id: 'double-cluster', name: 'Double Cluster (NGC 869 / NGC 884)', raHours: 2.3450, decDeg: 57.1333,
    distPc: 2300, diameterLy: 75, type: 'Double open cluster',
    facts: {
      'Notable fact': 'A pair of young open clusters in Perseus, close enough together to appear side by side in binoculars',
      Age: '~13 million years (both clusters, coeval)',
    },
  },
]
