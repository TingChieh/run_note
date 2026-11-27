# 106 · Editorial Receipt Web 迁移：设置中心（`/settings` 及关联分区）

延续 [101 · Editorial Receipt 第 1 阶段](101-editorial-receipt-phase1.md)、[102 · 跑步记录列表](102-editorial-receipt-activities.md)、[103 · 活动详情](103-editorial-receipt-activity-detail.md) 与 [brand.md](design-system/brand.md)（§2 操作页、§3–§6、§12、W-02/04/06/13/14）的按页迁移计划，本 PR 将 Web 设置中心全部 5 个分区路由迁移至 Editorial Receipt 操作页语言，覆盖：

- `/settings` 与 `/workspace/settings`（账户总览）
- `/settings/shoes` 与 `/workspace/settings/shoes`（跑鞋）
- `/settings/preferences` 与 `/workspace/settings/preferences`（目标与隐私）
- `/settings/site`（站点设置，仅站主）
- `/admin/users`（用户管理，仅站主）

不改动后端、API、数据库迁移、权限、CSRF、数据计算、版本号文件或发布流程，也不改动并行推进的回顾/报告页及其他未迁移页面。

## 使用方式

- **操作页边界与双层体系（`brand.md §2`、`§8.1`、`§12`）**：
  - 设置页属「操作页」，以可用性为优先，**不添加任何票据装饰**（无黄票头、打孔虚线、点线引导、锯齿边或装饰大数字）。
  - 保留根布局渲染的紧凑 `PageHeader` 底色（浅色 `--header-tint` 淡奶油黄、深色中性深灰，`--radius-header: 1rem`）以及全局顶部悬浮玻璃导航（≥800px）与手机底部 Tab 栏（<800px）。
  - 手机端「我的」页底部的 `MobileAccountLinks`（「更多」分组）去掉 24px `.aux-panel` 卡片外框改为 1px 发丝线（`.section-hairline`），`退出登录` 改为 10px 平面按钮，同时为外观切换控件 `<ThemeToggle compact />` 保留 `[data-glass-overlay]` 玻璃边界。
- **下划线设置分区标签（`SettingsTabs`，`brand.md §6.2`、`§12`）**：
  - 由玻璃胶囊分段（`.settings-tabs`）迁移为 `.underline-tabs.settings-tabs-sections`：桌面与平板（≥480px）单行排布、当前项 2px 墨色下划线、`站点设置` 前保留 CSS `::before` 1px 竖发丝分隔线、跑鞋提醒徽章使用等宽方角标；手机窄屏（<480px）**保留既有 2 列网格与奇数末项跨两列行为**（适配 3/4/5 个标签，单格高度 ≥44px，零横溢，2px 可见焦点环 `z-index: 5`）。
