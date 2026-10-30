import { addDays, type Dose, type DoseChange, type SymptomEvent } from '#lib/api/wellbeing.ts';

/** Pure helpers of the summary page: ranges, comparison, the small line and the medicine × side-effect counts. Presentation only; the figures come from the server. */

export const spanDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

/** The stretch of the same length that ends the day before `from`, used to say "compared with the period before". */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = spanDays(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** `current − previous` to one decimal, or null when either side has nothing recorded (a gap is never treated as 0). */
export function change(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;
}
export const changeText = (delta: number | null) => delta === null ? '' : delta === 0 ? '持平' : `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}`;

/** A thin line over the recorded days: runs of consecutive recorded values, as SVG point lists in a `width`×`height` box. A gap breaks the line; nothing is drawn across it. */
export function sparkRuns(values: (number | null)[], max: number, width = 100, height = 28, pad = 3): { runs: string[]; dots: [number, number][] } {
  const n = values.length, x = (i: number) => n <= 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (n - 1);
  const y = (v: number) => height - pad - (Math.min(Math.max(v, 0), max) / max) * (height - 2 * pad);
  const runs: string[] = [], dots: [number, number][] = [];
  let run: string[] = [];
  const flush = () => { if (run.length > 1) runs.push(run.join(' ')); run = []; };
  values.forEach((v, i) => {
    if (v === null) { flush(); return; }
    const px = Math.round(x(i) * 10) / 10, py = Math.round(y(v) * 10) / 10;
    run.push(`${px},${py}`); dots.push([px, py]);
  });
  flush();
  return { runs, dots };
}

export interface MatrixRow { name: string; total: number; cells: number[] }
export interface Matrix { columns: string[]; rows: MatrixRow[]; max: number }
export const UNLINKED = '未关联到某种药';

/** Side effects per medicine: each event is counted under the medicine of the dose it was noted for; old events with no dose go to one last row. Columns are the side effects, most frequent first. */
export function medicineMatrix(doses: Pick<Dose, 'id' | 'medication_name'>[], events: Pick<SymptomEvent, 'dose_id' | 'symptom'>[]): Matrix {
  const nameOf = new Map(doses.map(d => [d.id, d.medication_name]));
  const counts = new Map<string, Map<string, number>>(), totals = new Map<string, number>();
  for (const event of events) {
    const medicine = event.dose_id !== null ? nameOf.get(event.dose_id) ?? UNLINKED : UNLINKED;
    const row = counts.get(medicine) ?? new Map<string, number>();
    row.set(event.symptom, (row.get(event.symptom) ?? 0) + 1);
    counts.set(medicine, row);
    totals.set(event.symptom, (totals.get(event.symptom) ?? 0) + 1);
  }
  const columns = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b, 'zh'));
  const rows = [...counts.entries()].map(([name, row]) => ({ name, total: [...row.values()].reduce((a, b) => a + b, 0), cells: columns.map(c => row.get(c) ?? 0) }));
  rows.sort((a, b) => (a.name === UNLINKED ? 1 : 0) - (b.name === UNLINKED ? 1 : 0) || b.total - a.total || a.name.localeCompare(b.name, 'zh'));
  return { columns, rows, max: Math.max(0, ...rows.flatMap(r => r.cells)) };
}

export interface ChangeLine { date: string; from: string | null; to: string }
/** The dose history of one medicine as lines: the first dose of the range, then each time the amount differed from the one before ("from → to"). */
export function changeLines(timeline: DoseChange[], describe: (change: DoseChange) => string): ChangeLine[] {
  return timeline.map((item, index) => ({ date: item.date, from: index === 0 ? null : describe(timeline[index - 1]), to: describe(item) }));
}
