# 全量足迹开发库迁移验收

日期：2026-10-15。用户明确要求“迁移吧”，授权本次开发库升级。迁移前后均保持日常后端关闭。

## 使用方式与结果

本机 `127.0.0.1:5432/running_note` 已从 `0009_mifitness_imports` 升至现场唯一 head `0010_footprint_snapshots`。新增 `footprint_activity_caches`、`footprint_snapshots` 两张私有派生表，均为 0 行。实际 Alembic current 已独立确认。

启动新版后端后，生命周期任务将按既有设计扫描并自动建立快照；本次仅迁移，未启动后台计算，也未对真实用户进行登录或浏览器验收。功能说明见 [全量足迹快照](46-footprints-all-records-snapshots.md)。

## 备份与恢复演练

- 备份：`/Users/tingchieh/Backups/RunNote/20261015T231912+0800-footprints/running_note-before-footprints.dump`，7879928 字节，权限 0600；父目录 0700。
- SHA-256：`1c828a42f6a6d6814ce4396d32307f415814ecca7ee7e1cbdefdebbea1a6f476`。
- `pg_dump --format=custom` 及 `pg_restore --list` 均 exit 0；归档包含活动及原始轨迹点数据。归档不包含整个 PostgreSQL 实例的全局角色或服务配置。
- 恢复目标：`127.0.0.1:52394/runnote_footprints_restore_test`，独立原生 PostgreSQL18 实例，名称以 `_test` 结尾并显式通过允许目标验证。
- `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction` 恢复成功；恢复对象归临时角色，不宣称复原日常 owner/ACL。
- 完整恢复后全部旧表结构、行数及内容指纹与备份基线一致；随后在副本演练升级，`alembic check` 无差异。
- 临时实例已停止，目录 `/private/tmp/runnote-footprints-restore-kzila_59` 和备份均保留；日常 5432 PostgreSQL 与原前端 5183 进程保持运行。

## 接口与隐私

本轮未修改业务代码、接口或环境配置，仅执行已实现的迁移。连接目标、旧 revision、唯一 head 和迁移文件摘要均核对；开发库升级只执行一次。DDL 使用现有 5 秒 lock_timeout 与 60 秒 statement_timeout，没有终止数据库会话、降级或清理数据。

连接凭据由 Settings 在进程中加载，仅经子进程环境传递，不打印或写入审计。真实数据仅进入仓库外备份及授权的隔离恢复副本，不进入仓库、合成夹具或外部服务。摘要按 UTC 时间及几何 EWKB 计算，不输出任何业务行、坐标或身份信息。

## 验证记录

实际编排命令为 `backend/.venv/bin/python /private/tmp/runnote-footprints-dev-migration.py preflight|backup|rehearse|migrate`（四个阶段分别执行，全部 exit 0）。初次沙箱内预检因本机数据库连接权限失败，在获得本机访问权限后重跑成功；失败阶段未写开发库。

| 检查 | 实际结果 |
| --- | --- |
| 目标与实际身份 | running_note / 127.0.0.1 / 5432 / run_note |
| PostgreSQL / PostGIS | 18.6 (Homebrew) / 3.6.4，前后相同 |
| 完整备份及目录检查 | PASS |
| 恢复副本及升级演练 | PASS |
| 开发库单次升级 | PASS：0009 → 0010 |
| `.venv/bin/alembic current` | `0010_footprint_snapshots (head)` |
| 副本及开发库 `alembic check` | `No new upgrade operations detected.` |
| 全部旧表行数与内容指纹 | PASS：备份前后、恢复、演练、开发库升级后及最终复核一致 |
| 旧列、索引、约束验证状态及几何元数据 | PASS：不变；所有索引有效，新外键含归属约束及级联删除 |
| 新表 | 两张均空，没有触发真实用户计算 |
| live / ready / legacy health | 均 200：TestClient 连接真实开发库，未进入 lifespan、未启动 worker |
| 端口复核 | 5432 与 5183 保持；8001 与临时 52394 无监听 |

保留的主要数据：184 条活动、224381 个轨迹点、238 个轨迹段、167 条小米导入记录，其他表指纹亦全部一致。

审计文件：`/Users/tingchieh/Backups/RunNote/20261015T231912+0800-footprints/migration-audit.json`，权限 0600。包含迁移日志和全表摘要，不含凭据或原始业务行。

未重跑业务单元、集成、前端类型/构建或浏览器测试，本轮没有业务代码变化；前轮功能验证见 46、47 号文档。本轮没有启动开发后端、真实 AI 调用、导入、业务数据删除、Git 提交、推送或部署。后台实际生成与开发账号完整业务验收仍为未运行。
