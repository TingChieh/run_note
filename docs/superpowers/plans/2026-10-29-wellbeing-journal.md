# Wellbeing Journal 实施计划

1. 后端：迁移 0017 → 模型并注册 → schema（StrictInput，date/datetime 用 `strict=False` 且只接受字符串）→ service（upsert、事件 CRUD、趋势、报告、CSV）→ router → `main.py` 注册。
2. 后端测试：单元（schema 校验、CSV 注入、迁移降级保护、模块隔离）；集成（CRUD、幂等、隔离、CSRF、时区跨日、报告/CSV、公开接口无泄漏）。
3. 前端：API 层 → 页面与组件 → 趋势图 → 报告/打印 → 导航、受保护路径、noindex。
4. UI 合成 API（`ui-api.mjs`）补接口 → Playwright 规格（手机/桌面、深浅色、键盘）。
5. 文档 `docs/76-wellbeing-journal.md`（使用方式 / 接口与隐私 / 验证记录）。
