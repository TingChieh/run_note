# 私人页面顶部导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把私人页面的左侧绿色侧栏改成顶部悬浮玻璃条（宽屏图标加文字，中等宽度只有图标，800px 以下沿用移动菜单），并把跑量目标变成进度环加弹层、账户入口变成头像菜单。

**Architecture:** 仍是同一个 `AppNavigation.svelte` 与 `.app-sidebar` / `#app-navigation`，桌面（≥800px）用 CSS 把它排成顶部条，移动端样式不动。新增一个通用的锚定玻璃弹层 `AnchoredPanel.svelte`（复用 `rn-glass-menu`、`popover-motion.ts`、`menu-glass.ts`），同时承载跑量目标弹层与头像菜单。导航滑块 `enhanceNavigation` 增加横向模式，跨断点时重建。

**Tech Stack:** SvelteKit 3 / Svelte 5 runes、TypeScript、Tailwind 4 令牌（`app.css`）、Playwright 合成 UI 测试（`playwright.ui.config.ts`）。

设计文档：`docs/superpowers/specs/2026-10-30-top-navigation-design.md`。

## Global Constraints

- 不改接口、权限、CSRF、隐私边界、数据计算、数据库；不改公开页面导航、黄色页头、卡片、移动栏与移动菜单。
- 内部导入用 `#lib/...` 且带 `.ts` 扩展名（`.svelte` 同理写全）；不用 `$lib`、`$app/stores`、`createEventDispatcher`、svelte store。
- 组件用 Svelte 5 runes，props 单次 `$props()` 解构并内联类型，回调命名 `onxxx`。
- 颜色与稳定间距只用 `app.css` 里的语义令牌，新增时扩展令牌，组件里不写死色值。
- 液态玻璃、弹层动效复用 `lib/styles/` 现有实现，不重写材质或动画。
- 保留 `.app-sidebar` 类名与 `id="app-navigation"`。
- 响应式断点（Task 4c 之后断点为 B = 800px，实测见设计文档，手机栏与菜单已统一配色）：<800px 移动菜单；800–1359px 只有图标；≥1360px 图标加文字（入口为 9 个的普通账户在所有桌面宽度都只有图标，`aside[data-dense]`）。
- 页面切换动画的类名 `page-enter-up` / `page-enter-down` 与 `onnav` 方向语义不变，只在 ≥800px 把关键帧改成横向。
- 测试必须真实执行；UI 测试用端口 8291/5291 的临时配置（另一窗口常占 8191/5191），用完删除；不要在开发库做任何写入。
- 不执行 `git commit` / `push` / `merge`，除非用户明确授权。获授权提交时显式列出文件，不用 `git add -A`。每个 Task 末尾的提交步骤只在获授权后执行。
- 验证纪律：报告实际运行的命令与结果，分开写「已运行」与「未运行」。

## 前置条件

当前分支 `fix/chip-fill-from-click` 的工作区里有上一轮「设置按钮移到退出登录旁」的 6 个未提交文件（`app.css`、`AppNavigation.svelte`、`liquid-glass-controls.css`、`liquid-glass-indicator.ts`、`liquid-glass.spec.ts`、`ui-shell.spec.ts`）。本计划在它们的基础上继续，不回退。开始前向用户确认：先把这 6 个文件单独提交，还是并入本次一起提交；并确认在哪个分支上做（建议新分支 `feat/top-navigation`）。

## File Structure

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `frontend/src/lib/components/AnchoredPanel.svelte` | 新建 | 锚定在触发按钮下方的玻璃弹层；`inline` 时退化为普通块（移动菜单用） |
| `frontend/src/lib/components/GoalRing.svelte` | 新建 | 目标完成度进度环（纯展示） |
| `frontend/src/lib/components/AppNavigation.svelte` | 改 | 顶部条结构、进度环弹层、头像菜单 |
| `frontend/src/lib/components/RunningGoal.svelte` | 改 | 新增 `onprogress` 回调，把完成度交给进度环 |
| `frontend/src/app.css` | 改 | 令牌、桌面顶部条样式、三档响应式、横向页面动画 |
| `frontend/src/lib/styles/liquid-glass-indicator.ts` | 改 | `enhanceNavigation` 横向模式、断点重建 |
| `frontend/src/lib/styles/liquid-glass-controls.css` | 改 | 顶部条里滑块的配色与横向样式 |
| `frontend/tests/fixtures/top-navigation.ts` | 新建 | `openGoalPanel`、`openAccountMenu`、`settingsLink` 助手 |
| `frontend/tests/ui/top-navigation.spec.ts` | 新建 | 顶部条的专项 UI 测试 |
| `frontend/playwright.ui.config.ts` | 改 | 把新规格加入 `testMatch` |
| 既有 UI 规格 | 改 | 选择器与目标面板、设置链接的打开步骤 |
| `docs/design-system/*.md`、`docs/NN-top-navigation.md`、`frontend/tests/fixtures/ui-showcase/Showcase.svelte` | 改/新建 | 设计系统文档、展示页、验收记录 |

---

## Phase A：骨架、进度环与响应式

### Task 1: 顶部玻璃条骨架（≥800px）

**Files:**
- Modify: `frontend/src/app.css`（令牌；`.sport-theme` 侧栏规则之后新增桌面块）
- Modify: `frontend/src/lib/components/AppNavigation.svelte`
- Create: `frontend/tests/ui/top-navigation.spec.ts`
- Modify: `frontend/playwright.ui.config.ts`

**Interfaces:**
- Produces: CSS 变量 `--top-navigation-offset`（14px）、`--top-navigation-height`（4rem）、`--z-top-navigation`；桌面下 `.app-sidebar` 是 `position: fixed` 的顶部条；品牌名文字包在 `.brand-name` 里（`.desktop-brand` 内）；导航项带 `title` 与 `aria-label`。
- 本任务里滑块先隐藏、跑量目标暂时 `display: none`（均为临时规则，分别在 Task 3、Task 2 移除；注释里带 `TEMP`）。

- [ ] **Step 1: 写失败的测试**

在 `frontend/playwright.ui.config.ts` 的 `testMatch` 数组末尾追加 `'top-navigation.spec.ts'`。创建 `frontend/tests/ui/top-navigation.spec.ts`：

```ts
import { expect, test, type Page } from '@playwright/test';
import { installActivities, loginRunner } from '../fixtures/activities';

const bar = (page: Page) => page.locator('.app-sidebar');
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('desktop top bar', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await expect(bar(page)).toBeVisible();
  });

  test('navigation floats above the content instead of taking a left column', async ({ page }) => {
    const box = (await bar(page).boundingBox())!;
    expect(box.y).toBeCloseTo(14, 0);
    expect(box.height).toBeCloseTo(64, 0);
    expect(await bar(page).evaluate(el => getComputedStyle(el).position)).toBe('fixed');
    const main = (await page.locator('main').boundingBox())!;
    expect(main.x, 'content starts near the left edge, no sidebar offset').toBeLessThan(100);
    expect(main.y).toBeGreaterThanOrEqual(box.y + box.height);
    await page.evaluate(() => window.scrollTo(0, 600));
    expect((await bar(page).boundingBox())!.y).toBeCloseTo(14, 0);
    await noOverflow(page);
  });

  test('the bar keeps the brand, the navigation links and the account row on one line', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav.getByRole('link', { name: '数据汇总', exact: true })).toHaveAttribute('title', '数据汇总');
    const rects = await page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return { brand: top('.desktop-brand'), nav: top('.app-sidebar nav'), account: top('.nav-account'), bar: top('.app-sidebar') };
    });
    expect(rects.brand.right).toBeLessThanOrEqual(rects.nav.left + 1);
    expect(rects.nav.right).toBeLessThanOrEqual(rects.account.left + 1);
    expect(Math.abs((rects.nav.top + rects.nav.height / 2) - (rects.bar.top + rects.bar.height / 2))).toBeLessThan(2);
  });

  test('the loading bar spans the full width', async ({ page }) => {
    const left = await page.evaluate(() => {
      const probe = document.createElement('div'); probe.className = 'navigation-progress';
      document.querySelector('.app-shell')!.append(probe);
      const value = getComputedStyle(probe).left; probe.remove(); return value;
    });
    expect(left).toBe('0px');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

先写临时配置 `frontend/playwright.tmp-8291.config.ts`（用完删除）：

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', testMatch: ['top-navigation.spec.ts'], workers: 1,
  use: { baseURL: 'http://127.0.0.1:5291', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: 'node tests/fixtures/ui-api.mjs', url: 'http://127.0.0.1:8291/api/health', env: { UI_API_PORT: '8291' }, reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5291', url: 'http://127.0.0.1:5291/admin', env: { INTERNAL_API_BASE_URL: 'http://127.0.0.1:8291' }, reuseExistingServer: false }
  ]
});
```

