# infra/native — 原生（非容器）生产部署资产

完整说明见 [docs/66-production-deployment.md](../../docs/66-production-deployment.md)。本目录只放可执行/可安装的文件：

| 路径 | 作用 |
| --- | --- |
| `runnote-api.service` / `runnote-web.service` | API（uvicorn，2 worker）与 Node 的 systemd 单元，沙箱加固，经 `current` 软链运行 |
| `runnote-backup.service` / `.timer` | 每晚备份并做真实恢复演练（以 `postgres` 用户运行） |
| `Caddyfile` | HTTPS、安全响应头、`/api/*` 与 Node 分流；域名来自环境变量 `RUNNOTE_DOMAIN` |
| `env/*.env.example` | 后端/前端/备份环境文件模板（只含占位符，实际文件放 `/etc/run-note/`，权限 0600/0640） |
| `ops/build-release.sh` | CI 或工作站构建单个发布 tarball |
| `ops/deploy.sh` | 在服务器上安装发布；schema 落后时需显式 `--migrate`，自动备份+恢复演练 |
| `ops/rollback.sh` | 回滚；schema 不匹配时拒绝切软链，仅允许显式的备份恢复流程 |
| `ops/backup.sh` / `ops/restore-drill.sh` | 备份与真实恢复演练（恢复到临时库并与现网库比对） |
| `ops/envfile.py` / `ops/schema_compat.py` | 不经 shell 解析 EnvironmentFile 并复用应用校验；判定发布与库 schema 关系 |
| `tests/` | 运维脚本单元测试与隔离库端到端演练（`ops-e2e.sh`） |

本目录文件不读取、不生成真实密钥；`compose.dev.yml` 仍是已停用的历史文件。
