# 轨迹文件批量导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/activities` 的导入卡片一次选择多个同格式 GPX/TCX 文件，由页面依次导入，结束后给出汇总，不改后端接口和数据库。

**Architecture:** 新增纯逻辑模块 `lib/import-queue.ts`（串行队列、结果分类、429 重试、停止），新增展示组件 `ImportBatchPanel.svelte`（进度与汇总），`routes/activities/+page.svelte` 只负责把多选文件交给队列并在结束后刷新一次列表。选 1 个文件时沿用现有单文件流程，一行不改。

**Tech Stack:** SvelteKit 3 / Svelte 5 runes、TypeScript strict、Vitest、Playwright（合成 API）。

设计依据：`docs/superpowers/specs/2026-10-23-batch-track-import-design.md`

## Global Constraints

- 内部导入使用 `#lib/...` 别名并带 `.ts` 扩展名；不使用 `$lib`、`createEventDispatcher`、svelte store。
- 组件使用 Svelte 5 runes，props 用单次 `$props()` 解构并内联类型，回调命名 `onstop`、`onretry` 这类 `on*`。
- 页面保留 `disposed` 清理标志；await 之后赋值前检查；遇到 401 一律清除私人状态并跳转登录（沿用页面现有的 `fail()`）。
- 写操作经现有 `uploadGpx` / `uploadTcx`（内部先取 `/api/v1/auth/csrf`）；不新增接口调用，不改 SSR 代理白名单。
- 后端每用户同一时间只允许一个导入（429 `IMPORT_BUSY`，`Retry-After: 1`），所以队列必须严格串行。
- 单个文件最大 10 MiB（`10 * 1024 * 1024`），超过的文件前端直接记为失败，不发请求。
- 颜色与间距使用语义令牌（`var(--space-*)`、`var(--border)`、`var(--surface)`、`var(--primary)` 等），不硬编码色值；按钮复用 `.button-secondary`。
- 不新增通用组件到设计系统规范；`ImportBatchPanel` 是导入页专用片段。
- 前端 UI 测试走合成 API：新增请求拦截写在 spec 的 `page.route()` 里，不连真实后端。
- 提交与推送需要用户授权（`AGENTS.md` 第 11 节）。下面各任务末尾的 Commit 步骤只在用户已授权时执行；提交时显式列出文件，不使用 `git add -A`。
- 验证纪律：测试必须真实执行并如实报告；前端改动需通过 `pnpm check`。

## File Structure

| 文件 | 责任 |
| --- | --- |
| Create `frontend/src/lib/import-queue.ts` | 队列状态机：条目类型、格式检测、串行执行、结果分类、汇总计数。无 DOM 依赖，可在 Node 单测 |
| Create `frontend/src/lib/components/ImportBatchPanel.svelte` | 进度条、当前文件、汇总、失败清单、停止/重试按钮 |
| Modify `frontend/src/routes/activities/+page.svelte` | 多选、批量启动、结束后刷新一次列表；单文件流程不变 |
| Create `frontend/tests/unit/import-queue.test.ts` | 队列逻辑的 Vitest |
| Create `frontend/tests/ui/activity-batch-import.spec.ts` | 合成 API 下的批量导入 Playwright |
| Modify `frontend/playwright.activity-library.config.ts` | 把新 spec 加入 `testMatch` |
| Create `docs/NN-batch-track-import.md` | 完成后的特性文档（编号现场确认） |

---

### Task 1: 导入队列逻辑

**Files:**
- Create: `frontend/src/lib/import-queue.ts`
- Test: `frontend/tests/unit/import-queue.test.ts`

