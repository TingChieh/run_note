# 管理员只读查看运动记录

## 使用方式

站主在“设置 → 用户管理”中选择某个账号的“查看记录”，可分页浏览记录并打开详情，查看运动指标、轨迹、心率数据及备注。详情和列表顶部标明所查看用户及只读状态，并可返回用户管理。管理员访问本人工作区中的其他用户记录地址时，如果本人接口返回 404，会跳转到该用户的管理员只读详情。

## 接口与隐私

新增管理员专用只读接口：

- `GET /api/v1/admin/users/{user_id}`：读取用户资料，用于显示姓名。
- `GET /api/v1/admin/users/{user_id}/activities`：按本人活动列表规则筛选、排序及分页。
- `GET /api/v1/admin/users/{user_id}/activities/{activity_id}`：读取完整详情及备注。
- `GET /api/v1/admin/users/{user_id}/activities/{activity_id}/route`：读取轨迹。
- `GET /api/v1/admin/activities/{activity_id}/owner`：仅返回活动归属用户 ID，供跳转使用。

上述接口均要求管理员身份；目标用户不存在、活动不属于目标用户时返回 404。列表和详情复用既有用户归属查询，不读取身心健康日记。没有新增管理员写入接口；原本人接口仍按登录用户约束写入。地图轨迹留在浏览器内，底图沿用既有控制器。

这些只读端点提交身份认证依赖对会话空闲时间的续期，不修改活动数据。

## 验证记录

以下均在本地执行；后端集成测试使用进程环境指定的隔离 `_test` 数据库，前端 UI 使用合成 API。

- 后端 `.venv/bin/ruff check app migrations tests`：通过；`.venv/bin/ruff format --check app migrations tests`：239 个文件格式符合要求。
- 后端 `.venv/bin/pytest tests/unit -q`：第一次因未注入 `DATABASE_URL` 而有 1 项配置错误、502 项通过；注入测试进程环境后重跑，503 项通过。
- 后端针对 `test_admin_readonly_activities.py`、`test_admin_users.py` 及 `test_activity_explorer.py`、`test_activity_library.py`、`test_activity_management.py` 的集成回归：41 项通过；扩充筛选和分页断言后新测试文件单独重跑，1 项通过。
- 后端注入同一隔离测试库环境后运行 `.venv/bin/pytest -q`：896 项通过、1 项跳过。
- 前端 `pnpm test`：49 个测试文件、318 项通过。`pnpm check`：0 错误、0 警告。`pnpm build`：通过，输出既有的大体积 chunk 提示。
- 前端 `pnpm exec playwright test --config playwright.ui.config.ts tests/ui/admin-readonly-activities.spec.ts tests/ui/admin-users.spec.ts tests/ui/activities.spec.ts`：39 项通过。
- 补充指标、空分页和普通用户权限断言后，前端 `pnpm exec playwright test --config playwright.ui.config.ts tests/ui/admin-readonly-activities.spec.ts tests/ui/admin-users.spec.ts`：11 项通过。
- 全套 `./node_modules/.bin/playwright test --config playwright.ui.config.ts`：330 项中 325 通过、4 项跳过；`tests/ui/milestones.spec.ts:250` 首次因 30 秒超时失败（等待侧栏截图），单独重跑通过。已知偶发 `liquid-glass.spec.ts:6` 本次通过。

合成 UI 和隔离测试库的结果不等同于运行中的开发服务或生产验收；未重启开发服务，也未连接开发或生产数据库。
