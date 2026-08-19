import type { MoonMeanElements } from '../sim/moonOrbit'

/**
 * JPL Solar System Dynamics "Planetary Satellite Mean Elements"
 * (https://ssd.jpl.nasa.gov/sats/elem/), fetched 2026-08-18.
 *
 * Every row's epoch is 2000-01-01.5 TDB = JD 2451545.0 (`EPOCH_JD` below). `periodDays` is the
 * table's own P (days) column; mean motion is derived from it in src/sim/moonOrbit.ts rather than
 * duplicated here, so it can't drift out of sync.
 *
 * `poleRaDeg`/`poleDecDeg` is each satellite's own Laplace-plane pole, taken directly from the
 * table's R.A./Dec. columns where given (Saturn's four moons here, Triton, Phobos, Deimos) — this
 * is more accurate than substituting the parent planet's own IAU rotational pole, and is exactly
 * how the table's own worst case shows up: Iapetus's Laplace pole (RA 288.7°, Dec 78.9°) sits
 * ~15° away from Saturn's own pole (RA 40.6°, Dec 83.5°) because Iapetus orbits far enough out
 * that solar perturbations tilt its Laplace plane away from Saturn's equator and toward Saturn's
 * orbital plane — the table's own "Tilt" column reports that same 14.8° for Iapetus, vs 0.0-0.6°
 * for the other seven. For Titania and Oberon the table's Frame column is "equatorial" (not
 * "Laplace") with the R.A./Dec. columns blank — those elements are already given directly in
 * Uranus's own IAU equatorial frame, so poleRaDeg/poleDecDeg here is Uranus's own IAU (2015)
 * rotational pole (257.311°, -15.175°) instead of a per-satellite value.
 *
 * References (JPL SSD's own numbered citations, https://ssd.jpl.nasa.gov/sats/elem/#refs):
 * Saturn (SAT441) — R. A. Jacobson (2022); Mars (MAR099) — same source family; Uranus (URA182) —
 * R. A. Jacobson (2014-era update); Neptune (NEP097) — R. A. Jacobson (2009-era update).
 *
 * PHASE CALIBRATION (2026-08-18): an independent JPL Horizons cross-check found that this
 * table's M0 does NOT actually osculate at the 2000-01-01.5 epoch it's printed against, for 7 of
 * these 9 moons — the orbit ORIENTATION (i, Omega, omega, pole) reconstructed from the table is
 * correct (verified separately against Horizons' own osculating pole, agreement 0.28° for Titan),
 * but using the table's M0 verbatim put the mean-anomaly PHASE off by tens to ~175° at epoch.
 * Every M0Deg value below is therefore CALIBRATED, not the raw table value: scripts/build-moon-
 * phase.ts fetches each moon's real Horizons position vector at this epoch and solves for the M0
 * that reproduces it (see src/data/moonPhase.json for the full report and src/sim/moonOrbit.ts's
 * doc comment for the method). Each row's comment gives the original table M0 for provenance.
 * Gate (enforced in build-moon-phase.ts, re-run 2026-08-18): recomputing position from the
 * calibrated M0 via the real runtime moonOffsetEqjAu and comparing to the fetched Horizons vector
 * agrees within 1.0° for all nine — worst case Iapetus at 0.81°, most under 0.2°.
 */
export const MOON_ELEMENTS_EPOCH_JD = 2451545.0

const URANUS_POLE_RA_DEG = 257.311
const URANUS_POLE_DEC_DEG = -15.175

export type MoonV2Id =
  | 'titan' | 'rhea' | 'iapetus' | 'enceladus'
  | 'triton'
  | 'titania' | 'oberon'
  | 'phobos' | 'deimos'

