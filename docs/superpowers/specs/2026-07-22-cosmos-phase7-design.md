# Cosmos Phase 7 — Real Imagery & Sky View

**Date:** 2026-07-22
**Status:** Approved (continuation of the approved roadmap's final phase)
**Parent spec:** `2026-07-13-cosmos-v1-design.md` (v1 + phase 6 shipped + deployed)

## Goal

Bring real telescope imagery into the 3D scene, and add the "stand on Earth, look up"
mode that bridges the familiar night sky to everything the app already renders.
Checkpoints: fly toward the Orion Nebula and watch the actual photograph fade in;
toggle sky view and find Orion's belt with constellation lines over real stars.

## Part A — hips2fits imagery for curated objects

- **Service:** CDS `hips2fits` (https://alasky.cds.unistra.fr/hips-image-services/hips2fits)
  — returns a JPEG cutout of a chosen all-sky survey at any RA/Dec/FOV. Survey:
  `CDS/P/DSS2/color`. One request per object, on demand, browser-cached. No tile
  engine needed.
- **Behavior:** each curated object (26 galaxies + new DSOs) lazily fetches its cutout
  when first within an approach threshold (or on focus); the JPEG replaces the
  procedural glow sprite's texture, sized to the object's true angular extent
  (FOV = 1.6× the object's diameter). DSS black background + additive blending =
  transparent sky for free. Billboard orientation (like the glow sprites today);
  fetch failure silently keeps the glow sprite.
- **New DSOs:** ~15 famous non-galaxy objects in `src/data/deepSky.ts` (Orion Nebula,
  Pleiades, Carina, Lagoon, Eagle, Trifid, Ring, Dumbbell, Crab, Helix, Rosette,
  M13, Omega Centauri, 47 Tucanae, Double Cluster): RA/Dec (J2000), distance (pc),
  diameter (ly), type, facts. Searchable (same rank tier as galaxies), fly-to,
  info cards. Positions via raDecDistToXyz in parsecs — they live inside the star field.

## Part B — Sky view

- **Entry/exit:** a "🔭 Sky" toggle button in the HUD; Escape also exits. State machine
  in main.ts: `mode: 'orbit' | 'sky'`.
- **Camera:** true position pinned to Earth's current truePos (Earth mesh + clouds/
  atmosphere hidden while in sky view); drag = look around (yaw/pitch of view
  direction); wheel = FOV zoom clamped [15°, 90°] (restored to 55° on exit). All
  existing layers render unchanged — stars, planets, Milky Way band appear at their
  true sky positions automatically (floating origin already handles it).
- **Constellations:** d3-celestial `constellations.lines.json` (BSD-3, credited) —
  RA/Dec line strips per constellation. Build step converts to a compact
  `public/constellations.json`; rendered as a LineSegments group on a fixed-radius
  celestial sphere (1e6 AU), visible only in sky view, subtle blue like orbit lines.
- **HUD in sky view:** focus card hidden; a small "Sky view — drag to look, scroll to
  zoom, Esc to exit" hint.

## Non-goals

- Full progressive HiPS tiling / all-sky imagery sphere (hips2fits covers the product
  need at 1% of the complexity).
- Imagery for the 918k anonymous catalog galaxies (curated objects only).
- Refraction/horizon/atmosphere simulation in sky view (space-station view, not
  ground truth).

## Milestones

23. **Imagery + DSOs:** hips2fits sprite upgrades for curated objects; deepSky.ts
    catalog searchable with cards. *Checkpoint: Orion Nebula photo fades in on approach;
    Andromeda shows the real M31 photo.*
24. **Sky view:** mode toggle, look-around controls, FOV zoom, layer behavior.
    *Checkpoint: from Earth, the Milky Way band arcs across the sky; planets sit on
    the ecliptic.*
25. **Constellations + ship:** line data pipeline, sky-view rendering, README/CREDITS,
    full gates, live drive, deploy. *Checkpoint: Orion's belt under the lines, then
    fly INTO the sky — from constellation to the nebula's photograph in one motion.*
