# RunNote Design System

本规范提炼现有 RunNote UI。先读本文，再查 [组件](components.md)、[页面模式](patterns.md)、[Tokens](tokens.md)。事实与取舍见 [UI 审计](ui-audit.md)，实施边界见 [分阶段计划](../superpowers/plans/2026-10-16-ui-design-system.md)。

## 品牌语言与视觉不变量

- **核心品牌语言（Editorial Receipt Design）**：RunNote 的视觉设计以项目现有的 Editorial Receipt Design 为核心品牌语言。所有新增或修改的 UI 必须遵循本规范，优先复用已有的 Design Tokens、排版规则及组件，不得自行引入新的视觉体系。强调**排版而非容器、数据而非装饰、品牌一致性而非流行设计趋势**；避免通用 AI Dashboard 风格、过度卡片化（如卡片套卡片、将一组指标拆成零碎小框）及无意义的装饰性胶囊标签。
- **场景边界**：具象票据元素（纸感、存根/账簿编排等）主要用于**记录、报告和分享**场景（如活动记录、周期报告、跑步回顾与分享海报）；表单、导入、设置与管理等**操作型界面**始终以可用性为优先。
- **表面与色彩**：顶部悬浮玻璃导航（保持现状，含胶囊当前项与 40px 控件）、暖浅色背景、暖炭灰深色外观。页头保留底色：浅色淡奶油黄、深色中性深灰。浅色：品牌绿 Logo、淡绿当前导航、品牌绿主操作；深色：Logo、当前导航与主操作都是中性灰。绿色（`--primary`）始终是强调色，用于数字、单位、链接、进度与开关状态；票据黄只作票据页票头与图表峰值标记。
- **排版与信息锚点**：系统字体，舒展的中文正文，页面 h1 为 28px，统计数据用等宽数字与等宽小写单位；层级靠对齐、大字号主数字和线建立：主区块 2px 墨色节线，次级分组 1px 发丝线或留白。已迁移页面不再用彩色圆形图标、24px 内容卡片或阴影；未迁移页面在各自迁移 PR 前保持原样。
- **双层体系（Editorial Receipt × Liquid Glass）**：内容层是 Editorial Receipt（数据、排版、留白），交互层是 Liquid Glass（导航、浮动控件、菜单与弹层、空间层级与反馈）。玻璃不承载数据内容；已迁移页面（`.editorial-page`）的内容区按钮是 10px 圆角的平面按钮，数据区保持实底。保留全部玻璃实现、参数调节与仅开发环境可见的调节器，不另建组件体系；边界与参数见 [brand.md §8.1](brand.md#81-双层体系editorial-receipt--liquid-glass)。
- **壳层与外观**：私人顶部玻璃条与公开顶部导航分开；详情 hero 保持业务布局；手机导航沿文档流展开。外观支持系统、手动浅色/深色及恢复自动，沿用 `runnote-theme` 和 `watchSystemTheme`，不引入新偏好体系。

## Editorial Receipt 落地规范

负责人已确认（2026-11-27，决定记录在 [brand.md §12](brand.md#12-负责人决定2026-11-27)），按页迁移：第 1 阶段完成令牌、共享样式、`PageHeader` 与数据汇总页，其余页面每页一个 PR。上述品牌语言的具体落地写在 [brand.md](brand.md)：品牌原则、场景分级（票据页 / 档案页 / 操作页 / 记录中）、拟议令牌增量、排版与网格、图表、组件与状态规则，以及 Web / Mobile / Share 的共享与差异。现状诊断见 [Web 审计](web-audit.md)，高保真原型见 [prototypes/](prototypes/index.html)。

| 问题 | 单一来源 |
| --- | --- |
| 品牌语言、场景边界、Agent 流程 | 本文 |
| 落地规则、迁移进度与负责人决定 | [brand.md](brand.md)（已实施的令牌同步在 [tokens.md](tokens.md)） |
| 当前令牌实际值 | [tokens.md](tokens.md) → `frontend/src/app.css` |
| 移动端信息架构与记录流状态机 | [移动端方案](../mobile-ui-design/README.md)（视觉以 brand.md 为准） |

迁移方式：页面根元素加 `.editorial-page`，共享组件用可选外观（如 `TrendChart appearance="receipt"`、`ProvinceMap appearance="ledger"`、`MetricSummary appearance="receipt"`）进入新样式，未迁移的调用方保持原样；不做全局换肤。

## Agent 必须遵循的流程

1. 修改 UI 前必须先阅读本规范及相关文档（[组件](components.md)、[页面模式](patterns.md)、[Tokens](tokens.md)），并定位当前页面、调用方与现有未提交修改。
2. 优先复用已有组件、CSS 类、原生控件和增强 action；没有同名组件文件不表示缺少能力。
3. 找最接近的真实页面和 Pattern，延续结构、状态、断点和阅读顺序；以排版、留白与数据层级组织信息，避免过度卡片化与无意义的胶囊标签。
4. 使用已有语义 Token。新增颜色或稳定间距扩展 `app.css`，不得另建平行色板、在页面散落固定色值，或自行引入新的视觉体系。
5. 新设计延续 Editorial Receipt Design 与上述视觉语言；未经确认，不得擅自改变产品整体设计方向、全局主题、品牌风格或批量重写页面。
6. 只有真实重复需求成立才新增公共组件；同时补组件文档与独立展示，保持 API 命名与既有实现一致。
7. 修改后必须进行视觉验证（按 `AGENTS.md` 第 9 节核对修改前后截图与主题/断点），同时验证响应式、主题、键盘、焦点、交互状态、加载/空/错/成功与缺失值；区分合成 UI 与真实业务验收。
8. 不改接口、权限、CSRF、隐私、数据计算与数据库。较大视觉变更先提交具体方案和前后对照。

## 使用方式

在 `frontend/` 下执行：

```bash
pnpm showcase
pnpm exec playwright test --config playwright.design-system.config.ts
pnpm check
pnpm test
pnpm build
node tests/fixtures/check-showcase-isolation.mjs
```

`pnpm showcase` 仅监听 `http://127.0.0.1:5193`。入口在 `tests/fixtures/ui-showcase/`，使用真实组件、实际根主题与合成静态数据，不启动后端；专用 Vite 优化缓存避免干扰主应用开发服务。生产仍用原 `vite.config.ts`；展示没有注册到 `src/routes` 或 `static`。不要为方便访问把它加到业务导航或生产构建入口。

请在服务启动后访问上述 HTTP 地址；不要双击源码 `index.html` 或通过 `file://` 打开。源码依赖 Vite 编译，文件方式只显示启动说明与展示链接。

隔离脚本先要求已有生产 build，检查产物无展示标识，再使用 8191 内存 API 和 5194 adapter-node（就绪探测等 `/admin` 返回 200）检查 `/showcase`、`/ui-showcase`、`/tests/fixtures/ui-showcase/`、`/main.ts` 与已下线的 `/login` 均为 404，结束关闭本次进程。端口被占用时拒绝运行，不复用或停止已有服务。不要与占用 8191 的业务 UI 测试同时执行。

展示包含 PageHeader（含 `meta` 元信息行）、FeedbackState、PageSkeleton、MetricSummary、DatePicker、TimePicker、AnchoredPanel 与 GoalRing、ThemeToggle、原生表单和布局组合。依赖 `$app/state`、接口或私有数据的组件通过既有 `playwright.ui.config.ts` 合成路由夹具测试，不在独立入口中伪造运行环境。

视觉基线使用固定时间、UTC、合成数据、默认玻璃参数、真实 light/dark 根主题及 reduced-motion。需要更新快照时先查看差异和实际页面；`--update-snapshots` 不能替代设计审阅。首次基线只建立今后的对照点，不证明历史页面完全无差异。

## 体系边界与迁移

| 分类 | 当前处理 |
| --- | --- |
| A：直接复用 | 六个纯展示/交互组件、原生控件、现有布局类及材质 action |
| B：需要统一规范 | 按钮入口、字段组、dialog 表面、分页；本批文档化，不迁移业务页面 |
| C：问题暂缓 | Unicode 图标光学差异、密集日历目标、跨浏览器材质/Popover、旧路由警告；见审计 UI-06/10/12 |
| D：真正缺失 | 独立组件总览、正式规范、自动视觉基线已在本批补齐；Toast/Drawer/DataTable 等无现成业务需求，暂不实现 |

后续阶段 4 至多选择两个重复点试迁移，提供消费者 diff、前后视觉和行为验证，再决定扩大范围。不按组件数量衡量体系是否完成。

## 接口与隐私

展示没有 API 调用、鉴权替身、供应商请求、地图瓦片或数据库写入；所有文本与指标均为合成样例。主题偏好只存本机；现有业务组件的数据与授权边界保持在原调用方。不要将真实轨迹、坐标、文件名、用户信息或密钥加入展示与快照。

## 验证记录

本规范对应的实际命令、结果、视觉证据、生产隔离与剩余问题记录在 [阶段 1–3 验收](../50-ui-design-system.md)。审计的历史验证单独保留，不能用历史测试数量替代本次执行。
