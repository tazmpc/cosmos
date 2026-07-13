const KM_PER_AU = 149597870.7
const AU_PER_LY = 63241.077

export function formatDistance(au: number): string {
  if (au < 0.01) return `${Math.round(au * KM_PER_AU).toLocaleString('en-US')} km`
  if (au < AU_PER_LY) return `${au.toFixed(2)} AU`
  const ly = au / AU_PER_LY
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(2)} Mly`
  return `${ly.toFixed(2)} ly`
}