Run（在 `frontend/`）：`pnpm exec playwright test --config playwright.tmp-8291.config.ts`
Expected: 3 个用例全部 FAIL（`box.y` 是 0、`position` 不是 fixed 之类）。

- [ ] **Step 3: 加令牌与桌面顶部条样式**

在 `frontend/src/app.css` 的 `:root` 令牌区（`--sidebar-width: 15rem;` 附近，先 `grep -n "z-navigation-progress" src/app.css` 找到 z-index 区）追加：

```css
  --top-navigation-offset: 14px;
  --top-navigation-height: 4rem;
  --z-top-navigation: 30;
```

在 `app.css` 里 `.sport-theme .mobile-bar :focus-visible { outline-color: white; }`（约第 422 行）之后、同一个 `@layer components` 内，新增：

```css
  /* Desktop top navigation: the same <aside> becomes a floating glass bar. Below 800px the mobile bar and menu above stay as they were. */
  @media (min-width: 800px) {
    .sport-theme.app-shell .app-sidebar {
      inset: var(--top-navigation-offset) var(--top-navigation-offset) auto; z-index: var(--z-top-navigation);
      width: min(calc(100% - 2 * var(--top-navigation-offset)), var(--content-width)); height: var(--top-navigation-height); margin-inline: auto;
      flex-direction: row; align-items: center; gap: var(--space-4); padding: 0 var(--space-3) 0 var(--space-4); overflow: visible;
      border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--foreground);
      background: color-mix(in srgb, var(--surface) 80%, transparent);
      -webkit-backdrop-filter: blur(24px) saturate(1.6); backdrop-filter: blur(24px) saturate(1.6); box-shadow: var(--shadow-popover);
    }
    @media (prefers-reduced-transparency: reduce) { .sport-theme.app-shell .app-sidebar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; } }
    .sport-theme.app-shell .app-sidebar .brand { color: var(--foreground); }
    .sport-theme.app-shell .app-sidebar .brand-mark { background: var(--sport-sidebar); color: white; }
    .sport-theme.app-shell .sidebar-brand { margin: 0 var(--space-4) 0 0; flex-shrink: 0; }
    .sport-theme.app-shell .nav-caption { display: none; }
    .sport-theme.app-shell .app-sidebar nav { display: flex; flex: 0 1 auto; gap: .15rem; min-width: 0; }
    .sport-theme.app-shell .app-sidebar .nav-link { height: 2.5rem; min-height: 2.5rem; padding: 0 .8rem; gap: .45rem; border-radius: var(--radius-pill); color: var(--muted-foreground); font-size: var(--text-small); white-space: nowrap; }
    @media (hover: hover) { .sport-theme.app-shell .app-sidebar .nav-link:hover { background: var(--muted); } }
    .sport-theme.app-shell .app-sidebar .nav-link[aria-current="page"] { background: var(--sport-nav-active); color: var(--sport-nav-active-ink); }
    .sport-theme.app-shell .app-sidebar :focus-visible, .sport-theme.app-shell .app-sidebar .nav-link:focus-visible { outline-color: var(--ring); outline-offset: 2px; }
    /* TEMP (removed in Task 3): the moving lens is vertical-only until the indicator learns a horizontal axis. */
    .sport-theme.app-shell .app-sidebar nav > :is(.rn-moving-outline, .rn-moving-copy) { display: none; }
    /* TEMP (removed in Task 2): the goal card does not fit the bar until it becomes a ring with a popover. */
    .sport-theme.app-shell .app-sidebar .goal-container { display: none; }
    .sport-theme.app-shell .nav-account { flex-direction: row; align-items: center; gap: var(--space-2); margin: 0 0 0 auto; padding: 0; border: 0; }
    .sport-theme.app-shell .nav-account .button-secondary { color: var(--foreground); border-color: var(--border); }
    .sport-theme.app-shell .nav-account .theme-toggle { width: 2.75rem; padding: 0; }
    .sport-theme.app-shell .nav-account .theme-toggle > span:not(.rn-glass-surface) { display: none; }
    .sport-theme.app-shell .nav-account .runner-identity-text { display: none; }
    .sport-theme.app-shell .nav-account .runner-avatar { width: 2.5rem; height: 2.5rem; }
    .sport-theme.app-shell .nav-account .account-logout { width: 2.75rem; padding: 0; }
    .sport-theme.app-shell .nav-account .account-logout > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .app-shell .content-column { margin-left: 0; padding-top: 5rem; overflow-x: clip; }
    .app-shell .navigation-progress { left: 0; }
  }
  .logout-icon { display: none; }
  @media (min-width: 800px) { .logout-icon { display: block; } }
```

- [ ] **Step 4: 改 `AppNavigation.svelte` 的结构**

1) 导航项加 `title` / `aria-label`：把 `<a href={view.href(item.href)} aria-current=... class="nav-link" onclick=...>` 改为同时带上 `title={item.label} aria-label={item.label}`。

2) 桌面品牌名包一层：把 `...{/if}{site.title}</a>`（`.desktop-brand` 那一行末尾）改成 `...{/if}<span class="brand-name">{site.title}</span></a>`。

3) 退出按钮加图标（桌面只显示图标，文字变成视觉隐藏）。把

```svelte
<button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary account-logout">{busy ? '退出中…' : '退出登录'}</button>
```

改成

```svelte
<button type="button" onclick={onlogout} disabled={busy || !mounted} class="button-secondary account-logout"><svg class="logout-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9" /></svg><span>{busy ? '退出中…' : '退出登录'}</span></button>
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`
Expected: 3 passed。

- [ ] **Step 6: 看一眼真实效果**

Run: 临时 spec 截图（做法同「设置按钮」那轮：用 `installActivities` + `loginRunner`，`page.screenshot` 到 scratchpad，浅色、深色各一张）。核对：Logo、8 个导航项、主题切换、头像、退出、设置在一行；黄色页头不被条遮住；深色下文字可读。

- [ ] **Step 7: 类型检查**

Run: `pnpm check`
Expected: `0 ERRORS 0 WARNINGS`。

- [ ] **Step 8: 提交（仅在用户授权后）**

```bash
git add frontend/src/app.css frontend/src/lib/components/AppNavigation.svelte frontend/tests/ui/top-navigation.spec.ts frontend/playwright.ui.config.ts
git commit -m "feat: 私人页面导航改成顶部悬浮玻璃条（骨架）"
```

---

### Task 2: 进度环与目标弹层（含 `AnchoredPanel`）

**Files:**
- Create: `frontend/src/lib/components/AnchoredPanel.svelte`
- Create: `frontend/src/lib/components/GoalRing.svelte`
- Create: `frontend/tests/fixtures/top-navigation.ts`
- Modify: `frontend/src/lib/components/RunningGoal.svelte`（新增 `onprogress`）
- Modify: `frontend/src/lib/components/AppNavigation.svelte`
- Modify: `frontend/src/app.css`（移除 TEMP 的 `.goal-container` 隐藏规则）
- Modify: `frontend/tests/ui/top-navigation.spec.ts`
- Modify: 依赖跑量目标区域的既有规格（见 Step 8）

**Interfaces:**
- Produces:
  - `AnchoredPanel` props：`{ label: string; panelLabel: string; inline?: boolean; trigger: Snippet; children: Snippet }`；实例方法 `close(): void`。触发按钮 class 为 `button-secondary anchored-trigger`；面板在 `inline` 时是普通块，否则 `popover="auto"` 加 `rn-glass-menu`。
  - `GoalRing` props：`{ progress: number | null }`（0–100；`null` 表示未设目标）。
  - `RunningGoal` 新 prop：`onprogress?: (value: { progress: number | null; period: GoalPeriod; loading: boolean }) => void`。
  - 测试助手 `openGoalPanel(page): Promise<Locator>`（桌面点开弹层并返回 `region` 定位器；移动端直接返回）、`openAccountMenu(page)`、`settingsLink(page)`（Task 5 实现）。
