# Cosmos Phase 9 — Deep Data

**Date:** 2026-08-07
**Status:** Draft — awaiting user approval
**Goal:** Upgrade data quality and depth across every layer using nine additional public
sources: fix the two known data honesty-gaps (southern sky, Local Group), multiply
searchable content ~500×, add the asteroid belt / spacecraft / major moons, and replace
approximations (star colors, Milky Way dust) with measurements.

## Sources & what each fixes

| # | Source | License/access | Fixes |
|---|--------|----------------|-------|
| 1 | 6dF Galaxy Survey DR3 (~125k redshifts, southern sky) | public (VizieR/6dFGS site) | cosmic web is currently thin south of the SDSS wedge |
| 2 | Cosmicflows-4 (~56k redshift-independent distances) | public (EDD/VizieR) | Local Group absent (blueshifted galaxies have no redshift distance); curated sprites become data-backed |
| 3 | OpenNGC (~14k NGC/IC objects, typed, sized) | CC-BY-SA-4.0 | only 15 hand-curated DSOs today |
| 4 | Minor Planet Center MPCORB (~1.4M orbital elements) | public | no asteroids: belt, Kirkwood gaps, Jupiter Trojans, Kuiper belt |
| 5 | JPL Horizons (spacecraft ephemerides) | public API | Voyager 1/2, New Horizons, JWST as flyable objects |
| 6 | NASA Exoplanet Archive (~5.8k confirmed planets) | public | host stars carry no planet knowledge |
| 7 | JPL planetary-satellite mean elements | public | Titan/Enceladus/Triton etc. missing (declined to fake orbits; with published elements they're modeled-but-sourced) |
| 8 | Gaia DR3 `teff_gspphot` | free/open (ESA TAP) | star colors currently approximated from BP−RP via black-body |
| 9 | Edenhofer+ 2023 3D dust map (Gaia-based, ~1.25 kpc range) | public (Zenodo) | Milky Way dust is analytic; the Great Rift should take its measured shape |

## Design decisions

- **Galaxy catalog v2 (1+2):** merge 6dFGS + CF4 into the existing SDSS+2MRS pipeline.
  Dedup rule (surveys overlap): two entries within 1° on-sky AND (Δz < 0.002 OR ΔD < 2 Mpc)
  are the same galaxy; preference order CF4 > SDSS > 6dF > 2MRS (CF4 distances are
  measured, not inferred). CF4 entries with negative cz are the Local Group win — they
  enter with their measured distances. Andromeda/M33 become real catalog points (their
  curated sprites remain as the imagery layer on top).
- **OpenNGC (3):** all ~14k objects searchable with type-aware cards; sprites only above
  an angular-size threshold or on focus (14k always-on sprites would clutter); imagery
  on approach reuses the existing lazy hips2fits path unchanged. Name collisions with
  the curated 15 resolve to the curated entries (richer facts).
- **Asteroids (4):** bake MPCORB to a compact elements binary for the ~400k objects with
  H < 16 (all of the belt's visible structure at far smaller payload than 1.4M).
  Runtime: Kepler propagation to the sim date on a cadence (positions recomputed when
  sim time drifts >1 day from last solve, chunked across frames — never a full solve
  per frame), rendered as a point layer reusing the chunked-culling machinery. ~12
  famous asteroids (Ceres, Vesta, Pallas, Hygiea, Eros, Bennu, Ryugu, Apophis…)
  searchable with cards. Trojans and Kirkwood gaps must be visible — they're in the
  elements; the checkpoint is seeing them.
- **Spacecraft (5):** build-time Horizons state-vector samples (launch→now→+20 yr,
  monthly cadence) per craft; runtime cubic interpolation. Searchable, mission cards,
  small icon sprite + trajectory polyline toggle.
- **Exoplanets (6):** host-star index (Gaia/HIP cross-match from the Archive's own
  columns) baked to a sidecar; star info cards gain "Known planets: N (names)" and
  search gains the ~4k host stars that have proper names or designations.
- **Moons v2 (7):** Keplerian propagation about the parent from JPL mean elements for
  Titan, Rhea, Iapetus, Enceladus (Saturn), Triton (Neptune), Titania, Oberon (Uranus),
  Phobos, Deimos (Mars). Cards labeled "orbit: modeled from JPL mean elements" —
  distinct from the Galileans' full ephemerides. Colored spheres like the Galileans.
- **Star colors (8):** extend the Gaia build query with `teff_gspphot`; where present,
  store colorIndex as the Ballesteros-inverse of the measured temperature (shader
  unchanged); BP−RP fallback where absent. stars.bin rebuilt, byte-format identical.
- **Measured dust (9):** interior Milky Way build integrates τ through the downsampled
  Edenhofer map where the sightline is within its ~1.25 kpc validity range, blending to
  the analytic model beyond. Exterior (model) layer unchanged. No new runtime payload —
  dust bakes into the existing binary at build time.

## Honesty & docs

README/CREDITS updated per source; the deep-field note gains: galaxy distances now mix
redshift-derived (SDSS/6dF/2MRS) and directly-measured (CF4); minor-planet and
spacecraft positions are propagated/interpolated from published elements/ephemerides;
near-field Milky Way dust is measured (Edenhofer 2023), far-field modeled.

## Payload budget

6dF ~3 MB + CF4 ~2 MB (into galaxies.bin) + OpenNGC ~1.5 MB + asteroids ~12 MB +
spacecraft <100 KB + exoplanet sidecar ~300 KB; teff/dust change existing binaries only.
Net ≈ +19 MB (public/ ~92 → ~111 MB). Asteroid layer lazy-loads (fetched on first
approach to the solar system at sub-10-AU scale — which is the start view, so
effectively deferred-but-early; the point is it never blocks first render).

## Milestones

29. **Galaxy catalog v2:** 6dFGS + CF4 merge + dedup. *Checkpoint: southern web filled;
    Andromeda exists as a catalog point at ~0.78 Mpc.*
30. **OpenNGC:** 14k searchable DSOs. *Checkpoint: search "NGC 253", card + photo.*
31. **Asteroids:** elements pipeline + cadenced Kepler layer. *Checkpoint: belt +
    Kirkwood gaps + Trojan clouds visible at 1 mo/s time-lapse.*
32. **Spacecraft:** 4 craft + trajectories. *Checkpoint: fly to Voyager 1, watch it
    recede at 1 yr/s.*
33. **Moons v2 + exoplanets:** 9 moons; host-star cards. *Checkpoint: Titan orbits
    Saturn; Kepler-90 card lists 8 planets.*
34. **Measured colors + dust:** teff rebuild; Edenhofer τ integration. *Checkpoint:
    star-field hue comparison; Great Rift shape vs published dust maps.*
35. **Phase-9 ship:** docs, gates, full drive, deploy.
