# 多底图实施计划

**目标：** 两类 MapLibre 地图在保留本地业务层与相机的前提下切换 OpenFreeMap 三种样式。
**架构：** api/map-style.ts 提供本地样式、偏好策略与样式命名空间；map/basemap-controller.ts 管理底图资源生命周期；BasemapPicker 提供重复使用的原生 Popover。
**约束：** 仅前端；保留工作区未提交内容；不提交、不改数据库及后端。

- [x] 1. 先写并执行 map-style 单测：本地初始化无外部资源，手动与自动选择、未知偏好回退、外部 style 转换不碰业务 ID/GeoJSON。
- [x] 2. 实现共享控制器：可取消 fetch、递增代号、8 秒超时、真实 ready、失败只移除底图、销毁监听器；无 setStyle/fitBounds 与轨迹复制。
- [x] 3. 集成两个组件与共用 Picker，保留关闭/重试、Markers、数据更新与选择；使用真实署名，更新隐私说明和 showcase/组件规范。
- [x] 4. 写真实 Chrome 测试：合成 style 与本地数据验证成功/错误/快速竞争/主题/持久化/热区/选择；真实 OpenFreeMap 样式单独验收。更新旧 OSM 网络夹具，保证既有地图测试可继续验证降级。
- [x] 5. 执行 pnpm test、pnpm check、pnpm build 与地图/主题回归；审阅截图与 diff；在 docs/52-vector-basemaps.md 记录实际结果、未验证内容和使用方式。
