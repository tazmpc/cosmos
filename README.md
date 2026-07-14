# Cosmos

Google Earth for the universe — fly from Earth through the real solar system,
past 728,000 real stars, out to see the Milky Way from outside, and on into
918,000 real galaxies mapping the local cosmic web. All data public:
astronomy-engine ephemerides (planet positions correct for the simulated date),
Gaia DR3 + HYG star catalogs, SDSS + 2MRS galaxy catalogs, NASA/Solar System
Scope imagery. See CREDITS.md.

## Run

    npm install
    npm run dev

## Use

- **Drag** to orbit the focused object, **scroll** to zoom (speed scales with distance)
- **Search** (top) — try Jupiter, Sirius, Vega, Betelgeuse, Andromeda, the Coma Cluster —
  and fly there
- **Click** a planet or bright star to fly to it; a card shows its real data
- **Time controls** (bottom right): pause, step the rate up to 1 year/second, reset to now

## The deep field

Pulling back from Earth crosses three layers, crossfaded by distance:

1. **Stars** (728k, Gaia DR3 + HYG) — every point is a real star at its real position,
   sized and colored by its real apparent magnitude from wherever you're standing.
2. **The Milky Way** — the one non-literal layer, clearly labeled as modeled: sky-plane
   density is **real** (measured from ~2M Gaia sky positions), but depth along each
   line of sight is **modeled** (a standard exponential-disk + bulge profile), because
   individual per-star distances aren't what makes the galaxy legible from outside —
   its aggregate shape is. It renders as an unresolved glow, not as individually-real
   stars.
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
    npm run milkyway   # Gaia sky density + disk model -> public/milkyway.bin (~2M points)

## Tests

    npm run test

## Known boundaries

- Beyond ~1.9 Gpc you pass the deepest catalog galaxies — the fly-to camera cap sits
  just past the farthest object in the galaxy catalog. Phase 7 (imagery + sky view)
  picks up from there.
- Stars are points: fly-to arrival stops at 500 AU (below that, 32-bit GPU precision
  would visibly jitter — and there is nothing closer to see).
- Only Earth's Moon and Jupiter's Galilean moons (Io, Europa, Ganymede, Callisto) are
  included — they're the moons with real ephemerides in astronomy-engine. Titan and the
  rest would require modeled orbits, deferred.
- Design docs: docs/superpowers/specs/ (approved spec) and docs/superpowers/plans/ (implementation plan).