- Consumes: Task 1 的顶部条结构。

- [ ] **Step 1: 写失败的测试**

创建 `frontend/tests/fixtures/top-navigation.ts`：

```ts
import { expect, type Locator, type Page } from '@playwright/test';

/** Desktop: opens the goal popover from the progress ring. Mobile (ring hidden): the goal is already inline in the menu. */
export async function openGoalPanel(page: Page): Promise<Locator> {
  const trigger = page.locator('.app-sidebar .goal-container .anchored-trigger');
  if (await trigger.isVisible()) {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  }
  const region = page.getByRole('region', { name: '跑量目标' });
  await expect(region).toBeVisible();
  return region;
}
```

在 `top-navigation.spec.ts` 末尾追加：

```ts
import { openGoalPanel } from '../fixtures/top-navigation';

test.describe('goal ring', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the ring opens the goal panel, Escape closes it and returns focus to the ring', async ({ page }) => {
    const ring = page.locator('.goal-container .anchored-trigger');
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAccessibleName(/跑量目标/);
    await expect(page.getByRole('region', { name: '跑量目标' })).toBeHidden();
    const goal = await openGoalPanel(page);
    await expect(ring).toHaveAttribute('aria-expanded', 'true');
    await expect(goal.getByLabel('目标周期', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(goal).toBeHidden();
    await expect(ring).toBeFocused();
  });

  test('the goal draft survives navigation and the period select works inside the panel', async ({ page }) => {
    let goal = await openGoalPanel(page);
    await goal.getByRole('button', { name: '设置', exact: true }).click();
    await goal.getByLabel('目标距离（km）', { exact: true }).fill('42');
    await page.getByRole('navigation', { name: '主要导航' }).getByRole('link', { name: '跑步记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    goal = await openGoalPanel(page);
    await expect(goal.getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
    await goal.getByLabel('目标周期', { exact: true }).click();
    await page.getByRole('option', { name: '每月' }).click();
    await expect(goal.getByLabel('目标周期', { exact: true })).toHaveValue('month');
  });
});

test('on a phone the goal stays inline in the menu and the ring is hidden', async ({ page }) => {
  await installActivities(page); await loginRunner(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard');
  await expect(page.locator('.goal-container .anchored-trigger')).toBeHidden();
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.getByRole('region', { name: '跑量目标' })).toBeVisible();
});
```

> 周期下拉选项的定位器 `getByRole('option', { name: '每月' })` 取决于玻璃下拉（`liquid-glass-select.ts`）渲染的角色；如果失败，读 `liquid-glass-select.ts` 里选项的 `role` 后改成对应定位器，不要放宽断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "goal"`
Expected: FAIL（找不到 `.anchored-trigger`）。

- [ ] **Step 3: 新建 `GoalRing.svelte`**

```svelte
<script lang="ts">
  let { progress }: { progress: number | null } = $props();
  const radius = 15, circumference = 2 * Math.PI * radius;
  const filled = $derived(progress === null ? 0 : circumference * Math.min(100, Math.max(0, progress)) / 100);
