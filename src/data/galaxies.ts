/** Curated famous galaxies and clusters, positioned by real J2000 RA/Dec + distance. Rendered
 * as named focus targets layered on top of the bulk galaxies.bin point cloud — these are the
 * "landmarks" of the deep field, the galactic equivalent of the named stars. `facts` excludes
 * distance (the card computes and displays that from distMpc) and type (shown separately too). */
export interface GalaxyDef {
  id: string
  name: string
  raHours: number   // J2000, HYG convention (hours)
  decDeg: number    // J2000 (degrees)
  distMpc: number
  type: string
  facts: Record<string, string>
  /** Approximate visible diameter in kilolight-years (literature values). Drives the curated-galaxy
   * glow sprite's size (galaxySprites.ts). Omitted for cluster entries (no single-object diameter). */
  diameterKly?: number
}

export const GALAXIES: GalaxyDef[] = [
  {
    id: 'm31', name: 'Andromeda Galaxy (M31)', raHours: 0.712, decDeg: 41.269, distMpc: 0.78,
    type: 'Spiral (SA(s)b)', diameterKly: 220,
    facts: {
      'Notable fact': 'The nearest large spiral to the Milky Way; on a collision course, ~4.5 billion years out',
      Diameter: '~220,000 ly', Discoverer: 'Known since antiquity; first telescopic study by Simon Marius, 1612',
    },
  },
  {
    id: 'm33', name: 'Triangulum Galaxy (M33)', raHours: 1.564, decDeg: 30.660, distMpc: 0.86,
    type: 'Spiral (SA(s)cd)', diameterKly: 60,
    facts: {
      'Notable fact': 'Third-largest member of the Local Group; visible to the naked eye under dark skies',
      Diameter: '~60,000 ly',
    },
  },
  {
    id: 'm81', name: "Bode's Galaxy (M81)", raHours: 9.926, decDeg: 69.065, distMpc: 3.6,
    type: 'Spiral (SA(s)ab)', diameterKly: 90,
    facts: {
      'Notable fact': 'One of the brightest galaxies visible from Earth; grand-design spiral',
      Discoverer: 'Johann Elert Bode, 1774',
    },
  },
  {
    id: 'm82', name: 'Cigar Galaxy (M82)', raHours: 9.931, decDeg: 69.679, distMpc: 3.5,
    type: 'Starburst (irregular)', diameterKly: 37,
    facts: {
      'Notable fact': 'Prototypical starburst galaxy, undergoing intense star formation from a close pass with M81',
      'Star formation rate': '~10x the Milky Way',
    },
  },
  {
    id: 'm87', name: 'Virgo A (M87)', raHours: 12.514, decDeg: 12.391, distMpc: 16.8,
    type: 'Giant elliptical (E+0-1 pec)', diameterKly: 120,
    facts: {
      'Notable fact': 'Home to the first black hole ever imaged (Event Horizon Telescope, 2019)',
      'Black hole mass': '~6.5 billion solar masses', Redshift: 'z ≈ 0.0043',
    },
  },
  {
    id: 'm104', name: 'Sombrero Galaxy (M104)', raHours: 12.667, decDeg: -11.623, distMpc: 9.6,
    type: 'Spiral (SA(s)a)', diameterKly: 50,
    facts: {
      'Notable fact': 'Named for its bright nucleus, bulge, and dust lane resembling a sombrero hat',
      'Central black hole mass': '~1 billion solar masses',
    },
  },
  {
    id: 'm51', name: 'Whirlpool Galaxy (M51)', raHours: 13.498, decDeg: 47.195, distMpc: 8.6,
    type: 'Spiral (SA(s)bc pec), interacting', diameterKly: 76,
    facts: {
      'Notable fact': 'Classic grand-design spiral, interacting with companion NGC 5195',
      Discoverer: 'Charles Messier, 1773; first galaxy in which spiral structure was seen (Lord Rosse, 1845)',
    },
  },
  {
    id: 'm101', name: 'Pinwheel Galaxy (M101)', raHours: 14.053, decDeg: 54.349, distMpc: 6.4,
    type: 'Spiral (SAB(rs)cd)', diameterKly: 170,
    facts: {
      'Notable fact': 'Large, face-on spiral roughly 70% wider than the Milky Way',
      Diameter: '~170,000 ly',
    },
  },
  {
    id: 'centaurus-a', name: 'Centaurus A (NGC 5128)', raHours: 13.425, decDeg: -43.019, distMpc: 3.8,
    type: 'Peculiar lenticular/elliptical', diameterKly: 60,
    facts: {
      'Notable fact': 'Closest active galaxy to Earth; a massive dust lane marks an ongoing galaxy merger',
      Discoverer: 'James Dunlop, 1826',
    },
  },
  {
    id: 'm49', name: 'M49', raHours: 12.496, decDeg: 8.000, distMpc: 16.7,
    type: 'Giant elliptical (E2)', diameterKly: 157,
    facts: {
      'Notable fact': 'Brightest galaxy in the Virgo Cluster',
      Discoverer: 'Charles Messier, 1771',
    },
  },
  {
    id: 'm60', name: 'M60', raHours: 12.727, decDeg: 11.553, distMpc: 16.5,
    type: 'Giant elliptical (E2)', diameterKly: 120,
    facts: {
      'Notable fact': 'Paired on the sky with spiral NGC 4647; hosts a ~4.5 billion solar mass black hole',
    },
  },
  {
    id: 'ngc1316', name: 'Fornax A (NGC 1316)', raHours: 3.378, decDeg: -37.208, distMpc: 21.0,
    type: 'Peculiar lenticular', diameterKly: 110,
    facts: {
      'Notable fact': 'Brightest member of the Fornax Cluster; strong radio source shaped by past galaxy mergers',
    },
  },
  {
    id: 'ngc253', name: 'Sculptor Galaxy (NGC 253)', raHours: 0.792, decDeg: -25.288, distMpc: 3.5,
    type: 'Starburst spiral (SAB(s)c)', diameterKly: 70,
    facts: {
      'Notable fact': 'Brightest galaxy of the Sculptor Group; one of the dustiest galaxies known',
      Discoverer: 'Caroline Herschel, 1783',
    },
  },
  {
    id: 'ngc4874', name: 'NGC 4874', raHours: 12.993, decDeg: 27.959, distMpc: 100.0,
    type: 'Giant cD elliptical', diameterKly: 250,
    facts: {
      'Notable fact': 'Co-dominant central galaxy of the Coma Cluster, one of the most massive galaxies known',
    },
  },
  {
    id: 'ngc4889', name: 'NGC 4889', raHours: 13.001, decDeg: 27.977, distMpc: 100.0,
    type: 'Giant cD elliptical', diameterKly: 250,
    facts: {
      'Notable fact': 'Co-dominant Coma Cluster galaxy; hosts one of the largest black holes known (~2×10^10 solar masses)',
      Redshift: 'z ≈ 0.0219',
    },
  },
  {
    id: 'ngc1275', name: 'Perseus A (NGC 1275)', raHours: 3.331, decDeg: 41.512, distMpc: 76.0,
    type: 'Seyfert/cD elliptical', diameterKly: 100,
    facts: {
      'Notable fact': 'Central galaxy of the Perseus Cluster; sits in the Perseus intracluster medium "sound wave" (a B-flat 57 octaves below middle C)',
      Redshift: 'z ≈ 0.0179',
    },
  },
  {
    id: 'm94', name: 'M94', raHours: 12.848, decDeg: 41.120, distMpc: 4.7,
    type: 'Spiral (SA(r)ab)', diameterKly: 50,
    facts: {
      'Notable fact': 'Bright inner ring of concentrated star formation surrounding a compact nucleus',
    },
  },
  {
    id: 'm83', name: 'Southern Pinwheel Galaxy (M83)', raHours: 13.617, decDeg: -29.866, distMpc: 4.9,
    type: 'Barred spiral (SAB(s)c)', diameterKly: 55,
    facts: {
      'Notable fact': 'One of the closest and brightest barred spirals; has hosted six recorded supernovae',
    },
  },
  {
    id: 'm64', name: 'Black Eye Galaxy (M64)', raHours: 12.945, decDeg: 21.683, distMpc: 5.3,
    type: 'Spiral (SA(rs)ab)', diameterKly: 54,
    facts: {
      'Notable fact': 'Named for a striking dark dust band across its bright nucleus',
    },
  },
  {
    id: 'm63', name: 'Sunflower Galaxy (M63)', raHours: 13.263, decDeg: 42.029, distMpc: 8.9,
    type: 'Spiral (SA(rs)bc)', diameterKly: 98,
    facts: {
      'Notable fact': 'Flocculent spiral with patchy, discontinuous arms rather than grand-design arms',
    },
  },
  {
    id: 'ngc891', name: 'NGC 891', raHours: 2.377, decDeg: 42.349, distMpc: 9.6,
    type: 'Edge-on spiral (SA(s)b?)', diameterKly: 100,
    facts: {
      'Notable fact': 'Seen exactly edge-on, with a prominent dust lane; often called a Milky Way look-alike',
    },
  },
  {
    id: 'm77', name: 'M77 (Cetus A)', raHours: 2.712, decDeg: -0.013, distMpc: 14.0,
    type: 'Barred spiral Seyfert II', diameterKly: 170,
    facts: {
      'Notable fact': 'One of the closest and most luminous Seyfert galaxies, with an actively feeding central black hole',
    },
  },
  {
    id: 'ngc1300', name: 'NGC 1300', raHours: 3.328, decDeg: -19.411, distMpc: 20.7,
    type: 'Barred spiral (SB(rs)bc)', diameterKly: 110,
    facts: {
      'Notable fact': 'Textbook example of a strongly barred spiral galaxy',
    },
  },
  {
    id: 'ngc1365', name: 'NGC 1365', raHours: 3.559, decDeg: -36.140, distMpc: 19.0,
    type: 'Giant barred spiral (SB(s)b)', diameterKly: 200,
    facts: {
      'Notable fact': 'Dominant member of the Fornax Cluster; one of the largest known barred spirals',
    },
  },
  {
    id: 'ngc5195', name: 'NGC 5195', raHours: 13.500, decDeg: 47.266, distMpc: 8.0,
    type: 'Dwarf lenticular, interacting', diameterKly: 25,
    facts: {
      'Notable fact': "The Whirlpool's small companion, whose gravity shaped M51's spiral arms",
    },
  },
  {
    id: 'ic1101', name: 'IC 1101', raHours: 15.182, decDeg: 5.745, distMpc: 320.0,
    type: 'Supergiant cD elliptical', diameterKly: 400,
    facts: {
      'Notable fact': 'Among the largest galaxies ever found, spanning roughly 4 million ly, central to the Abell 2029 cluster',
      Redshift: 'z ≈ 0.0766',
    },
  },
  {
    id: 'virgo-cluster', name: 'Virgo Cluster (core)', raHours: 12.514, decDeg: 12.391, distMpc: 16.5,
    type: 'Galaxy cluster (~1,300 members)',
    facts: {
      'Notable fact': 'Nearest large galaxy cluster; the Local Group is gravitationally bound to it as part of the Virgo Supercluster',
    },
  },
  {
    id: 'fornax-cluster', name: 'Fornax Cluster', raHours: 3.641, decDeg: -35.451, distMpc: 19.0,
    type: 'Galaxy cluster (~340 members)',
    facts: {
      'Notable fact': 'Second-richest galaxy cluster within ~100 Mly, dominated by NGC 1399',
    },
  },
  {
    id: 'coma-cluster', name: 'Coma Cluster', raHours: 12.993, decDeg: 27.959, distMpc: 100.0,
    type: 'Galaxy cluster (~1,000 members)',
    facts: {
      'Notable fact': "Fritz Zwicky's 1933 velocity study of this cluster produced the first evidence for dark matter",
      Redshift: 'z ≈ 0.0231',
    },
  },
  {
    id: 'perseus-cluster', name: 'Perseus Cluster', raHours: 3.331, decDeg: 41.512, distMpc: 74.0,
    type: 'Galaxy cluster (~500+ members)',
    facts: {
      'Notable fact': 'One of the most massive known structures; its intracluster gas emits the deepest "note" ever detected from an astronomical object',
      Redshift: 'z ≈ 0.0179',
    },
  },
]
