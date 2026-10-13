# AI 跑步分析验收记录

日期：2026-10-13（Asia/Shanghai）。状态：**IMPLEMENTED / MOCK TECHNICAL_PASS**。本轮仅实施已批准AI设计；真实供应商调用和生产部署为NOT VERIFIED。

## 功能与入口

本地页面：http://127.0.0.1:5184/ai 。该页面需正常账号登录。8002后端、5184前端连接本轮原生PostgreSQL **127.0.0.1:55445/runnote_ai_20261013_test**，注入测试目录中的DemoProvider，不是日常开发库或真实模型。

新增近期总结/趋势解释/下周建议生成，统计依据预览，用户明示同意，加载及错误反馈，本人历史分页/详情与URL深链，失败历史及主动重试，报告删除和数据过时提示。模型仅给定性解释，数值面板来自后端快照。刷新和历史读取只有GET，不自动生成。

后端接口：GET `/api/v1/ai-reports/context` 返回默认日期、事实预览及配置/额度可用性；POST `/api/v1/ai-reports` 接收完整周范围、严格JSON true同意及UUID Idempotency-Key；GET列表/详情和DELETE仅本人报告。匿名401、他人报告404，写接口复用CSRF。没有公开AI报告路由。

## 真实统计口径与合成示例

默认最近四个已结束自然周，按用户时区确定当前日，运动按已有activity_date本地日期归属。日期左闭右开，周一开始，完整周范围最多366天。当前活动无运动类型字段，因此指标基于用户导入的运动记录，未自动识别是否为跑步。

复用statistics.summary/trends：

- 周跑量：本人范围内distance_m总和，包含缺耗时记录的距离。
- 跑步频率：每周activity_count与独立activity_days；平均频率=范围活动次数/完整周数，不以活跃周数为分母。
- 平均配速：仅distance_m>0、elapsed_seconds>0且temporal_quality为complete/manual的记录，sum(可靠耗时)×1000/sum(对应距离)。不是单条配速算术平均；缺耗时、零距离/零耗时不当作零配速。
- 周跑量变化率：(当前周距离-前周距离)/前周距离×100，Decimal三位小数half-even。首周或前周距离为零时NULL，不声称增长无限或零变化。
- 覆盖与质量：可计算配速的记录数、缺耗时数、质量警告数、总次数和天数。少于3条记录或不足2个活跃周标记分析依据有限；完全无记录时422，不调用供应商或扣减额度。

Chrome合成样例日期2026-09-14至2026-10-12：

| 周开始 | 距离 | 活动次数/天数 | 可靠耗时 | 配速 | 跑量变化 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-14 | 1.000 km | 1/1 | 600 s | 10:00/km | 无法比较 |
| 2026-09-21 | 1.500 km | 1/1 | 750 s | 8:20/km | +50.000% |
| 2026-09-28 | 2.000 km | 1/1 | 缺失 | 无法计算 | +33.333% |
| 2026-10-05 | 2.500 km | 1/1 | 1250 s | 8:20/km | +25.000% |

总距离7.000km，4条活动、4个运动日，平均1.000次/周；配速依据为3条记录、5.000km、2600s，所以平均520s/km=8:40/km。缺耗时1条、质量警告1条。样例均为隔离库合成数据，不使用真实用户训练数据。

模拟AI报告（数值未由模型生成）：

> 近期周跑量呈上升趋势。结合运动频率与数据覆盖情况，应留意恢复，避免继续急于加量。
>
> 下周优先安排轻松跑，保持可交谈的强度。根据疲劳和恢复情况调整安排，休息后再决定是否增加训练。出现疼痛或明显不适时停止训练并寻求专业意见。
>
> 这是模拟AI报告，仅基于后端统计摘要。部分记录缺少可靠耗时，配速依据并不完整；无法判断健康状况。训练建议仅供参考，不构成医疗建议。

## 隐私、费用与失败处理

