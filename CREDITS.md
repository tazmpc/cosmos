# Data & Asset Credits

- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) — CC Attribution 4.0.
- Planet/Moon/Sun positions: [astronomy-engine](https://github.com/cosinekitty/astronomy) — MIT.
- Star catalog (bootstrap): [HYG Database](https://github.com/astronexus/HYG-Database) — CC0.
- Star catalog (full): ESA [Gaia DR3](https://gea.esac.esa.int/archive/); this work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).
- Galaxy catalog (deep/wedge): Sloan Digital Sky Survey (SDSS), via [SkyServer](https://skyserver.sdss.org/). Funding for the Sloan Digital Sky Survey has been provided by the Alfred P. Sloan Foundation, the U.S. Department of Energy Office of Science, and the Participating Institutions.
- Galaxy catalog (all-sky, local): 2MASS Redshift Survey (2MRS) — Huchra, J. P., et al. 2012, ApJS, 199, 26 (VizieR catalog [J/ApJS/199/26](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/ApJS/199/26)).
- Milky Way layers: **model layers**, not individually-real stars. The interior layer's sky-plane density is real — sampled from 1M Gaia DR3 sky positions (uniform `random_index` shuffle) — with modeled depth (exponential disk Rd≈2.6 kpc, hz≈0.3 kpc + 4-arm log spiral + dust + bulge). The exterior layer (shown from ~20 kpc out) is sampled entirely from that analytic model, with no Gaia positions. Both built by `scripts/build-milkyway.ts`; see README "The deep field" for the honesty note.
- Real imagery for curated galaxies and deep-sky objects: [hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) cutout service, survey `CDS/P/DSS2/color` — Centre de Données astronomiques de Strasbourg (CDS). Digitized Sky Survey 2 data via CDS's HiPS infrastructure.
- Constellation lines (sky view): [d3-celestial](https://github.com/ofrohn/d3-celestial) `constellations.lines.json` — Olaf Frohn, BSD-3-Clause license.
