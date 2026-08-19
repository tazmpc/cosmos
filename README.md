# Cosmos

Google Earth for the universe — fly from Earth through the real solar system,
past 728,000 real stars, out to see the Milky Way from outside, and on into
1,014,000 real galaxies mapping the local cosmic web. Switch to sky view to stand
on Earth and look up at the real night sky with constellation lines overhead, or
fly into a nebula and watch its glow resolve into a real DSS2 telescope
photograph. All data public: astronomy-engine ephemerides (planet positions
correct for the simulated date), Gaia DR3 + HYG star catalogs, SDSS + 2MRS +
6dFGS + Cosmicflows-4 galaxy catalogs, OpenNGC deep-sky objects, MPC asteroid
orbits, JPL Horizons spacecraft/satellite data, the NASA Exoplanet Archive,
Edenhofer 2023 3D dust, NASA/Solar System Scope imagery, d3-celestial
constellation lines, CDS/hips2fits DSS2 imagery. See CREDITS.md.

## Run

    npm install
    npm run dev

## Use

- **Drag** to orbit the focused object, **scroll** to zoom (speed scales with distance)
- **Search** (top) — try Jupiter, Sirius, Vega, Betelgeuse, Andromeda, the Coma Cluster —
  and fly there
- **Click** a planet or bright star to fly to it; a card shows its real data
- **Time controls** (bottom right): pause, step the rate up to 1 year/second, reset to now

## Sky view

Click the 🔭 button (bottom-right corner) to switch from orbit mode to sky view: the camera
pins to Earth and looks up, the way the sky actually looks from the ground.

- **Drag** to pan the view, **scroll** to zoom (adjusts field of view, not distance)
- **Esc** or the 🔭 button again to exit back to orbit mode
- Constellation lines overlay the real star positions — find Orion's hourglass or the Big
  Dipper the same way you would outside at night
- Time keeps running in sky view, so planets visibly drift along the ecliptic if you leave the
  clock running
- Curated deep-sky objects (Orion Nebula, Pleiades, and others — see "Real imagery" below) sit
  at their real sky positions too; fly to one from search and its glow resolves into a real
  telescope photograph as you approach

## Real imagery

Curated galaxies (Andromeda, M33, …) and ~15 deep-sky objects (Orion Nebula, Pleiades, Ring
Nebula, Omega Centauri, and others) are landmark objects layered on top of the bulk star/galaxy
catalogs. Search for one, or approach it closely enough in orbit mode, and its placeholder glow
sprite is swapped for a real DSS2 (Digitized Sky Survey 2) cutout fetched from CDS's hips2fits
service, centered and scaled to the object's real angular size. This only applies to the curated
set — the bulk star and galaxy catalogs remain points, not photographs.

## Deep-sky catalog (OpenNGC)

Beyond the ~15 hand-curated deep-sky objects, all 12,414 NGC/IC objects from OpenNGC are
searchable — try "NGC 891" or "IC 342", or a common name where one exists. Each gets a
type-aware card (galaxy, globular cluster, open cluster, planetary nebula, nebula,
supernova remnant, …). OpenNGC carries no distance column at all, so card distances are
type-based placeholders — a category median, marked "estimated by type" — while position
(RA/Dec) is exact. Approach one closely enough and its telescope photo loads at the
object's real angular size, computed from its measured major axis, via the same lazy
hips2fits path the curated set uses. Where an OpenNGC entry shares a name with one of the
15 curated objects, the curated entry wins the collision — it carries richer hand-written
facts and a real measured distance instead of a placeholder.

CC-BY-SA-4.0 — see CREDITS.md.

## The deep field

Pulling back from Earth crosses three layers, crossfaded by distance:

1. **Stars** (728k, Gaia DR3 + HYG) — every point is a real star at its real position,
   sized and colored by its real apparent magnitude from wherever you're standing.
   Colors are **observed** colors — what the star looks like from here, not its intrinsic
   hue. For the **58.8%** of Gaia stars where GSP-Phot fitted an effective temperature,
   the color is that measured temperature with the measured interstellar reddening along
   that star's own sight line added back (Edenhofer et al. 2023, out to the star's own
   distance). The remaining **41.2%** — GSP-Phot fits no temperature for every source,
   notably the very bright saturated ones — fall back to Gaia's BP−RP index, which is an
   observed color and so is already reddened; it is converted onto the same B−V scale by
   a cubic refitted at build time against the stars that have both, so the two halves of
   the sky can't drift apart in hue. Named HYG stars (Sirius, Vega, …) keep HYG's
   ground-based B−V, which for bright saturated stars is the better measurement.
