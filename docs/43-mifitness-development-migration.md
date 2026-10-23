# Mi Fitness 开发库迁移验收

日期：2026-10-15。用户在本会话明确要求“帮我迁移吧”，本次授权用于开发库结构升级，不包括真实跑步数据导入、Git 提交或部署。

## 使用方式与结果

本机 `127.0.0.1:5432/running_note` 已从 `0008_activity_labels` 升至 `0009_mifitness_imports`。通过现场 Alembic head 与实际 `alembic current` 确认，不依赖 README 中的历史版本号。

8 个可空设备字段及 `mifitness_imports` 来源表已建立。全部旧活动的新字段仍为 NULL，来源表为 0 行。真实导出中的 167 条设备汇总和 162 份 GPX 仍留在下载目录，尚未入库；导入方式见 [Mi Fitness 功能说明](42-mifitness-import.md)。

迁移开始时日常后端没有监听，结束后保持关闭；原前端 PID 80301、`127.0.0.1:5183` 已恢复，保留同一个进程及环境。后续启动后端可使用新 Schema，但本次没有启动日常后端或进行浏览器业务验收。

## 备份与恢复演练

最终有效备份目录：`~/Backups/RunNote/20261015T214518+0800-mifitness/`，权限 0700。

- 完整自定义格式备份：`running_note-before-mifitness.dump`，520,361 字节，权限 0600。
- SHA-256：`9877ad07340171855431f30d55e22cf16a606660d5b43e5e22b12b6e91e99665`。
- `archive-list.txt` 为 `pg_restore --list` 检查结果；`preflight.json` 保存结构与数据摘要；`migration-audit.json` 保存完整步骤证据，均为 0600。没有记录密码、连接密钥或原始业务行。
- 单库 `pg_dump -Fc` 不包含整个实例的全局角色或服务配置。

原生 PostgreSQL 18 恢复实例监听 `127.0.0.1:63182`，恢复库为显式允许的 `runnote_mifitness_restore_test`，独立于开发库。新实例使用独立临时角色和随机 SCRAM 密码，不修改日常角色、`.env` 或认证密钥。

`pg_restore --no-owner --no-privileges --exit-on-error --single-transaction` 成功，证明单库对象和数据可恢复；所有恢复对象属于临时角色，不宣称已复原日常 owner/ACL 或全局角色。恢复前后全部旧表行数与内容指纹一致，然后在恢复副本演练 `0008 → 0009`；`alembic check` 返回 `No new upgrade operations detected.`。

最终恢复实例目录保留于 `/private/tmp/runnote-mifitness-restore-sgg__g9k`。临时实例已停止，不删除备份和恢复目录，不停止日常 5432 PostgreSQL。

## 迁移前会话变动的处理

第一次备份保留于 `~/Backups/RunNote/20261015T213904+0800-mifitness/`。首次恢复演练通过后，执行前校验发现 `auth_sessions` 指纹变化，因此在 DDL 执行之前停止；`development_upgrade_attempted` 仍为 false，开发库仍为 `0008`。

只读逐字段比较恢复副本与开发库，确认仅 1 条已有会话的 `last_seen_at` 向前更新 639.067493 秒；身份、令牌、会话数量及所有业务数据未变。该字段由现有认证服务定期刷新。不覆盖或回写该会话，也不把旧备份中的时间恢复到开发库。

核验前端 PID、Vite 命令及项目工作目录后，短暂 SIGSTOP 本项目前端，保留原备份和第一次证据；按最新会话状态重新执行完整备份、恢复演练和最终单次迁移。所有步骤完成后在 finally 中 SIGCONT 恢复同一进程，未重建环境、未终止其他会话。

## 接口与隐私

本次只执行既有迁移，未修改业务代码、API 契约或前端界面。连接目标严格核对为 `127.0.0.1:5432/running_note`，禁止连接其他目标；密钥只由运行时 Settings 提供给子进程环境，不打印 DSN/密码，不改写配置文件。

真实数据库数据仅进入用户授权的项目外完整备份和本次独立恢复副本，不进入仓库、测试夹具、公开接口或 AI 请求。对内容只存摘要，几何按 EWKB、时间按 UTC 规范比较，不依赖恢复后几何的普通 JSON 文本表示。

实际开发库只执行一次 `alembic upgrade 0009_mifitness_imports`。迁移环境保持 `lock_timeout=5000`、`statement_timeout=60000`，没有超时、终止数据库会话、降级、清库、重建开发库或导入操作。

## 验证记录

临时编排脚本：`/private/tmp/runnote-dev-migration-20261015.py`。最终执行阶段为 `refresh-and-migrate`，过程证据存放在上述项目外审计文件。脚本不是仓库业务实现。

| 实际检查 | 结果 |
| --- | --- |
| 配置目标及实际服务器身份 | PASS：running_note / 127.0.0.1 / 5432 / run_note |
| PostgreSQL / PostGIS | 18.6 (Homebrew) / 3.6.4，升级前后相同 |
| 完整 `pg_dump`、`pg_restore --list` | exit 0 |
| 新 `_test` 库完整事务恢复 | exit 0；旧结构和全表指纹与源库基线一致 |
| 恢复副本升级及 `alembic check` | exit 0；唯一 head，无新增 autogenerate 操作 |
| 开发库受控单次升级 | exit 0；仅执行 0008→0009 |
| 实际 `alembic current` | `0009_mifitness_imports (head)` |
| 全部既有表的行数与数据指纹 | PASS：最终备份基线、恢复副本、迁移后及最终复核一致 |
| 旧列、原索引、约束名称/类型/验证状态、几何元数据 | PASS：保留；新增列均可空；所有索引有效 |
| 新来源/指标约束与历史数据状态 | PASS：来源约束包含 mifitness，新来源表 0 行，旧活动新指标均 NULL |
| `/api/v1/health/live`、`/api/v1/health/ready`、`/api/health` | 全部 200：进程内 TestClient 连接真实开发库；未启动日常后端 |
| 临时实例及服务状态 | 临时端口 62522、63182 无监听；日常 5432 与原前端 5183 保留；8001 无监听 |

最终保留的数据数量：

| 表 | 行数 |
| --- | --- |
| users | 17 |
| activities | 17 |
| gpx_imports / tcx_imports | 16 / 1 |
| activity_segments / activity_points | 30 / 10,436 |
| running_goals / ai_reports | 3 / 3 |
| auth_sessions / auth_rate_buckets | 59 / 30 |
| activity_share_links | 0 |
| spatial_ref_sys | 8,500 |

本轮没有业务代码变化，未重跑单元、集成、前端类型/构建或浏览器业务测试；前一轮功能验证见 42 号文档，本轮证据仅覆盖实际迁移、备份恢复、数据保留与只读健康检查。未导入真实跑步记录、未请求真实 AI、未提交 Git、未部署。工作区原有修改保留。
