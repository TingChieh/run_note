# Mi Fitness 跑步导入与设备指标

完成日期：2026-10-15。代码及隔离测试完成，未提交 Git。后续经用户单独授权，开发库迁移已完成，见 [迁移验收](43-mifitness-development-migration.md)；日常后端保持原关闭状态，真实运动数据未入库。

## 数据获取结果

用户授权导出的跑步数据保存在仓库外：`~/Downloads/RunNote-MiFitness-20261015-running/`。

- 167 条跑步设备汇总，162 条有下载轨迹，5 条仅有汇总。
- 162 份 GPX 原件，共 22,045,942 字节、213,945 点、162 源段。原件不修改；`normalized_gpx/` 是仅补标准命名空间的派生副本。
- `running_summaries.json` 是导入用白名单；`manifest.json`、`validation.json` 和目录内 `README.md` 用于本机核对。不保存签名下载链接、账号或设备 ID。
- 162 个规范轨迹哈希互不重复。离线解析验证不等于真实数据已入库。

## 使用方式

本机开发库已在后续单独授权后完成备份、恢复演练、受控升级和复核，见 43 号文档；启动后端即可使用新 Schema。其他环境升级仍需单独授权与相同保护流程。

1. 登录后进入“运动记录”页面的“Mi Fitness 跑步导入”区域。
2. 选择下载目录的 `running_summaries.json`；选择根目录下的 162 份 `running_<来源时间>.gpx` 原件。不要同时选择原件和规范化副本，以免同名冲突。
3. 时区留空沿用账户时区，也可填写 `Asia/Shanghai` 等 IANA 名称。此批数据使用绝对 UTC 时间，不统一减 8 小时。
4. 点击“预览所选记录”，核对设备指标、时间、轨迹有无和异常提示；预览不写入活动数据。
5. 点击“导入预览成功的记录”。请求逐条执行；失败条目可单独重试，已成功条目不重复提交。

同源或同轨迹记录显示已有活动链接。选择“仅补充已有记录缺失指标”才补缺：只填 8 个新增指标以及热量、步数、平均心率的 NULL，不覆盖已有值；基础距离、设备用时、经过时间、配速、可见性和轨迹保留原值。实际补入指标对应的白名单来源值同步保存。时间/距离相近但非同一来源或轨迹的记录只提示疑似重复，由用户逐条确认是否另建。

仅汇总记录不生成虚假轨迹，详情显示“此活动没有路线”。设备指标在私人活动详情和数据汇总的活动详情中统一展示。

## 字段与指标口径

活动新增 8 个可空字段，旧记录保持 NULL，不回填推算值：

| 字段 | 含义 | 允许值 |
| --- | --- | --- |
| `max_heart_rate_bpm` / `min_heart_rate_bpm` | 最高 / 最低心率 | 整数 1–300 bpm |
| `avg_cadence_spm` / `max_cadence_spm` | 平均 / 最大步频 | 大于 0、不超过 400 步/分钟 |
| `vo2_max_ml_kg_min` | 设备估计最大摄氧量 | 大于 0、不超过 150 |
| `training_load` | 小米训练负荷 | 非负且小于十亿 |
| `aerobic_training_effect` / `anaerobic_training_effect` | 小米有氧 / 无氧训练效果 | 0–5，0 有效 |

复用既有距离、设备用时、经过时间、热量、步数及平均心率字段。新活动以设备距离和设备用时计算平均配速；设备起止时间与轨迹点时间分别保留。缺失/异常可选指标留空并提示，基础指标非法则拒绝整条。

本批最大步频 5730 留空，设备用时大于经过时间保留告警。步幅、恢复时间单位未确认，只保留来源值并提示，不展示推测单位。GPX 没有海拔、逐点心率或逐点步频，不制造采样数据。

## 接口与隐私

- `POST /api/v1/mifitness-imports`：multipart 的 `record` 是严格白名单 JSON；可选单个 `file`、`timezone`、`confirm_similar` 和 `enrich_activity_id`。
- `preview=true` 返回 200 的私人预览；保存返回 201 的既有 `ImportView`。同源/原文/规范哈希重复返回 409 `MIFITNESS_DUPLICATE`，`duplicate_kind` 为 `record` / `raw` / `canonical`。疑似重复为 `MIFITNESS_SIMILAR`。
- 单条 JSON 最大 4096 字节，GPX 最大 10 MiB，请求体最大 11 MiB。浏览器批次 JSON 最大 2 MiB，最多 1000 条记录及 1000 份 GPX；文件按来源时间精确匹配，重复文件名、缺失已下载轨迹和无法匹配的文件拒绝猜测。
- 不接受服务器下载地址；浏览器从本机白名单重建请求，不上传大 CSV、身份或设备标识。
- 复用每用户 advisory 导入锁直至提交、身份二次校验、本人行锁和数据版本递增；事务由路由提交，失败完整回滚。
- 新 `mifitness_imports` 表保存受限摘要和可空 GPX 原件、哈希及解析版本。新模型和路由显式注册；迁移 `0009_mifitness_imports` 是本次现场唯一 head，降级在存在来源或指标时拒绝丢失数据。
- 公开活动、分享响应和 AI 供应商请求继续使用原白名单，不添加新指标或来源数据。SSR 固定目标源、7 个转发头及上传双重限制保持原约束。

