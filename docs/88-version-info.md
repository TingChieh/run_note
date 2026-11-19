# 版本号与版本信息

本版本为 **1.0.0**（`2d1d6c5` 之后的第一个带版本号的发布）。此前仓库里没有任何版本号：没有 git tag、没有 release，服务器上只用提交号标识发布。

## 使用方式

站主在“设置 → 站点设置”页面的左列底部可以看到“版本信息”卡片：

- 版本：`v1.0.0`。
- 提交：这次发布对应的 12 位提交号。
- 构建时间：发布包的构建时间，以 UTC 显示，不做本地时区换算。
- 发布 ID：与服务器 `current/RELEASE` 里的 `id` 相同，回滚、排查时用它对照。

本地从源码运行时没有发布包，卡片只显示版本，并标明“本地源码运行（非发布包）”。版本信息读取失败时只影响这张卡片，站点设置的其余部分照常可用。

升级版本号只改一处：`backend/pyproject.toml` 的 `[project] version`（`MAJOR.MINOR.PATCH`），并把 `frontend/package.json` 的 `version` 改成相同的值，否则 `tests/unit/test_version.py` 失败。

## 接口与隐私

新增 `GET /api/v1/admin/version`，只有站主可读：

```json
{ "version": "1.0.0", "build": { "release_id": "20261119163755-2d1d6c553e57", "git_sha": "2d1d6c553e57", "built_at": "2026-11-19T16:37:55Z" } }
```

`build` 在源码运行时为 `null`。匿名访问返回 401，已登录的普通用户返回 403。健康检查接口和所有公开页面都不包含版本信息，没有新增匿名接口。

数据来源：

- 版本号读自 `backend/pyproject.toml`，该文件本来就随发布包上传。
- 构建信息读自发布包根目录的 `RELEASE` 文件，由 `build-release.sh` 写入。读取时逐项校验格式，任何一项不合法就当作没有构建信息，不会把文件里的任意文本展示出来。
- 没有数据库变更，没有新迁移。

## 验证记录

以下在本机执行；后端集成测试与真实后端 e2e 使用进程环境指定的隔离 `_test` 库（本次新建，已升到迁移 head），浏览器 UI 使用合成 API。

- `python3 scripts/verify.py --full --test-db running_note_phase_one_test`：11 项 PASS、1 项 NOT RUN。
  - 契约：生成的 API 类型与后端一致。
  - 后端：ruff 检查与格式检查通过；`pytest`：945 通过、1 跳过（`test_migrations.py` 需要 `TEST_SNAPSHOT_DATABASE_URL`）。
  - 前端：`pnpm test` 345 项通过；`pnpm check` 0 错误；`pnpm build` 通过；合成 API 浏览器 UI 340 项通过；真实后端浏览器 e2e 13 项通过（含新增 `version.spec.ts`：匿名 401、普通成员 403、站主在站点设置页看到版本）。
  - 基础设施：运维单元测试与 shellcheck 通过。
- 第一次完整运行有两项失败，都已修复后重跑通过：
  - 集成测试 `test_only_the_site_owner_can_read_the_version` 用夹具里的历史账号当普通用户，该账号默认停用，返回 401 而不是 403；改为由站主创建一个启用的普通账号再登录。
  - UI 用例 `top-navigation.spec.ts › the site settings preview column sticks below the bar` 失败：版本卡片最初放在右侧预览列，使该列比左列还高，失去了吸附空间；改放左列表单底部，该文件 66 项重跑通过。
- 未运行：部署/备份演练（`ops-e2e*.sh`、异地备份、Caddy）只在 CI 运行；开发服务未重启，新接口未在运行中的开发实例上验证。

合成 UI 和隔离测试库的结果不等同于生产验收；发布后站主需要在线上的“站点设置”页确认版本显示。
