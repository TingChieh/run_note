# Liquid Glass 通透增强与开发调节

> 当前官方按钮结构、默认值和照片预览已由 `37-official-glass-buttons.md` 更新。下方验证记录保留各轮真实执行结果。

## 使用方式

在 `frontend/` 运行既有 `pnpm dev` 开发前端后，点击右下角 **玻璃调节**。面板有彩色底纹的按钮预览，四个滑块同时影响整页按钮：

| 参数 | 范围 | 新默认值 |
| --- | --- | --- |
| 透明度 | 45–95%（越大越透明） | 86% |
| 折射强度 | 0–32px | 14px |
| 模糊程度 | 0–8px | 0px |
| 边缘高光 | 0–1 | 0.6 |

“通透增强”恢复当前推荐效果；“柔和磨砂”便于对照；“恢复默认”还会清除本地调节偏好。滑块支持键盘方向键；Escape 收起面板并将焦点还给入口。窄屏面板限制宽高，自身可滚动，不撑宽页面。

参数仅保存在当前浏览器。刷新会保留调节结果；存储禁用时仍可实时预览。面板不会自动更改源代码默认值。生产构建采用统一的新默认效果，不显示调节入口，也不读取开发参数。

主操作与删除确认采用随透明度变化的语义染色，并分别配置浅深色文字；日期色阶、历史卡选中标记、地图键盘焦点和禁用语义保留。浅色/深色预览底纹使用不同色阶，保证预览文字可见。系统“减少透明度”和强制颜色设置优先，开发滑块不能覆盖它们。

## 文件与实现

| 文件 | 本轮职责 |
| --- | --- |
| `frontend/src/lib/components/LiquidGlassTuner.svelte` | 开发浮动入口、4 滑块、预设/恢复默认、有色底纹预览、键盘和窄屏布局 |
| `frontend/src/lib/styles/liquid-glass-settings.ts` | 默认值和范围、有限数值验证、专用开发存储、变更通知 |
| `frontend/src/lib/styles/liquid-glass.ts` | 更新根透明度变量和已有引擎实例，按帧合并变化；非 Chrome 同步磨砂回退 |
| `frontend/src/lib/styles/liquid-glass.css` / `frontend/src/app.css` | 更通透材质、语义墨色、系统偏好覆盖、浅深色预览令牌 |
| `frontend/src/routes/+layout.svelte` | `import.meta.env.DEV` 内动态载入面板，卸载时防止过期赋值 |
| `frontend/src/lib/vendor/liquidglass/liquid-glass.d.ts` | 补充原引擎已有 `engine` 导出类型；上游原始 JS 未修改 |
| `frontend/tests/unit/liquid-glass-settings.test.ts` | 无效、非有限、未知和越界设置验证 |
| `frontend/tests/ui/liquid-glass.spec.ts` | 开发参数实时变化、原位更新、刷新记忆、恢复默认、键盘、存储失败与系统偏好优先 |
| `frontend/tests/ui/activities.spec.ts` | 空状态断言限定到活动区域，并允许区域名称包含加载后的活动计数 |

## 接口与隐私

没有新增接口、数据库字段或后端调用；不启动/重启开发后端、不修改数据库或 `.env`。现有活动、认证与上传逻辑不变。

开发设置仅包含四个外观数字，键为 `runnote:dev-liquid-glass:v1`，范围校验后保存。没有账号、位置、活动或文件数据；不上传调节结果。生产构建不包含面板模块、文案或该存储键，未增加运行时 CDN。已有引擎的来源和 MIT 许可见 `35-liquid-glass-buttons.md`。

## 验证记录

2026-10-15，使用 Node 22、本机真实 Chrome、合成 API 8191 / Vite 5191；生产隔离前端 5291 同样只连接合成 API。

- `pnpm check`：0 errors / 0 warnings。
- `pnpm test`：18 个文件、108 项单元测试通过，包含 2 项新增设置验证。
- `pnpm build`：adapter-node 构建成功；既有大 chunk 警告保留。
- `pnpm exec playwright test -c .cache/liquid-glass-ui.config.ts --reporter=dot`：最终全部 96 项 Chrome 合成 UI 通过（1.9m），涵盖整页调节、动态按钮、原生表单、地图焦点、存储失败和系统偏好。合成服务和生产检查用前端均已关闭。
- 初步相关 UI：`liquid-glass.spec.ts theme.spec.ts` 9 项通过。后续新增存储失败/系统偏好用例，纳入全量回归。
- 首次面板验收在缺少“玻璃调节”入口时失败；接入后可实时调节。折射改变时 SVG 位移 scale 变化且滤镜实例标识保持，确认更新已有实例。
- 透明度 45 / 78 / 95% 的主按钮计算对比度：浅色 6.86 / 11.79 / 15.04；深色 5.47 / 9.27 / 11.89，均大于 4.5。计算基于填色与祖先背景合成，另人工复核实际截图。
- 浅深色 1440 / 390 / 320px：没有页面或面板横向溢出；Escape 归还焦点。最终截图在被忽略的 `frontend/.cache/glass-tuner-*.png`。
- 生产 bundle 检查：59 个 JS/CSS 文件中均无面板文案、`tuner-panel` 或开发存储键。
- 真实 Chrome 生产页面：预置极端开发参数后，开发存储读取计数为 0，无调节入口，默认 opacity 为 0.22。
- 独立只读代码审查：未发现待修正 P1/P2，核查了生产隔离、生命周期、SSR、系统偏好、存储边界和键盘/窄屏布局。
- `git diff --check`：通过。

全量回归曾暴露旧活动空状态测试的定位问题：全局 status 同时匹配侧栏跑量加载和活动提示；将区域限定为“我的活动”时还需允许标题追加“（0）”计数。已改为稳定区域前缀匹配，单项回归 1 passed（3.4s），未修改活动业务代码。

未运行真实后端/数据库 e2e、后端测试及 Safari / Firefox 实机验证。Chrome 使用背景折射；其他引擎沿用官方磨砂回退。未提交、推送或部署。

### 相邻分段按钮阴影修正（2026-10-15）

在真实 Chrome 复现“轨迹叠加 / 运动热力图”相邻按钮各自带 `0 4px 14px` 外阴影、亮边重叠的问题。共享材质 CSS 改为整组承担一道半透明 `0 2px 6px` 轻阴影，按钮仅保留细内边；引擎 action 对 `.mode-switch` 内控件采用较窄光学边缘（bezel 0.35），折射和高光分别随开发参数的 40% / 30% 更新，减轻双重亮边。其余按钮仍使用原材质参数。上游引擎、页面布局、切换逻辑、接口与数据库未改动。

- `pnpm check`：0 errors / 0 warnings。
- `pnpm build`：成功，保留既有大 chunk 警告。
- `pnpm exec playwright test -c playwright.ui.config.ts footprints.spec.ts liquid-glass.spec.ts theme.spec.ts --reporter=dot`：18 passed（24.6s）。
- 额外 Chrome 合成数据检查：浅深色 1440 / 390 / 320px 无横向溢出；鼠标与 Enter 切换、键盘焦点、强制颜色去阴影，以及开发透明度 95% / 高光 1 均正常。人工复核截图位于忽略目录 `frontend/.cache/group-shadow-after-*.png`。
- 本轮只启动隔离 Vite / 合成 API，验证结束后已关闭；未运行真实后端/数据库 e2e 和 Safari / Firefox 验证。没有新增单元测试（局部视觉修正），没有启动或重启开发后端。
