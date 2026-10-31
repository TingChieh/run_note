# 深色外观暖炭灰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把深色外观从偏绿的深森林色改成中性偏暖的炭灰（方案 E），并让顶部条里的玻璃按钮不再泛绿。

**Architecture:** 深色值集中在 `app.css` 的一个令牌块，改值即可；另外新增 `--sport-brand` 令牌给 Logo 方块、桌面顶部条里的玻璃按钮改用中性玻璃令牌、本地路线地图的深色背景改成暖灰。数据色、浅色外观、外部底图不动。

**Tech Stack:** SvelteKit 3 / Svelte 5、CSS 自定义属性（`app.css`）、Playwright 合成 UI 测试。

设计文档：`docs/superpowers/specs/2026-10-30-dark-theme-warm-charcoal-design.md`（令牌新旧值表以它为准）。

## Global Constraints

- 只改深色；浅色外观颜色不变（唯一例外：桌面顶部条里玻璃按钮中性化，浅色下也生效）。
- 数据色（`--calendar-1..4`、`--chart-series`、`--well-*`、状态色前景与边框、轨迹区分色）不变。
- 颜色只用令牌；新增令牌 `--sport-brand` 要同时在浅色与深色块里定义。
- 不改接口、权限、数据、迁移；不改外部底图样式。
- 不执行 git commit / push / stash 等（项目规则：未经用户授权不提交）；工作区里有其它任务的未提交改动，只在需要的文件里做最小修改，不回退别人的改动。
- UI 测试只通过临时配置（端口 8291/5291 或 8391/5391，另一窗口占 8191/5191，不要动）；用完删除临时配置与临时 spec；不要不看差异就 `--update-snapshots`。
- 测试必须真实执行，报告实际结果；不放宽断言。

---

### Task 1: 深色令牌、`--sport-brand` 与玻璃按钮中性化

**Files:**
- Modify: `frontend/src/app.css`（深色令牌块；浅色 `.sport-theme` 令牌块；Logo 两处）
- Modify: `frontend/src/lib/styles/liquid-glass.css`
- Modify: `frontend/tests/ui/design-system.spec.ts:101`
- Modify/Create tests: `frontend/tests/ui/theme.spec.ts`（新增深色断言；若该规格不适合，放进 `design-system.spec.ts`）

**Interfaces:**
- Produces: 令牌 `--sport-brand`（浅色 `#218538`，深色 `#1f5a3a`）；深色令牌新值（见设计文档表）。

- [ ] **Step 1: 写失败的测试**

在 `theme.spec.ts`（读该文件，沿用它的登录与切换深色的方式，`await page.emulateMedia({ colorScheme: 'dark' })` 或点主题切换）新增：

```ts
test('dark theme is a neutral warm charcoal, not green, and stays legible', async ({ page }) => {
  // log in and open /dashboard the same way the other tests in this file do, then force dark.
  const read = (name: string) => page.evaluate((token) => {
    const el = document.querySelector('.sport-theme') as HTMLElement;
    const probe = document.createElement('i'); probe.style.color = `var(${token})`; el.append(probe);
    const [r, g, b] = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number); probe.remove(); return [r, g, b];
  }, name);
  const luminance = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= .03928 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };
  const background = await read('--background'), surface = await read('--surface');
  for (const color of [background, surface]) expect(Math.max(...color) - Math.min(...color), 'no green cast').toBeLessThanOrEqual(8);
  expect(contrast(await read('--foreground'), background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(await read('--foreground'), surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(await read('--muted-foreground'), surface)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(await read('--primary'), surface)).toBeGreaterThanOrEqual(4.5);
});

test('glass buttons in the desktop top bar are neutral, not green', async ({ page }) => {
  // desktop viewport, signed in, dark. The theme toggle is a glass button inside .app-sidebar.
  const fill = await page.locator('.app-sidebar .theme-toggle').evaluate(el => getComputedStyle(el).getPropertyValue('--button-glass-fill').trim());
  expect(fill).not.toContain('sport-sidebar');
  const [r, g, b] = await page.locator('.app-sidebar').evaluate(el => { const probe = document.createElement('i'); probe.style.color = getComputedStyle(el).getPropertyValue('--button-glass-fill'); el.append(probe); const c = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number); probe.remove(); return c; });
  expect(g - r, 'not greener than red').toBeLessThanOrEqual(8);
});
```

