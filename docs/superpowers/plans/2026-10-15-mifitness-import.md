# Mi Fitness 跑步导入实施计划

> 按已确认的设计在当前会话执行。前后端使用固定接口契约分工，逐项测试与复核；不提交 Git、不迁移开发库、不导入真实数据。保留现有未提交修改。

**目标：** 支持本机 Mi Fitness 跑步汇总与可选 GPX 合并导入，增加 8 个私人设备指标。

**架构：** 新建 `mifitness` 模块；复用 GPX 的并发锁、隔离解析、规范哈希、轨迹清洗与持久化辅助函数。前端只读取白名单 JSON 和本机 GPX，不上传原始大 CSV 或下载链接。公开与 AI 白名单不变。

## 全局约束

- 同步 SQLAlchemy、原生 PostgreSQL/PostGIS、手写线性迁移、所有输入继承 StrictInput。
- 迁移只用于显式允许的 `_test` 库；开发库迁移及真实数据入库不在授权范围。
- 单 GPX 10 MiB、请求体 11 MiB、JSON 表单字段 4096 字节；拒绝多余字段、重复表单键、未知文件与地址。
- 8 个新字段为设计中的最高/最低心率、平均/最大步频、VO2 max、训练负荷、有氧/无氧效果，均可空且只用于私人视图。
- 步幅、恢复时间保留来源值并提示单位未核实。0 不统一视为缺失。
- 使用真实已有脏工作区为基线；修改目标文件前保存基线，保留无关变化。不执行提交、合并或部署。

## 固定接口契约

`POST /api/v1/mifitness-imports`：multipart 包含 `record`（JSON）、可选 `file`、可选 `timezone`；查询 `preview=true` 时只读预览，否则保存。`record` 为 `{source_time: int, source_metrics: {...}}`，字段白名单取自整理后的 `running_summaries.json`；输入不接受 `has_downloaded_track`、账号/设备 ID 或 URL。

保存返回现有 `ImportView`。预览返回 `{activity_date, timezone, started_at, ended_at, distance_m, timer_seconds, elapsed_seconds, calories_kcal, steps, avg_heart_rate_bpm, ...8个新字段, has_route, point_count, segment_count, warnings, suspected_activity_ids}`。已存在同源/原文/规范轨迹返回 409 及本人 `existing_activity_id`；疑似重复需要提交 `confirm_similar=true` 才保存。已有活动补缺走同端点的 `enrich_activity_id`（UUID）显式选项，只补上述 8 个新指标及热量、步数、平均心率的空值；基础距离、用时、配速、轨迹及可见性保留原值，不自动合并。

## Task 1：指标、来源与安全解析

- [x] 在 `backend/tests/unit/test_mifitness_parser.py` 先写缺失、零值、5730 步频、指标矛盾、未知字段、无命名空间、实体与超限测试；运行确认红灯。
- [x] 新建 `backend/app/modules/mifitness/schema.py`、`metrics.py`、`parser.py`、`model.py`；函数接口为 `normalize_summary(record) -> (summary_dict, warnings)`、`parse_mifitness_gpx(raw) -> ParsedGPX`。保留普通 GPX 的严格输入行为。
- [x] 为活动模型和私人响应增加 8 个字段，手写下一条迁移，注册来源模型。来源记录使用 owner 指纹与可空 GPX 哈希，保留严格白名单摘要。
- [x] 单元测试、模型/迁移契约、Ruff 验证；不运行开发库迁移。

```python
def test_invalid_optional_cadence_does_not_discard_valid_distance():
    summary, warnings = normalize_summary(record(max_cadence=5730))
    assert summary['distance_m'] == 3000
    assert summary['max_cadence_spm'] is None
    assert 'MIFITNESS_MAX_CADENCE_INVALID' in warnings
```

## Task 2：事务、预览与导入

- [x] 在 `backend/tests/integration/test_mifitness_import.py` 先写无轨迹/带轨迹、设备与轨迹时间分离、同源防重、跨格式防重、owner 隔离、原子性与隐私测试。
- [x] 新建 `service.py`、`router.py`；解析走现有隔离 worker（增加 `format='mifitness'`）；复用每用户 advisory lock、`lock_owner` 和身份二次校验。
- [x] 在 GPX service 中仅抽取 `persist_segments(db, activity_id, segments) -> (point_count, segment_count)`，复用既有点/段写入；防重扫描新增来源表，保持 GPX/TCX 旧行为。
- [x] 注册路由并纳入后端与 SSR 上传请求上限；错误详情只使用已有白名单键。
- [x] 预览不写入；无轨迹使用设备起止和 `has_route=false`；有轨迹保留原文并使用来源专用命名空间适配。匹配失败拒绝，质量异常明确显示。
- [x] 在独立测试库执行相关集成测试及迁移升级/防御降级测试；执行 GPX、TCX、共享及统计相关回归。

```python
def test_summary_only_import_has_device_metrics_but_no_route(client):
    response = import_record(client, synthetic_record(), file=None)
    assert response.status_code == 201
    activity = response.json()['data']['activity']
    assert activity['has_route'] is False
    assert float(activity['distance_m']) == 3000
```

## Task 3：前端预览、串行导入和设备指标

- [x] 在 `frontend/tests/unit/mifitness.test.ts` 与 `frontend/tests/ui/mifitness.spec.ts` 先覆盖白名单重建、文件匹配、缺失文件拒绝、串行提交、401 清理、重复及质量提示。
- [x] 新建 `lib/api/mifitness.ts`、`MifitnessImport.svelte`、`DeviceMetrics.svelte`；读取本机 `running_summaries.json`（不超过 2 MiB、最多 1000 条）与最多 1000 个 GPX。以 `running_<source_time>.gpx` 精确匹配，不猜测；重复文件名拒绝。
- [x] 活动 API 校验新增字段；在活动页加入独立 Mi Fitness 导入区域，在详情及数据汇总活动详情复用设备指标组件；保留其他页面改动。
- [x] 显示服务端预览及异常后用户提交；逐条保存显示成功、重复、失败及仅汇总状态，可重试失败条目。显式补缺须用户选择；疑似重复须单独确认。
- [x] 在合成 API 或 spec route 中拦截新增接口，运行单元、真实 Chrome 桌面/手机 UI、`pnpm check` 和构建。

```ts
expect(parsePreparedRecords({ records: [record] })[0].record).not.toHaveProperty('has_downloaded_track');
expect(() => matchTrackFiles([record], [])).toThrow('缺少');
```

## Task 4：整体复核与交付

- [x] 复核公开及分享响应、AI 请求未增加新字段；旧 GPX/TCX 回归及仅汇总地图空态通过。
- [x] 运行相关全套检查，记录真实通过/失败/跳过数量，区分合成 API 与真实测试库。
- [x] 新增现场最大编号 +1 的中文特性文档，更新设计状态与验证记录；列出开发库未迁移、真实数据未导入、运行服务未替换。
- [x] 仅交付未提交文件改动与下载目录，不进行 Git 提交或远端发布。

## 完成记录

2026-10-15：实施完成，详见 `docs/42-mifitness-import.md`。后端单元 274、真实数据库集成 230、前端单元 120、Mi Fitness 合成 Chrome 7、旧导入合成 Chrome 12 和真实栈 Chrome 1 项通过；类型检查、构建及 Ruff 通过。开发库和真实数据保留，未提交。
