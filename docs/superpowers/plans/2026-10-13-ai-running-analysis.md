# AI Running Analysis Implementation Plan

**Goal:** 完成已批准的私人AI分析页面及模拟供应商业务验收。

**Architecture:** 沿用同步FastAPI、现有统计聚合与用户行锁；ai_reports保存快照和调用状态。SvelteKit同源代理转发幂等键，页面只在主动提交时生成。

**Constraints:** 不改.env/认证密钥；不操作running_note；无Docker、真实付费API、自动提交/推送或部署。直接保留当前工作区及提交历史。

- [x] 统计/输出契约：新增backend/tests/unit/test_ai_report_contracts.py，先验证未实现失败，再实现schema.py/snapshot.py/provider.py；验证四周范围、加权配速复用、白名单、数字输出拒绝、deadline、配置。
- [x] 报告流程：新增0005_ai_reports.py及model.py/service.py/router.py，注册模型/路由。POST /api/v1/ai-reports接收日期、同意和UUID幂等键；GET context/list/detail；DELETE软删除。所有接口仅本人；用户行锁保护版本、配额和pending，调用前提交事务，迟到完成不覆盖。
- [x] 隔离业务测试：新增test_ai_reports.py集成测试；原生独立测试实例先到0004，插入合成历史，再升级0005。只验证新增迁移，不重跑旧基础设施恢复验收。Mock注入真实业务服务，验证安全、统计、状态、费用和并发。
- [x] 页面：新增frontend/src/lib/api/ai.ts与routes/ai/+page.svelte；修改auth.ts保护路径、layout导航、backend.ts幂等转发和proxy-policy.ts生成预算。先写frontend/tests/unit/ai.test.ts与代理预算测试；实现事实/文字/历史/分页/重试/删除/状态反馈。
- [x] 浏览器：新增隔离Mock本地服务，正常Chrome注册登录；合成四周运动数据；检查生成/加载/事实/历史/错误/重试/删除/刷新不生成/隔离/窄屏，保存忽略目录证据。
- [x] 完成验证：相关后端测试、前端test/check/build、Ruff、diff检查；只读复核开发库及受保护文件哈希；更新README、09进度、16验收与15安全升级方案，停止开发。

供应商接口：`OpenAIProvider.generate(snapshot: dict, settings: Settings) -> ProviderResult`，结果包含已校验AnalysisText及可选token计数。测试仅替换app.state.ai_provider；不存在生产Mock开关。`build_snapshot(db, owner, start, end) -> dict`复用statistics.summary/trends，输入限定完整自然周，最大366天。

生成服务失败返回ApiError并包含report_id；重复完成key返回200原报告，无新供应商请求。客户端网络结果不明时保留key，提供同key查询结果；明确failed后用户主动新key重试。

完成记录见[验收文档](../../16-ai-running-analysis-acceptance.md)。独立审查三项P2（未知500幂等键、中文数量输出、响应等待预算）已补回归修复。
