# Cosmos

Google Earth for the universe — fly from Earth through the real solar system into
728,000 real stars. All data public: astronomy-engine ephemerides (planet positions
correct for the simulated date), Gaia DR3 + HYG star catalogs, NASA/Solar System
Scope imagery. See CREDITS.md.

## Run

    npm install
    npm run dev

## Use

- **Drag** to orbit the focused object, **scroll** to zoom (speed scales with distance)
- **Search** (top) — try Jupiter, Sirius, Vega, Betelgeuse — and fly there
- **Click** a planet or bright star to fly to it; a card shows its real data
- **Time controls** (bottom right): pause, step the rate up to 1 year/second, reset to now

## Rebuild the star catalog

    npm run catalog            # HYG only (~109k stars, fast, no download needed if cache present)
    npm run catalog -- --gaia  # Gaia DR3 (~728k stars; needs scripts/cache/gaia.csv from ESA TAP — see scripts/build-catalog.ts)

## Tests

    npm run test

## Known v1 boundaries

- Beyond ~10,000 ly the sky fades to black: star brightness follows real apparent
  magnitude, and from that far away every catalog star is genuinely too faint to see.
  Galaxies and Milky Way structure (phase 6 of the roadmap) will fill the deep field.
- Stars are points: fly-to arrival stops at 500 AU (below that, 32-bit GPU precision
  would visibly jitter — and there is nothing closer to see).
- Design docs: docs/superpowers/specs/ (approved spec) and docs/superpowers/plans/ (implementation plan).
