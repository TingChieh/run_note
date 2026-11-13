# 已登录站点管理页统一设计实施计划

**目标：** 已登录 `/admin` 使用与数据汇总相同的导航、内容宽度、页头和卡片，保留全部管理入口。

**方案：** 根布局仅对未登录 `/admin` 使用认证页布局；已登录时复用 `app-shell` 与 `AppNavigation`，不修改导航组件及其入口。正文复用 `PageHeader`、`aux-stack`、`aux-panel`、`button-secondary`；入口按单列、两列、三列响应式网格排列。

**约束：** 按用户指示单 agent 执行并自行审阅；仅提交当前分支，不推送、不操作 main、数据库或部署。不改登录表单、公开分享壳层、接口或权限。

## 实施步骤

- [x] 更新公开顶栏与统一壳层测试，将已登录 `/admin` 移出公开页断言、加入应用页回归，保留分享页操作与退出验证。
- [x] 新增应用壳层回归：375/390/1440 宽、浅深主题，比较 `/admin` 与数据汇总的导航链接及内容几何；确认无公开顶栏、无错误激活项、全部五个入口在具名卡片且目标不变、键盘焦点与无横溢。
- [x] 先运行新用例确认旧实现失败，再最小修改根布局和管理页。
- [x] 更新设计系统中公开导航适用路由说明，保留未登录 `/admin` 回归。
- [x] 执行样式 lint、类型检查、单元测试及完整合成 API UI 测试；失败时定位并如实记录重试。
- [x] 自行审阅最终 diff，记录验证结果，显式选择文件并以中文信息提交当前分支。

## 审阅重点

- `/admin/` 尾斜杠与登录状态必须使用相同的布局判定。
- `/shared/[token]`、`/public/activities/[id]` 登录前后保留公开菜单及退出行为。
- `/admin` 无导航匹配时不能错误高亮，正常导航后仍能激活。
- 管理入口归属正文卡片，不添加到应用菜单；原有普通用户身份条件不变。
- 不用隐藏横向溢出来掩盖窄屏布局问题，不为修复引入全局样式。

## 验证记录

- 红灯：`pnpm exec playwright test -c playwright.ui.config.ts admin-unified-design --grep '375px light'`：1 failed，旧实现缺少 `.app-shell`，符合预期。
- 首轮定向回归：8 passed / 4 failed；失败源于新测试在手机导航自动关闭后仍通过可访问性定位器读取激活项。测试改为重新打开菜单后检查，产品行为无需调整。
- 定向回归重跑：`pnpm exec playwright test -c playwright.ui.config.ts admin-unified-design mobile-public-header`：12 passed（21.6s）。
- `pnpm lint:style`：exit 0；项目无 `lint` 脚本，使用现有样式 lint。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm test`：50 files / 324 tests passed。
- `pnpm format tests/ui/admin-unified-design.spec.ts`：只格式化新增文件。
- `pnpm format:check tests/ui/admin-unified-design.spec.ts`：通过；仅对新增测试执行 Prettier，不批量格式化既有文件。
- 首轮全量：`npx playwright test -c playwright.ui.config.ts`：334 passed / 4 skipped / 4 failed（16.8m）。其中 `ui-shell:209` 尚将已登录 `/admin` 列为公开页；已改为纳入应用页并确认无匹配高亮。`sport-detail:153` 仅模拟详情 401 却保留登录 cookie，导致服务端仍返回已登录站点管理；已在该测试返回 401 前清除合成会话 cookie，并断言登录按钮可见，使后续 SSR 也观察到未登录状态。另有 `activities:355` 动画高度采样为 0、已知偶发的 `liquid-glass:6` 超时，未改无关代码。
- 失败项重跑：`pnpm exec playwright test -c playwright.ui.config.ts --last-failed`：4 passed（35.5s）。
- `pnpm build`：exit 0，adapter-node 构建成功；保留既有大 chunk 警告。
- 最终全量：`npx playwright test -c playwright.ui.config.ts --retries=1`：exit 0，336 passed / 2 flaky / 4 skipped（13.6m），无未解决失败。`activities:64` 与 `activities:85` 首次失败、自动重试通过，保留既有代码；四项跳过是 Chrome 桌面配置不适用的手机/WebKit 条件用例。所有新增管理页用例及用户指定的相关 spec 已执行。
- 已查看 375px 浅色与 1440px 深色截图，确认沿用标准页头、宽度与玻璃按钮；截图为合成 API 证据，保留在忽略的 `frontend/test-results/`，不提交。
- 按用户要求自行审阅：复查布局判定、SSR 身份来源、无匹配导航激活态、公开页及普通账号条件；补齐 `ui-shell` 旧断言与 `sport-detail` 会话过期替身。产品变更仍仅根布局与站点管理页两个文件，无子 agent 或外部审阅。

未运行真实后端/数据库、生产环境与真实业务验收；本次仅调整前端展示，不改变接口、权限、CSRF 或数据。

提交前 `git diff --check` 通过。仅显式选择本次两个页面文件、四个 UI spec、UI 配置与两份文档；不包含构建产物、截图或密钥。