**Interfaces:**
- Consumes: `ActivityError`（`#lib/api/activities.ts`，字段 `status`、`code`、`message`、`existingActivityId`）。
- Produces（后续任务依赖这些确切名字）:
  - `MAX_IMPORT_BYTES: number`、`BUSY_RETRY_LIMIT: number`（5）、`BUSY_RETRY_DELAY_MS: number`（1000）
  - `type ImportStatus = 'pending' | 'running' | 'success' | 'duplicate' | 'failed' | 'skipped'`
  - `interface ImportItem { id: number; file: File; status: ImportStatus; message: string; warnings: string[]; existingActivityId: string | null }`
  - `type BatchFormat = { ok: true; format: 'gpx' | 'tcx' } | { ok: false; message: string }`
  - `createItems(files: File[]): ImportItem[]`
  - `detectBatchFormat(files: readonly File[]): BatchFormat`
  - `summarize(items: readonly ImportItem[]): { total: number; done: number; success: number; duplicate: number; failed: number; skipped: number; withWarnings: number }`
  - `runImportQueue(items: ImportItem[], options: QueueOptions): Promise<QueueOutcome>`，其中 `QueueOptions = { importOne: (file: File) => Promise<{ warnings: string[] }>; onupdate: (items: ImportItem[]) => void; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }`，`QueueOutcome = { items: ImportItem[]; stopped: boolean; authExpired: boolean }`

- [ ] **Step 1: 写失败的测试**

创建 `frontend/tests/unit/import-queue.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run（在 `frontend/`）: `pnpm exec vitest run tests/unit/import-queue.test.ts`
Expected: FAIL，提示找不到 `../../src/lib/import-queue.ts`。

- [ ] **Step 3: 写最小实现**

创建 `frontend/src/lib/import-queue.ts`：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run tests/unit/import-queue.test.ts`
Expected: PASS，全部用例通过。

- [ ] **Step 5: 类型检查与全量单元测试**

Run: `pnpm check` 然后 `pnpm test`
Expected: 0 errors / 0 warnings；全部 Vitest 通过。

- [ ] **Step 6: Commit（仅在用户授权后）**

```bash
git add frontend/src/lib/import-queue.ts frontend/tests/unit/import-queue.test.ts
git commit -m "feat: add a serial import queue for batch track imports"
```

---

### Task 2: 进度与汇总组件

**Files:**
- Create: `frontend/src/lib/components/ImportBatchPanel.svelte`

**Interfaces:**
- Consumes: `ImportItem`、`summarize`（Task 1）。
- Produces: 组件 `ImportBatchPanel`，props `{ items: ImportItem[]; running: boolean; onstop: () => void; onretry: () => void }`。DOM 约定（Task 4 的测试依赖）：
  - 进度/汇总文字在 `role="status"` 的元素里；运行中文案 `正在导入第 {done+1} / {total} 个：{文件名}`；结束文案 `导入完成：成功 X · 重复跳过 Y · 失败 Z`，有未处理时追加 ` · 未处理 W`。
  - 按钮文字：`停止`、`重试失败项`。
  - 失败清单是 `<ul aria-label="失败的文件">`，每项含文件名与原因。
  - 有警告的成功文件数以 `{N} 个文件导入时有提示，可在活动详情查看` 显示。

- [ ] **Step 1: 创建组件**

