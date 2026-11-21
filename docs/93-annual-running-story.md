# 跑步年度故事（时空长卷）

## 使用方式

登录后，可通过以下两个既有入口进入本人年度故事页面（`/workspace/records/story?year=YYYY`，不新增全局一级导航）：

- 在「个人记录」的周期报告卡片切换到「年度」模式后点击「查看年度故事」；
- 在「跑步回顾」（`/workspace/records/recap`）的年度视图中点击顶部「查看年度故事」。

页面采用经确认的 **Direction A · 时空长卷（Chronicle Scroll）** 结构，桌面端（`>= 1080px`）为左叙事长卷 + 右侧粘性离线路线舞台（`position: sticky`），平板与手机端自动切换为单栏线性叙事并内联章节舞台：

1. **序章（Prologue）**：年度总览、当年进行中截止注记（如适用）、总里程/总次数/总天数/平均配速与年度最长连续天数/周数，并提供年份切换与快捷打开海报。
2. **01 · 年初第一跑**：当年首条跑步记录的日期、里程、用时、配速、城市（如有）、跑鞋（如有）及简化轨迹（无轨迹时自动降级展示里程标尺）。
3. **02 · 年度最长路线**：当年最长单次距离（包含无轨迹室内/手动记录；无轨迹时在舞台以等距里程标尺呈现，并列最长时展示并列次数，与第一跑相同时给出说明）。
4. **03 · 年度最佳表现**：按标准距离档位（`10km` → `半马` → `全马` → `5km` → `3km`）选取当年最快合格配速并标注是否为历史全时期 PB 与年内提速幅度；无标准档位时回退至 `>= 1 km` 最快单次；全部无合格配速时回退至年度最长里程。
5. **04 · 探索城市**：当年涉及城市总数、年内新解锁城市数、地区覆盖数、已定位与未定位活动数，以及可点击聚焦至离线舞台的城市列表；缓存待补全时展示温和提示而非阻断页面。
6. **05 · 最常跑路线**：复用 `route_groups` 按年份聚合出现次数 `>= 2` 的最常跑路线，呈现次数、占比、中位距离、年内首/最快/均配速变化、12 个月频次条及最多 16 条叠加轨迹；路线索引构建中或年内无重复路线时显式降级。
7. **06 · 年度足迹动画**：在离线 Canvas 2D 舞台按时间顺序逐条绘制当年简化轨迹，同步推进日期、累计里程、城市与里程碑徽章；支持播放/暂停、重播、`1×`/`2×`/`4×` 调速与进度条拖拽，底部提供 `<details>` 完整无障碍轨迹数据表；无 GPS 轨迹时降级为 12 个月里程脉动轨道，命中 `prefers-reduced-motion` 时默认静态展示完整年度轨迹。
8. **尾声 · 9:16 纪实海报（`纪实卷轴`）**：通过原生 `<dialog>` 实时在本地 Canvas 2D 渲染 `1080 × 1920` PNG，支持浅色/深色外观以及「隐藏城市名称」「隐藏路线名称」两项隐私开关，下载/系统分享与 Object URL 清理均在本地完成。

## 接口与隐私边界

- 后端新增只读私人聚合接口 `GET /api/v1/statistics/annual-story?year=YYYY`（无需数据库迁移或新建表，不写入任何数据），使用 `Depends(get_read_identity)` 鉴权并返回 `Cache-Control: private, no-store`，额外/重复查询参数返回 `422`。
- 严格仅聚合当前登录用户本人数据，不暴露任何他人 ID 或跨用户存在性（他人活动仍保持统一 `404`）；不暴露至 `/showcase/*`、`/public/*`、`/shared/*` 或 AI 报告；不读取或引用 `wellbeing` 模块的任何数据。
- 轨迹舞台与海报均完全离线渲染（无外部瓦片或外域网络请求），并对时间线长度（`<= 366` 条，必保里程碑）、单条折线点数（`<= 48` 点）与常跑叠加条数（`<= 16` 条）做上限控制；跨越国际日期变更线的坐标采用展开投影处理。
- 9:16 分享图默认仅绘制年度叙事汇总、简化几何与可选城市/路线名（用户可一键隐藏），绝不绘制邮箱、用户名、账号/活动 ID、备注、头像、原始高精轨迹坐标或身心健康数据。

## 设计与参考资产

- Phase 1 探索规范与三方向对比：`docs/superpowers/specs/2026-11-21-annual-story-design.md`
- 静态原型与截图归档：`docs/assets/2026-11-21-annual-story/`（含生产页明暗/多视口/动画关键帧/海报/降级态截图 `prod-screenshots/`）

## 验证覆盖

- 后端单元与集成测试：`backend/tests/unit/test_annual_story.py`、`backend/tests/integration/test_annual_story.py`（真实 PostGIS 校验全部 6 个故事节点、跨用户隔离、无写副作用、空年/未来年/进行中/无轨迹降级与严格查询参数）。
- 契约与架构守卫：`backend/tests/unit/test_api_contract.py`、`backend/tests/unit/test_architecture.py`、`backend/tests/unit/test_wellbeing.py`、`frontend/tests/contract/api-types.ts`、`frontend/tests/unit/api-contract.test.ts`。
- 前端单元测试：`frontend/tests/unit/story.test.ts`、`frontend/tests/unit/story-poster-render.test.ts`。
- 浏览器 UI 与真实后端 E2E 测试：`frontend/tests/ui/annual-story.spec.ts`、`frontend/tests/e2e/annual-story.spec.ts`（含 `records.spec.ts` / `recap.spec.ts` 回归验证）。