- **去 24px 内容卡片、2px 节线 + 1px 发丝线与表单控件（`W-02/04/13/14`）**：
  - **账户总览（`/settings`）**：首块身份与头像区以 2px `.section-rule` 开头，邮箱与时区改为等宽纯文字行（去除灰色胶囊）；三栏「个人管理概览」去除 24px 外框与彩色圆形徽章（`鞋`/`标`/`隐`），改以 1px 上下及竖发丝线分隔；「个人资料」「修改用户名」「账户安全」采用原型式两栏结构（≥900px 左标签+说明、右字段，<900px 单栏）；`<SaveBar>` 改为无玻璃平面样式（10px 圆角、`1px solid var(--control-border)`、`--surface` 底）。
  - **目标与隐私（`/settings/preferences`）**：`跑量目标`（3 列等宽 `km` 后缀输入框）、`展示、隐私与个人模块`（发丝线开关行 + 圆点状态文本替代胶囊徽章）、`设备健康数据（只读）`（`CompanionHealthPanel`，指标汇总切换为 `MetricSummary appearance="receipt"`）、`离线缓存与增量同步`（`CompanionCachePanel`，并补充 `onMount` 水合 `ready` 保护避免 SSR 阶段误点）与 `数据与记录入口` 全部统一为两栏发丝线分组；`<SaveBar>` 改为平面样式。
  - **跑鞋（`/settings/shoes`）**：保留桌面 3:7 主从分栏与手机列表/详情切换；`使用中 / 已退役` 切换改为单行 `.underline-tabs`；列表项由 24px 卡片改为发丝线账页行（选中态为 `--recap-well` 底 + 左侧 3px 墨色竖线），进度条改为 4px 直角细条（`ShoeProgress`），详情区以 2px `.section-rule` 开头，编辑弹窗输入框采用 `--control-border`。
  - **站点设置（`/settings/site`）**：保留桌面 ≥1024px 两栏布局与右栏吸顶预览/图标，去除全部 24px `.aux-panel` 卡片，改用 2px 节线与 1px 发丝线分组；版本信息采用等宽账页列表；`<SaveBar>` 改为平面样式。
  - **用户管理（`/admin/users`）**：筛选栏登录状态分段改为 `.underline-tabs`，表格区去除 `.aux-panel` 卡片外框改为 2px `.section-rule` + 发丝线表行（同步修正开关底色 `--switch-ground` 为 `--background`），行内操作为 10px 平面按钮，弹窗保留完整校验与焦点回退。
- **与静态原型（`docs/design-system/prototypes/web.html`）的诚实差异**：
  - 原型中的「新记录默认公开」「分享图默认隐藏城市名」目前**后端无对应用户偏好字段与接口**，遵循「不改后端/API/Schema、不虚构功能」原则，未在界面中伪造无效开关。
  - 原型中的单组「外观」分段在真实 Web 应用中已分别由桌面顶栏 `ThemeToggle`、手机「我的」页 `MobileAccountLinks` 外观控件（本机偏好）与 `/settings/site`「默认外观」（站点默认）承担，遵循 `AGENTS.md`「避免重复入口」原则未再新增第三处重复控件。

## 改动范围

| 区域 | 文件 | 意图 |
| --- | --- | --- |
| 共享样式（最小增量） | `frontend/src/app.css`、`frontend/src/lib/styles/liquid-glass-controls.css` | 仅在文件末尾增量添加 `.underline-tabs.settings-tabs-sections`、`.editorial-page` 表单/平面 `SaveBar`/`.settings-editorial-group` 与 `.editorial-page select.rn-liquid-select` 样式，不改未迁移页面既有规则，降低与并行报告页冲突风险 |
| 设置壳层与导航 | `frontend/src/routes/+layout.svelte`、`frontend/src/lib/components/SettingsTabs.svelte`、`frontend/src/lib/components/MobileAccountLinks.svelte` | 设置页头容器启用 `.editorial-page`；`SettingsTabs` 切换为 `.underline-tabs.settings-tabs-sections`；手机「更多」区去 24px 卡片并保留 `ThemeToggle` 的 `[data-glass-overlay]` 玻璃边界 |
| 五个设置分区与专用组件 | `frontend/src/routes/settings/+page.svelte`、`frontend/src/routes/settings/preferences/+page.svelte`、`frontend/src/routes/settings/site/+page.svelte`、`frontend/src/routes/admin/users/+page.svelte`、`frontend/src/lib/components/CompanionHealthPanel.svelte`、`frontend/src/lib/components/CompanionCachePanel.svelte`、`frontend/src/lib/components/shoes/ShoesPage.svelte`、`frontend/src/lib/components/shoes/ShoeProgress.svelte`、`frontend/src/lib/components/shoes/ShoeEditor.svelte` | 迁移全部设置表单、开关、跑鞋列表/详情、站点设置两栏与用户管理表格至 Editorial Receipt 操作页；保留所有表单校验、保存/错误/成功反馈、权限与账号安全流程；修复 `CompanionCachePanel` SSR 水合前按钮可点问题 |
| 测试与验收资产 | `frontend/tests/ui/settings-hub.spec.ts`、`frontend/tests/ui/top-navigation.spec.ts`、`frontend/tests/ui/ui-shell.spec.ts`、本文及 `docs/assets/2026-11-28-editorial-receipt-settings/` | 按 `brand.md §12` 退役设置分区旧玻璃透镜飞行断言并新增 Editorial Receipt 平面控件/无卡片/平面 `SaveBar`/4 视口×明暗零溢出断言；将 `top-navigation.spec.ts` 的 `segmented lens label` 指向仍使用 `.settings-tabs` 的 `/routes` 排序控件以保持分段透镜覆盖不缩水；留存迁移前后合成截图 |