2. **The Milky Way** — the modeled layers, clearly labeled as such. Two datasets share
   the job: from **inside** the galaxy you see a layer whose sky-plane density is
   **real** (measured from a 1M-star Gaia sample — the Great Rift and dust patchiness
   you see are genuinely in the data) with **modeled** depth along each sight line
   (exponential disk + spiral arms + dust + bulge). The dust reddening along the first
   1.25 kpc of every sight line is **measured** too — the Edenhofer et al. (2023) 3D
   dust map — so the reddening across the band follows real clouds (the Aquila Rift,
   Orion, ρ Ophiuchi, Cygnus) rather than a smooth exponential. That measured dust
   **reddens the band but cannot darken it**: this layer emits exactly one point per
   Gaia sky direction and normalizes each sight line's weights on its own, so extinction
   moves points nearer along a dusty ray but can never change how many a direction gets.
   The Great Rift still reads as dark here for the honest reason — Gaia's own star
   counts are depleted behind it, which is measured data, not anything the model adds.
   From **outside** (~20 kpc up),
   it crossfades to a second layer sampled **entirely from that same analytic model** —
   no Gaia positions — because the measured sky, being Sun-centered, cannot show the
   galaxy's face-on structure. Both render as unresolved glow, not individually-real
   stars. Every other point of light in the app remains a real cataloged object.
3. **Galaxies** (1.01M, SDSS + 2MRS + 6dFGS + CF4) — every point is a real cataloged
   galaxy, positioned by its real sky coordinates and distance. That distance is a mix:
   most of it is redshift-derived (SDSS, 6dFGS, and 2MRS all infer distance from
   recession velocity), but Cosmicflows-4 contributes distances measured directly
   (Tully-Fisher, surface brightness fluctuations, and similar methods) rather than
   inferred from redshift. That distinction is what puts the Local Group — Andromeda,
   M33, and their neighbors — into the catalog at all: they're blueshifted (falling
   toward us), so a redshift-only survey has no distance to assign them and would drop
   them. Pull back far enough and the filaments and voids of the local cosmic web
   become visible.

**Honesty note on the SDSS wedge:** the deep galaxy survey (SDSS) covers roughly a
third of the sky — it was never a full-sky survey. The dense wedge-shaped region you
see in the galaxy layer *is the real survey footprint*, not a rendering artifact;
2MRS and 6dFGS (which together cover the rest of the sky) fill in the nearer, all-sky
layer around it.

## Exoplanet hosts

Star cards gain planet knowledge from the NASA Exoplanet Archive (its `ps` table,
default parameter set): 6,336 confirmed planets around 4,749 host stars. Any host in
this project's own star catalog gets its known planets listed on its card (radius,
orbital period). Archive hostnames are often Bayer/Flamsteed designations rather than
the proper names this catalog searches by, so a small hand-verified alias map bridges
nine of them: 51 Peg = Helvetios, τ Cet, ε Eri = Ran, υ And = Titawin, 47 UMa = Chalawan,
55 Cnc = Copernicus, γ Cep = Errai, α Tau = Aldebaran, and Proxima (Centauri). A few
famous hosts are too faint for this catalog's magnitude cut to carry a real star point —
TRAPPIST-1, Kepler-90, HD 209458 — but are still searchable as card-only entries showing
their known planets. No star point is ever synthesized for them, and there's no fly-to:
search surfaces the card, nothing more.

## Moons

14 moons orbit their planets, by two different methods. The Moon and Jupiter's four
Galileans (Io, Europa, Ganymede, Callisto) move on real ephemerides from
astronomy-engine. The other nine — Titan, Rhea, Iapetus, Enceladus (Saturn), Triton
(Neptune), Titania, Oberon (Uranus), Phobos, Deimos (Mars) — are modeled: an unperturbed
two-body orbit propagated from JPL's published mean orbital elements, phase-calibrated
against JPL Horizons at epoch (7 of the 9 published mean-anomaly values turned out to be
50–175° off a real Horizons position; the orbit's orientation was already right, only its
phase needed correcting). Each moon's card "Orbit:" line says which kind you're looking
at. Triton is the odd one out dynamically — it orbits Neptune retrograde, backwards
relative to Neptune's own rotation, a signature of having been captured rather than
formed in place.

