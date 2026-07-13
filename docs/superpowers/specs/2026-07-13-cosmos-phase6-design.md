# Cosmos Phase 6 — Galaxies, Cosmic Web, Milky Way Bridge

**Date:** 2026-07-13
**Status:** Approved (user selected SDSS+2MRS and Gaia-derived density cloud)
**Parent spec:** `2026-07-13-cosmos-v1-design.md` (v1 shipped; this is the "Later phases" galaxy tier)

## Goal

Fill the deep field: pull back from the v1 star shell and see our Milky Way from
outside, then the local universe's galaxies as filaments and voids. Checkpoint:
search "Andromeda", arrive; pull back until the Milky Way is one dot among the
cosmic web.

## Data (all public)

| Layer | Source | Rows | Delivery |
|-------|--------|------|----------|
| Cosmic web (deep) | SDSS DR18 SpecObj galaxies (class='GALAXY', zWarning=0, 0.003<z<0.25) via SkyServer SQL, paged | ~2M | build script → `public/galaxies.bin` |
| Cosmic web (all-sky local) | 2MRS (2MASS Redshift Survey, VizieR J/ApJS/199/26) | ~44k | same script, merged |
| Milky Way bridge | REAL: an unbiased ~2M-star sample of Gaia DR3 sky positions (`random_index` uniform shuffle — measured sky density, dust lanes and all; HEALPix `GROUP BY` is an acceptable alternative). MODELED: depth along each sight line from a standard exponential disk (Rd≈2.6 kpc, hz≈0.3 kpc) + bulge profile | ~2M sampled directions → ~2M synthesized points | build script → `public/milkyway.bin` |

The Milky Way layer is **individually synthetic, statistically real** — sky-plane
density is measured, depth is modeled. Labeled as a model layer in README + CREDITS.
The galaxy layers remain individually real objects.

## Format & units

Both new files reuse the existing CSMS binary format (magic/version/count + SoA
f32 positions, absMag, colorIndex) — one decoder, no new parser.

- `milkyway.bin`: positions in **parsecs** (disk fits f32 comfortably) — loads
  through the existing `loadStarField` path as a second instance, zero new shader code.
- `galaxies.bin`: positions in **megaparsecs**, EQJ-aligned equatorial cartesian
  (same raDecDistToXyz, distance from redshift). absMag = SDSS r-band / 2MRS K-band
  absolute magnitude (drives size/alpha); colorIndex = g−r (SDSS) / J−K (2MRS),
  reusing the star color ramp for subtle warm/cool variation.

Redshift → distance: flat ΛCDM (H0=70, Ωm=0.3, ΩΛ=0.7), comoving distance by
numerical integration in a pure, TDD'd `src/data/cosmology.ts`. Low-z sanity:
d ≈ cz/H0 within 5% for z<0.03; monotonicity; d(0)=0.

## Rendering & LOD

- Galaxy layer: same vertex/fragment shader source as stars, second ShaderMaterial
  instance with its own uniforms: `uCamPc` becomes camera in **Mpc**, PC_TO_AU
  becomes MPC_TO_AU = 2.0626e11, and brightness constants tuned for galaxies
  (M≈−21 objects at 10–1000 Mpc). Minimum size clamp keeps the web legible from
  afar (documented artistic boost — the web is otherwise sub-visual, which defeats
  the layer's purpose).
- Layer crossfades by camera distance from Sun (new per-material `uLayerAlpha`):
  local stars 1→0 over 2–10 kpc; Milky Way cloud 0→1 over 1.5–8 kpc, 1→0 over
  0.5–3 Mpc; galaxies 0→1 over 0.1–2 Mpc. Managed by a small pure function
  (`layerAlphas(distAu)`) — TDD'd (bands, monotonic edges, all-1/all-0 extremes).
- `MAX_DIST_AU` raised 5e9 → 3e16 (~1.5 Gpc). Doubles are fine; fly-to math unchanged.

## Search, cards, focus

- Curated `src/data/galaxies.ts`: ~30 famous galaxies/clusters (M31 Andromeda, M33,
  M87, M104 Sombrero, Centaurus A, Coma cluster, …) with 2MRS/SDSS coordinates +
  facts. Matched to the nearest catalog point at build time (or coordinates used
  directly); searchable, fly-to (minApproach 0.05 Mpc ≈ 1e10 AU), info card:
  distance (Mly), redshift, type, source catalog.
- HUD distance formatting gains Mly above 1e6 ly.

## Error handling & performance

- Each layer loads independently; a failed galaxies.bin fetch shows the banner and
  leaves v1 behavior intact.
- ~2M galaxy points + ~2M MW points + 728k stars = ~4.7M point sprites across three
  draw calls; well within M4 headroom. Files: galaxies ~40 MB, milkyway ~40 MB,
  committed like stars.bin (repo grows to ~100 MB — accepted; clones need no rebuild).

## Milestones

16. **Cosmology + galaxy pipeline (TDD):** cosmology.ts; SDSS paged download +
    2MRS download; merged galaxies.bin committed. *Checkpoint: decode + spot-check
    a known galaxy distance.*
17. **Galaxy rendering + LOD:** second point layer, layerAlphas crossfades, raised
    distance cap. *Checkpoint: fly out, watch stars hand off to the web; filaments
    visible in the SDSS wedge.*
18. **Milky Way bridge:** Gaia HEALPix counts + disk model → milkyway.bin; third
    layer wired into the crossfade. *Checkpoint: the galaxy from outside, correct
    orientation vs the real star shell.*
19. **Named galaxies + ship:** curated list, search/cards, README/CREDITS updates,
    full gates + live drive. *Checkpoint: Andromeda arrival; the money shot.*
