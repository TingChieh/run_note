# 个人足迹页流畅度优化

## 使用方式

`/footprints`（以及 `/p/{username}/footprints`、`/workspace/footprints` 复用的同一页面）的外观与操作不变，只改善切换和加载体验：

- **模式切换**：“轨迹叠加”与“运动热力图”之间来回切换时，已加载过的模式立即显示，不出现骨架屏，也不重建地图；页面在后台静默重新读取，数据未变化时保持原对象，地图不重绘。首次进入某个模式仍显示骨架屏。
- **等待生成**：快照处于 `pending` 时，页面每 5 秒静默检查一次，不再每次清空并重绘；生成完成后才替换为结果。
- **地图复用**：数据变化时对现有 MapLibre 实例调用 `source.setData()`，同时重置选中记录、热区分页和取景，不再销毁并重建 WebGL 地图。
- **城市识别**：城市入口出现得更快，结果与优化前完全一致。
- **重新读取足迹**：按钮行为不变，仍是清空缓存的完整重载（骨架屏、重新建图），用于用户明确要求刷新的场景。

## 改动范围

仅前端与测试，无后端、接口、数据库或依赖变更。

- `frontend/src/routes/footprints/+page.svelte`
  - `data` 使用 `$state.raw`，大体积 GeoJSON 不再被深度代理，仅整体替换。
  - 新增按模式的“最近一次就绪结果”缓存；切换命中缓存时直接显示并以 `load(true)` 后台重新验证。后台验证失败且屏幕已有数据时保留现有内容；401 仍清除私人状态并跳转登录。
  - `load(silent)`：静默模式不清空 `data`、不置 `loading`；pending 轮询使用静默模式。
  - URL 更新（`goto`）与数据请求并行，请求不再等待导航完成。
  - 移除 `{#key data}`，仅保留 `{#key mapVersion}`（地图出错重试）。新增 `reload()`，清缓存后完整重载。
  - 保留既有的 `disposed` 标志、单调请求令牌和迟到响应丢弃。
- `frontend/src/lib/components/FootprintMap.svelte`
  - 新增 `applyData()` 与 `$effect`：数据变化时更新现有源、重置选择与分页、重新取景并重新识别城市；首次加载用同一份最新数据，避免快照过期。
  - 就绪检测由每帧触发的 `render` 回调改为一次性监听，就绪后立即 `off`。
  - 给城市 worker 传递几何时去掉多余的 `$state.snapshot` 深拷贝（数据已是非代理对象）。
- `frontend/src/lib/map/footprint-cities.ts`
  - `touchesLine` 加入精确的预过滤：轨迹包围盒与多边形包围盒不相交则跳过；仅对落在多边形包围盒内的点做“点在多边形内”判断；线段相交只比较落在轨迹包围盒内的边界边。判定语义（点在内部或边界、孔洞、日期变更线跳过）保持不变，不做采样近似。
- `frontend/tests/ui/footprints.spec.ts`
  - 新增用例：切回已加载模式时复用同一个地图画布、无骨架屏、图例随模式更新，并且仍发出一次重新验证请求。

## 接口与隐私

- 不新增、不修改任何 API；仍使用 `/api/v1/showcase/footprints/all?mode=`，响应校验与白名单重建不变。
- 缓存只存在于页面内存中，随页面卸载释放；不写入本机存储，也不跨账号保留。401 时缓存与私人状态一并清除。
- 轨迹 GeoJSON 仍只留在浏览器内，不进入任何第三方请求；城市识别仍在本地 Worker 中运行。
- SSR 代理白名单未改动。

## 测量与决策

用合成数据（所有点集中在同一区域，作为偏保守的压力情形）在 Vitest 中计时：

| 步骤（主线程） | 10 万点 | 250 万点 |
| --- | --- | --- |
| `footprintDisplayData` + `displayFootprints` + `geometryBounds` + 上色 | 约 13 ms | 约 23 ms |

主线程几何处理不是瓶颈，因此未做进一步改动。城市识别（Worker 内）优化前后：

| 规模 | 优化前 | 优化后 |
| --- | --- | --- |
| 10 万点（200 × 500） | 540 ms | 175 ms |
| 100 万点（1000 × 1000） | 7.7 s | 1.6 s |
| 250 万点（1000 × 2500） | 18.8 s | 4.0 s |

后端响应：用合成快照比较 FastAPI `response_model` 路径与手写 `JSONResponse`，前者 100 万点约 53 ms，后者约 464 ms，说明序列化不是瓶颈，也不应绕过 `response_model`。坐标由 9 位小数降为 6 位只缩小约 20%（29 MB → 23 MB）。

站主真实数据（只读查询得到的体积，不含任何记录内容）：170 条记录，`tracks` 快照约 5.5 MB，`heatmap` 约 67 KB，低于 10 MB 的决策阈值，因此**未做**服务端抽样。

### 明确未做及原因

- **后端 ETag / 304**：SSR 代理只放行 7 个请求头，不含 `If-None-Match`，不得扩大白名单。
- **响应压缩**：代理会移除 `content-encoding`，浏览器侧压缩属于前置反向代理的部署职责。
- **坐标精度降为 6 位**：现有集成测试要求展示几何与数据库原值逐点相等，且需要提升 `ALGORITHM_VERSION` 并重建全部快照；收益仅约 20%。
- **服务端展示用抽样**：会改变公共响应（轨迹不再是全分辨率）；当前真实体积不需要。若快照体积超过约 10 MB，应先写设计说明，评估影响范围后再决定。
- **点击高亮改用 `feature-state`**：同一活动有多个轨迹段，`promoteId` 的行为不够确定，收益也小。
- **另一模式的空闲预取**：会多发一个请求，需要改动多处依赖请求计数的既有用例。

## 验证记录

2026-10-22，原生 Node/pnpm，真实 Chrome，合成 API（`playwright.ui.config.ts`），不连接任何数据库。

| 实际执行 | 结果 |
| --- | --- |
| `pnpm check` | 0 errors / 0 warnings（570 files） |
| `pnpm test`（Vitest） | 30 files / 176 tests passed |
| `pnpm exec vitest run tests/unit/footprint-cities.test.ts`（优化城市识别后） | 6 passed |
| Playwright：`footprints`、`footprint-card-deck`、`map-framing`、`showcase`（含新增用例） | 58 passed |
| 与远程部署提交变基合并后复跑 `pnpm check`、`pnpm test`、Playwright `footprints` + `map-framing` | 0 errors；176 passed；23 passed |

### 未运行

- 后端测试与 Ruff（本次未改后端）。
- `pnpm build`。
- `infra/native/tests` 部署脚本测试（来自远程提交，本次未执行）。
- 真实后端上的 e2e：没有配置独立测试库。
- 开发服务未重启，改动未在运行实例上手动验证。
- 性能数字均来自合成数据，未在浏览器 Performance 面板用真实数据复测。

## 剩余风险

- 切回已缓存模式时，会短暂显示上一次读取的结果，随后静默重新验证并在数据变化时替换；这段窗口内用户可能看到略旧的快照。
- 优化只针对前端。如果日后快照体积明显增大（约 10 MB 以上），传输量会成为主要瓶颈，需要重新评估服务端抽样。
