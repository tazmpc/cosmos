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
