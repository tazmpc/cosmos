import { KPC_TO_AU, MPC_TO_AU } from '../data/units'

export interface LayerAlphas {
  stars: number
  /** Interior Milky Way (milkyway.bin) — the Gaia-sight-line reconstruction. Faithful only from
   *  inside; owns sky view and the near-galactic camera. */
  milkyWay: number
  /** Exterior Milky Way (milkyway-ext.bin) — the volumetrically-sampled model. Owns every
   *  from-outside vantage. Never on screen at the same strength as `milkyWay`; the two hand off
   *  around 20-30 kpc. */
  milkyWayExt: number
  galaxies: number
}

const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))
const lg = Math.log10

/** Start and end of the interior<->exterior Milky Way handoff (kpc). The two layers share this
 *  ONE band and split it complementarily — see the note in layerAlphas. Log-midpoint (where they
 *  are equal) is sqrt(12*28) ~ 18.3 kpc. */
const MW_HANDOFF_LO_KPC = 12
const MW_HANDOFF_HI_KPC = 28

/** Crossfade weights per layer from camera distance to the Sun (AU).
 *
 * The two Milky Way layers are the same galaxy built two different ways, so they must never both
 * be near full strength (doubled point density = a brightness bump mid-flight) — and, just as
 * importantly, their weights must never SAG below full together, which would dim the galaxy to
 * ~60% partway through a flythrough and brighten it again. Independently-chosen ramps do exactly
 * that, so the handoff is written as a single split instead: `t` rises 0 -> 1 across the band and
 * the interior takes (1 - t) while the exterior takes t, making their sum identically 1 at every
 * distance.
 *
 * The band's placement is a compromise between two artifacts. Below 12 kpc the camera is still
 * inside the disk, where the interior layer is the faithful one — and the classic edge-on rift
 * view at ~40 kly (12.3 kpc) lands here, at t = 0.03, so it stays essentially pure interior.
 * Above it the interior layer's own Sun-centred concentration (~8% of its points sit within
 * 2 kpc of the Sun, plus the pencil beam toward the galactic centre) starts reading as a bright
 * knot at the camera's own position rather than as a galaxy, so the band is kept short — closed
 * out by 28 kpc — to minimise how long that knot is on screen while it cross-dissolves into the
 * exterior layer's correctly-placed bulge.
 *
 * Past the band only the exterior layer is drawn, and it carries the outer fade (1 -> 0 over
 * 0.5-3 Mpc) as the galaxy recedes into the galaxy field.
 */
export function layerAlphas(distAu: number): LayerAlphas {
  const d = lg(Math.max(distAu, 1))
  const outerFade = 1 - ramp(d, lg(0.5 * MPC_TO_AU), lg(3 * MPC_TO_AU))
  const handoff = ramp(d, lg(MW_HANDOFF_LO_KPC * KPC_TO_AU), lg(MW_HANDOFF_HI_KPC * KPC_TO_AU))
  const mwVisible = ramp(d, lg(1.5 * KPC_TO_AU), lg(8 * KPC_TO_AU)) * outerFade
  return {
    stars: 1 - ramp(d, lg(2 * KPC_TO_AU), lg(10 * KPC_TO_AU)),
    milkyWay: mwVisible * (1 - handoff),
    milkyWayExt: mwVisible * handoff,
    galaxies: ramp(d, lg(0.1 * MPC_TO_AU), lg(2 * MPC_TO_AU)),
  }
}
