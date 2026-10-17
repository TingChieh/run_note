# OpenFreeMap 多底图设计

## 目标与边界

仅升级前端 MapLibre 底图。RouteMap 与 FootprintMap 共享实现；ProvinceMap 是 ECharts，不受影响。保留现有工作区修改，不提交、推送或部署，不修改后端、数据库、指标与代理。

## 最小方案

不整体 setStyle，不重建地图。先初始化本地 background 与 GeoJSON，再获取 OpenFreeMap Positron / Dark / Liberty style JSON，将其 source/layer ID 命名空间化，插入本地业务图层下方。三种在线样式已现场核对，共用 glyphs 与 sprite URL，字体/图标通过公开 MapLibre setter 配置并复用。业务图层、DOM Marker、相机与事件监听器不被删除，选择 paint 也保留。

候选整体 setStyle + transformStyle 虽可重建业务源，但资源加载屏障和重放事件更复杂；重复创建 Map 会丢失相机与交互，不采用。

## 状态与并发

控制器唯一管理 loading/ready/failed/off。每次加载递增 token、AbortController 取消 style fetch、清理旧 timeout 与底图层/源；过期 fetch 与源事件不能影响新代。ready 必须确认当前所有底图源和 style 加载完成；8 秒超时或网络错误只清除底图，恢复本地主题背景，允许重试。销毁移除监听器、取消请求与定时器。

## 偏好与控件

本机 runnote-basemap 只存 positron/dark/liberty；自动模式移除该键。沿用 watchSystemTheme 的实际页面主题，自动模式 light=Positron、dark=Dark；手动模式不被主题覆盖。监听同页面事件与 storage，多个地图同步。关闭底图保留选择，主题变化不重新开启。

右上角原生 Popover 按钮（位于导航缩放控件左侧），用普通按钮组 aria-pressed，提供三种样式及自动模式，原生 Escape/外点关闭和焦点行为；使用现有 Token 与 button-secondary。补独立 showcase。

## 归属与隐私

使用 MapLibre AttributionControl 消费真实 TileJSON 的署名（包含 OpenFreeMap 提供方链接）；不再输出旧单一 OSM 手工署名。仅请求公开 style、sprite、glyph 和视口瓦片，不发送轨迹或身份信息。关闭底图删除源，停止后续瓦片调度。

## 验证

单元测试覆盖选择解析、自动/手动策略、命名空间与源引用。真实 Chrome 使用合成 API 与网络夹具验证三种切换、快速切换、相机/多段/Marker/选择/热区保留、主题、刷新、失败、超时与重试，并另测真实 OpenFreeMap 网络。执行前端全量单测、check 和 build。合成测试不等同真实业务库验收。