（第二个测试里 `--button-glass-fill` 是 `color-mix(...)` 表达式，上面用探针元素解析成实际 rgb；若 `getPropertyValue` 返回的是未解析的表达式，探针法即可得到最终颜色。写之前先在实际页面里确认返回值形态，必要时调整探针写法，但断言意图不变。）

在 `design-system.spec.ts:101` 把深色期望值 `'rgb(27, 41, 34)'` 改为 `'rgb(51, 49, 47)'`。

Run: `pnpm exec playwright test --config playwright.tmp-8291.config.ts -g "warm charcoal|neutral warm|glass buttons in the desktop top bar|surface-mapping"`（临时配置的 `testMatch` 加上 `theme.spec.ts`、`design-system` 对应的规格；`design-system.spec.ts` 属于哪个配置用 `grep -l design-system.spec frontend/playwright.*.ts` 找，它可能在独立的 showcase 配置里，按该配置运行）。
Expected: 新测试与改过的期望值 FAIL（旧值仍是深绿）。

- [ ] **Step 2: 改深色令牌**

在 `app.css` 的深色块里，按设计文档的「令牌变更（深色）」表逐项替换（`--background`、`--surface`、`--foreground`、`--muted`、`--muted-foreground`、`--border`、`--control-hover-border`、`--primary-soft`、`--success-soft`、`--sport-sidebar`、`--sport-nav-active`、`--sport-nav-active-ink`、`--sport-yellow`、`--calendar-0`、`--calendar-ring`、`--calendar-label`、`--route-thumbnail`、`--province-unvisited`、`--province-sea`、`--glass-fill-base`、`--glass-surface`、`--glass-surface-hover`、`--glass-action-foreground`）。不在表里的令牌不要动。同一块里新增 `--sport-brand: #1f5a3a;`。

在浅色 `.sport-theme` 令牌块（`--sport-sidebar: #218538;` 所在块）里新增 `--sport-brand: #218538;`。

- [ ] **Step 3: Logo 改用 `--sport-brand`**

`app.css` 里两处 Logo 方块背景：桌面顶部条的 `.sport-theme.app-shell .app-sidebar .brand-mark { background: var(--sport-sidebar); color: white; }` 与公开页 `.sport-theme .public-header .brand-mark { background: var(--sport-sidebar); }`，都改为 `var(--sport-brand)`。移动栏的 `.mobile-bar .brand-mark`（白底、`--sport-sidebar` 字色）与 `.app-sidebar .brand-mark`（旧侧栏规则，移动菜单用）不动。

- [ ] **Step 4: 桌面顶部条里的玻璃按钮中性化**

在 `liquid-glass.css` 里 `.sport-theme :is(.app-sidebar, .mobile-bar) { ... }` 规则之后新增：

```css
/* The desktop top navigation is a light glass bar, not the old green sidebar: its glass buttons use the neutral glass tokens. The mobile bar and menu keep the rule above. */
@media (min-width: 800px) {
  .sport-theme.app-shell .app-sidebar {
    --button-glass-fill: var(--glass-surface);
    --button-glass-hover: var(--glass-surface-hover);
    --button-glass-sheen: var(--glass-sheen);
    --button-glass-fallback: var(--surface);
  }
}
```

- [ ] **Step 5: 运行测试**

Run: Step 1 的命令，再加上 `top-navigation`、`ui-shell`、`liquid-glass`、`crossbrowser-glass`、`sport-detail`、`dashboard`、`records`、`milestones`、`activities`、`admin-users`、`site-settings`、`wellbeing`（用 `grep -rln "rgb(" tests/ui` 先找出写死深色 rgb 值的断言并按新值更新，保持原意）。
Expected: 全部通过。已知抖动 `seo-routes`、`dashboard-explorer` 的 slow reads 不算。