export const MOON_ELEMENTS: Record<MoonV2Id, MoonMeanElements> = {
  // ---- Saturn (frame: Laplace) ----
  titan: {
    aKm: 1221900, e: 0.029, iDeg: 0.3, omegaDeg: 78.3, OmegaDeg: 78.6,
    M0Deg: 217.6983, // JPL table M0 = 11.7° (osculating phase differs — calibrated vs Horizons at epoch, delta -154.00°)
    periodDays: 15.945448, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 36.4, poleDecDeg: 84.0,
  },
  rhea: {
    aKm: 527200, e: 0.001, iDeg: 0.3, omegaDeg: 44.3, OmegaDeg: 133.7,
    M0Deg: 234.211, // JPL table M0 = 31.5° (osculating phase differs — calibrated vs Horizons at epoch, delta -157.29°)
    periodDays: 4.517503, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 40.6, poleDecDeg: 83.5,
  },
  iapetus: {
    aKm: 3561700, e: 0.028, iDeg: 7.6, omegaDeg: 254.5, OmegaDeg: 86.5,
    M0Deg: 219.8778, // JPL table M0 = 74.8° (osculating phase differs — calibrated vs Horizons at epoch, delta 145.08°)
    periodDays: 79.331002, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 288.7, poleDecDeg: 78.9,
  },
  enceladus: {
    aKm: 238400, e: 0.005, iDeg: 0.0, omegaDeg: 119.5, OmegaDeg: 0.0,
    M0Deg: 62.4519, // JPL table M0 = 57.0° (osculating phase differs — calibrated vs Horizons at epoch, delta 5.45°)
    periodDays: 1.370218, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 40.6, poleDecDeg: 83.5,
  },
  // ---- Neptune (frame: Laplace) ----
  triton: {
    // Retrograde: i = 157.3° (> 90°) is what makes moonOffsetEqjAu's Kepler solve trace Triton
    // backwards around its own orbit normal — see moonOrbit.test.ts's angular-momentum-vs-pole test.
    aKm: 354800, e: 0.0, iDeg: 157.3, omegaDeg: 0.0, OmegaDeg: 178.1,
    M0Deg: 58.9544, // JPL table M0 = 63.0° (osculating phase differs — calibrated vs Horizons at epoch, delta -4.05°)
    periodDays: 5.876994, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 299.8, poleDecDeg: 43.1,
  },
  // ---- Uranus (frame: equatorial — no per-satellite pole published; Uranus's own IAU pole used) ----
  titania: {
    aKm: 436298, e: 0.002, iDeg: 0.1, omegaDeg: 184.0, OmegaDeg: 29.5,
    M0Deg: 44.4691, // JPL table M0 = 68.1° (osculating phase differs — calibrated vs Horizons at epoch, delta -23.63°)
    periodDays: 8.705869, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: URANUS_POLE_RA_DEG, poleDecDeg: URANUS_POLE_DEC_DEG,
  },
  oberon: {
    aKm: 583511, e: 0.002, iDeg: 0.1, omegaDeg: 132.2, OmegaDeg: 76.8,
    M0Deg: 338.474, // JPL table M0 = 143.6° (osculating phase differs — calibrated vs Horizons at epoch, delta -165.13°)
    periodDays: 13.463237, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: URANUS_POLE_RA_DEG, poleDecDeg: URANUS_POLE_DEC_DEG,
  },
  // ---- Mars (frame: Laplace) ----
  phobos: {
    aKm: 9375, e: 0.015, iDeg: 1.1, omegaDeg: 216.3, OmegaDeg: 169.2,
    M0Deg: 189.66, // JPL table M0 = 189.7° (already close — calibrated vs Horizons at epoch, delta -0.04°)
    periodDays: 0.3187, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 317.7, poleDecDeg: 52.9,
  },
  deimos: {
    aKm: 23457, e: 0.0, iDeg: 1.8, omegaDeg: 0.0, OmegaDeg: 54.3,
    M0Deg: 205.0952, // JPL table M0 = 205.0° (already close — calibrated vs Horizons at epoch, delta 0.10°)
    periodDays: 1.2625, epochJd: MOON_ELEMENTS_EPOCH_JD, poleRaDeg: 316.6, poleDecDeg: 53.5,
  },
}
