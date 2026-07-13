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