- [ ] **Step 6: 视觉检查**

用临时 spec 截图（保存到 scratchpad 并用 Read 查看）：深色 `/dashboard` 顶部与向下滚动后的导航玻璃态、`/activities`、`/wellbeing`、设置页、移动宽度 361px 的深色菜单（打开后）、浅色 `/dashboard`（确认浅色基本不变，只有顶部条按钮由浅绿变中性）。核对：没有残留的绿色底（卡片、边框、按钮、日历空格、地图背景除外——地图在 Task 2）、文字可读、强调色仍是薄荷绿、黄色页头仍协调。

- [ ] **Step 7: 类型检查**

Run（在 `frontend/`）：`pnpm check`，期望 0 错误。不提交（获授权后：`git add frontend/src/app.css frontend/src/lib/styles/liquid-glass.css frontend/tests/ui`）。

---

### Task 2: 地图本地背景、设计系统文档与基线

**Files:**
- Modify: `frontend/src/lib/api/map-style.ts`
- Modify: `docs/design-system/README.md`、`docs/design-system/tokens.md`
- Modify: 像素基线（`design-system.config.ts` 对应的快照，审阅后）
- Create: `docs/NN-dark-theme-warm-charcoal.md`（`NN` 用 `ls docs/` 现场确认已用最大编号 +1）

- [ ] **Step 1: 地图本地背景**

`map-style.ts` 的 `createRouteMapStyle` 与 `applyMapTheme` 两处 `dark ? '#19271f' : '#edf3ef'` 提取成同一个常量并把深色值改为 `#302e2c`：

```ts
const routeMapBackground = (dark: boolean) => (dark ? '#302e2c' : '#edf3ef');
```

两处都改为 `routeMapBackground(dark)`。先在 `tests/unit` 或现有断言里查有没有写死 `#19271f` 的测试（`grep -rn "19271f" frontend/tests frontend/src`），按新值更新，保持原意。路线线条与点的 `#77d4ac` / `#14785b` 不变。

- [ ] **Step 2: 文档**

按设计文档「设计系统文档」一节更新 `README.md`（视觉不变量）与 `tokens.md`（深色列新值、`--sport-sidebar` 用途、新增 `--sport-brand`、说明深色数据色不变）。创建 `docs/NN-dark-theme-warm-charcoal.md`（中文，含「使用方式 / 接口与隐私 / 验证记录」）：使用方式写主题仍按 `runnote-theme` 与系统外观；接口与隐私写「不改接口与数据」；验证记录写本次实际命令、结果、截图、未运行项与剩余风险（包括设计文档风险一节的三点）。数字必须来自真实输出。

- [ ] **Step 3: 像素基线**

Run: `pnpm exec playwright test --config playwright.design-system.config.ts`（需要先有生产构建时按 `docs/design-system/README.md`「使用方式」操作）。先逐张查看差异图，确认深色快照的变化都是预期的暖炭灰，浅色快照没有意外变化；确认后才对深色相关快照 `--update-snapshots`，并在验收记录里写明「已审阅」。

- [ ] **Step 4: 全量回归**

Run（`frontend/`）：`pnpm check`、`pnpm test`、`pnpm build`（既有大 chunk 警告属已知状态），以及含受影响规格的 Playwright 配置。两个海报对话框（路线海报、活动海报）深色主题各截一张图查看。真实后端 e2e 未运行时必须在报告里明说。

- [ ] **Step 5: 清理与提交（仅在用户授权后）**

删除临时配置与临时 spec，确认端口已释放。

```bash
git add frontend/src/lib/api/map-style.ts docs/design-system docs/superpowers/specs/2026-10-30-dark-theme-warm-charcoal-design.md docs/superpowers/plans/2026-10-30-dark-theme-warm-charcoal.md docs/NN-dark-theme-warm-charcoal.md frontend/tests
git commit -m "feat: 深色外观改为暖炭灰，顶部条玻璃按钮中性化"
```
