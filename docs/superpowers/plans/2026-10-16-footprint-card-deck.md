# 详情足迹堆叠与完整记录切换实施计划

目标：右侧铺满自适应堆叠卡片，两侧箭头直接切换完整记录，保留返回来源并平滑移动。

- [x] 修改 `tests/ui/footprint-card-deck.spec.ts`：先确认固定三张、预览模式及底部控件不符合新需求。
- [x] 修改 `ActivityWallPreview.svelte`：ResizeObserver 自适应容量、左右控件、FLIP/进入离开动画、分页缓存与失败重试；调用 `onswitch(id)` 更新详情。
- [x] 修改详情页面：准备新详情与路线后 shallow replace URL；保留卡片组件，管理/分享按 ID 重建，旧响应隔离；根布局跳过 shallow 全页 loading。
- [x] 检查真实 Chrome 中宽屏/320px、动画/触屏/键盘/减少动态效果、跨页、首尾、慢请求/失败/401、刷新及返回原足迹墙页码。
- [x] 运行前端 check、unit、build 和 diff 检查，更新编号验收记录及组件目录。

执行结果及未通过的扩展检查见 `docs/51-footprint-card-deck.md`；不把运行完毕等同于全部检查通过。

保留其他未提交修改；不更改后端接口、数据库，不提交或推送。
