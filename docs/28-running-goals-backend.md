# 跑量目标后端保存

## 需求与设计

侧栏与首页的周、月、年目标按登录账户持久化。保存成功后更新目标数值、关闭编辑，不显示成功提示；失败时保留输入和原目标，显示可重试的错误。

新增 `running_goals` 表：`user_id` 外键、`period`（week/month/year）联合主键，`target_km` 为最多一位小数的正数（上限 100000）。目标是重复使用的周期设置，不是某一日期范围的记录。读写身份取自会话，禁止客户端指定账户。

`GET /api/v1/me/running-goals` 返回 `{week, month, year}`，未设置为 null；`PUT /api/v1/me/running-goals/{period}` 接受 `{target_km: number}`，返回该周期确认值。写入沿用 Origin 与 CSRF 校验，使用数据库 upsert，避免首次并发保存产生重复记录。

新增 Alembic `0006_running_goals`，只添加目标表。现有 localStorage 目标不自动上传，也不覆盖后端值；用户重新保存后即绑定账号。两个组件通过接口刷新，同页保存事件与窗口重新聚焦触发重读。

## 实施与验证计划

- 先添加后端持久化、三周期独立、账号隔离、非法值、未登录和 CSRF 集成测试，确认旧实现失败。
- 新增模型、请求/响应校验、路由、迁移并注册；更新 schema head 测试，验证迁移可重复运行且 ORM 无漂移。
- 新增前端读写 API，改侧栏与首页组件，处理加载失败、保存中、保存失败及过期会话；去掉浏览器存储说明和成功提示。
- 在隔离 PostgreSQL 跑接口测试；运行单元测试、类型检查、生产构建和真实 Chrome 回归，检查刷新后保留、入口同步、错误保留输入及移动端溢出。

本次不提交、不推送、不迁移开发数据库。

## 验证结果

- 后端：临时原生 PostgreSQL/PostGIS 从空库迁移至 `0006_running_goals`，单元、认证、目标与迁移回归共 250 passed、1 skipped（未配置额外快照测试库）。目标测试覆盖新会话重新登录、账号隔离、非法输入、CSRF 与首次并发保存。迁移重复运行及 Alembic check 通过；验证结束已停止临时数据库。
- 前端：Vitest 53 passed；svelte-check 0 errors / 0 warnings；生产构建通过，保留现有图表与地图大包警告。
- Chrome：首页、仪表盘、目标回归 13 passed，覆盖清空 localStorage 后刷新仍读取后端目标、两个入口互相同步、保存失败保留输入与原目标、成功不出现提示、保存等待期间禁止统计重试丢弃输入、320/390/768/1440 宽度无溢出。浏览器使用 HTTP API fixture，后端真实持久化由隔离 PostgreSQL 集成测试验证。
- 已查看侧栏截图 `frontend/test-results/running-goals-backend.png`，卡片下方没有保存成功提示。

## 启用

现有开发数据库尚未执行迁移。获得数据库迁移授权后，在 `backend/` 使用当前开发数据库配置执行 `.venv/bin/alembic upgrade head`，并重启后端；需先确认目标库身份、备份和恢复验证。仅新增 `running_goals` 表，不更改既有业务记录。旧浏览器目标需由用户重新保存至账户。
