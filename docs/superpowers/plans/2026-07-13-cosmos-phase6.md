# Cosmos Phase 6 Implementation Plan — Galaxies, Cosmic Web, Milky Way

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new data layers — SDSS+2MRS galaxies (real), a Gaia-density Milky Way bridge (statistically real, labeled model), and LOD crossfades — so pulling back from the v1 star shell reveals our galaxy, then the cosmic web.

**Architecture:** Reuse the CSMS binary format and the star point shader for all layers (parameterized unit scale + brightness constants + a new per-layer alpha uniform). Positions: milkyway.bin in parsecs (reuses star pipeline verbatim), galaxies.bin in megaparsecs. Distances from redshift via a TDD'd ΛCDM module. Crossfades from a pure `layerAlphas(distAu)` function.

**Tech Stack:** existing (Vite/TS/Three.js/Vitest/tsx). New data: SDSS DR18 SkyServer, VizieR TAP (2MRS), Gaia TAP random subsample.

**Spec:** `docs/superpowers/specs/2026-07-13-cosmos-phase6-design.md`
**Conventions:** exactly as v1 — strict TDD for pure math, `npm run test` + `npx tsc --noEmit` + `npm run build` gates every task, commit per task, coordinator does visual checkpoints. Constants: `MPC_TO_AU = 2.06264806e11`, `KPC_TO_AU = 2.06264806e8`.

---

### Task 16: Cosmology + galaxy pipeline → galaxies.bin

**Files:**
- Create: `src/data/cosmology.ts`, `src/data/cosmology.test.ts`, `scripts/build-galaxies.ts`
- Modify: `package.json` (script `"galaxies": "tsx scripts/build-galaxies.ts"`)
- Output (committed): `public/galaxies.bin`

- [ ] **Step 1 (TDD): cosmology tests first**

```ts
import { describe, it, expect } from 'vitest'
import { comovingDistanceMpc, luminosityDistanceMpc } from './cosmology'

describe('cosmology (flat LCDM H0=70 Om=0.3)', () => {
  it('d(0) = 0', () => expect(comovingDistanceMpc(0)).toBe(0))
  it('matches cz/H0 at low z within 1%', () => {
    const d = comovingDistanceMpc(0.01)
    const approx = 299792.458 * 0.01 / 70 // 42.827 Mpc
    expect(Math.abs(d - approx) / approx).toBeLessThan(0.01)
  })
  it('is monotonic and sub-linear at higher z', () => {
    const d1 = comovingDistanceMpc(0.1), d2 = comovingDistanceMpc(0.2)
    expect(d2).toBeGreaterThan(d1)
    expect(d2).toBeLessThan(2 * d1) // deceleration of dC growth vs z
  })
  it('luminosity distance = (1+z) * comoving', () => {
    expect(luminosityDistanceMpc(0.1)).toBeCloseTo(1.1 * comovingDistanceMpc(0.1), 6)
  })
})
```

Run → FAIL. Implement:

```ts
const C_KM_S = 299792.458

/** Comoving distance, flat LCDM, midpoint-rule integral (512 steps: <0.01% error for z<=0.3). */
export function comovingDistanceMpc(z: number, h0 = 70, omegaM = 0.3, omegaL = 0.7): number {
  if (z <= 0) return 0
  const n = 512
  let sum = 0
  for (let i = 0; i < n; i++) {
    const zi = (i + 0.5) * z / n
    sum += 1 / Math.sqrt(omegaM * (1 + zi) ** 3 + omegaL)
  }
  return (C_KM_S / h0) * (z / n) * sum
}

export function luminosityDistanceMpc(z: number): number {
  return (1 + z) * comovingDistanceMpc(z)
}
```

Run → pass. Commit: `feat: LCDM cosmology distances (TDD)`

- [ ] **Step 2: download SDSS (paged) + 2MRS**

SDSS SkyServer SqlSearch, CSV, paged over 10 z-slices to stay under the row cap. Per slice (z0,z1 from splitting [0.003, 0.25] into 10):

```bash
mkdir -p scripts/cache
SQL="SELECT ra, dec, z, modelMag_r, modelMag_g FROM SpecPhoto WHERE class='GALAXY' AND zWarning=0 AND z BETWEEN {z0} AND {z1}"
curl -fG 'https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch' \
  --data-urlencode "cmd=$SQL" --data-urlencode 'format=csv' \
  -o scripts/cache/sdss_{i}.csv --max-time 900
```

