# RunNote Design System

本规范提炼现有 RunNote UI。先读本文，再查 [组件](components.md)、[页面模式](patterns.md)、[Tokens](tokens.md)。事实与取舍见 [UI 审计](ui-audit.md)，实施边界见 [分阶段计划](../superpowers/plans/2026-10-16-ui-design-system.md)。

## 品牌语言与视觉不变量

- **核心品牌语言（Editorial Receipt Design）**：RunNote 的视觉设计以项目现有的 Editorial Receipt Design 为核心品牌语言。所有新增或修改的 UI 必须遵循本规范，优先复用已有的 Design Tokens、排版规则及组件，不得自行引入新的视觉体系。强调**排版而非容器、数据而非装饰、品牌一致性而非流行设计趋势**；避免通用 AI Dashboard 风格、过度卡片化（如卡片套卡片、将一组指标拆成零碎小框）及无意义的装饰性胶囊标签。
- **场景边界**：具象票据元素（纸感、存根/账簿编排等）主要用于**记录、报告和分享**场景（如活动记录、周期报告、跑步回顾与分享海报）；表单、导入、设置与管理等**操作型界面**始终以可用性为优先。
- **表面与色彩**：顶部悬浮玻璃导航、暖浅色背景、暖炭灰深色外观、24px 内容卡片与既有胶囊交互控件（导航、按钮、分段控件，区别于无意义的装饰性胶囊标签）。浅色：淡奶油黄页头、品牌绿 Logo、淡绿当前导航与分段滑块、品牌绿主操作；深色：页头无色块，Logo、当前导航、分段滑块与主操作都是中性灰。绿色（`--primary`）始终是强调色，用于数字、链接、进度与开关状态。
- **排版与信息锚点**：系统字体，舒展的中文正文，指标用等宽数字；彩色圆形图标是信息锚点，不能把数据色、状态色与品牌色混用。
- **克制的材质**：普通表面使用边框与留白，控件保留既有 Liquid Glass 材质和弹性反馈；不将所有容器玻璃化。
- **壳层与外观**：私人顶部玻璃条与公开顶部导航分开；详情 hero 保持业务布局；手机导航沿文档流展开。外观支持系统、手动浅色/深色及恢复自动，沿用 `runnote-theme` 和 `watchSystemTheme`，不引入新偏好体系。

## Editorial Receipt 落地规范（评审稿，待确认）

上述品牌语言的具体落地写在 [brand.md](brand.md)：品牌原则、场景分级（票据页 / 档案页 / 操作页 / 记录中）、拟议令牌增量、排版与网格、图表、组件与状态规则，以及 Web / Mobile / Share 的共享与差异。现状诊断见 [Web 审计](web-audit.md)，高保真原型见 [prototypes/](prototypes/index.html)。

| 问题 | 单一来源 |
| --- | --- |
| 品牌语言、场景边界、Agent 流程 | 本文 |
| 落地规则与拟议令牌增量 | [brand.md](brand.md)（确认实施后增量并入 [tokens.md](tokens.md)） |
| 当前令牌实际值 | [tokens.md](tokens.md) → `frontend/src/app.css` |
| 移动端信息架构与记录流状态机 | [移动端方案](../mobile-ui-design/README.md)（视觉以 brand.md 为准） |

在负责人确认前，下方"视觉不变量"中与 brand.md 冲突的条目（24px 内容卡片、彩色圆形图标、淡奶油黄页头、内容区玻璃按钮）仍描述现行实现；确认后由本文统一改写，不另建平行规范。

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

展示包含 PageHeader、FeedbackState、PageSkeleton、MetricSummary、DatePicker、TimePicker、AnchoredPanel 与 GoalRing、ThemeToggle、原生表单和布局组合。依赖 `$app/state`、接口或私有数据的组件通过既有 `playwright.ui.config.ts` 合成路由夹具测试，不在独立入口中伪造运行环境。

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
