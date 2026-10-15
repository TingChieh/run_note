# 跑步记录编辑与删除

## 使用方式

在「跑步记录」列表打开任一活动，详情页顶部「记录信息」提供「编辑记录」和「删除记录」。

- 编辑标题及私人备注。标题去除首尾空格后为 1–120 字符，备注最多 5000 字符；保存成功直接更新标题、备注和足迹卡片，刷新仍保留；取消不写入，保存失败保留草稿。
- 删除需要模态对话框确认，可取消或按 Escape 返回；确认后删除记录、关联轨迹点/段、GPX/TCX 原文和分享链接，成功返回更新后的列表。失败保留对话框并允许重试。
- 导入时间、日期、运动指标和轨迹仍保持只读。已有可见性设置继续使用相同 PATCH 地址；备注不出现在公开/分享响应中。

## 实现边界

活动模块统一注册 PATCH 和 DELETE，沿用会话、Origin 和 CSRF 检查。写入先锁本人 users 行，再查本人活动，修改/删除与 activity_data_version 递增在同一事务；他人及不存在的活动返回 404。原有分享创建也复用相同用户锁。数据库已有级联约束负责删除关联数据，无新增数据库迁移。

后续统计查询反映删除后的数据；旧 AI 报告保留原快照、标记过时，不自动生成或调用提供商。删除后可重新导入原文件。

## 验证记录（2026-10-15）

- 测试先复现：metadata PATCH 返回 422、DELETE 返回 405、浏览器缺少编辑控件、客户端缺少 mutation 函数；实现后验证通过。
- 后端：104 项隔离集成测试通过，覆盖活动编辑/删除、GPX/TCX 导入回归、公开/分享、AI。包含文本边界、只读字段拒绝、本人/他人/匿名、Origin/CSRF、持久化、级联删除、统计更新、重复删除、重新导入、并发字段及版本更新、AI 快照过时。
- 前端：76 项单元测试通过；svelte-check 0 errors / 0 warnings；生产构建通过（仍有既有大 chunk 提示）。
- 真实 Chrome fixture：13 项通过，包含现有活动/分享回归和新增草稿保留、取消、刷新、删除确认/Escape/重试、重复提交防护、320/390px 无横向溢出。另保存移动编辑、删除和暗色截图作视觉检查。
- 真实 FastAPI/PostgreSQL 浏览器端到端：GPX、TCX 共 2 项通过，正常注册、上传、编辑、刷新确认持久化、删除返回空列表、原详情 404、统计归零；没有未捕获页面错误。
- 独立代码审查：权限/校验/事务/级联/隐私/交互范围内无可操作问题；审查未独立重复测试。
- 仅本轮创建的本机 55447/activity_management_test 接受迁移与合成数据，现有开发数据、环境配置和此前工作区改动保留。没有调用真实 AI，没有提交、推送或部署；没有在用户真实记录上执行编辑或删除。

复验命令：后端在显式允许的 `_test` 库执行 `pytest -q tests/integration/test_activity_management.py tests/integration/test_gpx_import.py tests/integration/test_tcx_import.py tests/integration/test_sharing.py tests/integration/test_ai_reports.py`。前端使用 `pnpm test`、`pnpm check`、`pnpm build`、`pnpm exec playwright test --config playwright.activity-management.config.ts`，真实联调用 `playwright.activity-management-e2e.config.ts`，要求显式设置 TEST_DATABASE_URL 和 TEST_DATABASE_ALLOWED_TARGETS。