If `SpecPhoto` or column names differ in DR18, discover with a `SELECT TOP 1 *` probe and adapt (report the adaptation). If a slice exceeds the server cap (row-limit error in body), split that slice in two and retry. Expect ~1.5–2.5M rows total.

2MRS via VizieR TAP:

```bash
curl -fG 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync' \
  --data-urlencode 'REQUEST=doQuery' --data-urlencode 'LANG=ADQL' --data-urlencode 'FORMAT=csv' \
  --data-urlencode 'QUERY=SELECT RAJ2000, DEJ2000, cz, Ktmag FROM "J/ApJS/199/26/table3"' \
  -o scripts/cache/2mrs.csv --max-time 600
```

Column names may differ — probe with `SELECT TOP 1 *` and adapt. cz is km/s → z = cz/299792.458. Expect ~43–45k rows.

- [ ] **Step 3: `scripts/build-galaxies.ts`**

For each SDSS row: `dC = comovingDistanceMpc(z)`; skip z outside (0.003, 0.25) or bad parses; position = `raDecDistToXyz(raDeg/15, decDeg, dC)` (units become Mpc); absMag = `modelMag_r − 5*log10(luminosityDistanceMpc(z)*1e6/10)`; colorIndex = `modelMag_g − modelMag_r` clamped [−0.5, 2.5] (NaN → 0.8). For each 2MRS row: z from cz; same pipeline with Ktmag (absMag from K-band; colorIndex fixed 1.0). Merge (SDSS first, then 2MRS — no dedup: overlap is scientifically real but negligible visually), encode with the existing `encodeCatalog`, write `public/galaxies.bin`. Log counts per source + total.

Sanity gates inside the script (throw on failure): total in [500k, 3M]; no NaN in any output array (full scan); all distances in (10, 1100) Mpc.

- [ ] **Step 4: run + verify + commit**