供应商请求重建字段白名单：日期、汇总、周桶、变化率、覆盖与固定质量提示。不发送用户id、邮箱/用户名、标题/备注、坐标、精确时间、GPX或分享链接。测试包含混入字段的顶层/周桶/汇总白名单检查，以及其他用户不同数据的排除。API Key为服务端SecretStr，不进入前端；构建客户端未找到AI_API_KEY或测试密钥标记。供应商异常只保存自有错误码，不保存原始错误或在日志打印完整摘要/响应/密钥。

用户行锁串行化快照与版本、额度和pending创建；短事务提交后才调用供应商。不同应用实例共享同一DB约束，每用户至多一个pending。完成仅更新仍pending的记录；读取时回收超过当前配置timeout+60秒的遗留pending，迟到结果不会覆盖failed。并发活动写入测试证明summary、周桶和source_data_version保持一致；外部调用期间其他写事务可取得用户锁，旧报告随后标记is_stale。

默认UTC日最多5次，计入成功和失败，删除不返还额度。用户内幂等键唯一：完成重放200、不调用模型；参数不同409，已删key在保留期间409；完成重放不受新额度或其他pending误拦。删除清空正文和快照，调用元数据保留30天，之后本人请求内清理已删元数据。

页面将未确认请求的key与日期范围保存在本人sessionStorage命名空间，不保存密钥/完整运动数据或报告。网络中断和未知服务端500不自动另发新key；用户可读取历史或主动按原key重试。Chrome实际丢弃已成功响应，再同key请求：总报告和attempts_today均未增加。明确失败后主动新分析才使用新key。最终Chrome共7次POST，其中包含两次原键恢复；实际计入5次尝试（含Mock超时），没有额外计费请求。

OpenAI兼容适配器仅访问配置地址追加/chat/completions，禁止重定向和隐式环境代理，不自动重试。显式连接预算≤5秒，连接后的响应等待允许剩余整体预算；进程隔离整体deadline≤30秒，超时终止并回收网络子进程；输出预算2000token、HTTP响应≤64KiB。JSON/Pydantic结构、文字总长6000及持久化JSON10000字符上限校验；HTML、Unicode数字（包括中文大写、罗马与圈号数字）、常见英文定量表达拒绝为AI_OUTPUT_INVALID。不能将这些规则当作对任意语言定性事实或医疗内容的全面正确性证明；页面事实始终来自快照，真实模型质量仍需受控人工评估。

## 自动化与真实Chrome证据

- **PASS 后端：223 passed，0 skipped，23.74秒**。覆盖全部unit及AI、现有统计/认证/分享的相关integration；没有重跑已完成的备份恢复或整套基础设施验收。
- **PASS 前端：10文件40项；类型检查0 errors / 0 warnings；production build与adapter-node输出成功。**既有MapLibre/ECharts大chunk及NO_COLOR/FORCE_COLOR提示仍存在。
- **PASS Ruff check、format --check（96文件）、git diff --check。**
- **PASS 安装的真实Chrome155.0.8059.40，18项交互检查，0 pageerror。**正式完整验收采用Chrome无窗口模式，实际渲染页面并操作表单/鼠标/导航；不使用jsdom或认证cookie绕过。CLI窗口检查确认匿名/ai跳转登录。

18项包括：匿名保护，正常注册/退出/登录，默认周范围与同意，无自动生成，加载/禁用重复提交与改日期，Mock生成和事实对照，刷新不POST，历史/深链，B用户读/删404，丢失响应同key恢复，未知500后保留key重放，Mock超时历史/提示，主动新尝试，稀疏依据，额度含失败，空数据不生成，删除不返还额度，390px无整页横向溢出，0未捕获页面错误。

实际命令：

```sh
# 仓库根；运行器固定55445/_test，不指向.env中的开发库
backend/.venv/bin/python /private/tmp/runnote-ai-run.py test \
  tests/unit tests/integration/test_ai_reports.py \
  tests/integration/test_statistics.py tests/integration/test_auth.py \
  tests/integration/test_sharing.py -q --tb=short
node frontend/test-results/ai-chrome.cjs

# backend目录
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests

# frontend目录
npm_config_manage_package_manager_versions=false pnpm test
npm_config_manage_package_manager_versions=false pnpm check
npm_config_manage_package_manager_versions=false pnpm build
```

