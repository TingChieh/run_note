# AI 分析供应商兼容修复

日期：2026-10-15。

## 问题与改动

页面显示 `AI_OUTPUT_INVALID`。经用户授权，以合成统计摘要调用真实供应商复现：DeepSeek 默认开启思考模式，原请求的输出预算为 2000 token，全部用于思考，最终正文为空，`finish_reason=length`。统计与历史查询正常，失败位于供应商输出处理阶段。

仅对主机名严格为 `api.deepseek.com` 的请求增加 `thinking: {type: disabled}` 与 `response_format: {type: json_object}`；其他兼容供应商继续使用原请求参数。保留预算、总超时、白名单、内容校验和无自动重试策略。明确拒绝截断结果，即使截断正文碰巧能解析为 JSON。

真实验证还发现模型会写入“一个周区间”“增加一次轻松跑”等数量表达，按现有定性分析规则应拒绝。提示词升级为 `running-qualitative-v3`，增加定性改写说明和可通过既有校验的 JSON 示例；缺失值使用“未知”表述。没有放宽数字、具体训练处方或内容长度校验。


2026-10-24 补充：生产接入阿里云百炼后，合成摘要复现 `AI_OUTPUT_INVALID`：接口与 JSON 格式均正常（`finish_reason=stop`），但正文含“而非为零”，其中汉字数字“零”被既有定性校验拒绝。同一批采样还发现主因：百炼的混合思考模型默认也会思考，输出预算（2000 token）被思考耗尽，正文为空、`finish_reason=length`（6 次采样中约一半）。仅对主机名为 `dashscope.aliyuncs.com` / `dashscope-intl.aliyuncs.com` 的请求增加 `enable_thinking: false`，其他供应商不受影响；关闭后同一提示词连续 6 次合成调用全部通过校验（每次约 100 多个输出 token）。提示词升级为 `running-qualitative-v4`，明确列出汉字数字及含这些字的常见说法（为零、零星、一直、一些、一定、唯一、第一、十分、半数）与替代表达；校验、额度和无自动重试策略不变。


2026-10-24 再补充：真实账号（364 天、约 52 周、带设备数据，输入约 1.3 万 token）在 v4 下仍失败。以同规模合成数据复现，4 次中 3 次失败：模型照抄了提示词里“不得声称两者对应”的“两者”，其中“两”被定性校验拒绝（此前的小样本没有心率与配速的内容，未触发）。提示词升级为 `running-qualitative-v5`：该句改为“心率与配速彼此对应”，并把“两者”“两项”“双方”加入禁用词；新增测试要求提示词里只有刻意列举禁用词的行才能带被校验拒绝的字。同规模合成数据连续 8 次均通过校验（输出约 210 到 270 token）。

本机后端已通过 `./backend.command restart` 加载修复。刷新 AI 分析页面，读取统计依据，确认发送摘要后点击“生成近期总结与下周建议”。旧失败报告保留失败状态，不会因刷新或查看历史自动重做；新分析仍计入原有额度。

## 接口与隐私

没有修改前端、公共 API、数据库结构、配额或幂等行为。新增供应商参数仅在服务端生效。所有外部诊断使用合成统计，经既有字段白名单发送，不使用真实用户数据、轨迹、坐标或原始文件，不写入数据库或报告历史。不输出凭据，不修改环境配置，不提交或推送。

## 验证记录

- 后端最终单元回归：`cd backend && .venv/bin/pytest tests/unit -q --tb=short`，208 passed，0 failed，0 skipped。
- `ruff check app migrations tests`：All checks passed；`ruff format --check app migrations tests`：121 files already formatted。
- 新回归先复现默认思考导致空正文及截断 JSON 被接受，再验证修复；覆盖 DeepSeek 根路径和 `/v1`，以及其他供应商不接收专用参数。新增数量表达拒绝用例及提示词 JSON 示例校验；示例曾因“零”被拒绝，改为“未知”后通过。
- 经用户分次授权，共执行五次真实供应商合成调用。最终调用 `finish_reason=stop`，正文 208 字符，无思考内容，输入 595 token、输出 101 token；完整 `OpenAIProvider.generate` 返回通过 `AnalysisText` / `ProviderResult` 校验的结果。
- 重启后，后端 `http://127.0.0.1:8001/api/v1/health/ready` 与前端代理 `http://127.0.0.1:5183/api/health` 均为 HTTP 200；数据库 connected、PostGIS enabled、schema current。
- `git diff --check` 通过。初次受沙箱监听限制的模拟 HTTP 测试失败，获准运行本机临时监听后通过；最终回归数量以上述实测为准。

未运行：数据库集成测试、前端检查/构建、浏览器端生成与真实账号报告落库验收。本次未改动数据库事务或前端，真实供应商合成验证不代表真实账号全流程验收。模型输出仍须经过校验，单次成功不保证未来所有生成均符合规则。

供应商协议依据：[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)与 [JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)。