未改动：后端代码、数据库迁移、API 契约、权限与 CSRF、版本号文件、`CHANGELOG.md`、发布 workflow、全局顶部玻璃导航、身心健康玻璃 `SaveBar`、数据汇总/跑步记录/详情/足迹/回顾页。

## 接口与隐私

不新增或修改任何 API 路径、请求字段、响应结构或权限边界。站主专用路由（`/settings/site`、`/admin/users`）与普通用户重定向（`/settings*` → `/workspace/settings*`）、30 天用户名冷却、修改密码清空全部会话并清理离线缓存/健康授权历史均完整保留。所有截图与测试均基于合成 UI API 数据，不含真实用户信息或密钥。

## 验证记录（2026-11-28，本机 Linux，Node 24.18，Chrome，Playwright 1.65）

| 命令（`frontend/`） | 结果 |
| --- | --- |
| `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` | 0 errors / 0 warnings |
| `stylelint "src/**/*.{css,svelte}" "tests/fixtures/**/*.{css,svelte}"` | 通过 |
| `vitest run` | 80 files / 528 tests passed |
| `vite build`（adapter-node） | 成功（仅既有大体积 chunk 警告） |
| `node tests/fixtures/check-showcase-isolation.mjs` | PASS（1061 files，无 showcase 标识，5 个探测路由均 404） |
| `playwright test --config playwright.ui.config.ts`（`admin-users`、`liquid-glass`、`settings-hub`、`shoes`、`theme`、`top-navigation`、`ui-shell`） | 142 passed / 1 skipped（仅环境变量触发的截图用例）/ 0 failed（首轮 138 passed + 修正 2 处测试选择器后 `settings-hub`/`top-navigation` 专项 9/9 passed） |
| `playwright test --config playwright.site-settings.config.ts` | 12 passed / 0 failed |
| `playwright test --config playwright.username.config.ts` | 1 passed / 0 failed |
| `playwright test --config playwright.companion-phase2.config.ts` | 6 passed / 0 failed（首次运行暴露并修复 `CompanionCachePanel` SSR 水合前点击竞态） |
| `playwright test --config playwright.together.config.ts` | 21 passed / 0 failed |
| `playwright test --config playwright.wellbeing.config.ts -g "personal setting saves\|floating save bar"` | 2 passed / 0 failed |

### 视觉验收矩阵（合成数据，4 视口 × 浅/深色）

在 1440×900、768×1024、390×844、320×640 四档视口 × 浅/深色 × 全部 5 个设置路由（共 40 组页面检查）下实测：横向溢出 0、控制台错误 0、页面错误 0；并与 [设置原型（1440 浅色）](design-system/prototypes/screenshots/web-settings-1440-light.png) / [深色](design-system/prototypes/screenshots/web-settings-1440-dark.png) / [768 浅色](design-system/prototypes/screenshots/web-settings-768-light.png) 逐项比对结构层级、下划线标签、发丝线分组、10px 控件与平面吸底 `SaveBar`。

#### 账户总览（`/settings`）

