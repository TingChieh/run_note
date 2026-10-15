# 全站 Liquid Glass 按钮

后续增加开发调节面板，并按官方组件修正分层、胶囊外形及弹簧按压；当前实现与验证见 [37-official-glass-buttons.md](37-official-glass-buttons.md)，调节使用方式见 [36-liquid-glass-dev-tuner.md](36-liquid-glass-dev-tuner.md)。以下保留初次引擎接入记录。

## 使用方式

全站原生按钮及 `.button-primary` / `.button-secondary` 样式链接自动获得玻璃材质。首页运动记录箭头继续位于边框上，图标居中。编辑、删除弹窗新增的按钮也会自动接入，关闭时释放相应滤镜。

主要操作和删除确认保留原有颜色语义。日期格保留全年热力色阶，历史记录大卡片与文件选择按钮采用轻量 CSS 材质。光学增强不对这些区域创建独立位移滤镜。

系统浅色/深色自动适配。开启“减少透明度”或系统强制颜色时关闭折射与模糊，恢复实色；开启“减少动态效果”时取消按钮过渡。Chrome 支持背景真实折射，Safari / Firefox 按上游 `backdrop` 模式使用磨砂回退。纯色背景下折射视觉较轻，边缘高光和透光仍可见。

## 来源与文件职责

官方文档：https://liquidglass.dev/docs/ 。仓库：https://github.com/gentpan/liquidglass 。采用核心引擎 v1.0.0，固定提交 `068ad226f53e1ca62d857f78bdc32f58f3c5fce7`。

| 文件 | 职责 |
| --- | --- |
| `frontend/src/lib/vendor/liquidglass/liquid-glass.js` | 未改写的零依赖 MIT 核心引擎；与固定提交逐字节一致 |
| 同目录 `LICENSE` / `README.md` / `liquid-glass.d.ts` | 许可证、来源与 SHA-256、项目实际使用 API 的类型声明 |
| `frontend/src/lib/styles/liquid-glass.ts` | 客户端动态载入、原生按钮光学增强、响应式圆角、动态元素/偏好切换/卸载清理 |
| `frontend/src/lib/styles/liquid-glass.css` | 通用材质、语义颜色、禁用/选中/悬停与无障碍回退 |
| `frontend/src/app.css` | 导入共享材质与浅深色玻璃令牌 |
| `frontend/src/routes/+layout.svelte` | 通过 Svelte action 对应用壳启用增强 |
| `frontend/src/lib/components/ActivityExplorer.svelte` | 删除重复材质定义，继续保留箭头布局和操作 |
| `frontend/tsconfig.json` | 仅排除未经改写的上游 JS 严格 checkJs；调用方仍由同目录声明检查 |
| `frontend/tests/ui/liquid-glass.spec.ts` / `playwright.ui.config.ts` | 新增并注册原生表单与动态引擎生命周期的 Chrome 验收 |
| `frontend/tests/ui/theme.spec.ts` | 颜色检测兼容 `color(srgb ...)` / `color-mix()`，按祖先背景色合成透明填色 |

引擎 SHA-256：`92a62e5b80cfa7e03912b13bdc53aff1c0ae367a5f296de1327e0f62f0579210`。

## 接口与隐私

仅前端材质与客户端装饰逻辑；不修改接口、数据库、认证、上传、活动编辑/删除权限或路由。保留原生元素，不用自定义元素替换按钮，不改变表单提交与键盘语义。

引擎在本地 canvas 生成位移 PNG（data URL）和 SVG 滤镜，无网络请求，无私人 DOM / GPX / TCX 内容复制。运行时没有 CDN 依赖。底图仍按既有规则请求瓦片，轨迹保持浏览器本地绘制。未读写 `.env` 或真实跑步数据。

## 验证记录

2026-10-15，在 Node 22 / 本机真实 Chrome 中执行：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm check` | PASS：0 errors，0 warnings |
| `pnpm build` | PASS：adapter-node 构建成功；既有大 chunk 警告仍在 |
| `pnpm exec playwright test -c .cache/liquid-glass-ui.config.ts --reporter=dot` | PASS：94 passed（1.6m）；临时配置覆盖全部 `tests/ui/*.spec.ts`，使用合成 API 8191 与 Vite 5191 |
| 新增引擎用例 | PASS：原生按钮使用 SVG 背景折射且内容滤镜为 none；Enter 保留表单 required 校验；强制颜色时滤镜清空并能恢复；动态编辑取消按钮接入且关闭后其滤镜释放；日历日期无背景滤镜 |
| 地图键盘焦点回归 | PASS：新增断言先复现 outline 为 none；补充内侧 2px 实线焦点描边及强制颜色 Highlight 后，最终 94 项回归通过 |
| 条纹背景折射对照 | PASS：同一滤镜保持模糊和高光不变，将位移 scale 置零作对照，607 个像素出现显著变化，确认实际折射而非仅模糊 |
| 减少透明度（CDP 媒体偏好） | PASS：背景滤镜 none，SVG filter 实例数归零 |
| 浅色/深色，1440 / 390 / 320px | PASS：箭头 SVG 中心与按钮中心误差 < 1px；无横向溢出 |
| 最终截图 | PASS：复核活动列表、登录、删除弹窗、地图控件、手机与首页运动足迹；证据位于被忽略的 `frontend/.cache/glass-*.png` |
| 固定上游内容与许可 | PASS：固定 SHA 源码 `cmp` 一致，保留 MIT LICENSE |
| `git diff --check` | PASS |

新增首个引擎用例在接入前明确失败：期望 SVG URL，实际只有 `blur(14px) saturate(1.5)`；接入后通过。首次全量 CSS 验证有一项旧颜色解析误判，已改用浏览器解码；最终 94 项为修正并接入引擎后的结果。

另由独立只读代码审查检查 SSR、原生表单、生命周期与隐私边界；发现的地图按钮焦点提示问题已修正，并纳入引擎 UI 用例。

主题对比度自动检查合成背景色，不模拟背景图片、渐变和 SVG 光学采样；因此同时保留真实截图复核。合成环境日志中的部分未提供接口 404 与既有 `replaceState` 弃用警告不代表真实后端结果。

未运行：真实后端/数据库 e2e、后端测试、Safari / Firefox 实机验收；本次没有后端变更，也没有启动/重启开发后端。未做生产部署、提交或推送。合成测试服务在视觉检查结束后关闭。