`npm run galaxies` → report counts/size (expect ~30–50 MB). Decode spot-check: nearest 2MRS galaxy to Andromeda's coordinates (RA 0.712 h, Dec +41.27°) sits at dC < 5 Mpc — wait, M31's cz is blueshifted (~−300 km/s), so it may be absent or at z≤0; NOTE: it is fine if M31 is missing from 2MRS output (negative cz rows are skipped — Task 19's curated list carries Andromeda with a literature distance instead; log how many negative-cz rows were skipped). Instead spot-check: the Coma cluster region (RA 12.99 h, Dec +27.98°) has a dense clump near ~100 Mpc. `npm run test` (38/38 incl. cosmology), tsc clean. Commit: `feat: SDSS+2MRS galaxy catalog pipeline; commit galaxies.bin`

---

### Task 17: Galaxy layer rendering + LOD crossfades

**Files:**
- Create: `src/scene/layerAlphas.ts`, `src/scene/layerAlphas.test.ts`, `src/scene/galaxyField.ts`
- Modify: `src/scene/starField.ts` (parameterize material + add uLayerAlpha), `src/engine/cameraControls.ts` (MAX_DIST_AU 5e9 → 3e16), `src/main.ts` (wire layer + fades), `src/ui/format.ts` (+Mly)

- [ ] **Step 1 (TDD): layerAlphas**

```ts
import { describe, it, expect } from 'vitest'
import { layerAlphas } from './layerAlphas'

const KPC = 2.06264806e8, MPC = 2.06264806e11

describe('layerAlphas', () => {
  it('near Earth: stars only', () => {
    const a = layerAlphas(1)
    expect(a.stars).toBe(1); expect(a.milkyWay).toBe(0); expect(a.galaxies).toBe(0)
  })
  it('at 5 kpc: MW rising, stars fading', () => {
    const a = layerAlphas(5 * KPC)
    expect(a.milkyWay).toBeGreaterThan(0.5)
    expect(a.stars).toBeLessThan(1)
  })
  it('at 10 Mpc: galaxies only', () => {
    const a = layerAlphas(10 * MPC)
    expect(a.stars).toBe(0); expect(a.milkyWay).toBe(0); expect(a.galaxies).toBe(1)
  })
  it('alphas are within [0,1] across 20 log-spaced distances', () => {
    for (let e = 0; e <= 19; e++) {
      const a = layerAlphas(Math.pow(10, e))
      for (const v of [a.stars, a.milkyWay, a.galaxies]) {
        expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
```

Implement (log-space linear ramps):

```ts
const KPC_TO_AU = 2.06264806e8
const MPC_TO_AU = 2.06264806e11

export interface LayerAlphas { stars: number; milkyWay: number; galaxies: number }

const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))
const lg = Math.log10

/** Crossfade weights per layer from camera distance to the Sun (AU). */
export function layerAlphas(distAu: number): LayerAlphas {
  const d = lg(Math.max(distAu, 1))
  return {
    stars: 1 - ramp(d, lg(2 * KPC_TO_AU), lg(10 * KPC_TO_AU)),
    milkyWay: ramp(d, lg(1.5 * KPC_TO_AU), lg(8 * KPC_TO_AU)) *
              (1 - ramp(d, lg(0.5 * MPC_TO_AU), lg(3 * MPC_TO_AU))),
    galaxies: ramp(d, lg(0.1 * MPC_TO_AU), lg(2 * MPC_TO_AU)),
  }
}
```

Commit: `feat: LOD layer crossfade weights (TDD)`

- [ ] **Step 2: parameterize the point material.** In starField.ts, extract material creation into an exported factory used by both stars and galaxies:

```ts
export interface PointLayerConfig {
  unitToAu: number     // 206264.806 for pc, 2.06264806e11 for Mpc
  scale: number        // uScale
  faintMag: number     // uFaintMag
  minSize: number      // gl_PointSize lower clamp
  maxSize: number
}
export function makePointMaterial(cfg: PointLayerConfig): THREE.ShaderMaterial { ... }
```

Shader changes: `uUnitToAu`, `uMinSize`, `uMaxSize` become uniforms (replacing the inlined PC_TO_AU and 0.75/14.0 clamps); add `uniform float uLayerAlpha;` multiplied into vAlpha. Keep the logdepthbuf + common includes EXACTLY as they are (they were a hard-won fix). Star layer config: `{unitToAu: 206264.806, scale: 9, faintMag: 6.5, minSize: 0.75, maxSize: 14}` — must render pixel-identically to today (verify visually at checkpoint).

`StarField.update` gains an optional alpha arg: `update(camTruePosAu, layerAlpha = 1)` setting both uniforms (camera divided by unitToAu — generalize the /PC_TO_AU).

- [ ] **Step 3: `src/scene/galaxyField.ts`** — thin wrapper: fetch `/galaxies.bin`, decode, same geometry/attributes/colors as loadStarField (reuse via an exported helper if trivial, else mirror), material from `makePointMaterial({unitToAu: 2.06264806e11, scale: 60, faintMag: 20, minSize: 1.5, maxSize: 9})` (starting constants — tune at checkpoint).

- [ ] **Step 4: wire main.ts** — load galaxy layer alongside stars (independent .catch → banner mentioning galaxies only); per frame compute `const la = layerAlphas(camTruePos.length())` and pass to each layer's update. Raise `MAX_DIST_AU` to 3e16 in cameraControls.ts. Extend formatDistance: values ≥ 1e6 ly → `X.XX Mly`. Add a format test (`formatDistance(2.0626e11 * 200)` → megaparsec-scale Mly string; compute exact expected in the test).

- [ ] **Step 5: gates + commit** — tests all green, tsc, build. Commit: `feat: galaxy point layer with distance crossfades (milestone: cosmic web visible)`

*Coordinator checkpoint: fly out — stars fade, web appears; SDSS wedge structure visible; star layer unchanged up close.*

---

### Task 18: Milky Way bridge → milkyway.bin + third layer

**Files:**
- Create: `scripts/build-milkyway.ts`
- Modify: `package.json` (script `"milkyway"`), `src/main.ts` (third layer)
- Output (committed): `public/milkyway.bin`

- [ ] **Step 1: real Gaia sky-density sample**

```bash
curl -fG 'https://gea.esac.esa.int/tap-server/tap/sync' \
  --data-urlencode 'REQUEST=doQuery' --data-urlencode 'LANG=ADQL' --data-urlencode 'FORMAT=csv' \
  --data-urlencode 'QUERY=SELECT ra, dec FROM gaiadr3.gaia_source WHERE random_index < 2000000' \
  -o scripts/cache/gaia_density.csv --max-time 1800
```

`random_index` is Gaia's built-in uniform shuffle — this is a genuine unbiased 2M-star sample of the real sky density (dust lanes, bulge asymmetry and all). If timeout, halve to 1M and note it.

- [ ] **Step 2: `scripts/build-milkyway.ts`** — for each sampled (ra, dec):
  1. Unit direction in EQJ, rotate to galactic frame with the standard J2000 matrix:
     ```ts
     // rows of the J2000 equatorial -> galactic rotation matrix (IAU standard)
     const R = [
       [-0.0548755604, -0.8734370902, -0.4838350155],
       [ 0.4941094279, -0.4448296300,  0.7469822445],
       [-0.8676661490, -0.1980763734,  0.4559837762],
     ]
     ```
  2. Sample a distance s along that sight line from the density model
     ρ(R_gal, z_gal) = exp(−R_gal/2.6 kpc)·exp(−|z_gal|/0.3 kpc) + 2.5·exp(−(r_gc/0.8 kpc)²)
     with the Sun at (−8.2, 0, 0) kpc galactocentric: discretize s ∈ (0, 30] kpc into 300
     bins, weight each bin by ρ at that point, inverse-transform sample with a seeded PRNG
     (mulberry32(42) — deterministic builds, same as committing any binary requires).
  3. Emit position = direction·s converted to EQJ **parsecs** (rotate back with Rᵀ),
     absMag drawn N(5, 1.5) (clamped [0,10]), colorIndex drawn U(0.4, 1.6).
  Write with encodeCatalog → `public/milkyway.bin` (~2M points ≈ 40 MB). Gates in-script:
  no NaN full-scan; galactocentric radius of the point cloud's centroid < 3 kpc (bulge
  pulls it toward center — catches a frame/rotation bug); ≥60% of points within |z_gal| < 1 kpc (disk flatness).

