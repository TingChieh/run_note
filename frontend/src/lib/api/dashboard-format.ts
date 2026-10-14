/** Presentation only: API values and chart calculations retain their original precision. */
export function dashboardDistance(metres: number | string | null): string {
  return metres === null ? '—' : `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(Number(metres) / 1000)} km`;
}
