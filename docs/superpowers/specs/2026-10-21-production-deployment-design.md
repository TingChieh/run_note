# 生产部署基础设施设计（阶段 1）

日期：2026-10-21。基于对仓库的只读调查（见调查报告）与用户确认的方向：单台 Linux、全原生、systemd + Caddy、PostgreSQL/PostGIS 本机、不使用容器。

## 目标与非目标

目标：让部署可复现、可审阅、可回退，并把"备份可恢复"变成被持续验证的事实。非目标：自动 CD、监控栈、高可用、托管数据库、任何业务改动。

## 关键决策

1. **复用现有模板**：保留 `infra/native/` 的 systemd + Caddy 形态与 loopback 绑定、`/api/*` 直连后端的边界；只补缺口（加固、多 worker、安全头、备份、发布）。不引入 Gunicorn（锁文件无该依赖）或 Supervisor。
2. **发布单元**：一个自描述 tarball（源码 + 已构建前端 + 运维脚本），在服务器用 `--require-hashes` 现建 venv（venv 不可迁移）。`current`/`previous` 软链，每次最多保留 5 个。
3. **Schema 兼容性是一等公民**：应用要求 `alembic_version` 等于唯一 head，且降级在有数据时拒绝。因此"发布"和"回滚"都以 `schema_compat.py` 的关系判定为准：`same` 才允许直接切换，`behind` 需显式 `--migrate`（先停服务、备份并恢复演练、单次迁移），`ahead/unknown` 视为回滚，只能前向修复或显式备份恢复。
4. **备份必须被恢复过**：夜间任务和迁移前任务都执行真实恢复到临时库，并与现网库比对 revision、表集合、索引、行数（停服务时严格相等）与几何列可查询性。
5. **配置不经 shell**：`envfile.py` 以 systemd 语义解析环境文件并复用 `Settings`，另行拒绝已知危险组合（如缺少 `AUTH_TRUSTED_PROXIES`）。
6. **验证在隔离环境**：脚本全部可由环境变量重定位，端到端演练只用临时 PostgreSQL 集群；CI 在 Linux 上复现。

## 风险与缓解

- 登录限流 IP：通过模板默认值 + 部署前强制检查消除。
- PostGIS 非 trusted extension：文档要求超级用户预建扩展，否则首次迁移失败。
- Linux 路径未在真实机器验证：CI 覆盖 + 文档逐项标注未验证。
