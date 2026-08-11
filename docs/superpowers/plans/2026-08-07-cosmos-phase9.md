# Cosmos Phase 9 Implementation Plan — Deep Data

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One task per subagent; strict TDD for pure math (orbit propagation, dedup, interpolation); coordinator visual checkpoints; gates per task (`npm run test`, `npx tsc --noEmit`, `npm run build`); commit per task; deploy only after the phase-9 final review.

**Spec:** `docs/superpowers/specs/2026-08-07-cosmos-phase9-design.md`
**Conventions:** as prior phases. CSMS binary + chunked point layers + units.ts + BASE_URL fetches + honesty notes. Deterministic builds (seeded PRNG only, no Date.now in scripts).

---

### Task 29: Galaxy catalog v2 — 6dFGS + Cosmicflows-4

- 6dFGS DR3 via VizieR TAP (catalog `VII/259/spectra` or the 6dFGS final redshift table — probe columns with TOP 1; need RA/Dec/cz/quality; keep quality ≥ 3). Expect ~110–125k.
- CF4 via EDD/VizieR (`J/ApJ/944/94` Tully+2023 or EDD export — probe; need RA/Dec, distance Mpc (or DM), cz). ~55k. CF4 distance is used DIRECTLY (no cosmology inversion).
- Extend `scripts/build-galaxies.ts`: four sources with per-source parsers → common rows {raDeg, decDeg, distMpc, absMag proxy, source}. **Dedup (TDD the pure function):** spatial hash on 1° cells; two rows within 1° great-circle AND (|Δcz| < 600 km/s OR |ΔD| < 2 Mpc) are one galaxy; keep by preference CF4 > SDSS > 6dF > 2MRS. Unit tests: synthetic duplicates across each survey pair, preference order, non-dupes at 1.1° kept, Local-Group negative-cz CF4 rows retained.
- Gates: total in [900k, 1.4M]; report per-source kept/deduped; Andromeda present within 0.15 Mpc of its true position (assert!); southern-cap density check: count galaxies with Dec < −30° must exceed 60k (was ~15k) — asserts the 6dF fill.
- Checkpoint (coordinator): southern web visibly filled; M31 exists as a catalog point.

### Task 30: OpenNGC — 14k deep-sky objects

- OpenNGC CSV from the ofrohn-adjacent repo (mattiaverga/OpenNGC, CC-BY-SA-4.0) → parse NGC/IC id, common names, type, RA/Dec, major axis (arcmin), V mag, distance where present (else omit from fly-to targets? — objects WITHOUT distance get placed at a nominal 10 kpc with the card saying "distance: —" and excluded from fly-to... simpler: include only objects WITH enough data: type + position; distance fallback by type median, marked estimated in the card). Bake `public/deepsky.json` (~1.5 MB) or binary sidecar.
- Search: massive-index concern — current search is a linear scan over entries at each keystroke; 14k more entries is still fine (<1 ms) — verify with a micro-benchmark in the report.
- Cards: type-aware (galaxy/nebula/cluster templates). Imagery: same lazy hips2fits on focus (proximity sweep stays curated-only — 14k × proximity checks is wasteful; focus-triggered fetch only for OpenNGC entries).
- Sprites: none by default (avoid clutter); the existing glow+photo sprite is created ON FIRST FOCUS for an OpenNGC object, then managed like curated ones.
- Curated-15 collision: OpenNGC entries matching a curated id defer to the curated definition.
- Checkpoint: search "NGC 253" (already curated — resolves curated), "NGC 891", "IC 434" → cards + photos on arrival.

### Task 31: Asteroids — MPCORB → cadenced Kepler layer

- Download MPCORB.DAT (~1.4M rows, fixed-width). Bake `public/asteroids.bin`: new binary section format {a, e, i, Ω, ω, M0, epoch, H} as f32×7 + f16-ish H (use f32; ~32 B/object) for objects with H < 16 (~400k → ~13 MB). Famous-12 list with names/facts in `src/data/asteroids.ts`.
- TDD `src/sim/kepler.ts`: solveKepler(M, e) (Newton, e<0.97 guard), elementsToHeliocentric(elements, jd) → EQJ AU (elements are J2000 ecliptic — rotate by obliquity ε=23.43928°; TESTS: Ceres position vs a JPL Horizons reference vector for a fixed date within 0.05 AU; circular-orbit sanity; retrograde i>90 case).
- Runtime layer `src/scene/asteroidField.ts`: positions buffer recomputed by a cadence worker — a chunk of ~20k objects per frame round-robin (full refresh ≈ 20 frames), re-solve when |simJD − solvedJD| > 0.5 day per object. Rendered as a point layer (size by H, fixed dim color) reusing chunked culling? — positions change per cadence, chunk bounds would stale: simpler, own Points with frustumCulled=false and the layer visible only when camera < 100 AU (heliocentric) — the belt is invisible beyond that anyway.
- Lazy: fetch asteroids.bin after first render idle (requestIdleCallback), never blocking startup.
- Checkpoint: belt annulus + Kirkwood gaps visible from above the ecliptic at ~4 AU; two Trojan clouds at ±60° of Jupiter; time at 1 mo/s shows the belt shearing (inner faster). Search "Ceres" → card + fly-to.