| 视口 / 主题 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-1440-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-1440-light.png) |
| 1440×900 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-1440-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-1440-dark.png) |
| 768×1024 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-768-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-768-light.png) |
| 768×1024 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-768-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-768-dark.png) |
| 390×844 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-390-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-390-light.png) |
| 390×844 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-390-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-390-dark.png) |
| 320×640 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-320-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-320-light.png) |
| 320×640 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-settings-320-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-settings-320-dark.png) |

#### 目标与隐私（`/settings/preferences`）

| 视口 / 主题 | 修改前 | 修改后 |
| --- | --- | --- |
| 1440×900 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-1440-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-light.png) |
| 1440×900 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-1440-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-dark.png) |
| 768×1024 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-768-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-768-light.png) |
| 768×1024 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-768-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-768-dark.png) |
| 390×844 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-390-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-390-light.png) |
| 390×844 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-390-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-390-dark.png) |
| 320×640 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-320-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-320-light.png) |
| 320×640 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-preferences-320-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-preferences-320-dark.png) |

#### 跑鞋、站点设置与用户管理（1440 / 390 浅色与深色）

| 分区 / 视口 | 修改前 | 修改后 |
| --- | --- | --- |
| 跑鞋 1440 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-shoes-1440-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-shoes-1440-light.png) |
| 跑鞋 1440 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-shoes-1440-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-shoes-1440-dark.png) |
| 跑鞋 390 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-shoes-390-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-shoes-390-light.png) |
| 站点设置 1440 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-site-1440-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-site-1440-light.png) |
| 站点设置 1440 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-site-1440-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-site-1440-dark.png) |
| 站点设置 390 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-site-390-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-site-390-light.png) |
| 用户管理 1440 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-users-1440-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-users-1440-light.png) |
| 用户管理 1440 深色 | ![](assets/2026-11-28-editorial-receipt-settings/before-users-1440-dark.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-users-1440-dark.png) |
| 用户管理 390 浅色 | ![](assets/2026-11-28-editorial-receipt-settings/before-users-390-light.png) | ![](assets/2026-11-28-editorial-receipt-settings/after-users-390-light.png) |

#### 整页与交互态核对

- 整页长图：[账户总览 1440 浅色](assets/2026-11-28-editorial-receipt-settings/after-settings-1440-light-full.png)、[账户总览 1440 深色](assets/2026-11-28-editorial-receipt-settings/after-settings-1440-dark-full.png)、[目标与隐私 1440 浅色](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-light-full.png)、[目标与隐私 1440 深色](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-dark-full.png)。
- 交互态：[平面 SaveBar（未保存态）](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-light-savebar.png)、[下划线标签键盘焦点](assets/2026-11-28-editorial-receipt-settings/after-settings-1440-light-focus.png)、[表单校验错误态](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-light-error.png)、[保存成功态](assets/2026-11-28-editorial-receipt-settings/after-preferences-1440-light-success.png)、[跑鞋空态](assets/2026-11-28-editorial-receipt-settings/after-shoes-1440-light-empty.png)、[跑鞋加载态](assets/2026-11-28-editorial-receipt-settings/after-shoes-1440-light-loading.png)。

## 未验证项与剩余风险

- **真实后端 E2E（`playwright.config.ts`）与后端集成测试**：未在本机运行（本机未配置独立 `_test` 库，且本次未改动后端/数据库/API）；全量 `frontend-ui` 结果以 PR CI 为准。
- **`design-system.spec.ts` 像素快照对比**：基线仅包含 macOS（`*-darwin.png`），未在 Linux 上执行像素级 diff（本次未修改设计系统 showcase 页面或基础组件默认外观）。
- **真机 Safari / WebKit**：本机 Linux 缺少 WebKit 系统库，未做真实 Safari 目视核对；所有浏览器验证均基于 Chromium 合成 API 环境。
- **未在前端伪造的原型项**：原型中的「新记录默认公开」与「分享图默认隐藏城市名」缺少后端数据字段与接口，待后续后端提供对应用户偏好字段后再接入。
