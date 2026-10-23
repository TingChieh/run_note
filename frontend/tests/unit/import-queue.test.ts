import { describe, expect, it } from 'vitest';
import { ActivityError } from '../../src/lib/api/activities.ts';
import {
  BUSY_RETRY_DELAY_MS, BUSY_RETRY_LIMIT, MAX_IMPORT_BYTES, createItems, detectBatchFormat, runImportQueue, summarize,
  type ImportItem
} from '../../src/lib/import-queue.ts';

const existing = '11111111-1111-4111-8111-111111111111';
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);
const states = (items: ImportItem[]) => items.map(item => `${item.file.name}:${item.status}`);
const noSleep = async () => {};

describe('detectBatchFormat', () => {
  it('accepts one supported format regardless of letter case', () => {
    expect(detectBatchFormat([file('a.gpx'), file('b.GPX')])).toEqual({ ok: true, format: 'gpx' });
    expect(detectBatchFormat([file('a.tcx'), file('b.TCX')])).toEqual({ ok: true, format: 'tcx' });
  });
  it('rejects mixed or unsupported extensions', () => {
    for (const files of [[file('a.gpx'), file('b.tcx')], [file('a.gpx'), file('b.fit')], [file('a.gpx'), file('noextension')]]) {
      expect(detectBatchFormat(files)).toEqual({ ok: false, message: '请分开导入同一种格式的 GPX 或 TCX 文件' });
    }
  });
});

