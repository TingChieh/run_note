# 多矢量底图与选择菜单

## 使用方式

活动详情、活动足迹预览和足迹地图右上角的“图层”提供 Positron、Dark、Liberty 与“自动（跟随外观）”。自动模式跟随实际页面主题（包括手动切换外观）；手选底图不被主题变化覆盖。偏好仅保存本机 `runnote-basemap`，恢复自动会移除此键。原有“关闭底图”“重试底图”保留，关闭后主题变化不会自动开启。

菜单直接复用项目的 rn-glass-menu、rn-menu-option、createGlass 和 createIndicator，选项不是单独的玻璃胶囊。使用稳定容器定位，在退出动画完成后释放光学层，支持鼠标、Tab、Enter、Escape 和外点关闭。独立 showcase 提供无地图请求的控件示例。

## 实现范围

- `frontend/src/lib/api/map-style.ts`：本地背景、三样式偏好与命名空间转换，保留本地数据颜色逻辑。
- `frontend/src/lib/map/basemap-controller.ts`：仅管理外部底图资源、8 秒超时、取消与代号、失败降级和监听器清理。
- `RouteMap.svelte` / `FootprintMap.svelte`：接入共享控制器、Picker、真实 AttributionControl，保留既有 GeoJSON、Marker、相机、选择、事件和城市定位。
- `BasemapPicker.svelte`：重复使用的底图入口与项目风格浮层。
- 足迹页只更新底图提供方/隐私说明；不改 API 与统计。
- 测试：map-style 单测、合成 MVT 与 API 夹具、真实 Chrome 底图场景及主题夹具；独立真实供应商网络配置。
- 设计系统与 showcase：记录可复用组件 API，示例不接入生产导航。

现场检查发现仅 RouteMap、FootprintMap 消费 map-style。ProvinceMap 使用 ECharts，中国省份图与 RouteThumbnail 的本地 SVG 不需要底图切换。

## 接口与隐私

没有后端、数据库、运动指标算法或代理改动。底图系统仅 GET OpenFreeMap 的公开样式、字体、sprite 与当前视口瓦片；轨迹仍是浏览器内 GeoJSON，不携带在第三方请求里。测试只用合成账号/路线，不连接开发库。真实 TileJSON 的归属由 MapLibre AttributionControl 展示，含 OpenFreeMap、OpenMapTiles、OpenStreetMap。

不调用 map.setStyle，不重建 Map；provider source/layer 名称按代号命名空间化，图层插入本地业务层之下，切换时删除的只有 provider 层/源。样式 fetch 可取消；过期响应和旧 source 错误不能影响当前代。ready 要求当前 style 与源实际加载，超时或失败恢复本地背景。三种实际样式已核对使用同一 glyph/sprite URL。sprite 通过当前锁定版本正式导出的 Style.setSprite 完成回调封装共享 Promise，每代等待并核对 token 后才安装外部层；失败重试重置 sprite 与 glyph 请求缓存，加载中关闭后再开启也会重新请求。旧代无 sourceId 的异步错误不再删除新底图；当前源加载状态与超时继续负责降级。

图层菜单闪烁修复：使用稳定 wrapper 的边界，打开时同步测量，不读取按压缩放中的按钮矩形；关闭后保留光学层 240ms，覆盖共享 CSS 的 220ms 退出动画；横向位置限制在视口内。清理时取消延迟释放任务，连续打开不重复创建效果或订阅。

### 按压阶段的追加修复

用户继续反馈按住按钮仍闪烁。上一轮开关测试没有覆盖按住过程的光学层逐帧状态。新增 Chrome 复现显示：按住“图层”的 20 帧中，backdrop-filter 引用由 `v3` 连续替换为 `v4` 至 `v23`，同时重建 lens 几何。此过程在 WebGL 地图上反复使合成表面失效。

本次仅在 RouteMap 覆盖区域和 BasemapPicker 容器标记 `data-glass-stable`，在 `styles/liquid-glass.ts` 对这些控件保持 atlas/clip/refraction 参数稳定，使用原有 press spring 缩放同一表面，保留按压反馈、阴影、高光、颜色与原生点击区域。上游玻璃引擎与其他按钮的形变逻辑不改。覆盖“图层”和“关闭底图”，足迹地图的图层入口也复用相同组件；缩放按钮保留原有独立按压效果。

新增测试先失败（20 个滤镜地址），修复后通过；分别检查桌面浅色与 390px 深色中的按住、移出、松开，要求滤镜与 clip 在 20 帧中稳定、表面确有弹簧形变并回到原位。后续回归结果见下方追加记录。

