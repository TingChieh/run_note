# CI 路径过滤与运行节奏

日期：2026-10-26。

## 问题

每个小改动（例如改页脚）会触发 3 次完整 CI：推分支、开 PR、合并到 `main`，每次约 11 至 12 分钟，且每次都跑全部任务：`frontend` 0.6 分钟、`backend` 4.7 分钟、`macOS`（仅 `main`）7.2 分钟、`infra` 9.3 分钟、`frontend-ui` 10.9 分钟。改一行前端也会安装 PostgreSQL 跑后端测试、再跑一遍部署脚本演练。

约束：`ops/ship.py` 要求目标提交存在已完成的 CI 运行，且每个任务为 success 或 skipped；没有运行会被拒绝（“no CI run exists”）。所以不能让整个工作流不运行，只能让任务级别被跳过。

## 使用方式

- 触发：`pull_request`、`main` 的 `push`、手动 `workflow_dispatch`。分支有 PR 时不再因 push 重复运行。
- 并发：同一 PR 的新推送取消旧的运行；`main` 上按提交分组，既不会被取消，也不会在排队时被替换。
- 前置任务 `changes` 调用 `.github/scripts/changed_areas.py`，用 `git diff` 比较基准与当前提交（PR 用 PR 基准，`main` 用 push 前的提交），输出 `backend` / `frontend` / `infra` 三个开关，其余任务据此运行或显示 skipped：

| 改动 | backend、macOS | frontend、frontend-ui | infra |
|---|---|---|---|
| 仅文档（`docs/`、`*.md`、`LICENSE`） | 跳过 | 跳过 | 跳过 |
| 仅 `frontend/` | 跳过 | 运行 | 仅当改了 `package.json` / 锁文件时运行 |
| 仅 `backend/` | 运行 | 跳过 | 仅当改了迁移或 `requirements.lock` 时运行 |
| `scripts/` | 运行 | 跳过 | 运行 |
| `infra/` | 跳过 | 跳过 | 运行 |
| 改了 `.github/`、不认识的路径、或算不出差异 | 运行 | 运行 | 运行 |

macOS 任务仍然只在 `main` 上运行。

## 接口与隐私

只改 CI 与文档，无后端、前端运行时代码与数据库改动。脚本只读 git 差异，不读取密钥，不引入第三方 Action（沿用既有的固定提交 SHA 的 `actions/checkout`）。

保守默认：任何不确定都全部运行；`ship.py` 的部署门槛不变（`main` 上该提交的任务全部 success/skipped）。

## 验证记录

- `backend/.venv/bin/python -m unittest infra.native.tests.test_ci_changes`：12 项通过，覆盖仅文档、仅前端、仅后端、仅 infra、迁移/脚本/依赖清单触发 infra、混合改动取并集、`.github/` 与未知路径全开、空差异全开、差异不可算全开。
- 用真实差异验证：页脚改动分支相对 `main`（3 个前端文件）得到 `backend=false frontend=true infra=false`。
- 工作流 YAML 用 Ruby `YAML.load_file` 解析：触发、并发组、各任务的 `needs` 与 `if` 与设计一致。
- 未运行：本 PR 因为改了 `.github/`，按设计全部任务运行，**看不到“跳过”的实际效果**；首次实际跳过需要看下一个只改前端或文档的 PR。尚未在真实 `main` push 上观察过 `github.event.before` 的行为（强制推送或新分支时按“全部运行”处理）。