describe('runImportQueue', () => {
  it('imports strictly in order, keeps warnings and publishes every state change', async () => {
    const calls: string[] = []; const updates: string[][] = [];
    const outcome = await runImportQueue(createItems([file('a.gpx'), file('b.gpx')]), {
      importOne: async f => { calls.push(f.name); return { warnings: f.name === 'a.gpx' ? ['TIME_INCOMPLETE'] : [] }; },
      onupdate: items => updates.push(states(items)), sleep: noSleep
    });
    expect(calls).toEqual(['a.gpx', 'b.gpx']);
    expect(states(outcome.items)).toEqual(['a.gpx:success', 'b.gpx:success']);
    expect(outcome.items[0].warnings).toEqual(['TIME_INCOMPLETE']);
    expect(updates[0]).toEqual(['a.gpx:running', 'b.gpx:pending']);
    expect(outcome).toMatchObject({ stopped: false, authExpired: false });
  });

  it('treats a 409 with an existing activity as a skipped duplicate and continues after failures', async () => {
    const outcome = await runImportQueue(createItems([file('a.gpx'), file('b.gpx'), file('c.gpx'), file('d.gpx')]), {
      importOne: async f => {
        if (f.name === 'a.gpx') throw new ActivityError('此运动记录已经导入', 409, 'GPX_DUPLICATE', existing, 'raw');
        if (f.name === 'b.gpx') throw new ActivityError('GPX 文件超过大小限制', 413, 'GPX_TOO_LARGE');
        if (f.name === 'c.gpx') throw new ActivityError('相似记录', 409, 'SOMETHING_ELSE');
        return { warnings: [] };
      },
      onupdate: () => {}, sleep: noSleep
    });
    expect(states(outcome.items)).toEqual(['a.gpx:duplicate', 'b.gpx:failed', 'c.gpx:failed', 'd.gpx:success']);
    expect(outcome.items[0].existingActivityId).toBe(existing);
    expect(outcome.items[1].message).toBe('GPX 文件超过大小限制');
    expect(summarize(outcome.items)).toMatchObject({ total: 4, done: 4, success: 1, duplicate: 1, failed: 2, skipped: 0 });
  });

  it('waits and retries IMPORT_BUSY, then succeeds', async () => {
    let attempts = 0; const waits: number[] = [];
    const outcome = await runImportQueue(createItems([file('a.gpx')]), {
      importOne: async () => { if (++attempts < 3) throw new ActivityError('忙', 429, 'IMPORT_BUSY'); return { warnings: [] }; },
      onupdate: () => {}, sleep: async ms => { waits.push(ms); }
    });
    expect(states(outcome.items)).toEqual(['a.gpx:success']);
    expect(waits).toEqual([BUSY_RETRY_DELAY_MS, BUSY_RETRY_DELAY_MS]);
  });

  it('gives up on IMPORT_BUSY after the retry limit and moves on', async () => {
    let attempts = 0;
    const outcome = await runImportQueue(createItems([file('a.gpx'), file('b.gpx')]), {
      importOne: async f => { if (f.name === 'a.gpx') { attempts++; throw new ActivityError('忙', 429, 'IMPORT_BUSY'); } return { warnings: [] }; },
      onupdate: () => {}, sleep: noSleep
    });
    expect(attempts).toBe(1 + BUSY_RETRY_LIMIT);
    expect(states(outcome.items)).toEqual(['a.gpx:failed', 'b.gpx:success']);
  });

  it('stops everything on 401 and marks the rest as not processed', async () => {
    const calls: string[] = [];
    const outcome = await runImportQueue(createItems([file('a.gpx'), file('b.gpx'), file('c.gpx')]), {
      importOne: async f => { calls.push(f.name); if (f.name === 'b.gpx') throw new ActivityError('登录已过期', 401, 'AUTH_REQUIRED'); return { warnings: [] }; },
      onupdate: () => {}, sleep: noSleep
    });
    expect(calls).toEqual(['a.gpx', 'b.gpx']);
    expect(states(outcome.items)).toEqual(['a.gpx:success', 'b.gpx:skipped', 'c.gpx:skipped']);
    expect(outcome.authExpired).toBe(true);
  });

  it('stops before the next file when aborted and keeps finished results', async () => {
    const controller = new AbortController(); const calls: string[] = [];
    const outcome = await runImportQueue(createItems([file('a.gpx'), file('b.gpx'), file('c.gpx')]), {
      importOne: async f => { calls.push(f.name); if (f.name === 'a.gpx') controller.abort(); return { warnings: [] }; },
      onupdate: () => {}, signal: controller.signal, sleep: noSleep
    });
    expect(calls).toEqual(['a.gpx']);
    expect(states(outcome.items)).toEqual(['a.gpx:success', 'b.gpx:skipped', 'c.gpx:skipped']);
    expect(outcome.stopped).toBe(true);
  });

  it('never sends a file over 10 MiB', async () => {
    const calls: string[] = [];
    const outcome = await runImportQueue(createItems([file('big.gpx', MAX_IMPORT_BYTES + 1), file('ok.gpx')]), {
      importOne: async f => { calls.push(f.name); return { warnings: [] }; }, onupdate: () => {}, sleep: noSleep
    });
    expect(calls).toEqual(['ok.gpx']);
    expect(outcome.items[0]).toMatchObject({ status: 'failed', message: '轨迹文件不能超过 10 MiB' });
  });

  it('only processes pending items, so a retry resends nothing that already finished', async () => {
    const items = createItems([file('a.gpx'), file('b.gpx'), file('c.gpx')]);
    items[0] = { ...items[0], status: 'success' }; items[1] = { ...items[1], status: 'duplicate', existingActivityId: existing };
    const calls: string[] = [];
    const outcome = await runImportQueue(items, { importOne: async f => { calls.push(f.name); return { warnings: [] }; }, onupdate: () => {}, sleep: noSleep });
    expect(calls).toEqual(['c.gpx']);
    expect(states(outcome.items)).toEqual(['a.gpx:success', 'b.gpx:duplicate', 'c.gpx:success']);
  });
});

describe('summarize', () => {
  it('counts statuses and files that carry warnings', () => {
    const items = createItems([file('a.gpx'), file('b.gpx'), file('c.gpx')]).map((item, i) => ({ ...item, status: (['success', 'failed', 'skipped'] as const)[i], warnings: i === 0 ? ['X', 'Y'] : [] }));
    expect(summarize(items)).toEqual({ total: 3, done: 2, success: 1, duplicate: 0, failed: 1, skipped: 1, withWarnings: 1 });
  });
});