## 验证记录

2026-10-16，原生 Node/pnpm + Chrome，以下均实际执行：

- `pnpm test`：24 文件，142 测试通过，包含控制器超时、关闭中失败、重试与迟到 sprite 错误的回归。
- `pnpm check`：0 错误、1 警告，来自并行 ActivityWallPreview 的 unused CSS selector（与本次底图无关）。
- `pnpm build`：最终 adapter-node 构建成功，既有大 chunk 提示与上述 unused CSS 警告。
- `pnpm exec playwright test --config playwright.basemaps-live.config.ts`：1 通过；真实三样式、字体、sprite、矢量瓦片加载并绘制，真实归属与相机保留通过。
- `pnpm exec playwright test --config playwright.basemaps.config.ts`：9 通过；多段轨迹/Marker/相机、三样式、自动/手动/刷新/快速切换、足迹选择/点击、热区、超时、sprite/glyph 悬挂后恢复，以及反复开关菜单、退出材质与 320/390/1440px 边界。
- `pnpm exec playwright test --config playwright.ui.config.ts footprints.spec.ts --retries=1`：18 通过，未触发重试；包含 25 万点合成性能、城市定位、重叠轨迹、热区、WebGL 重绘、轮询及数据兜底。
- `pnpm exec playwright test --config playwright.ui.config.ts theme.spec.ts sport-detail.spec.ts map-framing.spec.ts`：17 通过。

曾中断两个长批次回归：出现页面导航等待超时（含尚未创建地图的 login 页面），未将这些中断运行计为通过；独立足迹全套重跑已通过。第一次底图批次在源码热更新期间出现一次菜单关闭断言失败，之后独立及完整 9 场景重跑通过。

17 项回归通过的同时，开发服务器曾在公共详情路径输出共享 `+layout.svelte` SSR TypeError/500；现有主题测试没有断言该次响应状态，不能将通过数解释为公共详情无 SSR 错误。该路径不展示坐标底图，本次未改布局，尚未确定此开发态日志原因。另有既有 replaceState 弃用提示。

真实供应商 Liberty 样式请求 `wood-pattern`，现场检查实际公共 sprite JSON 不包含此图案，Chrome 因此给出一次缺图警告；不是切换丢失本地图层，轨迹与矢量底图仍正常绘制。此处不替供应商虚构填充图案。

### 按压修复追加验证（2026-10-16）

- `pnpm exec playwright test --config playwright.ui.config.ts basemaps.spec.ts liquid-glass.spec.ts`：25 通过，0 失败；包含新增两项逐帧按压测试，以及缩放按钮的独立形变、键盘/焦点、原有按钮、菜单、滑块、回退与清理回归。已检查浅深色按压截图。
- `pnpm check`：0 错误、0 警告。
- `pnpm test`：24 文件、143 测试通过（包含工作区其他并行改动的当前测试集）。
- `pnpm build`：退出码 0，adapter-node 完成；保留既有大 chunk 提示。
- 只读核对当前 `127.0.0.1:5183` 为本仓库 Vite dev，并确认其实际提供的 glass 模块包含修复；没有重启用户开发服务。
- 本轮未重复运行真实供应商联网测试、数据库 e2e 或整套 UI；本次不改变底图请求与地图生命周期。此前真实供应商与其他回归的结果单独保留，不冒充本轮重跑。

### 底图开关样式统一（2026-10-16）

RouteMap 的“关闭底图／开启底图”移除旧的独立圆角、字号和间距类，直接使用项目 `button-secondary`，与“图层”和 FootprintMap 开关保持胶囊圆角、字号、间距、最小高度及材质一致；保留 `data-glass-stable` 按压机制、开关事件、禁用与 aria-pressed。仅修改这一处 class。

本次 `pnpm check` 为 0 错误、0 警告；`pnpm exec playwright test --config playwright.basemaps.config.ts --grep 'pressing map overlay|automatic theme'` 为 3 通过，已检查浅色按压截图。未重复运行全量单测、构建、真实供应商测试或数据库 e2e。

## 未运行与验收边界

不执行后端/数据库集成或注册写入真实库的 e2e，不重启开发服务，不提交、推送、部署。合成 API 的通过不等同于真实业务库验收；供应商可用性随网络变化，代码保留降级与重试。

工作区存在并行足迹卡片开发，曾在 320px 出现既有卡片横向溢出；底图测试分别验证自己的按钮/浮层视口边界，不借本次修改重写卡片布局。
