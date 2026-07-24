# Cosmos Phase 7 Implementation Plan — Real Imagery & Sky View

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps; one task per subagent; strict TDD for pure logic; visual checkpoints by the coordinator; gates = `npm run test` + `npx tsc --noEmit` + `npm run build` per task; commit per task; deploy (push to main) only after the phase-7 final review.

**Spec:** `docs/superpowers/specs/2026-07-22-cosmos-phase7-design.md`
**Conventions:** as v1/phase 6. Custom shaders MUST carry the common+logdepthbuf includes. Units from `src/data/units.ts`. Curated-object sprites live in `src/scene/galaxySprites.ts` (rename/extend as needed).

---

### Task 23: hips2fits imagery + deep-sky objects

**Files:** create `src/data/deepSky.ts`, `src/scene/objectImagery.ts` (or extend galaxySprites.ts); modify `src/main.ts`, `src/ui/infoCard.ts` (if a DSO card variant is needed), `CREDITS.md`.

- [ ] `src/data/deepSky.ts`: `DeepSkyDef { id, name, raHours, decDeg, distPc, diameterLy, type, facts }` for ~15 objects (Orion Nebula M42, Pleiades M45, Carina Nebula, Lagoon M8, Eagle M16, Trifid M20, Ring M57, Dumbbell M27, Crab M1, Helix, Rosette, Hercules M13, Omega Centauri, 47 Tucanae, Double Cluster) with literature J2000 coordinates, distances, diameters, 2–3 facts. Accuracy matters.
- [ ] TDD a pure helper in `src/data/angularSize.ts`: `angularFovDeg(diameterLy, distPc)` = 2·atan((diameter/2 in pc)/dist)·(180/π)·1.6 padding, clamped [0.05°, 10°]; test with M42 (24 ly @ 412 pc ≈ 0.53°·1.6) and a galaxy-scale case (M31 220 kly @ 0.78 Mpc → clamps to 10°).
- [ ] `src/scene/objectImagery.ts`: for every curated object (galaxies with sprites + DSOs), on first focus OR camera within 20× the object's world diameter, fetch
  `https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=CDS%2FP%2FDSS2%2Fcolor&ra={raDeg}&dec={decDeg}&fov={fovDeg}&width=512&height=512&format=jpg&projection=TAN`
  via `new THREE.TextureLoader().load` (it accepts cross-origin URLs; set `crossOrigin='anonymous'`). On load: swap the object's sprite material map to the photo, resize sprite to `2·dist·tan(fov/2)` (world units, square), keep additive blending (black sky → transparent), opacity path unchanged. On error: keep glow, console.warn once. Never fetch twice (per-object state). DSOs get sprites created the same way as curated galaxies (glow first, photo on approach).
- [ ] Wire DSOs into search (rank tier = galaxy), fly-to (`minApproachAu` = max(2× diameter in AU, 1e6 AU)), info cards (distance shown in ly via existing formatDistance of distPc·PC_TO_AU).
- [ ] CREDITS: DSS2/hips2fits (CDS, Strasbourg) acknowledgment.
- [ ] Gates + live smoke (implementer): search "orion nebula" → fly → photo replaces glow; "andromeda" → real M31 photo; a failed-fetch path stays on glow. Commit.

### Task 24: Sky view mode

**Files:** create `src/engine/skyViewControls.ts`; modify `src/main.ts`, `index.html` (🔭 button + hint element), `src/scene/solarSystem.ts` (expose Earth-extras visibility toggle if needed).

- [ ] `SkyViewControls`: drag → yaw/pitch of a view DIRECTION (not orbit); wheel → `camera.fov` clamp [15, 90] + updateProjectionMatrix; exposes `getViewDir(out)`, mirrors FocusOrbitControls' pointer handling (incl. the pointercancel/lostpointercapture guards and drag-suppression cooperation with the click handler — simplest: while in sky mode, the click-to-focus handler is disabled).
- [ ] main.ts mode state `'orbit' | 'sky'`: entering sky = camera truePos pinned to Earth truePos each frame, Earth mesh+clouds+atmosphere hidden, HUD focus card hidden, hint shown, controls swapped; exiting (button or Escape) restores fov 55, Earth visibility, FocusOrbitControls state as-was. Time controls stay live (watch planets drift along the ecliptic at 1 day/s!).
- [ ] Layer alphas in sky mode: force `layerAlphas(small)` equivalent — stars 1, MW 1 (the band is genuinely visible from inside — keep its real crossfade value at Earth distance… verify visually; if MW alpha at Earth ≈ 0 per the ramp, override to ~0.6 in sky mode so the band shows), galaxies 0.
- [ ] Gates + live smoke: toggle in/out; drag pans the sky; wheel zooms FOV; planets visible as bright dots near the ecliptic; MW band arcs across the sky. Commit.

### Task 25: Constellations + phase-7 ship

**Files:** create `scripts/build-constellations.ts`, `public/constellations.json`, `src/scene/constellations.ts`; modify `src/main.ts`, `README.md`, `CREDITS.md`.

- [ ] Build script: download d3-celestial `constellations.lines.json` (BSD-3) from the ofrohn/d3-celestial GitHub raw URL into scripts/cache/, transform GeoJSON MultiLineString coordinates (RA deg [-180,180] or [0,360) — verify format, dec deg) into flat segment list `[[ra,dec,ra2,dec2],…]` per constellation, write compact `public/constellations.json` (~100 KB). Committed.
- [ ] `src/scene/constellations.ts`: load JSON, build one `THREE.LineSegments` — each vertex = unit direction from raDecDistToXyz(ra/15, dec, 1) × 1e6 (AU), `LineBasicMaterial({ color: 0x3a5a7a, transparent: true, opacity: 0.5 })`; group visible only in sky mode; positioned at GL origin (camera-relative by construction — directions only).
- [ ] Wire into sky mode toggle. README: sky-view section + phase-7 features; CREDITS: d3-celestial (BSD-3, Olaf Frohn).
- [ ] Full gates; coordinator does the phase-7 ship drive (Orion constellation → fly into the belt region → M42 photo; regression spot-checks); final whole-phase review; merge to main; push (auto-deploy); verify live URL.