## The asteroid belt

Closer in, ~486k real minor planets (MPCORB, absolute magnitude H &lt; 17, semi-major
axis 1.5–50 AU) fill the region between Mars and Jupiter and beyond — that upper bound
reaches well past Jupiter, so a handful of bright Kuiper-range objects ride along with
the belt proper. These are the only points in the app whose positions are
**not** baked: each object's place is solved from its published Keplerian elements at
the current simulated time, so the belt genuinely orbits. Speed the clock up and it
*shears* — inner objects sweep round faster than outer ones, exactly as Kepler's third
law requires.

The structure is real, not decorative. The **Kirkwood gaps** — bands swept clear by
orbital resonances with Jupiter — show up as dark rings in the annulus, and Jupiter's
two **Trojan swarms** sit 60° ahead of and behind it along its orbit, with the leading
cloud noticeably richer than the trailing one. None of that is placed by hand; it falls
out of the catalog.

Twelve of them (Ceres, Vesta, Pallas, Hygiea, Juno, Eunomia, Ida, Eros, Gaspra, Bennu,
Ryugu, Apophis) are searchable and have info cards. Flying to one tracks it as it moves.

**Honesty note on the orbits:** propagation is an unperturbed **two-body** solution from
each object's osculating elements — it ignores the planets' gravitational tugs. Near the
elements' epoch that is accurate to ~1,500 km for Ceres (checked against JPL Horizons);
run the clock years away from it and the error grows. Good for *where the belt is*, not
for astrometry.

## Spacecraft

Four human-made spacecraft are flyable: Voyager 1, Voyager 2, New Horizons, and JWST.
Their trajectories come from JPL Horizons state-vector samples — every 30 days, or every
5 days for JWST, whose halo orbit around Sun-Earth L2 curves faster — cubic-interpolated
to the simulated date. Search for one and fly to it; the camera tracks it live as it
moves, and its card shows live distance from the Sun and from Earth. A trajectory line
traces its path while it's focused.

**Honesty note:** JWST's predicted ephemeris from Horizons ends in August 2031 —
station-keeping burns aren't planned that far ahead. Past that date its position is held
at the last predicted point while Earth keeps orbiting around it; that's a known
simplification, not a real trajectory beyond the ephemeris horizon.

## Rebuild the star catalog

    npm run catalog            # HYG only (~109k stars, fast, no download needed if cache present)
    npm run catalog -- --gaia  # Gaia DR3 (~728k stars; needs scripts/cache/gaia.csv + gaia_teff.csv from ESA TAP — see scripts/build-catalog.ts)

`--gaia` also needs the dust cache for reddening, so run `npm run dustmap` first.

## Rebuild the galaxy / Milky Way catalogs

    npm run galaxies   # SDSS + 2MRS + 6dFGS + CF4 -> public/galaxies.bin (~1.01M galaxies)
    npm run dustmap                 # Edenhofer 2023 3D dust -> scripts/cache/edenhofer-cum.bin (~1.6 GB download, once)
    npm run dustmap -- --mean FILE  # ...reusing an already-downloaded copy of the map's MEAN cube instead of refetching
    npm run milkyway                # interior: Gaia sky density + model depth -> public/milkyway.bin (1M points)
    npm run milkyway -- --exterior  # exterior: fully model-sampled -> public/milkyway-ext.bin (1M points)

`npm run milkyway` (interior only) needs the dust cache, so run `npm run dustmap` first.

## Rebuild the constellation lines

    npm run constellations   # d3-celestial line data -> public/constellations.json (~89 constellations, ~740 segments)

## Rebuild the asteroid belt

    npm run asteroids   # MPCORB -> public/asteroids.bin (~486k orbits)

Needs `scripts/cache/MPCORB.DAT` from the Minor Planet Center:

    curl -L -o scripts/cache/MPCORB.DAT.gz https://minorplanetcenter.net/iau/MPCORB/MPCORB.DAT.gz
    gunzip -k scripts/cache/MPCORB.DAT.gz

