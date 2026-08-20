# Cosmos Phase 10 Plan — Polish Bundle, Deep Links, Proper Motions

> Subagent-driven; TDD for pure logic; coordinator visual checkpoints; gates per task; deploy after final review. Branch `phase-10`.

## Task A — Polish bundle
1. **Fly-to auto-aim:** on arrival at a moon, set FocusOrbitControls yaw/pitch from d = normalize(moonTruePos − parentTruePos) (camera sits along d beyond the moon, parent in frame behind it); on arrival at a spacecraft/asteroid, aim similarly using the Sun as the "parent". Applied in the FlyToAnimator arrival path (opt-in per Focusable via an optional `aimFrom?: () => Vector3` or a parent position provider — keep the API minimal).
2. **Lazy exterior Milky Way:** drop the 1600 ms setTimeout eager fetch; instead one-shot trigger when camera heliocentric distance first exceeds 8 kpc (checked in the existing 1 Hz-ish paths). Never blocks anything; band interior unaffected.
3. **Imagery texture disposal:** when a photo replaces a sprite's texture, dispose the replaced texture UNLESS it is the shared curated glow texture (standalone OpenNGC glow canvases are per-object → dispose; the shared curated glow must never be disposed — flag it).
4. **Asteroid catch-up:** on hidden→visible transition, run the rolling cursor at 32k/frame until one full sweep completes, then back to 8k (kills the ~1 s catch-up wave after time-warping while hidden).
5. **uPixelRatio follows the governor:** point-layer/spacecraft/halo materials read the current render pixel ratio each update (shared getter from renderer.ts) instead of a load-time snapshot.
6. **Search tests:** ranking tests for dso/asteroid/spacecraft kinds + a perf smoke (<5 ms over the full 13.2k entries).

## Task B — Deep links
- Pure `src/ui/urlState.ts` (TDD): encode/decode the view to/from the URL hash: `#mode=orbit|sky & focus=<kind>:<key> & d=<AU> & yaw & pitch & fov & t=<ISO sim date> & rate=<s/s>`. Round-trip tests; tolerant decoding (ignore unknown keys, clamp ranges, never throw).
- Apply on load once the needed catalog is ready (focus by kind: planet/moon ids, star names, galaxy/dso ids, asteroid names, spacecraft ids; missing target → console.warn + default view). Sim date/rate applied to SimClock; sky mode restores yaw/pitch/fov.
- Auto-update via history.replaceState, throttled 1 Hz, suppressed while dragging or flying. A 🔗 button (next to 🔭) copies the URL (navigator.clipboard) with a brief "copied" toast; document in README.

## Task C — Proper motions
- Data: second Gaia extract (ra, dec, pmra, pmdec — same WHERE, RA-sliced like teff; join by ra/dec toFixed(9) with a ≥50% join gate); HYG pm columns for the 701 named stars from the HYG cache.
- Build: per star, tangential velocity vector in pc/yr: v = (pmra*, pmdec in rad/yr) mapped onto the local (east, north) unit vectors at (ra, dec), scaled by dist_pc (pmra is pmra*cosδ per Gaia convention — use directly on e_east). CSMS **v2**: version field 2, three extra f32 SoA arrays vx, vy, vz (pc/yr). Decoder accepts v1 (velocities zero) and v2; encodeCatalog gains optional velocities. stars.bin → v2 (+8.7 MB); all other .bin files stay v1.
- TDD: velocity math vs Barnard's Star (μ ≈ 10.36″/yr at 1.83 pc → |v_tan| ≈ 9.19e-5 pc/yr; direction mostly north); format v2 round-trip; v1 backward-compat decode.
- Shader: `uniform float uYearsFromEpoch` (sim date − 2016.0, Gaia DR3 epoch); `pos = position + vel * uYearsFromEpoch` (attribute `starVel`, zero-filled for v1 catalogs so ONE shader serves all layers). Clamp |years| ≤ 200,000 (document).
- Time controls: two new rate steps — 100 yr/s and 10,000 yr/s (labels '100 yr/s', '10 kyr/s') so the deformation is watchable. README honesty notes: proper motion is linear extrapolation (no galactic orbits), planets/ephemerides degrade at extreme dates, constellation LINES are epoch-locked → hide constellation lines when |sim − J2000| > 5,000 yr with the sky-view hint noting why.
- Checkpoint: sky view at 10 kyr/s — the Big Dipper visibly deforms within seconds; Barnard's Star races.

Ship: gates, live drive, final review, merge, deploy.
