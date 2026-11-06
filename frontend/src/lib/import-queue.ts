import { ActivityError } from '#lib/api/activities.ts';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const BUSY_RETRY_LIMIT = 5;
// The API answers IMPORT_BUSY with Retry-After: 1.
export const BUSY_RETRY_DELAY_MS = 1000;

export type ImportStatus = 'pending' | 'running' | 'success' | 'duplicate' | 'failed' | 'skipped';
export interface ImportItem {
  id: number;
  file: File;
  status: ImportStatus;
  message: string;
  warnings: string[];
  existingActivityId: string | null;
}
export type BatchFormat = { ok: true; format: 'gpx' | 'tcx' } | { ok: false; message: string };
export interface QueueOptions {
  importOne: (file: File) => Promise<{ warnings: string[] }>;
  onupdate: (items: ImportItem[]) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}
export interface QueueOutcome { items: ImportItem[]; stopped: boolean; authExpired: boolean }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createItems(files: File[]): ImportItem[] {
  return files.map((file, id) => ({ id, file, status: 'pending', message: '', warnings: [], existingActivityId: null }));
}

export function detectBatchFormat(files: readonly File[]): BatchFormat {
  const extensions = new Set(files.map(file => file.name.split('.').at(-1)?.toLowerCase() ?? ''));
  if (extensions.size === 1) {
    const [only] = extensions;
    if (only === 'gpx' || only === 'tcx') return { ok: true, format: only };
  }
  return { ok: false, message: '请分开导入同一种格式的 GPX 或 TCX 文件' };
}

/**
 * Spots exports that write local wall-clock time with a Z suffix. Only unmistakable signals count:
 * the Mi Fitness creator, or a last timestamp that lies in the future.
 */
export type LocalTimeSignal = 'creator' | 'future';
export function localTimeSignal(head: string, tail: string, now = Date.now()): LocalTimeSignal | null {
  if (/creator\s*=\s*["']Mi Fitness["']/i.test(head)) return 'creator';
  const stamps = [...tail.matchAll(/<time>\s*([^<\s]+)\s*<\/time>/gi)].map(match => match[1]);
  const last = stamps.at(-1);
  if (last && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(last) && Date.parse(last) > now + 5 * 60 * 1000) return 'future';
  return null;
}
export async function detectLocalTime(files: readonly File[]): Promise<LocalTimeSignal | null> {
  const found = new Set<LocalTimeSignal>();
  for (const file of files) {
    try {
      const [head, tail] = await Promise.all([file.slice(0, 2048).text(), file.slice(Math.max(0, file.size - 4096)).text()]);
      const signal = localTimeSignal(head, tail);
      if (signal) found.add(signal);
    } catch { /* unreadable files are reported by the upload itself */ }
  }
  return found.has('creator') ? 'creator' : found.has('future') ? 'future' : null;
}

export function summarize(items: readonly ImportItem[]) {
  const count = (status: ImportStatus) => items.filter(item => item.status === status).length;
  const success = count('success'), duplicate = count('duplicate'), failed = count('failed');
  return {
    total: items.length, done: success + duplicate + failed, success, duplicate, failed, skipped: count('skipped'),
    withWarnings: items.filter(item => item.status === 'success' && item.warnings.length > 0).length
  };
}

/** Strictly serial: the server allows one import per user at a time. Only `pending` items run. */
export async function runImportQueue(initial: ImportItem[], options: QueueOptions): Promise<QueueOutcome> {
  const { importOne, onupdate, signal, sleep = wait } = options;
  let items = initial.map(item => ({ ...item }));
  const publish = (index: number, patch: Partial<ImportItem>) => {
    items = items.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onupdate(items);
  };
  let stopped = false, authExpired = false;
  for (let index = 0; index < items.length && !authExpired; index++) {
    if (items[index].status !== 'pending') continue;
    if (signal?.aborted) { stopped = true; break; }
    const file = items[index].file;
    if (file.size > MAX_IMPORT_BYTES) { publish(index, { status: 'failed', message: '轨迹文件不能超过 10 MiB' }); continue; }
    publish(index, { status: 'running' });
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await importOne(file);
        publish(index, { status: 'success', warnings: result.warnings });
        break;
      } catch (cause) {
        if (cause instanceof ActivityError) {
          if (cause.status === 401) { authExpired = true; publish(index, { status: 'pending' }); break; }
          if (cause.status === 409 && cause.existingActivityId) {
            publish(index, { status: 'duplicate', message: cause.message, existingActivityId: cause.existingActivityId });
            break;
          }
          if (cause.status === 429 && cause.code === 'IMPORT_BUSY' && attempt < BUSY_RETRY_LIMIT && !signal?.aborted) {
            await sleep(BUSY_RETRY_DELAY_MS);
            continue;
          }
        }
        publish(index, { status: 'failed', message: cause instanceof Error ? cause.message : '导入失败，请重试' });
        break;
      }
    }
  }
  if (stopped || authExpired) {
    items = items.map(item => (item.status === 'pending' ? { ...item, status: 'skipped' } : item));
    onupdate(items);
  }
  return { items, stopped, authExpired };
}
