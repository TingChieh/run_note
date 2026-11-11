// Built once: creating an Intl formatter costs far more than formatting, and a year's calendar asks 365 times.
const KILOMETRES = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

/** Presentation only: API values and chart calculations retain their original precision. */
export function dashboardDistance(metres: number | string | null): string {
  return metres === null ? '—' : `${KILOMETRES.format(Number(metres) / 1000)} km`;
}