- [ ] **Step 3: wire as third layer** in main.ts: `loadStarField`-equivalent fetch of `/milkyway.bin` through the SAME star-layer path (positions are parsecs) but its own material `makePointMaterial({unitToAu: 206264.806, scale: 6, faintMag: 9, minSize: 0.75, maxSize: 4})`, driven by `la.milkyWay`. Independent .catch (silent console.warn — this layer is optional garnish, no banner).

- [ ] **Step 4: gates + commit** — `feat: Milky Way bridge layer from real Gaia sky density (modeled depth)`

*Coordinator checkpoint: at ~5–50 kpc the galaxy appears — disk plane + central bulge, correctly tilted vs the ecliptic (the galactic plane should NOT align with the planet orbit plane).*

---

### Task 19: Named galaxies, cards, docs, phase-6 ship

**Files:**
- Create: `src/data/galaxies.ts`
- Modify: `src/main.ts` (search entries + focus/cards), `src/ui/infoCard.ts` (galaxy card), `README.md`, `CREDITS.md`

- [ ] **Step 1: curated list** — `src/data/galaxies.ts`: `GalaxyDef { id, name, raHours, decDeg, distMpc, type, facts }` for ~30 famous objects (M31 Andromeda 0.779 Mpc, M33, M81, M82, M87, M104 Sombrero, Centaurus A, Whirlpool M51, Pinwheel M101, Virgo cluster core, Coma cluster, Fornax cluster, …) with literature distances and 2–4 facts each. Position via `raDecDistToXyz(raHours, decDeg, distMpc)` × MPC_TO_AU; `minApproachAu = 5e9` (~24 kpc — inside a galaxy's halo, nothing closer to see).

- [ ] **Step 2: wire search + cards** — add kind `'galaxy'` to SearchEntry (rank between planet and star at equal match), focusEntry branch, showGalaxyCard (name, distance Mly via formatDistance of distMpc·MPC_TO_AU... show as `distMpc*3.262` Mly, type, facts). No click-picking for galaxies in this phase (the curated 30 are search-first; picking against 2M anonymous points isn't useful).

- [ ] **Step 3: docs** — README: new "The deep field" section (three layers, what's real vs modeled, phase-6 boundary now "beyond ~1.5 Gpc"); Known-boundaries updated (remove the fades-to-black item, note SDSS wedge coverage honestly); CREDITS: SDSS (acknowledgment per SDSS policy), 2MRS (Huchra et al. 2012), Milky Way layer = model over real Gaia density sample.

- [ ] **Step 4: full gates + commit** — all tests, tsc, build. Commit: `feat: named galaxies, cards, docs — phase 6 complete`

*Coordinator ship-drive: search Andromeda → arrive (~2.5 Mly); pull back → Milky Way becomes a dot among filaments; SDSS wedge + 2MRS all-sky structure; v1 regression spot-checks (Sirius card, Saturn rings, time controls).*

---

## Deviations & judgment calls

- All brightness constants (scale/faintMag/minSize/maxSize per layer, crossfade band edges) are starting values — tune at visual checkpoints, commit what looks right.
- If SDSS SkyServer is unavailable, ship phase 6 on 2MRS alone (structure without fine filaments) and leave SDSS as a follow-up; note it.
- Spec said "HEALPix GROUP BY" for the Gaia density; this plan uses the `random_index` uniform sample instead — same realness (measured sky density), no HEALPix geometry code needed. Spec updated to allow either.
