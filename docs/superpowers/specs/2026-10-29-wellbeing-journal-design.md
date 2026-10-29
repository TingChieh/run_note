# 身心健康日记（Wellbeing Journal）设计

日期：2026-10-29。状态：实现中（本地工作区，未提交）。

## 定位与边界

个人观察记录：情绪、焦虑、精力、注意力、睡眠、服药与不良反应。**不是诊断、处方或剂量建议工具**；报告只汇总用户实际记录。
模块名 `wellbeing`（`health` 已是服务健康检查，不得占用）。仅登录用户可见自己的数据；没有任何公开、分享、站主展示或 AI 接口。

## 数据模型（迁移 `0017_wellbeing_journal`）

| 表 | 说明 |
| --- | --- |
| `wellbeing_daily_entries` | 每用户每天至多一行（`UNIQUE(user_id, entry_date)`）；评分列均可为 NULL，`CHECK` 限 0–10；睡眠时长 `NUMERIC(3,1)` 0–24；备注 ≤2000（原设计里的“自伤或轻生念头”已按用户要求移除，见迁移 0019） |
| `wellbeing_dose_events` | 每次服药一行：药名、实际剂量与单位、`taken_at`、`entry_date`（按服药当时账户时区计算并存储）、`regimen`（`scheduled/as_needed`）、备注 |
| `wellbeing_symptom_events` | 每条副作用一行：症状名、严重程度 0–10、可选 `onset_at`、`duration_minutes`、`affects_daily_life`、`entry_date` |

- 药物与副作用名称各有一张用户列表（`wellbeing_medications`、`wellbeing_symptom_names`，迁移 0018/0019）；事件仍各自保存名称文本，列表只是快捷项，改名或移除不改历史；首次记录新名称会自动入列。
- 未填写 = NULL，从不写 0。`entry_date` 由账户时区决定；之后修改账户时区不改写历史日期。
- 不使用 `relationship()`；不调用 `lock_owner`，因此**不递增 `activity_data_version`**，不会让跑步 AI 报告变旧。
- 降级：任一表有数据则 `RuntimeError`，不删除真实数据。

## 接口（`/api/v1/me/wellbeing`）

读取需登录；写入需登录 + Origin + CSRF。他人资源一律 404。全部响应 `Cache-Control: no-store`（全局中间件已设置，另有测试断言）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/days/{date}` | 当天的记录、服药、副作用，以及账户时区和“今天” |
| PUT | `/days/{date}/entry` | 幂等 upsert（`ON CONFLICT`），整条替换；全空返回 422 |
| DELETE | `/days/{date}/entry` | 删除当天状态（不删服药/副作用） |
| GET | `/entries` | 历史分页 `limit/offset` + `from/to` |
| GET | `/days` | 日历摘要：范围内有记录的日期及各类数量 |
| POST/PATCH/DELETE | `/doses[/{id}]` | 服药事件 |
| POST/PATCH/DELETE | `/symptoms[/{id}]` | 副作用事件 |
| GET | `/medications` | 已用药名与最近一次剂量单位 |
| GET | `/trends?days=7|30|90` | 逐日序列（缺失为 null）与副作用汇总 |
| GET | `/report?from&to` | 复诊报告 JSON（范围 ≤366 天） |
| GET | `/report.csv?from&to` | 同范围 CSV（UTF-8 BOM，防公式注入） |

## 隐私

- 日志只记录异常类型与 request_id；校验错误只返回字段与类型，不回显输入值。
- 前端不把日记内容写入 localStorage/sessionStorage；草稿仅在内存中。
- 路由 `/wellbeing`、`/workspace/wellbeing` 加入受保护路径与 noindex/robots 禁止；`/p/*` 下无此路由，导航在公开视图隐藏。
- 数据库整库备份（`pg_dump`，`umask 077`，可选 restic 加密异地）会包含这些表；见 `docs/76-wellbeing-journal.md`。

## 前端

`lib/api/wellbeing.ts`（运行时校验）、`routes/wellbeing`（标签页：今日记录 / 历史记录 / 趋势分析 / 复诊报告）、ECharts 趋势图（评分方向写在图标题与图例，缺失值断线不插值，附数据表兜底）、打印样式的复诊摘要。