```svelte
<script lang="ts">
  import { summarize, type ImportItem } from '#lib/import-queue.ts';
  let { items, running, onstop, onretry }: { items: ImportItem[]; running: boolean; onstop: () => void; onretry: () => void } = $props();
  const summary = $derived(summarize(items));
  const current = $derived(items.find(item => item.status === 'running'));
  const failures = $derived(items.filter(item => item.status === 'failed'));
  const headline = $derived(
    running
      ? `正在导入第 ${Math.min(summary.done + 1, summary.total)} / ${summary.total} 个：${current?.file.name ?? ''}`
      : `导入完成：成功 ${summary.success} · 重复跳过 ${summary.duplicate} · 失败 ${summary.failed}${summary.skipped ? ` · 未处理 ${summary.skipped}` : ''}`
  );
</script>
<div class="batch-panel" data-testid="import-batch">
  <p class="batch-headline" role="status">{headline}</p>
  <div class="batch-progress" role="progressbar" aria-label="批量导入进度" aria-valuemin="0" aria-valuemax={summary.total} aria-valuenow={summary.done}><span style:width={`${summary.total ? (summary.done / summary.total) * 100 : 0}%`}></span></div>
  {#if !running && summary.withWarnings}<p class="batch-note">{summary.withWarnings} 个文件导入时有提示，可在活动详情查看。</p>{/if}
  {#if !running && failures.length}
    <ul class="batch-failures" aria-label="失败的文件">
      {#each failures as item (item.id)}<li><span class="batch-name">{item.file.name}</span><span class="batch-reason">{item.message}</span></li>{/each}
    </ul>
  {/if}
  <div class="batch-actions">
    {#if running}<button type="button" class="button-secondary" onclick={onstop}>停止</button>{/if}
    {#if !running && failures.length}<button type="button" class="button-secondary" onclick={onretry}>重试失败项</button>{/if}
  </div>
</div>
<style>
  .batch-panel { display: grid; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-control); min-width: 0; }
  .batch-headline { font-size: .9375rem; font-weight: 600; overflow-wrap: anywhere; }
  .batch-progress { width: 100%; height: .375rem; overflow: hidden; background: var(--muted); border-radius: 999px; }
  .batch-progress span { display: block; height: 100%; background: var(--primary); border-radius: inherit; transition: width .2s ease; }
  @media (prefers-reduced-motion: reduce) { .batch-progress span { transition: none; } }
  .batch-note { color: var(--muted-foreground); font-size: .8125rem; }
  .batch-failures { display: grid; gap: var(--space-1); max-height: 14rem; overflow: auto; font-size: .8125rem; }
  .batch-failures li { display: grid; gap: .125rem; padding: var(--space-1) 0; border-bottom: 1px solid var(--border); }
  .batch-name { font-weight: 600; overflow-wrap: anywhere; }
  .batch-reason { color: var(--muted-foreground); overflow-wrap: anywhere; }
  .batch-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .batch-actions:empty { display: none; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `pnpm check`
Expected: 0 errors / 0 warnings。

- [ ] **Step 3: Commit（仅在用户授权后）**

```bash
git add frontend/src/lib/components/ImportBatchPanel.svelte
git commit -m "feat: add the batch import progress and summary panel"
```

---

### Task 3: 把批量导入接入活动页

**Files:**
- Modify: `frontend/src/routes/activities/+page.svelte`（脚本段约 18–27、53–75、100–150 行，标记段约 160–200 行）

**Interfaces:**
- Consumes: `createItems`、`detectBatchFormat`、`runImportQueue`、`ImportItem`（Task 1）；`ImportBatchPanel`（Task 2）；页面已有的 `uploadGpx`/`uploadTcx`（`view.bind` 后签名 `(form: FormData) => Promise<{ activity; warnings: string[] }>`）、`fail()`、`load()`、`controlsBusy`、`busy`。
- Produces: 多选行为；单文件行为保持不变。

- [ ] **Step 1: 先看现有测试里有哪些文案会被改动**

Run: `grep -rn "单个，最大\|选择或拖入轨迹文件\|导入 GPX" frontend/tests | cut -c1-160`
Expected: 列出依赖这些文案的用例。第 7 步统一核对；单文件下按钮文案 `导入 GPX` 不变。

- [ ] **Step 2: 增加导入与状态**

在 `<script>` 里已有的 import 之后加入：

```ts
  import ImportBatchPanel from '#lib/components/ImportBatchPanel.svelte';
  import { createItems, detectBatchFormat, runImportQueue, type ImportItem } from '#lib/import-queue.ts';
```

在 `let fileInput = ...` 那一行之后加入：

```ts
  let pickedFiles = $state<File[]>([]), batchItems = $state<ImportItem[]>([]), batchRunning = $state(false);
  let batchController: AbortController | undefined;
  const multi = $derived(pickedFiles.length > 1);
