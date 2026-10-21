# 生产部署基础设施实施计划（阶段 1）

对应设计：`docs/superpowers/specs/2026-10-21-production-deployment-design.md`。

- [x] 复核登录限流（`rate_limit.py`）与迁移（`migrations/env.py`、各降级、readiness、worker）逻辑，并实测限流
- [x] `ops/envfile.py`、`ops/schema_compat.py` 与单元测试
- [x] `ops/backup.sh`、`ops/restore-drill.sh`（真实恢复）
- [x] `ops/build-release.sh`、`ops/deploy.sh`、`ops/rollback.sh`
- [x] systemd 单元加固、备份 service/timer、Caddyfile、环境模板
- [x] 隔离集群端到端演练 `tests/ops-e2e.sh`
- [x] Linux CI（后端、前端、合成 UI、infra）
- [x] `docs/66-production-deployment.md`、README/AGENTS 指引
- [ ] 阶段 2（待外部条件）：服务器初始化、DNS、异地备份仓库、真实域名验收
- [ ] 阶段 3：从开发库只读导出，在服务器做恢复演练与迁移演练
- [ ] 阶段 4：首次上线与验收；阶段 5：评估自动 CD（审批 + 受限 SSH）
