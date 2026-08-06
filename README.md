# Cosmos

Google Earth for the universe — fly from Earth through the real solar system,
past 728,000 real stars, out to see the Milky Way from outside, and on into
918,000 real galaxies mapping the local cosmic web. Switch to sky view to stand
on Earth and look up at the real night sky with constellation lines overhead, or
fly into a nebula and watch its glow resolve into a real DSS2 telescope
photograph. All data public: astronomy-engine ephemerides (planet positions
correct for the simulated date), Gaia DR3 + HYG star catalogs, SDSS + 2MRS
galaxy catalogs, NASA/Solar System Scope imagery, d3-celestial constellation
lines, CDS/hips2fits DSS2 imagery. See CREDITS.md.

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

## The deep field

Pulling back from Earth crosses three layers, crossfaded by distance:

1. **Stars** (728k, Gaia DR3 + HYG) — every point is a real star at its real position,
   sized and colored by its real apparent magnitude from wherever you're standing.
2. **The Milky Way** — the modeled layers, clearly labeled as such. Two datasets share
   the job: from **inside** the galaxy you see a layer whose sky-plane density is
   **real** (measured from a 1M-star Gaia sample — the Great Rift and dust patchiness
   you see are genuinely in the data) with **modeled** depth along each sight line
   (exponential disk + spiral arms + dust + bulge). From **outside** (~20 kpc up),
   it crossfades to a second layer sampled **entirely from that same analytic model** —
   no Gaia positions — because the measured sky, being Sun-centered, cannot show the
   galaxy's face-on structure. Both render as unresolved glow, not individually-real
   stars. Every other point of light in the app remains a real cataloged object.
3. **Galaxies** (918k, SDSS + 2MRS) — every point is a real cataloged galaxy, positioned
   by its real sky coordinates and redshift-derived distance. Pull back far enough and
   the filaments and voids of the local cosmic web become visible.

**Honesty note on the SDSS wedge:** the deep galaxy survey (SDSS) covers roughly a
third of the sky — it was never a full-sky survey. The dense wedge-shaped region you
see in the galaxy layer *is the real survey footprint*, not a rendering artifact;
2MRS (which is full-sky) fills in the nearer, all-sky layer around it.

## Rebuild the star catalog

    npm run catalog            # HYG only (~109k stars, fast, no download needed if cache present)
    npm run catalog -- --gaia  # Gaia DR3 (~728k stars; needs scripts/cache/gaia.csv from ESA TAP — see scripts/build-catalog.ts)

## Rebuild the galaxy / Milky Way catalogs

    npm run galaxies   # SDSS + 2MRS -> public/galaxies.bin (~918k galaxies)
    npm run milkyway                # interior: Gaia sky density + model depth -> public/milkyway.bin (1M points)
    npm run milkyway -- --exterior  # exterior: fully model-sampled -> public/milkyway-ext.bin (1M points)

## Rebuild the constellation lines

    npm run constellations   # d3-celestial line data -> public/constellations.json (~89 constellations, ~740 segments)

## Tests

    npm run test

## Known boundaries

- Beyond ~1.9 Gpc you pass the deepest catalog galaxies — the fly-to camera cap sits
  just past the farthest object in the galaxy catalog.
- Stars are points: fly-to arrival stops at 500 AU (below that, 32-bit GPU precision
  would visibly jitter — and there is nothing closer to see).
- Only Earth's Moon and Jupiter's Galilean moons (Io, Europa, Ganymede, Callisto) are
  included — they're the moons with real ephemerides in astronomy-engine. Titan and the
  rest would require modeled orbits, deferred.
- Real telescope imagery (DSS2 via hips2fits) only covers the curated set of ~15 deep-sky
  objects and a handful of landmark galaxies (Andromeda, M33, …) — the bulk star and galaxy
  catalogs (728k stars, 918k galaxies) remain points, not photographs.
- Constellation lines are drawn as straight 3D chords between catalog line-segment endpoints,
  not great-circle-subdivided arcs — accurate enough at the rendered scale, but a very long
  segment would show as a visibly straight line rather than curving with the sphere.
- Design docs: docs/superpowers/specs/ (approved spec) and docs/superpowers/plans/ (implementation plan).