```

- [ ] **Step 3: 改写 `pickChanged`，`formatSize` 保持不动**

把现有 `pickChanged` 整个替换为：

```ts
  function pickChanged() {
    pickedFiles = Array.from(fileInput.files ?? []);
    picked = pickedFiles[0] ?? null;
    batchItems = [];
    if (pickedFiles.length > 1) {
      const detected = detectBatchFormat(pickedFiles);
      if (detected.ok) { importFormat = detected.format; message = ''; } else message = detected.message;
    } else {
      const extension = picked?.name.split('.').at(-1)?.toLowerCase();
      if (extension === 'tcx' || extension === 'gpx') importFormat = extension;
    }
    timeMode = 'absolute';
  }
```

- [ ] **Step 4: 增加批量执行函数，并在 `submit` 里分流**

在 `submit` 函数之前加入：

```ts
  async function runBatch(retry = false) {
    const detected = detectBatchFormat(retry ? batchItems.map(item => item.file) : pickedFiles);
    if (!detected.ok) { message = detected.message; return; }
    const format = detected.format, mode = timeMode, zone = timezone.trim();
    const upload = format === 'tcx' ? uploadTcx : uploadGpx;
    const items = retry
      ? batchItems.map(item => (item.status === 'failed' ? { ...item, status: 'pending' as const, message: '' } : item))
      : createItems(pickedFiles);
    batchController = new AbortController();
    busy = true; batchRunning = true; batchItems = items;
    let authExpired = false;
    try {
      const outcome = await runImportQueue(items, {
        signal: batchController.signal,
        onupdate: next => { if (!disposed) batchItems = next; },
        importOne: async file => {
          const form = new FormData(); form.append('file', file);
          if (zone) form.append('timezone', zone);
          if (format === 'tcx') form.append('time_mode', mode);
          const result = await upload(form);
          return { warnings: result.warnings };
        }
      });
      authExpired = outcome.authExpired;
    } finally { if (!disposed) { busy = false; batchRunning = false; } }
    if (disposed) return;
    // One refresh for the whole batch instead of one per file.
    window.dispatchEvent(new CustomEvent('runnote-activities-changed'));
    if (authExpired) { fail(new ActivityError('登录已过期，请重新登录', 401, 'AUTH_REQUIRED')); return; }
    fileInput.value = ''; picked = null; pickedFiles = [];
    await load();
  }
```

在 `submit` 里，`message = ''; duplicateId = null; successId = null; warnings = [];` 这一行之后立刻加入：

```ts
    if (pickedFiles.length > 1) { await runBatch(); return; }
```

- [ ] **Step 5: 停止与卸载**

把 `onMount(() => { mounted = true; void load(lastOffset); return () => { disposed = true; ++listRequest; }; });` 改为：

```ts
  onMount(() => { mounted = true; void load(lastOffset); return () => { disposed = true; ++listRequest; batchController?.abort(); }; });