本地忽略目录证据：frontend/test-results/ai-chrome.cjs、ai-seed.py、ai-chrome-result.json、ai-example-report.json、ai-chrome-trace.zip、ai-report.png、ai-error.png、ai-mobile.png、ai-cli。运行器和实例数据保留/private/tmp/runnote-ai-run.py与/private/tmp/runnote-ai-20261013；不提交账号密码、数据库归档或浏览器认证trace。

独立审查最后复核“一致”“进一步”合法定性文本及“三组”“叁回”拒绝案例通过，没有遗留的重要审查项。

独立审查发现未知500清除key、中文数量漏拦及响应等待误用连接预算三项P2，已补回归并修复。本机HTTP供应商连接立即成功、延迟六秒返回，在十秒整体预算内通过；短整体预算仍能终止子进程。Unicode数字过滤采用保守策略，明确允许一致、进一步等常见定性词；仍可能拒绝其他含数词的普通用语。参考中的参/參允许，但数量用法拒绝。

浏览器首次发现读新范围仍展示旧selected报告，已修复预览时清除选中报告/URL与迟到详情，并要求表单日期匹配已读取快照才能生成。完整Chrome回归验证新范围事实面板正确。另一个窗口测试出现非预期导航，原因未确认；最终使用独立无窗口Chrome及trace完成全部流程。测试路径错误只修正本地合成数据脚本，没有绕过认证。追加回归时曾出现B注册等待超时，原因未确认；一轮浏览器任务因与同库测试夹具运行重叠而中止，不计入通过证据。最终后端测试完成后，再顺序运行Chrome完整流程通过。

## 数据库与Git

新增0005_ai_reports，父revision0004_public_sharing，只新增ai_reports表、用户CASCADE FK、状态/日期/完成/删除/正文/用量约束、用户时间索引、用户内幂等唯一约束及pending部分唯一索引；复用users.activity_data_version，不改变既有运动/轨迹表。

本轮独立55445实例从零到0004，插入合成旧用户/活动后再升级0005；旧活动距离1234.000m保留。只读核对8个CHECK及索引，alembic check结果No new upgrade operations detected。未执行downgrade或恢复旧基础设施验收。

结束只读复核开发running_note：仍0003_gpx_storage；users17、activities14、gpx_imports14、activity_points63、activity_segments22；public目录摘要86b1627f3741206c5772399dc5314c4c不变。.env与认证密钥校验和前后一致。没有对开发库迁移/DDL/DML、清空、重建、修改密钥或使用Docker。HEAD仍3c3f21b，main相对本地origin/main ahead3，未fetch、提交、推送或部署。新增业务及文档保持未提交供人工审查。

最新完整业务数据备份仍未确认，旧空业务备份不适用于当前14活动。后续日常库升级只按[工程基线及升级方案](15-ai-engineering-baseline.md)先新备份、确认目标、获得授权后执行0003→0004→0005；本轮不执行。

## 真实API与部署待办

真实供应商调用次数 **0**。仅本机Mock HTTP与注入的DemoProvider参与验收。真实接入尚需在FastAPI进程环境配置AI_BASE_URL（含API前缀）、AI_MODEL、AI_API_KEY；按需要调整AI_DAILY_LIMIT（默认5）与AI_TOTAL_TIMEOUT_SECONDS（默认30、上限30）。变量不放PUBLIC_*、浏览器或仓库；不修改已有.env。

尚未验证真实供应商兼容性、计费/token用量、定性建议质量和真实模型的事实错误率；不得声称已通过真实模型质量验收。生产HTTPS、反向代理/日志策略、部署密钥管理、并发容量和真实移动设备也未验收。服务8002/5184和隔离55445保留供本地查看，浏览器验收会话关闭。本轮停止于此。