### Task 32: Spacecraft — Horizons

- Build script: JPL Horizons API (`https://ssd.jpl.nasa.gov/api/horizons.api`) VECTORS, center @0 (SSB) or @sun, EQJ frame (`REF_PLANE=FRAME`), monthly samples from launch to now+20 y for: Voyager 1 (-31), Voyager 2 (-32), New Horizons (-98), JWST (-170). ~500 samples each → `public/spacecraft.json` (<100 KB).
- TDD cubic Hermite interpolation over samples (test: midpoint of a known analytic trajectory within tolerance; clamped ends).
- Render: small icon sprite (canvas-drawn probe glyph) + optional trajectory polyline (toggleable, drawn like orbit lines); searchable ("Voyager 1" → card: launch date, speed, distance, "the farthest human-made object"); fly-to.
- Checkpoint: fly to Voyager 1 (~166 AU in 2026); at 1 yr/s watch it recede along its polyline.

### Task 33: Moons v2 + exoplanet hosts

- `src/data/moonElements.ts`: JPL mean elements (a, e, i, ω, Ω, M0, n [deg/day], epoch, frame notes) for Titan, Rhea, Iapetus, Enceladus, Triton (retrograde!), Titania, Oberon, Phobos, Deimos — parent-centered; propagate with the Task 31 Kepler solver (TDD: Titan period 15.945 d reproduced; Triton retrograde direction). Positions = parent heliocentric + rotated offset. PlanetDef entries (colors, facts, parent) — everything downstream (search/cards/orbits-skip) is automatic.
- Cards state "orbit: modeled from JPL mean elements" (vs Galileans' "astronomy-engine ephemeris").
- Exoplanets: NASA Exoplanet Archive TAP (`ps` table, `default_flag=1`): pl_name, hostname, sy_dist, disc_year... Bake `public/exoplanets.json` keyed by host name; cross-match hosts to our star catalog by name (HYG proper names + a curated alias map for the famous ones: 51 Peg, Kepler-90, TRAPPIST-1 — TRAPPIST-1 is mag 18.8, NOT in our catalog: hosts absent from the catalog get synthesized star points? NO — keep honest: only badge hosts that exist in our catalog; report the match count; famous unmatched hosts (TRAPPIST-1 etc.) become searchable card-only entries WITHOUT a rendered star, card noting "below catalog magnitude cut").
- Checkpoint: Titan orbits Saturn at 1 day/s; card for 51 Pegasi shows its planet.

### Task 34: Measured star colors + measured dust

- **teff:** extend build-catalog --gaia query with `teff_gspphot`; where non-null, colorIndex := ballesterosInverseCi(teff) (TDD: round-trip ci→T→ci within 0.01 for ci ∈ [−0.3, 2]; solve the Ballesteros formula for B−V given T — closed-form quadratic, derive in the module). Fallback BP−RP unchanged. Rebuild stars.bin; report % with measured teff (expect ~85%+).
- **Dust:** download the Edenhofer 2023 downsampled release (Zenodo — the healpix nside=256 mean map, ~500 MB is too big: use their provided low-res summary product; if only large files exist, downsample the smallest to a (l, b, dist) grid ≤ 50 MB cached, NOT committed). In build-milkyway INTERIOR mode: for each sightline, τ_measured(s) from trilinear lookup within the map's validity radius (~1.25 kpc), analytic beyond, blended over 1.0–1.25 kpc. K recalibrated so the in-plane τ distribution stays in the working range (report before/after percentiles). Exterior build unchanged. Gates as before + a Great-Rift direction check: mean τ toward (l=30°, b=0°, 1 kpc) must exceed mean τ toward (l=30°, b=+20°, 1 kpc) by ≥2× (the rift is dark — asserts the map is being read in the right orientation).
- Checkpoint: sky-view band vs before (structure should get MORE textured/asymmetric, matching the real rift); star colors subtly truer (bluer OB stars).

### Task 35: Phase-9 ship

- README/CREDITS per spec's honesty section; Known boundaries updates (asteroid H cut, spacecraft interpolation cadence, dust map range).
- Full gates; coordinator drive: southern web, M31 catalog point, NGC 891 photo, belt + Trojans, Voyager 1, Titan, 51 Peg card, rift comparison; regression spot-checks (Sirius, Andromeda arrival, sky view).
- Final whole-phase review → merge → deploy → verify live.