```

- [ ] **Step 6: 改标记**

1. `<input ... type="file" name="file" ...>` 增加 `multiple` 属性。
2. 文件选择提示改为（保留原有 `{#if picked}` 分支原文不动，仅在最前面加 `multi` 分支，并更新空状态提示）：

```svelte
          {#if multi}<span class="file-pick-title">已选择 {pickedFiles.length} 个文件</span><span class="file-pick-hint">{formatSize(pickedFiles.reduce((sum, f) => sum + f.size, 0))} · 依次导入，点击或拖入可更换</span>
          {:else if picked}<span class="file-pick-title">{picked.name}</span><span class="file-pick-hint">{formatSize(picked.size)} · 点击或拖入可更换</span>
          {:else}<span class="file-pick-title">选择或拖入轨迹文件</span><span class="file-pick-hint">GPX / TCX · 可多选，单个最大 10 MiB</span>{/if}
```

3. 提交按钮文案改为：

```svelte
{busy ? (batchRunning ? '正在批量导入…' : '正在解析与保存…') : multi ? `导入 ${pickedFiles.length} 个 ${importFormat.toUpperCase()}` : `导入 ${importFormat.toUpperCase()}`}
```

4. “文件格式”下拉框的 `disabled` 改为 `disabled={controlsBusy || !mounted || multi}`。
5. “补充导入信息”里 **标题** 与 **补录日期** 两个 `<input>` 的 `disabled` 改为 `disabled={controlsBusy || !mounted || multi}`；在该区块网格末尾加一行：

```svelte
        {#if multi}<p class="import-help sm:col-span-2">批量导入时标题和补录日期不可用，沿用文件里的信息；时区仍会应用到每个文件。</p>{/if}
```

6. 通用的加载提示 `{#if busy}<div class="mt-4"><FeedbackState kind="loading" ...` 改为 `{#if busy && !batchRunning}`，并在它后面加入：

```svelte
  {#if batchItems.length}<ImportBatchPanel items={batchItems} running={batchRunning} onstop={() => batchController?.abort()} onretry={() => void runBatch(true)} />{/if}
```

- [ ] **Step 7: 类型检查，并只修正确实依赖旧文案的测试**

Run: `pnpm check`
Expected: 0 errors / 0 warnings。

Run: `pnpm exec playwright test --config playwright.activity-library.config.ts activities.spec.ts tcx.spec.ts`
Expected: 全部通过。若有用例因空状态提示 `单个，最大 10 MiB` 失败，把断言改成新文案 `可多选，单个最大 10 MiB`，不要改其他断言。

- [ ] **Step 8: Commit（仅在用户授权后）**

```bash
git add frontend/src/routes/activities/+page.svelte
git commit -m "feat: import several track files of one format from the activities page"
```

---

### Task 4: Playwright 验收（合成 API）

**Files:**
- Create: `frontend/tests/ui/activity-batch-import.spec.ts`
- Modify: `frontend/playwright.activity-library.config.ts`（`testMatch` 增加 `'activity-batch-import.spec.ts'`）

**Interfaces:**
- Consumes: 页面 DOM 约定（Task 2、3）；`installActivities`、`loginRunner`、`incompleteActivity`（`tests/fixtures/activities`）。
- Produces: 回归保护。

- [ ] **Step 1: 写 spec**

```ts
import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner, incompleteActivity, sampleActivity } from '../fixtures/activities';

type Plan = 'ok' | 'duplicate' | 'error' | 'hold';
const gpx = (name: string) => ({ name, mimeType: 'application/gpx+xml', buffer: Buffer.from('<gpx version="1.1" creator="synthetic"></gpx>') });
const tcx = (name: string) => ({ name, mimeType: 'application/xml', buffer: Buffer.from('<TrainingCenterDatabase></TrainingCenterDatabase>') });
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

// Registered after installActivities, so it wins over the default single-upload route.
async function batchApi(page: Page, plan: Record<string, Plan>) {
  const uploaded: string[] = [];
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/gpx-imports', async route => {
    const name = /filename="([^"]+)"/.exec(route.request().postData() ?? '')?.[1] ?? '';
    uploaded.push(name);
    const mode = plan[name] ?? 'ok';
    if (mode === 'hold') await hold;
    if (mode === 'error') return route.fulfill({ status: 503, json: { error: { code: 'DEPENDENCY_UNAVAILABLE', message: '保存暂时失败，请稍后重试' } } });
    if (mode === 'duplicate') return route.fulfill({ status: 409, json: { error: { code: 'GPX_DUPLICATE', message: '此运动记录已经导入', details: [{ existing_activity_id: sampleActivity.id, duplicate_kind: 'raw' }] } } });
    const imported = { ...incompleteActivity, id: '44444444-4444-4444-8444-444444444444', title: name, visibility: 'private' as const };
    return route.fulfill({ json: { data: { activity: imported, warnings: ['TIME_INCOMPLETE'] }, error: null } });
  });
  return { uploaded, release };
}
async function openActivities(page: Page) {
  await page.goto('/activities');
  // The controls stay disabled until hydration finishes; selecting files earlier is silently lost.
  await expect(page.getByRole('button', { name: '导入 GPX', exact: true })).toBeEnabled();
}
async function open(page: Page) {
  await installActivities(page); await loginRunner(page);
}
const picker = (page: Page) => page.locator('input[type=file][name=file]');
const status = (page: Page) => page.getByTestId('import-batch').getByRole('status');

test('several files import in order, the list refreshes once and the summary counts them', async ({ page }) => {
  await open(page); const api = await batchApi(page, {}); await openActivities(page);
  await page.evaluate(() => { (window as unknown as { changed: number }).changed = 0; window.addEventListener('runnote-activities-changed', () => { (window as unknown as { changed: number }).changed++; }); });
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await expect(page.getByText('已选择 3 个文件')).toBeVisible();
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('导入完成：成功 3 · 重复跳过 0 · 失败 0');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx', 'c.gpx']);
  expect(await page.evaluate(() => (window as unknown as { changed: number }).changed)).toBe(1);
  await expect(page.getByText('3 个文件导入时有提示')).toBeVisible();
});

test('duplicates are skipped, failures are listed and retrying resends only the failed file', async ({ page }) => {
  await open(page); const plan: Record<string, Plan> = { 'b.gpx': 'duplicate', 'c.gpx': 'error' };
  const api = await batchApi(page, plan); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('成功 1 · 重复跳过 1 · 失败 1');
  const failures = page.getByRole('list', { name: '失败的文件' });
  await expect(failures).toContainText('c.gpx'); await expect(failures).toContainText('保存暂时失败');
  plan['c.gpx'] = 'ok';
  await page.getByRole('button', { name: '重试失败项', exact: true }).click();
  await expect(status(page)).toContainText('成功 2 · 重复跳过 1 · 失败 0');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx', 'c.gpx', 'c.gpx']);
});

test('stopping keeps finished files and leaves the rest unprocessed', async ({ page }) => {
  await open(page); const api = await batchApi(page, { 'b.gpx': 'hold' }); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx'), gpx('c.gpx')]);
  await page.getByRole('button', { name: '导入 3 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('正在导入第 2 / 3 个：b.gpx');
  await expect(page.getByRole('button', { name: '正在批量导入…' })).toBeDisabled();
  await page.getByRole('button', { name: '停止', exact: true }).click(); api.release();
  await expect(status(page)).toContainText('成功 2 · 重复跳过 0 · 失败 0 · 未处理 1');
  expect(api.uploaded).toEqual(['a.gpx', 'b.gpx']);
});

test('mixed formats are refused before anything is sent, and batch mode disables per-file fields', async ({ page }) => {
  await open(page); const api = await batchApi(page, {}); await openActivities(page);
  await picker(page).setInputFiles([gpx('a.gpx'), tcx('b.tcx')]);
  await expect(page.getByRole('alert')).toContainText('请分开导入同一种格式');
  await page.getByRole('button', { name: /^导入 2 个/ }).click();
  expect(api.uploaded).toEqual([]);
  await picker(page).setInputFiles([gpx('a.gpx'), gpx('b.gpx')]);
  await page.getByText('补充导入信息', { exact: true }).click();
  await expect(page.getByLabel('标题（可选）')).toBeDisabled();
  await expect(page.getByLabel('补录日期（可选）')).toBeDisabled();
  await expect(page.getByLabel('时区（可选）', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('文件格式', { exact: true })).toBeDisabled();
});

test('a single file keeps the existing flow and the summary fits a phone screen', async ({ page }) => {
  await open(page); const plan: Record<string, Plan> = { 'long-name-for-a-phone-layout-check-0001.gpx': 'error' };
  await batchApi(page, plan); await page.setViewportSize({ width: 390, height: 900 }); await openActivities(page);
  await picker(page).setInputFiles(gpx('single.gpx'));
  await page.getByRole('button', { name: '导入 GPX', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '导入成功' })).toBeVisible();
  await expect(page.getByTestId('import-batch')).toHaveCount(0);
  await picker(page).setInputFiles([gpx('long-name-for-a-phone-layout-check-0001.gpx'), gpx('b.gpx')]);
  await page.getByRole('button', { name: '导入 2 个 GPX', exact: true }).click();
  await expect(status(page)).toContainText('失败 1'); await noOverflow(page);
});
```

在 `frontend/playwright.activity-library.config.ts` 的 `testMatch` 数组末尾加入 `'activity-batch-import.spec.ts'`。

- [ ] **Step 2: 运行并修正测试自身的问题**

Run: `pnpm exec playwright test --config playwright.activity-library.config.ts activity-batch-import.spec.ts`
Expected: 5 passed。

- [ ] **Step 3: 回归**

Run: `pnpm exec playwright test --config playwright.activity-library.config.ts`
Expected: 全部通过（含既有的 `activities.spec.ts`、`tcx.spec.ts`、`activity-management.spec.ts`）。

- [ ] **Step 4: Commit（仅在用户授权后）**

```bash
git add frontend/tests/ui/activity-batch-import.spec.ts frontend/playwright.activity-library.config.ts
git commit -m "test: cover batch track import with the synthetic API"
```

---

### Task 5: 特性文档与最终验证

**Files:**
- Create: `docs/NN-batch-track-import.md`（先 `ls docs/` 取已用最大编号 +1）

- [ ] **Step 1: 确认编号**

Run: `ls docs | grep -E '^[0-9]+' | sort -n | tail -1`
Expected: 输出当前最大编号；新文档用它 +1。

- [ ] **Step 2: 写文档（中文）**

文档必须包含 `## 使用方式`、`## 改动范围`、`## 接口与隐私`、`## 验证记录`，内容取自本次实际结果，不引用本计划的预期数字。接口与隐私部分写明：后端接口、响应结构、数据库、SSR 代理白名单均未改；文件名只在页面内存里展示；每个文件仍各自提交一次数据版本更新，足迹 worker 会合并 1 秒内的连续唤醒。验证记录写真实命令和结果，并列出未运行项（后端测试、真实后端 e2e、开发服务未重启等）。

- [ ] **Step 3: 最终验证**

Run（`frontend/`）: `pnpm check`、`pnpm test`、`pnpm exec playwright test --config playwright.activity-library.config.ts`
Expected: 0 errors / 0 warnings；Vitest 全部通过；Playwright 全部通过。

- [ ] **Step 4: Commit（仅在用户授权后）**

```bash
git add docs/NN-batch-track-import.md
git commit -m "docs: record the batch track import"
```

---

## Self-Review

- **Spec coverage:** 多选与同格式约束（Task 1 `detectBatchFormat`、Task 3 `pickChanged`/`runBatch`）；标题/补录日期禁用、时区沿用、TCX 时间解释整批生效（Task 3 第 6 步、`runBatch`）；进度、停止、汇总、失败清单、重试失败项（Task 2、Task 3）；串行、重复归为跳过、失败不中断、429 重试 5 次、401 立即停止、超过 10 MiB 不发送（Task 1）；结束后只刷新一次并只触发一次 `runnote-activities-changed`（Task 3 `runBatch`、Task 4 第 1 个用例）；单文件行为不变（Task 4 第 5 个用例）；移动端不溢出（Task 4 第 5 个用例）；不改后端与代理（全程未触及）；测试与特性文档（Task 1、4、5）。
- **Placeholder scan:** 计划中没有 TBD/TODO；唯一待现场确定的是文档编号，Task 5 给了确切命令。
- **Type consistency:** `ImportItem`、`ImportStatus`、`summarize`、`runImportQueue`、`createItems`、`detectBatchFormat`、`MAX_IMPORT_BYTES` 等名字在 Task 1 定义，Task 2/3/4 使用的拼写一致；`ImportBatchPanel` 的 props 名 `items/running/onstop/onretry` 在 Task 2 定义，Task 3 的调用一致；`上传` 函数签名与页面现有 `view.bind` 绑定后的 `(form)` 一致。
- **已知限制:** `ActivityError` 不携带 `Retry-After`，队列使用固定 1 秒退避（与后端 `retry_after=1` 一致）；停止后“未处理”的文件不会随“重试失败项”重新导入，需要重新选择文件，重复文件会被安全地跳过。
