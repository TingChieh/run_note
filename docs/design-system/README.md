# RunNote Design System

本规范提炼现有 RunNote UI。先读本文，再查 [组件](components.md)、[页面模式](patterns.md)、[Tokens](tokens.md)。事实与取舍见 [UI 审计](ui-audit.md)，实施边界见 [分阶段计划](../superpowers/plans/2026-10-16-ui-design-system.md)。

## 视觉不变量

- 绿色运动导航、黄色页头、暖浅色背景、绿色系深色外观、24px 内容卡片与胶囊控件。
- 系统字体，舒展的中文正文，指标用等宽数字；彩色圆形图标是信息锚点，不能把数据色、状态色与品牌色混用。
- 普通表面使用边框与留白，控件保留既有 Liquid Glass 材质和弹性反馈；不将所有容器玻璃化。
- 私人侧栏与公开顶部导航分开；详情 hero 保持业务布局；手机导航沿文档流展开。
- 外观支持系统、手动浅色/深色及恢复自动。沿用 `runnote-theme` 和 `watchSystemTheme`，不引入新偏好体系。

## Agent 必须遵循的流程

1. 先阅读 Design System，并定位当前页面、调用方与现有未提交修改。
2. 查找已有组件、CSS 类、原生控件和增强 action；没有同名组件文件不表示缺少能力。
3. 找最接近的真实页面和 Pattern，延续结构、状态、断点和阅读顺序。
4. 使用已有语义 Token。新增颜色或稳定间距扩展 `app.css`，不能另建平行色板或在页面散落固定色值。
5. 新设计延续上述视觉语言；未经允许不得改全局主题、品牌风格或批量重写页面。
6. 只有真实重复需求成立才新增公共组件；同时补组件文档与独立展示，保持 API 命名与既有实现一致。
7. 验证响应式、主题、键盘、焦点、交互状态、加载/空/错/成功与缺失值；区分合成 UI 与真实业务验收。
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

隔离脚本先要求已有生产 build，再使用 8191 内存 API 和 5194 adapter-node 检查四个路径 404、产物无展示标识，结束关闭本次进程。端口被占用时拒绝运行，不复用或停止已有服务。不要与占用 8191 的业务 UI 测试同时执行。

展示包含 PageHeader、FeedbackState、PageSkeleton、MetricSummary、DatePicker、ThemeToggle、原生表单和布局组合。依赖 `$app/state`、接口或私有数据的组件通过既有 `playwright.ui.config.ts` 合成路由夹具测试，不在独立入口中伪造运行环境。

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
