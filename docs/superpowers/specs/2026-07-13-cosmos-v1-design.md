# Cosmos v1 — Design Spec

**Date:** 2026-07-13
**Status:** Approved pending user review
**One-liner:** A "Google Earth for the universe" — a web app where you fly from Earth
through the real solar system out into a field of real stars, built entirely from
publicly available data.

## Goals (v1)

- Continuous 3D fly-through from Earth's surface scale out to interstellar space.
- Real data everywhere: planet positions correct for the current date, every visible
  star a real catalog star with a true 3D position.
- Search-and-fly-to: type "Jupiter" or "Sirius", the camera flies there smoothly.
- Runs at 60 fps in a browser on the M4 MacBook; no backend.

## Non-goals (v1)

- Galaxies, cosmic web, deep-sky imagery (v2 — the architecture must not preclude them).
- Time controls / orbit animation, object info cards, sky-view mode (deferred features
  from brainstorming; design leaves room for all three).
- Mobile support, accounts, sharing.

## Architecture

Static web app: **Vite + TypeScript + Three.js**. No server — all data is baked at
build time or computed client-side. Local dev via `npm run dev`; deployable to any
static host.

Modules (each independently testable, communicating through typed interfaces):

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| `engine/` | Three.js renderer, camera controller, floating-origin transform, log depth buffer | Three.js |
| `sim/` | Simulation clock; planet/Moon/Sun positions via `astronomy-engine` | astronomy-engine |
| `data/` | Star catalog binary loader; planet definitions (radii, textures, names) | — |
| `ui/` | Search box + fuzzy matching, fly-to triggers, HUD (focus name, distance) | engine, data |

`main.ts` wires them: data loads → sim computes positions → engine renders → ui drives
camera.

## The scale problem

The scene spans ~10^13 in magnitude (planet radii in km to stars at hundreds of
thousands of AU). 32-bit GPU floats cannot represent this. Solution (both are
standard, proven techniques):

1. **Doubles on the CPU, floating origin on the GPU.** All true positions are kept in
   JS numbers (already IEEE 754 doubles). Every frame, positions are re-expressed
   relative to the camera before upload, so GPU-side coordinates are always small.
2. **Logarithmic depth buffer** (`logarithmicDepthBuffer: true` in Three.js) to avoid
   z-fighting across the near/far range.

World unit = **1 AU**. Star distances in parsecs convert at 1 pc = 206,264.8 AU.
Doubles hold exact integers to 2^53 ≈ 9×10^15, so precision is ample through the v2
galaxy scale (gigaparsecs) without rework.

## Data sources (all public)

| Data | Source | License | Delivery |
|------|--------|---------|----------|
| Planet/Moon/Sun positions | `astronomy-engine` npm package | MIT | computed live, correct for current date |
| Planet imagery | NASA/USGS maps; Solar System Scope texture set as fallback | public domain / CC-BY 4.0 | build-time resize → web textures in `public/` |
| Stars (~120k) | HYG catalog v3 (Hipparcos + Yale + Gliese merge: positions, parallax, magnitude, color index, proper names, Bayer designations) | public domain (CC0) | build script: CSV → compact binary (~3 MB) |
| v1.5 upgrade path | Gaia DR3 via ESA TAP/ADQL (brightest ~1M stars) | free/open | same binary format, bigger file |

### Star catalog binary format

Build script (`scripts/build-catalog.ts`, run once; its binary output is committed to the repo so
clones need no rebuild):
per star — position as 3×float32 (parsecs, ICRS cartesian), apparent magnitude
float32, color index float32. Named stars carry an index into a JSON sidecar
(`names.json`: name → star index) used by search. Loader parses the ArrayBuffer
directly into typed arrays consumed by the GPU point cloud; no per-star JS objects.

## Navigation & search

- **Focus orbiting** (Google Earth model): the camera always orbits a focus object;
  Earth at launch. Drag rotates around focus; scroll zooms with speed proportional to
  current distance from focus, so one gesture works at planet-surface and
  interstellar scale alike.
- **Refocus:** click a planet or bright star (GPU picking / raycast) to make it the
  new focus.
- **Search:** input box fuzzy-matches planet names + HYG proper names/Bayer
  designations. Selecting a result plays an animated fly-to.
- **Fly-to animation:** interpolate the focus point linearly and the camera distance
  in **log space** with ease-in-out, so Earth → Sirius reads as pull-back, traverse,
  approach — never a teleport. Duration scales gently with log of distance ratio,
  clamped (~2–6 s).

## Rendering

- **Planets:** UV-sphere meshes with real texture maps; single point light at the
  Sun; Saturn gets a ring mesh. Toggleable orbit lines (computed from
  astronomy-engine samples over one period).
- **Sun:** emissive sphere + additive glow sprite.
- **Stars:** one `THREE.Points` cloud, custom shader: size and alpha from apparent
  magnitude, color from color index (B–V → RGB approximation). Additive blending.
- **No skybox.** Every visible star is a real, navigable catalog star. This is the
  product's honesty guarantee.

## Loading & error handling

- Solar system renders immediately (positions are computed, not fetched); the star
  catalog streams in after and fades up when parsed.
- Catalog fetch/parse failure → visible dismissible banner ("star catalog failed to
  load"), app remains usable as a solar-system explorer.
- WebGL context loss → standard Three.js context-restore handling, reload prompt as
  fallback.

## Performance budget

- 120k point sprites + ~10 textured spheres: trivial for the M4; target 60 fps with
  headroom for the 1M-star Gaia upgrade.
- Catalog binary ~3 MB (v1), ~25 MB (v1.5) — streamed, not blocking first render.

## Testing

Vitest unit tests on everything mathematical (where silent bugs live):

- **Coordinates:** RA/Dec/parallax → cartesian verified against known stars (e.g.
  Sirius ≈ 2.64 pc, correct octant; Polaris near +Z in equatorial frame).
- **Catalog format:** encode → decode round-trip preserves positions/magnitudes/names.
- **Search:** exact match beats prefix beats fuzzy; planets rank above dim stars.
- **Fly-to math:** easing hits exact endpoints; log-space midpoint is the geometric
  mean of distances.
- **Sim:** astronomy-engine wrapper returns Earth ≈ 1 AU from Sun; Moon ≈ 0.0026 AU
  from Earth.

Rendering/UX verified by driving the app in the browser (dev server + browser tools).

## Milestones

1. **Scaffold + solar system:** Vite/TS/Three.js, floating-origin engine, textured
   planets at real current positions, orbit-the-focus camera. *Checkpoint: fly around
   Saturn.*
2. **Stars:** catalog build script, binary loader, point-cloud shader. *Checkpoint:
   recognizable constellations from Earth's position; fly out and watch them distort.*
3. **Search + fly-to + HUD:** fuzzy search, animated fly-to, focus/distance readout,
   click-to-refocus. *Checkpoint: search "Sirius", arrive at Sirius.*
4. **Polish:** orbit lines, Saturn's rings, loading states, error banners, perf pass.