## 改动范围

- 后端：`modules/mifitness/` 的 schema/metrics/parser/model/service/router；活动 model/schema 的 8 字段；模型和路由注册；手写迁移。
- 复用导入：GPX service 仅抽取点段保存辅助函数并扩展跨格式防重；worker 增加来源专用解析分支；body guard 纳入新路径。普通 GPX parser 和既有 GPX/TCX 指标口径保留。
- 前端：`api/mifitness.ts`、`MifitnessImport.svelte`、`DeviceMetrics.svelte`；活动 API 校验、活动页/详情/数据汇总详情和上传 proxy policy。
- 测试：新增 parser/迁移/端点/真实数据库集成及 unit/UI/e2e；更新模型表清单、head 预期和旧上传选择器。较旧迁移的防丢失测试直接执行其 guard，避免被新迁移中其他测试留下的数据提前拦截，断言继续检查真实数据与 revision 保留。
- 文档：本说明以及对应设计和实施计划。其他会话的界面、目标、AI 供应商等未提交改动保留。

## 验证记录

使用本次专用原生 PostgreSQL/PostGIS：`127.0.0.1:55461` 的 `runnote_mifitness_test` 与 `runnote_mifitness_snapshot_test`。仅通过进程环境显式允许这两个 `_test` 库；不修改 `.env`，不连接开发库。初始主测试库升至 head，快照库从 `0001_postgis` 验证升级保留基线。

| 实际命令 | 最终结果 |
| --- | --- |
| 后端 `.venv/bin/pytest tests/unit -q --tb=short` | 274 passed |
| `python3 /private/tmp/runnote-mifitness-tests.py tests/integration -q --tb=short` | 230 passed，无跳过 |
| 后端 `.venv/bin/ruff check app migrations tests` | All checks passed |
| 后端 `.venv/bin/ruff format --check app migrations tests` | 133 files already formatted |
| 前端 `pnpm test` | 19 文件，120 项通过 |
| 前端 `pnpm check` | 0 errors、0 warnings |
| 前端 `pnpm build` | exit 0；保留既有大 chunk 警告 |
| `pnpm exec playwright test --config playwright.mifitness.config.ts` | 7 passed，合成 API + 真实 Chrome，包含桌面与手机 |
| `pnpm exec playwright test --config playwright.tcx.config.ts` | 12 passed，旧 GPX/TCX 合成 UI 回归 |
| `pnpm exec playwright test --config playwright.mifitness-e2e.config.ts` | 1 passed，真实 Chrome → SvelteKit SSR → FastAPI → 独立 PostGIS 测试库 |
| `git diff --check` | 通过 |

后端单元测试第一次在 sandbox 中遇到 10 个本机端口权限失败，随后获工具审核允许本机合成 HTTP 测试并通过；模型表清单同步后全绿。首次完整集成暴露测试 UUID 类型和旧迁移 guard 被新 guard 提前拦截，修正测试后复跑全绿。新端点曾发现立即返回的 Decimal 格式不同，已统一；极限年份时区转换由异常修正为 422，并先红后绿验证。

独立审查发现并修复两处问题：前端冲突标识误用 `source` 而非实际 `record`；显式补缺后来源摘要未同步新指标。均增加契约/持久化断言并经静态复核关闭。

真实栈 e2e 使用合成账号和两条合成活动，验证预览未写入、有/无轨迹保存、异常步频留空、有效零值、重新预览同源重复、逐条显式补缺、非空和基础指标不覆盖、刷新后持久化及无轨迹空态。地图瓦片失败不阻断本地路线显示。测试结束关闭专用 API/前端；临时数据库实例也停止，目录保留，不停止日常 PostgreSQL。

未运行：开发服务验收、真实 167 条数据入库、生产部署、全量既有前端 UI/e2e、真实 AI 供应商请求。隔离测试通过不代表上述步骤完成。