</script>
<svg viewBox="0 0 36 36" width="28" height="28" aria-hidden="true">
  <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="3.5" stroke-dasharray={progress === null ? '3 4' : undefined} />
  {#if progress === null}
    <path d="M18 12v12M12 18h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  {:else}
    <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-dasharray={`${filled} ${circumference}`} transform="rotate(-90 18 18)" />
  {/if}
</svg>
```

- [ ] **Step 4: 新建 `AnchoredPanel.svelte`**

```svelte
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { glassOptics, readGlassSettings, watchGlassSettings } from '#lib/styles/liquid-glass-settings.ts';
  import { preparePopoverMotion, positionPopoverMotion } from '#lib/styles/popover-motion.ts';
  import { bindVisualViewport, popoverSupported, visualViewportBox } from '#lib/styles/browser-support.ts';
  import { attachMenuGlass } from '#lib/styles/menu-glass.ts';
  let { label, panelLabel, inline = false, trigger, children }: { label: string; panelLabel: string; inline?: boolean; trigger: Snippet; children: Snippet } = $props();
  const id = $props.id();
  let panel: HTMLDivElement, anchor: HTMLDivElement;
  let expanded = $state(false), top = $state(0), right = $state(0);
  export function close() { if (panel?.matches(':popover-open')) panel.hidePopover(); }
  function position() {
    if (inline || !panel?.matches(':popover-open')) return;
    // Measure the stable wrapper, never the spring-animated trigger button.
    const box = anchor.getBoundingClientRect();
    const view = visualViewportBox();
    const height = panel.offsetHeight || 280;
    const desired = box.bottom + 8 + height <= view.top + view.height - 12 ? box.bottom + 8 : box.top - 8 - height;
    top = Math.max(view.top + 12, Math.min(desired, view.top + view.height - height - 12));
    const width = panel.offsetWidth;
    const left = view.left + Math.max(12, Math.min(box.right - view.left - width, view.width - width - 12));
    right = window.innerWidth - (left + width);
    positionPopoverMotion(panel, box, { left, top });
  }
  function glass(node: HTMLDivElement) {
    let surface: ReturnType<typeof attachMenuGlass> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settings = readGlassSettings();
    const release = () => { surface?.destroy(); surface = undefined; };
    const stop = watchGlassSettings(value => { settings = value; surface?.update({ ...glassOptics(value, .7), chroma: 0 }); });
    const toggled = (event: Event) => {
      clearTimeout(timer);
      expanded = (event as ToggleEvent).newState === 'open';
      if (!expanded) { timer = setTimeout(release, 240); return; }
      position();
      surface ??= attachMenuGlass(node, settings);
    };
    node.addEventListener('toggle', toggled);
    return { destroy() { clearTimeout(timer); stop(); node.removeEventListener('toggle', toggled); release(); } };
  }
  function toggle(event: MouseEvent) {
    event.preventDefault();
    if (!popoverSupported() || typeof panel.togglePopover !== 'function') return;
    if (!panel.matches(':popover-open')) preparePopoverMotion(panel);
    panel.togglePopover();
    if (panel.matches(':popover-open')) position();
  }
  onMount(() => bindVisualViewport(position));
</script>
<svelte:window onresize={position} onscroll={position} />
<div class="anchored" class:inline data-glass-stable>
  <div bind:this={anchor} class="anchored-anchor">
    <button type="button" popovertarget={id} aria-label={label} aria-expanded={expanded} aria-controls={id} class="button-secondary anchored-trigger" title={label} onclick={toggle}>{@render trigger()}</button>
  </div>
  <div bind:this={panel} use:glass {id} popover={inline ? undefined : 'auto'} class="anchored-panel" class:rn-glass-menu={!inline}
    role={inline ? undefined : 'group'} aria-label={inline ? undefined : panelLabel} style:top={inline ? undefined : `${top}px`} style:right={inline ? undefined : `${right}px`}>
    {@render children()}
  </div>
</div>
<style>
  .anchored-anchor { display: inline-flex; }
  .anchored.inline .anchored-anchor { display: none; }
  .anchored-trigger { width: 2.75rem; height: 2.75rem; padding: 0; border-radius: var(--radius-pill); }
  .anchored-panel { width: 20rem; max-width: calc(100vw - var(--space-8)); max-height: calc(100dvh - var(--space-6)); }
  .anchored.inline .anchored-panel { width: auto; max-width: none; max-height: none; }
</style>
```

- [ ] **Step 5: `RunningGoal.svelte` 增加 `onprogress`**

把 props 行改为：

```ts
  let { user, readonly = false, onprogress }: { user: ShowcaseProfile; readonly?: boolean; onprogress?: (value: { progress: number | null; period: GoalPeriod; loading: boolean }) => void } = $props();
```

在 `let progress = $derived(...)` 那行之后新增：

```ts
  $effect(() => { onprogress?.({ progress: target !== null && distance !== null ? progress : null, period, loading: loading || goalLoading }); });
```

- [ ] **Step 6: `AppNavigation.svelte` 接入进度环**

脚本区，在 `import ThemeToggle ...` 之后加：

```ts
  import AnchoredPanel from './AnchoredPanel.svelte';
  import GoalRing from './GoalRing.svelte';
```

在 `let toggle: HTMLButtonElement;` 之后加：

```ts
  let goal = $state<{ progress: number | null; period: 'week' | 'month' | 'year'; loading: boolean }>({ progress: null, period: 'week', loading: true });
  const periodLabel = { week: '本周', month: '本月', year: '今年' };
  const goalLabel = $derived(goal.loading ? '跑量目标' : goal.progress === null ? '跑量目标，未设置' : `跑量目标，${periodLabel[goal.period]}已完成 ${Math.round(goal.progress)}%`);
```

把原来的 goal 容器那一行

```svelte
{#if sports && mounted && profile && !identityBlocked}<div class="goal-container" hidden={checking && !!user} inert={checking && !!user}>{#key context.prefix}<RunningGoal user={profile} readonly={!view.manage} />{/key}</div>{/if}
```

改成，并移到 `.appearance-row` 之前（让桌面顺序是 进度环 → 主题切换 → 头像；移动菜单里仍是 主题切换 在前，所以保持 DOM 顺序不变，用 CSS `order` 调整桌面顺序，见 Step 7）：

```svelte
{#if sports && mounted && profile && !identityBlocked}<div class="goal-container" hidden={checking && !!user} inert={checking && !!user}>
  <AnchoredPanel label={goalLabel} panelLabel="跑量目标面板" inline={mobile}>
    {#snippet trigger()}<GoalRing progress={goal.progress} />{/snippet}
    {#key context.prefix}<RunningGoal user={profile} readonly={!view.manage} onprogress={(value) => { goal = value; }} />{/key}
  </AnchoredPanel>
</div>{/if}
```

- [ ] **Step 7: CSS：移除 TEMP 的目标隐藏规则并排序**

在 `app.css` 桌面块里删除 `/* TEMP (removed in Task 2) ... */` 那条与 `.goal-container { display: none; }`，换成：

```css
    .sport-theme.app-shell .nav-account .goal-container { order: -1; }
    .sport-theme.app-shell .nav-account .goal-container .anchored-trigger { color: var(--primary); }
```

- [ ] **Step 8: 更新依赖跑量目标区域的既有规格**

规则：桌面宽度下，凡是通过 `page.getByRole('region', { name: '跑量目标' })` 或 `.goal-*` 操作目标面板的用例，先 `import { openGoalPanel } from '../fixtures/top-navigation'`，用 `const goal = await openGoalPanel(page)` 取代原来的 `page.getByRole('region', { name: '跑量目标' })`；点到面板外（导航、点页面）会让弹层关闭，后续再断言面板内容前要重新 `await openGoalPanel(page)`。

先列出受影响用例：`grep -n "跑量目标\|goal-km\|goal-edit\|goal-period\|running-goal" tests/ui/*.ts`（预期涉及 `activities`、`admin-users`、`crossbrowser-glass`、`milestones`、`ui-shell`、`sport-detail`、`liquid-glass`）。逐个规格运行并修复：

```bash
pnpm exec playwright test --config <含该规格的配置> tests/ui/<spec>.ts
```

示例（`ui-shell.spec.ts`「private navigation preserves sidebar drafts…」）：

```ts
const goal = await openGoalPanel(page);
await goal.getByRole('button', { name: '设置', exact: true }).click();
await goal.getByLabel('目标距离（km）', { exact: true }).fill('42');
// … 导航与其它断言 …
await expect((await openGoalPanel(page)).getByLabel('目标距离（km）', { exact: true })).toHaveValue('42');
```

`ui-shell.spec.ts` 里「unified sports shell」每个路由的 `await expect(page.getByRole('region',{name:'跑量目标'})).toBeVisible()` 改为 `await openGoalPanel(page)`；`admin-users.spec.ts` 里 `toContainText('37 km')` 这类不要求可见的断言不需要改。`liquid-glass.spec.ts` 的 `page.locator('.app-sidebar select').first()` 需要先 `await openGoalPanel(page)`。

- [ ] **Step 9: 运行测试**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`（临时配置的 `testMatch` 先加上 `'ui-shell.spec.ts', 'milestones.spec.ts', 'activities.spec.ts', 'sport-detail.spec.ts', 'liquid-glass.spec.ts', 'crossbrowser-glass.spec.ts'`）。
Expected: 全部通过。`seo-routes` 与 `dashboard-explorer` 的已知端口/抖动问题不属于本任务。

- [ ] **Step 10: 视觉检查与类型检查**

截图确认：进度环（有目标、无目标两种）、弹层位置在环正下方且右对齐、浅/深色；`pnpm check` 为 0 错误。

- [ ] **Step 11: 提交（仅在用户授权后）**

```bash
git add frontend/src/lib/components/AnchoredPanel.svelte frontend/src/lib/components/GoalRing.svelte frontend/src/lib/components/RunningGoal.svelte frontend/src/lib/components/AppNavigation.svelte frontend/src/app.css frontend/tests/fixtures/top-navigation.ts frontend/tests/ui
git commit -m "feat: 跑量目标变成顶部条进度环加弹层，新增 AnchoredPanel"
```

---

### Task 3: 横向导航滑块

**Files:**
- Modify: `frontend/src/lib/styles/liquid-glass-indicator.ts`（`enhanceNavigation`、`build`）
- Modify: `frontend/src/lib/styles/liquid-glass-controls.css`
- Modify: `frontend/src/app.css`（移除 TEMP 的滑块隐藏规则）
- Modify: `frontend/tests/ui/top-navigation.spec.ts`、`frontend/tests/ui/liquid-glass.spec.ts`、`frontend/tests/ui/crossbrowser-glass.spec.ts`

**Interfaces:**
- Consumes: `createIndicator(host, items, initial, axis = 'y', start = 0)`（已支持 `'x'`）。
- Produces: `enhanceNavigation(nav, settings)` 在 ≥800px 用横向，其余纵向；导航元素带 `data-axis="x" | "y"`；跨 800px / 1360px 断点销毁重建。

- [ ] **Step 1: 写失败的测试**

在 `top-navigation.spec.ts` 追加：

```ts
test.describe('horizontal lens', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the lens sits under the current link and follows hover along the x axis', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await expect(nav).toHaveAttribute('data-axis', 'x');
    const outline = nav.locator('.rn-moving-outline');
    const current = nav.getByRole('link', { name: '数据汇总', exact: true });
    const other = nav.getByRole('link', { name: '个人足迹', exact: true });
    const x = () => outline.evaluate(el => el.getBoundingClientRect().x);
    await expect.poll(x).toBeCloseTo((await current.boundingBox())!.x, 0);
    await other.hover();
    await expect.poll(x).toBeCloseTo((await other.boundingBox())!.x, 0);
    await page.getByRole('heading', { level: 1 }).hover();
    await expect.poll(x).toBeCloseTo((await current.boundingBox())!.x, 0);
  });

  test('the lens is hidden on a page that has no navigation link', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('navigation', { name: '主要导航' })).toHaveAttribute('data-idle', '');
  });

  test('crossing the desktop breakpoint rebuilds the lens on the other axis', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开导航' }).click();
    await expect(nav).toHaveAttribute('data-axis', 'y');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(nav).toHaveAttribute('data-axis', 'x');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "horizontal lens"`
Expected: FAIL（没有 `data-axis`）。

- [ ] **Step 3: 改 `enhanceNavigation` 与 `build`**

把 `liquid-glass-indicator.ts` 里的 `enhanceNavigation` 整个函数替换为：

```ts
export function enhanceNavigation(nav: HTMLElement, settings: GlassSettings) {
  const read = () => [...nav.querySelectorAll<HTMLAnchorElement>(':scope > .nav-link')];
  // Desktop (>=800px) lays the links out in a row; the mobile menu keeps the column. The icon-only step at 1360px changes link widths too.
  const queries = [matchMedia('(min-width: 800px)'), matchMedia('(min-width: 1360px)')];
  const axis = () => (queries[0].matches ? 'x' : 'y');
  let current = settings, links = read(), stop = build(nav, links, settings, axis()), alive = true, frame = 0;
  // Links appear after the session resolves (e.g. the admin entry), so a stale link list must be rebuilt.
  const sameLinks = () => { const next = read(); return next.length === links.length && next.every((link, i) => link === links[i]); };
  const rebuild = () => { stop.destroy(); links = read(); stop = build(nav, links, current, axis()); };
  const onQuery = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (alive) rebuild(); }); };
  queries.forEach(query => query.addEventListener('change', onQuery));
  return { update(next: GlassSettings) {
    current = next;
    if (sameLinks()) { stop.update(next); return; }
    rebuild();
  }, destroy() { alive = false; cancelAnimationFrame(frame); queries.forEach(query => query.removeEventListener('change', onQuery)); stop.destroy(); } };
}
```

把 `function build(nav, links, settings)` 的签名与第一行改为：

```ts
function build(nav: HTMLElement, links: HTMLAnchorElement[], settings: GlassSettings, axis: 'x' | 'y') {
  const indicator = createIndicator(nav, links, settings, axis);
  nav.classList.add('rn-liquid-navigation'); nav.dataset.axis = axis;
```

并在 `build` 返回对象的 `destroy` 里 `nav.removeAttribute('data-idle');` 之后追加 `nav.removeAttribute('data-axis');`。

- [ ] **Step 4: 样式：配色与横向**

移除 `app.css` 桌面块里 `/* TEMP (removed in Task 3) ... */` 及其下一条 `nav > :is(.rn-moving-outline, .rn-moving-copy) { display: none; }`。

在 `liquid-glass-controls.css` 末尾追加：

```css
/* Top navigation: the lens runs along x on a light glass bar instead of the old green column. */
@media (min-width: 800px) {
  .sport-theme.app-shell .app-sidebar nav.rn-liquid-navigation > .rn-moving-copy { color: var(--sport-nav-active-ink); background: color-mix(in srgb, var(--sport-nav-active) calc((.75 + var(--glass-opacity) * .25) * 100%), var(--surface)); }
  .sport-theme.app-shell .app-sidebar .rn-liquid-navigation .nav-link[aria-current="page"], .sport-theme.app-shell .app-sidebar .rn-liquid-navigation .nav-link { color: var(--muted-foreground); }
  .sport-theme.app-shell .app-sidebar .rn-liquid-navigation .nav-link[aria-current="page"] { color: var(--sport-nav-active-ink); background: transparent; }
}
```

- [ ] **Step 5: 更新受影响的既有测试**

`liquid-glass.spec.ts`「liquid navigation follows hover…」里比较的是 `getBoundingClientRect().y`，桌面现在沿 x 轴，改为比较 `.x`：把 `position = () => indicator.evaluate(el => el.getBoundingClientRect().y)` 和三处 `boundingBox())!.y` 换成 `.x`。`crossbrowser-glass.spec.ts:59` 的 `.app-sidebar nav .rn-moving-copy` 保持可用，若按 y 断言则同样改成 x。

- [ ] **Step 6: 运行测试与视觉检查**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`（`testMatch` 含 `top-navigation`、`liquid-glass`、`crossbrowser-glass`、`ui-shell`）。
Expected: 全部通过。截图确认浅色/深色下滑块胶囊在当前项下，文字可读，悬停时滑块跟随。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add frontend/src/lib/styles/liquid-glass-indicator.ts frontend/src/lib/styles/liquid-glass-controls.css frontend/src/app.css frontend/tests/ui
git commit -m "feat: 导航滑块支持横向，顶部条里沿 x 轴移动"
```

---

### Task 4: 图标版（800–1359px）与左右页面动画

**Files:**
- Modify: `frontend/src/app.css`
- Modify: `frontend/tests/ui/top-navigation.spec.ts`
- Modify: `frontend/tests/ui/ui-shell.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `.brand-name`、导航项 `title` / `aria-label`；Task 3 的断点重建。
- Produces: 800–1359px 下导航项只显示图标；≥800px 下 `page-enter-up` / `page-enter-down` 关键帧改为横向。

- [ ] **Step 1: 写失败的测试**

在 `top-navigation.spec.ts` 追加：

```ts
test.describe('responsive steps', () => {
  for (const [width, labelled] of [[1440, true], [1360, true], [1359, false], [1280, false], [1100, false], [1024, false]] as const) {
    test(`${width}px: links ${labelled ? 'show' : 'hide'} their text and the last link stays clear of the account row`, async ({ page }) => {
      await installActivities(page); await loginRunner(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      const nav = page.getByRole('navigation', { name: '主要导航' });
      const link = nav.getByRole('link', { name: '数据汇总', exact: true });
      const text = link.locator('span').first();
      if (labelled) await expect(text).toBeVisible(); else await expect(text).toBeHidden();
      await expect(link).toHaveAttribute('title', '数据汇总');
      const metrics = await bar(page).evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }));
      expect(metrics.scroll, 'bar content fits').toBeLessThanOrEqual(metrics.client);
      expect(metrics.height).toBeCloseTo(64, 0);
      await noOverflow(page);
    });
  }
});

test.describe('horizontal page transition', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });
  const firstTransform = (page: Page) => page.locator('.page-reveal').evaluate(el => (el.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]?.transform ?? '');

  test('moving down the menu enters from the right, moving up enters from the left', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: '主要导航' });
    await nav.getByRole('link', { name: '跑步记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '跑步记录', exact: true })).toBeVisible();
    await expect.poll(() => firstTransform(page)).toContain('translate3d(24px');
    await nav.getByRole('link', { name: '数据汇总', exact: true }).click();
    await expect(page.getByRole('heading', { name: '数据汇总', exact: true })).toBeVisible();
    await expect.poll(() => firstTransform(page)).toContain('translate3d(-24px');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "responsive steps|horizontal page"`
Expected: 1359/1280/1100/1024 与动画用例 FAIL。

- [ ] **Step 3: 图标版样式**

在 `app.css` 桌面块之后追加：

```css
  /* 800-1359px: icon-only links. Text is removed from layout, so the accessible name comes from aria-label/title. */
  @media (min-width: 800px) and (max-width: 1359px) {
    .sport-theme.app-shell .app-sidebar nav .nav-link { padding-inline: .7rem; }
    .sport-theme.app-shell .app-sidebar nav .nav-link > span, .sport-theme.app-shell .app-sidebar nav .rn-moving-label > span { display: none; }
    .sport-theme.app-shell .desktop-brand .brand-name { display: none; }
  }
```

- [ ] **Step 4: 横向页面关键帧**

在 `app.css` 里 `@keyframes page-enter-down { ... }`（约第 234 行）之后追加（同名关键帧在媒体查询里重新定义，后者生效，所以类名与既有测试不用改）：

```css
  @media (min-width: 800px) {
    @keyframes page-enter-up { from { transform: translate3d(1.5rem, 0, 0); } to { transform: translate3d(0, 0, 0); } }
    @keyframes page-enter-down { from { transform: translate3d(-1.5rem, 0, 0); } to { transform: translate3d(0, 0, 0); } }
  }
```

- [ ] **Step 4b: 更新 `ui-shell.spec.ts` 里依赖侧栏纵向间距的用例**

`ui-shell.spec.ts` 里「logo/caption gap」那个用例（约第 286–300 行，对 `.desktop-brand`、`.nav-caption`、`.app-sidebar nav` 做纵向间距断言，并要求 caption 不是 `none`）整个替换为：

```ts
  await page.goto('/');
  for (const height of [1080, 900, 768, 720]) {
    await page.setViewportSize({ width: 1440, height });
    const box = await page.locator('.app-sidebar').boundingBox();
    expect(box!.height, `bar height at ${height}`).toBeCloseTo(64, 0);
    expect(box!.y, `bar offset at ${height}`).toBeCloseTo(14, 0);
  }
```

同一用例所在的 `test(...)` 标题里的「logo/caption」字样改成「top bar keeps its size at every desktop height」。

- [ ] **Step 5: 运行测试**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`（`testMatch` 含 `top-navigation`、`ui-shell`、`liquid-glass`、`crossbrowser-glass`、`milestones`、`activities`、`sport-detail`）。
Expected: 全部通过。如果 1280px 的 `scroll <= client` 失败，说明 8 个入口加账户区放不下：把图标版阈值上调到 `1319px`，同步修改 `enhanceNavigation` 里的 `(min-width: 1280px)`、本任务测试里的 1280/1279 取值与设计文档，再重跑。

> 修订：普通账户的第 9 个入口「本人工作区」使带文字的顶部条在任何宽度都放不下，因此 `AppNavigation` 在入口多于 8 个时给 `aside` 加 `data-dense`，≥1360px 的图标版样式（链接文字隐藏、`padding-inline: .7rem`）对它同样生效；测试见 `top-navigation.spec.ts` 的「nine links」用例。

> 实施结果（2026-10-30）：1280px 的 `scroll <= client` 断言并不会失败（溢出的链接盖在账户区上，不增加 scrollWidth），但链接与账户区的几何检查在 1280–1339px 失败，所以实际阈值取 1360px / 1359px，而不是 1320px / 1319px（1320 时仍有 4px 重叠）。

- [ ] **Step 6: 视觉检查**

1440、1360、1100、1024 四个宽度的浅/深色截图，核对图标版的滑块位置、图标对齐、品牌只剩 Logo。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add frontend/src/app.css frontend/tests/ui
git commit -m "feat: 顶部导航图标版与左右页面切换动画"
```

---

### Task 4b: 悬浮在内容上方时更透明（对齐身心健康保存栏）

用户在 Task 3 之后追加的需求：顶部条悬浮在别的组件上方时透明度要更高，和身心健康里的「保存」栏（`SaveBar.svelte` 的 `glass` 模式）一致。

**设计（照搬 `SaveBar` 的两态）：**
- **docked**：页面内容还没有滑到条下面时，是不透明的 `var(--surface)` 卡片，无模糊、无浮起阴影。
- **floating**：页面内容在条下面经过时，用项目的玻璃面板配方：`border-color: var(--glass-edge)`，`background: color-mix(in srgb, var(--glass-fill-base, var(--surface)) calc(var(--glass-opacity, .12) * 100% * .75), transparent)`（默认 .12 时约 9%，比保存栏更透明，对照 Apple Liquid Glass 演示；玻璃调节器仍可调），`box-shadow: inset 0 1px var(--glass-sheen), 0 .5rem 1.5rem var(--glass-shadow)`，并通过 `attachMenuGlass` 做折射（`glassOptics(settings, 1)` 加 `chroma: 0`，与玻璃按钮同一套光学，模糊取玻璃设置，默认 2）。导航文字与品牌名**不加**光晕或文字阴影（会在字形边缘留白边，用户明确不要）；测试断言悬浮时这些文字的 `text-shadow` 为 `none`。悬浮时未选中的导航文字与图标用 `var(--foreground)`（docked 仍为 `--muted-foreground`；规则写在未分层的 `liquid-glass-controls.css` 里才压得过那里的灰色规则，`app-sidebar[data-floating] .rn-liquid-navigation .nav-link:not([aria-current="page"])`，`app.css` 里为无滑块回退再放一条同样的规则），测试在两种明暗外观下断言两态的计算颜色。
- WebKit 无法折射，`attachFloatingGlass` 的 WebKit 分支只加类 `rn-frosted-glass`（不调用 `attachMenuGlass`，所以没有行内 `backdrop-filter: none`），样式由 `app.css` 决定：`backdrop-filter: blur(14px) saturate(1.5)` 加约 60% 的 `--surface` 底色（`.5 + --glass-opacity × .8`），亮边与较轻阴影沿用；这取代了最初的 `.rn-static-glass` 静态边缘（它在 WebKit 里约 91% 不透明，会让下面未模糊的内容像重影一样透出来）。Safari 比 Chromium 不够清透，用户已接受。`prefers-reduced-transparency: reduce` 与 `forced-colors: active` 保持 docked 的实心卡片，不挂折射。
- 仅桌面（≥800px）；移动栏与移动菜单不变（Task 4c 之后配色统一）；弹层（目标面板、之后的头像菜单）本来就是玻璃，不动。

**Files:**
- Modify: `frontend/src/lib/styles/menu-glass.ts`（新增 `attachFloatingGlass`）
- Modify: `frontend/src/lib/components/AppNavigation.svelte`
- Modify: `frontend/src/app.css`（桌面块里的底色/阴影/模糊规则）
- Modify: `frontend/tests/ui/top-navigation.spec.ts`，以及因条的底色随滚动变化而需要调整的既有断言（如 `sport-detail.spec.ts` 里对比导航条背景色的用例、`ui-shell.spec.ts` 里对条背景的断言；保持它们的原意，不放宽）
- 不改 `SaveBar.svelte`（共用 helper 的重构是后续事项，在 Task 6 的验收记录里记一笔）

**Interfaces:**
- Produces: `attachFloatingGlass(node: HTMLElement): () => void`（在 `menu-glass.ts`；尊重 `prefers-reduced-transparency` 与 `forced-colors`，返回清理函数）；`.app-sidebar[data-floating]`（桌面且内容在条下方时存在）。
- Consumes: `attachMenuGlass`、`glassOptics`、`readGlassSettings`、`watchGlassSettings`（已有）。

- [ ] **Step 1: 写失败的测试**

在 `top-navigation.spec.ts` 追加（用 `installActivities` + `loginRunner`，1440x900，打开 `/dashboard`；页面要足够长，必要时先 `page.evaluate` 滚动）：

```ts
test.describe('floating glass state', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
    await expect(bar(page)).toBeVisible();
  });
  const alpha = (page: Page) => bar(page).evaluate(el => {
    const value = getComputedStyle(el).backgroundColor;
    const match = value.match(/\/\s*([\d.]+)\s*\)|rgba\([^)]*,\s*([\d.]+)\)/);
    return match ? Number(match[1] ?? match[2]) : 1;
  });

  test('at the top, with nothing under it, the bar is a solid card', async ({ page }) => {
    await expect(bar(page)).not.toHaveAttribute('data-floating');
    expect(await alpha(page)).toBe(1);
  });

  test('content scrolling under the bar makes it clear glass, and it settles back at the top', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).toHaveAttribute('data-floating', '');
    await expect.poll(() => alpha(page)).toBeLessThanOrEqual(0.2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar(page)).not.toHaveAttribute('data-floating');
    await expect.poll(() => alpha(page)).toBe(1);
  });

  test('forced colors keep the solid card and attach no refraction', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).toHaveAttribute('data-floating', '');
    expect(await bar(page).evaluate(el => el.style.backdropFilter || el.style.getPropertyValue('-webkit-backdrop-filter'))).toBe('');
  });

  test('the phone menu is not affected', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar(page)).not.toHaveAttribute('data-floating');
  });
});
```

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "floating glass"`
Expected: FAIL（没有 `data-floating`）。

- [ ] **Step 2: 新增 `attachFloatingGlass`**

在 `menu-glass.ts` 末尾追加（并补 `readGlassSettings`、`watchGlassSettings` 的导入）：

```ts
/** Floating chrome (the top navigation): the same refracting optics as the glass buttons. Solid in reduced-transparency and forced-colors. WebKit cannot refract: it only gets the `rn-frosted-glass` class (frosted glass, see app.css). */
export function attachFloatingGlass(node: HTMLElement): () => void {
  if (matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(forced-colors: active)').matches) return () => {};
  if (engine === 'webkit') {
    node.classList.add('rn-frosted-glass');
    return () => node.classList.remove('rn-frosted-glass');
  }
  const optics = (value: GlassSettings) => ({ ...glassOptics(value, 1), chroma: 0 });
  const initial = readGlassSettings();
  const handle = attachMenuGlass(node, initial);
  handle.update(optics(initial));
  const stop = watchGlassSettings(value => handle.update(optics(value)));
  return () => { stop(); handle.destroy(); };
}
```

- [ ] **Step 3: `AppNavigation.svelte` 判断悬浮并挂玻璃**

给 `<aside>` 加 `bind:this={sidebar}` 与 `data-floating={floating ? '' : undefined}`；脚本区新增：

```ts
  import { attachFloatingGlass } from '#lib/styles/menu-glass.ts';
  let sidebar = $state<HTMLElement | undefined>(), floating = $state(false);
  // Floating exactly while page content extends under the bar: the first content row (below #main's top padding) has reached the bar's bottom edge.
  $effect(() => {
    if (mobile || !sidebar) { floating = false; return; }
    const main = document.getElementById('main');
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!main || !sidebar) return;
      const contentTop = main.getBoundingClientRect().top + (parseFloat(getComputedStyle(main).paddingTop) || 0);
      floating = contentTop < sidebar.getBoundingClientRect().bottom;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    measure();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  });
  $effect(() => { if (!floating || mobile || !sidebar) return; return attachFloatingGlass(sidebar); });
```

（`$effect` 里直接 `return attachFloatingGlass(...)`，它返回的清理函数会在 `floating` 变回 false 或卸载时调用。）

- [ ] **Step 4: CSS 两态**

在 `app.css` 桌面块里把 `.sport-theme.app-shell .app-sidebar` 现有的 `background`（80% 混合）、`-webkit-backdrop-filter` / `backdrop-filter` 与 `box-shadow: var(--shadow-popover)` 改为 docked 态，并新增 floating 态（紧跟其后；注意放在 `prefers-reduced-transparency` 规则之前，让后者仍能强制实心）：

```css
    /* Docked: nothing under the bar, so a plain card. Floating (data-floating): clear liquid glass, the same recipe as the wellbeing save bar. */
    .sport-theme.app-shell .app-sidebar { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none; transition: background-color var(--transition-control), border-color var(--transition-control), box-shadow var(--transition-control); }
    .sport-theme.app-shell .app-sidebar[data-floating] { border-color: var(--glass-edge); background: color-mix(in srgb, var(--glass-fill-base, var(--surface)) calc(var(--glass-opacity, .12) * 100% * .75), transparent); box-shadow: inset 0 1px var(--glass-sheen), 0 .5rem 1.5rem var(--glass-shadow); }
    .sport-theme.app-shell .app-sidebar[data-floating].rn-frosted-glass { -webkit-backdrop-filter: blur(14px) saturate(1.5); backdrop-filter: blur(14px) saturate(1.5); background: color-mix(in srgb, var(--surface) calc((.5 + var(--glass-opacity, .12) * .8) * 100%), transparent); }
    @media (prefers-reduced-transparency: reduce), (forced-colors: active) { .sport-theme.app-shell .app-sidebar[data-floating], .sport-theme.app-shell .app-sidebar[data-floating].rn-frosted-glass { background: var(--surface); border-color: var(--border); box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; } }
```

删除 Task 1 里那条单独的 `@media (prefers-reduced-transparency: reduce) { .sport-theme.app-shell .app-sidebar { background: var(--surface); ... } }`（上面最后一行已经覆盖）。

- [ ] **Step 5: 运行测试与视觉检查**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`（含 `top-navigation`、`ui-shell`、`sport-detail`、`liquid-glass`、`crossbrowser-glass`、`dashboard`、`records`、`milestones`、`activities`、`admin-users`）。既有断言里依赖「条的背景色固定」的要保持原意改写（例如改成在同一滚动位置下比较）。
Expected: 全部通过。截图（用临时 spec，浅/深色各两张：顶部 docked、滚动后 floating，滚动位置要让黄色页头或卡片从条下面经过）确认：玻璃下能透出内容并有折射，导航文字可读，当前项滑块仍清楚，WebKit 路径不在本地验证时在报告里写明未验证。

- [ ] **Step 6: 类型检查与收尾**

Run: `pnpm check`，期望 0 错误。不提交（仅在用户授权后：`git add frontend/src/lib/styles/menu-glass.ts frontend/src/lib/components/AppNavigation.svelte frontend/src/app.css frontend/tests/ui`）。

### Phase A 验收检查点

- [ ] 运行：`pnpm check`、`pnpm test`、`pnpm build`，以及包含 `top-navigation`、`ui-shell`、`liquid-glass`、`crossbrowser-glass`、`milestones`、`activities`、`sport-detail`、`site-settings`、`admin-users`、`theme`、`wellbeing`、`footprints` 的各 Playwright 配置（用 `grep -l "<spec>" playwright.*.ts` 找配置；端口冲突时用临时配置）。
- [ ] 报告实际结果；有失败时先判断是本次改动引起还是已知抖动（见记忆「UI test port clash」的 `seo-routes`、`dashboard-explorer`），不要放宽断言。
- [ ] 把浅/深色、1440/1280/1100/1024/361 的截图给用户看，得到确认后进入 Phase B。

---

## Phase B：头像菜单与文档

### Task 5: 头像菜单

**Files:**
- Modify: `frontend/src/lib/components/AppNavigation.svelte`
- Modify: `frontend/src/app.css`
- Modify: `frontend/tests/fixtures/top-navigation.ts`
- Modify: `frontend/tests/ui/top-navigation.spec.ts`
- Modify: 引用 `.nav-account` 里设置链接或退出按钮的既有规格

**Interfaces:**
- Consumes: Task 2 的 `AnchoredPanel`（`close()`、`inline`）。
- Produces: 桌面头像菜单（触发按钮 `aria-label="账户菜单"`，菜单项是 `a.rn-menu-option`「设置」与 `button.rn-menu-option`「退出登录」）；移动菜单保留原有内联版本；助手 `openAccountMenu(page)`、`settingsLink(page)`。

- [ ] **Step 1: 写失败的测试和助手**

在 `tests/fixtures/top-navigation.ts` 追加：

```ts
/** Desktop: opens the avatar menu. Mobile: the inline account block is already in the opened menu. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const trigger = page.locator('.account-menu-host .anchored-trigger');
  if (await trigger.isVisible()) {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    const menu = page.getByRole('group', { name: '账户' });
    await expect(menu).toBeVisible();
    return menu;
  }
  return page.locator('.account-inline');
}
export async function settingsLink(page: Page): Promise<Locator> {
  return (await openAccountMenu(page)).getByRole('link', { name: '设置', exact: true });
}
```

在 `top-navigation.spec.ts` 追加：

```ts
import { openAccountMenu, settingsLink } from '../fixtures/top-navigation';

test.describe('account menu', () => {
  test.beforeEach(async ({ page }) => {
    await installActivities(page); await loginRunner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');
  });

  test('the avatar opens a menu with the name, settings and logout; Escape returns focus', async ({ page }) => {
    const trigger = page.getByRole('button', { name: '账户菜单' });
    const menu = await openAccountMenu(page);
    await expect(menu.getByTestId('current-user')).toContainText('管理员模式');
    await expect(menu.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('href', '/settings');
    await expect(menu.getByRole('button', { name: '退出登录', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('settings opens from the menu, closes the menu and is marked as the current page', async ({ page }) => {
    await (await settingsLink(page)).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('group', { name: '账户' })).toBeHidden();
    await expect(await settingsLink(page)).toHaveAttribute('aria-current', 'page');
  });

  test('logout from the menu signs out', async ({ page }) => {
    const menu = await openAccountMenu(page);
    await Promise.all([
      page.waitForURL(/\/(admin|dashboard)/),
      menu.getByRole('button', { name: '退出登录', exact: true }).click(),
    ]);
    await expect(page.getByRole('button', { name: '账户菜单' })).toHaveCount(0);
  });

  test('only one logout button is exposed on desktop', async ({ page }) => {
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
    await openAccountMenu(page);
    await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(1);
  });
});
```

> 退出后的落点以 `ui-shell.spec.ts` 里现有「logout」用例的断言为准（读该用例，沿用它的 `waitForURL` 与断言，不要猜）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "account menu"`
Expected: FAIL（没有「账户菜单」按钮）。

- [ ] **Step 3: 改 `AppNavigation.svelte`**

脚本区：在 `let toggle: HTMLButtonElement;` 之后加

```ts
  let accountMenu: ReturnType<typeof AnchoredPanel> | undefined;
  const modeLabel = $derived(checking ? '正在确认身份…' : context.kind === 'workspace' ? '本人工作区' : context.manage ? '管理员模式' : '个人跑步展示');
  const settingsActive = $derived(active(view.href(settings.href)));
```

把 `afterNavigate(() => { open = false; });` 改成 `afterNavigate(() => { open = false; accountMenu?.close(); });`。

把 `.nav-account` 里的 `runner-identity` 与退出/设置那一块（移动端内联版本）整体包进 `<div class="account-inline">…</div>`，在它前面加桌面头像菜单：

```svelte
{#if user && !checking}<div class="account-menu-host">
  <AnchoredPanel bind:this={accountMenu} label="账户菜单" panelLabel="账户">
    {#snippet trigger()}<span class="runner-avatar account-avatar" data-current={settingsActive ? '' : undefined}>{#if profile?.avatar_url && !avatarFailed}<img src={profile.avatar_url} alt="" onerror={() => { avatarFailed = true; }} />{:else}{Array.from(profile?.display_name || '跑者')[0]}{/if}</span>{/snippet}
    <div class="account-menu">
      <div class="account-menu-id"><p class="text-sm font-semibold">{profile?.display_name || '跑步记录'}</p><p class="account-email" data-testid="current-user">{modeLabel}</p></div>
      {#if view.manage}<a href={view.href(settings.href)} class="rn-menu-option" aria-current={settingsActive ? 'page' : undefined} onclick={(event) => visit(event, settings.href, navigation.length)}>设置</a>{/if}
      <button type="button" class="rn-menu-option" disabled={busy || !mounted} onclick={() => { accountMenu?.close(); onlogout(); }}>{busy ? '退出中…' : '退出登录'}</button>
    </div>
  </AnchoredPanel>
</div>{/if}
```

> `data-testid="current-user"` 现在会同时出现在菜单与内联版本里。内联版本里的那个保持不变（移动菜单与现有测试用），菜单里的改成 `data-testid="current-user-menu"` 并把上面测试里的 `getByTestId('current-user')` 同步改成 `current-user-menu`，避免重复的 test id。

- [ ] **Step 4: CSS**

在 `app.css` 桌面块里，把 Task 1 里临时排出的内联账户元素在桌面隐藏，并给菜单与头像样式：

```css
    .sport-theme.app-shell .account-inline { display: none; }
    .sport-theme.app-shell .account-avatar { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; overflow: hidden; }
    .sport-theme.app-shell .account-menu .account-menu-id { padding: var(--space-2) var(--space-3); }
    .sport-theme.app-shell .account-menu .account-email { margin: 0; color: var(--muted-foreground); white-space: normal; }
    .sport-theme.app-shell .anchored-trigger:has(.account-avatar[data-current]) { box-shadow: 0 0 0 2px var(--primary); }
```

并在文件里 `@media (max-width: 799px)` 块（约第 301 行）内追加：

```css
    .account-menu-host { display: none; }
```

保证移动菜单里只有内联版本；删除 Task 1 里 `.nav-account .runner-avatar`、`.account-logout`、`.logout-icon` 为桌面临时排布写的规则（现在桌面的内联块整体 `display: none`），以及 `AppNavigation.svelte` 里给退出按钮加的 `.logout-icon` 与视觉隐藏的 `span`（移动端的退出按钮恢复成纯文字）。

- [ ] **Step 5: 更新既有测试**

凡是在桌面通过 `.nav-account` 点设置链接或退出按钮的既有用例，改用助手：`await (await settingsLink(page)).click()`、`(await openAccountMenu(page)).getByRole('button', { name: '退出登录', exact: true })`。先 `grep -n "nav-account\|退出登录" tests/ui/*.ts` 列出：本计划前面改过的 `ui-shell.spec.ts`（四处 `.nav-account` 设置链接、「AI 分析 navigation entry…」里的 `toHaveCount(0)`）、`liquid-glass.spec.ts` 的设置高亮断言（现在设置不在导航里，该断言改成 `await expect(nav).toHaveAttribute('data-idle', '')`）等。逐个规格运行并修复，规则同 Task 2 Step 8。

- [ ] **Step 6: 运行测试、视觉检查与类型检查**

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts`（含所有受影响规格）与 `pnpm check`。
Expected: 全部通过。截图确认头像菜单的位置、玻璃质感、浅/深色，以及设置页时头像的高亮环。

- [ ] **Step 7: 提交（仅在用户授权后）**

```bash
git add frontend/src/lib/components/AppNavigation.svelte frontend/src/app.css frontend/tests/fixtures/top-navigation.ts frontend/tests/ui
git commit -m "feat: 顶部导航头像菜单（设置、退出登录）"
```

---

### Task 6: 设计系统文档、展示页与验收记录

**Files:**
- Modify: `docs/design-system/README.md`、`components.md`、`patterns.md`、`tokens.md`
- Modify: `frontend/tests/fixtures/ui-showcase/Showcase.svelte`
- Create: `docs/NN-top-navigation.md`（`NN` 用 `ls docs/` 确认已用最大编号 +1）
- Modify: `frontend/tests/ui/*` 与 `design-system.config.ts` 的基线（审阅后）

**Interfaces:**
- Consumes: 前面全部任务的实现。

- [ ] **Step 1: 更新设计系统文档**

- `README.md`「视觉不变量」：把「绿色运动导航、黄色页头…」改为「顶部悬浮玻璃导航（绿色用于 Logo 与当前项）、黄色页头、暖浅色背景、绿色系深色外观、24px 内容卡片与胶囊控件」；把「私人侧栏与公开顶部导航分开」改为「私人顶部玻璃条与公开顶部导航分开」。
- `components.md`：新增 `AnchoredPanel`（props、`inline`、`close()`、与 `BasemapPicker` 的关系）与 `GoalRing`；更新导航一节为顶部条与三档响应式。顶部导航的 docked / floating 两态（与身心健康保存栏同一玻璃配方）与 `attachFloatingGlass` 也写在这里；并记一笔「`SaveBar` 与顶部导航各自有一份相似的玻璃挂载逻辑，后续可让 `SaveBar` 改用 `attachFloatingGlass`」。
- `patterns.md`：外壳模式改为顶部条加内容区；账户区的进度环、主题切换、头像菜单顺序。
- `tokens.md`：新增 `--top-navigation-offset`、`--top-navigation-height`、`--z-top-navigation`；`--sport-sidebar` 的用途改为「Logo 底色」。
- 各文档里的「侧栏」表述按实际改成「顶部导航」；用 `grep -n "侧栏" docs/design-system/*.md` 检查残留。

- [ ] **Step 2: 展示页加 AnchoredPanel**

读 `frontend/tests/fixtures/ui-showcase/Showcase.svelte` 里 `TimePicker` 那一节的写法（第 74–75 行附近），在同一页面按同样的结构新增一节「AnchoredPanel」：

```svelte
<AnchoredPanel label="示例弹层" panelLabel="示例面板">
  {#snippet trigger()}<GoalRing progress={62} />{/snippet}
  <p class="text-sm">合成示例：本周已完成 62%。</p>
</AnchoredPanel>
```

并在文件顶部加上对应的 `import AnchoredPanel from '../../../src/lib/components/AnchoredPanel.svelte';` 与 `GoalRing`。运行 `node tests/fixtures/check-showcase-isolation.mjs` 前需要先有生产构建（见 README「使用方式」）。

- [ ] **Step 3: 像素基线**

Run: `pnpm exec playwright test --config playwright.design-system.config.ts`
Expected: 展示页新增区块与导航相关快照有差异。先看差异图，确认都是预期变化，再对这些快照 `--update-snapshots`，并在验收记录里写明「已审阅」。不要不看就更新。

- [ ] **Step 4: 全量回归**

Run（`frontend/`）：`pnpm check`、`pnpm test`、`pnpm build`（既有大 chunk 警告属已知状态），以及所有含受影响规格的 Playwright 配置。真实后端的 `*-e2e` 配置需要独立测试库，本次未运行时必须在报告里明说。

- [ ] **Step 5: 写验收记录**

创建 `docs/NN-top-navigation.md`（中文，含「使用方式 / 接口与隐私 / 验证记录」）：使用方式写三档响应式与账户区；接口与隐私写「不改接口、权限、隐私；进度环只显示已有的跑量与目标」；验证记录写实际执行的命令、通过/失败/跳过数量、截图路径、未运行项（真实后端 e2e、Safari/Firefox 实机）与剩余风险（1360px 以下最紧，8 个入口在 1360px 起带文字；9 个入口的普通账户在所有桌面宽度都是图标版；横向滑块在窗口缩放时的位置）。数字必须来自本次真实输出。

- [ ] **Step 6: 清理与提交（仅在用户授权后）**

删除临时配置 `frontend/playwright.tmp-8291.config.ts` 与 scratchpad 之外的任何临时文件，确认 `lsof -iTCP:8291 -iTCP:5291 -sTCP:LISTEN` 为空。

```bash
git add docs/design-system docs/superpowers docs/NN-top-navigation.md frontend/tests/fixtures/ui-showcase frontend/tests
git commit -m "docs: 顶部导航设计系统、展示页与验收记录"
```

---

## 交付说明（完成后按 AGENTS.md 第 12 节）

报告：改动范围（前端 / 文档 / 测试分开写）、实际执行的命令与结果、未运行的检查、未确认事项与剩余风险（例如「开发服务未重启，真实后端未验证」「Safari/Firefox 未实机检查」）、未受影响的部分（接口、数据、公开页面、移动菜单）。不夸大完成度：合成 UI 通过不等价于真实业务验收。