## Rebuild the deep-sky, spacecraft, exoplanet, and moon-phase data

    npm run openngc     # scripts/cache/NGC.csv (OpenNGC) -> public/openngc.json (~12.4k NGC/IC objects)
    npm run spacecraft   # JPL Horizons API state vectors -> public/spacecraft.json (4 craft, cached responses)
    npm run exoplanets   # NASA Exoplanet Archive TAP -> public/exoplanets.json (6,336 planets / 4,749 hosts)
    npm run moonphase    # JPL Horizons API -> src/data/moonPhase.json (phase-calibration report for the 9 modeled moons)

`npm run openngc` needs `scripts/cache/NGC.csv` from
[mattiaverga/OpenNGC](https://github.com/mattiaverga/OpenNGC):

    curl -sL -o scripts/cache/NGC.csv https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv

`npm run spacecraft` and `npm run moonphase` hit the JPL Horizons API live and cache each
response under `scripts/cache/` (gitignored) — re-running from a warm cache reproduces
byte-identical output. `npm run exoplanets` hits the NASA Exoplanet Archive's TAP service
the same way, caching to `scripts/cache/exoplanets.csv`.

## Tests

    npm run test

## Known boundaries

- Beyond ~1.9 Gpc you pass the deepest catalog galaxies — the fly-to camera cap sits
  just past the farthest object in the galaxy catalog.
- Stars are points: fly-to arrival stops at 500 AU (below that, 32-bit GPU precision
  would visibly jitter — and there is nothing closer to see).
- 14 moons total. The Moon and Jupiter's four Galileans (Io, Europa, Ganymede, Callisto)
  have real ephemerides from astronomy-engine. The other nine — Titan, Rhea, Iapetus,
  Enceladus (Saturn), Triton (Neptune), Titania, Oberon (Uranus), Phobos, Deimos (Mars) —
  are modeled from JPL's published mean orbital elements, propagated as an unperturbed
  two-body orbit about their parent. Their published mean-anomaly values didn't actually
  hold at the table's own epoch — 7 of the 9 were 50–175° off a real JPL Horizons position
  when checked — so each was phase-calibrated against Horizons before shipping (orientation
  was already correct; only where-in-the-orbit was off). Nodes and apsides are held fixed
  at their epoch values, so real precession isn't modeled and the phase error grows slowly
  over years away from that epoch. Each card's "Orbit:" line says which kind you're
  looking at.
- Real telescope imagery (DSS2 via hips2fits) only covers the curated set of ~15 deep-sky
  objects and a handful of landmark galaxies (Andromeda, M33, …) — the bulk star and galaxy
  catalogs (728k stars, 1.01M galaxies) remain points, not photographs.
- The asteroid belt is cut at absolute magnitude H &lt; 17 (~486k of MPCORB's ~1.55M orbits) —
  a cut for visual density, not a completeness limit, and MPCORB itself is far from complete
  at that magnitude. The layer is hidden entirely beyond 100 AU from the Sun, and its orbits
  are two-body (see the honesty note above).
- JWST's trajectory is only real through August 2031, the end of Horizons' predicted
  ephemeris for it — station-keeping burns aren't planned further out. Past that date its
  position is held at the last predicted point while Earth keeps orbiting (see "Spacecraft").
- Measured dust reddening only extends to ~1.25 kpc from the Sun (the Edenhofer 2023 map's
  own range). Stars beyond that edge take the reddening accumulated at the edge as a
  deliberate lower bound, not an extrapolation; the Milky Way band's far-field dust (beyond
  1.25 kpc along any sight line) is the analytic exponential-disk model, not measured.
- Exoplanet host stars below this catalog's magnitude cut (TRAPPIST-1, Kepler-90, HD 209458,
  …) are searchable card-only entries — no star point is ever drawn for them, and there's no
  fly-to (see "Exoplanet hosts").
- Constellation lines are drawn as straight 3D chords between catalog line-segment endpoints,
  not great-circle-subdivided arcs — accurate enough at the rendered scale, but a very long
  segment would show as a visibly straight line rather than curving with the sphere.
- Design docs: docs/superpowers/specs/ (approved spec) and docs/superpowers/plans/ (implementation plan).
