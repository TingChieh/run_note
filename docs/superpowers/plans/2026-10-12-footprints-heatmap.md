# 足迹地图实施计划

目标：交付已批准设计的本人轨迹叠加和活动次数热力图。直接在用户指定工作区实施；不提交或推送。

技术：现有 SvelteKit/TypeScript、FastAPI、PostGIS、MapLibre。无迁移、无新依赖、无 .env 变更、无 Docker、无公开/分享/AI。

- [x] 后端红绿：新增 tests/integration/test_footprints.py，真实空间数据验证线穿过无采样点网格、密集/稀疏一致、同次多段/绕圈去重、多次频率、跨用户、日期、单点、日期变更线、极区与预算。仅现有独立测试库。
- [x] 新增 modules/footprints/{router,service}.py；GET /api/v1/footprints?date_from&date_to&mode；身份确定 owner，按 activity_date 左闭右开。固定 100m EPSG:3857 原点网格，完整边相交 COUNT(DISTINCT activity_id)，输出明确口径和数量。注册 main.py。
- [x] 前端红绿：tests/unit/footprints.test.ts 验证筛选日期、刷新恢复、输入验证、认证路径和 API 响应。
- [x] 新增 lib/api/footprints.ts、components/FootprintMap.svelte、routes/footprints/+page.svelte；修改导航与保护路径。URL 保存筛选/模式；取消旧请求和迟到响应防护；MapLibre 点/线/网格、重叠选择、记录详情、图例、空状态、底图失败降级。
- [x] 使用已有服务更新代码并真实 Chrome 交互验收，正常认证和导入合成数据，核对多段、频率、筛选/刷新、详情、无数据、瓦片失败及隔离。
- [x] 运行相关后端完整回归、pnpm test/check/build、Ruff check/format、git diff --check。更新 README、docs/09 与 docs/13 验收记录，明确未验证范围。

测试命令使用 backend/.venv/bin/pytest 与 frontend 的 pnpm。现有独立目标凭据从进程加载，不打印、不写回配置。后端查询 5 秒 statement_timeout，小于现有代理 8 秒；参数/输出超限使用统一错误。热度不采用可视化简化线。测试逐项执行后填写实际结果。

最终证据：docs/13-footprints-heatmap-acceptance.md。后端226项、前端32项、类型/构建/Ruff、真实Chrome通过；独立审查边界问题均修复复核。
