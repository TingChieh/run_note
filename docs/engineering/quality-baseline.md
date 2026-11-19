# 工程质量基线（2026-11-19）

本文记录一次全仓库工程审计：发现的问题、风险、优先级与可复现的验证方式，以及本轮已落地的确定性约束。结论都有实际执行的命令作证据；没有运行的检查单独列出。后续改进按优先级推进，完成一项就在“状态”列更新并附上证据。

## 1. 审计范围与方法

- 代码：`backend/app`（19 个模块、132 个 HTTP 操作）、`backend/migrations`（30 个版本）、`frontend/src`（SvelteKit 3 / Svelte 5）、`.github/workflows/ci.yml`、`infra/native`、`AGENTS.md`。
- 方法：先跑现有检查得到基线；再用 FastAPI 路由自省（`fastapi.routing.iter_route_contexts`）枚举每条路由的认证依赖、CSRF、请求体与响应模型；用 AST 扫描 AGENTS.md 中的自然语言规则是否被遵守；抽查重复计算与权限路径；最后对新增的守护做“故意破坏”验证，确认它们真的会失败。
- 包管理确认：后端 `pip` + `requirements.lock`（`--require-hashes`），无 uv/Poetry；前端 `pnpm@11.25.0`，Node `^24`。

## 2. 基线：现有检查的实际结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 后端单元测试 | `cd backend && .venv/bin/pytest tests/unit -q` | 506 passed（改动前） |
| 后端全量（含集成，隔离 `_test` 库） | docs/09 的注入方式，库 `running_note_phase_one_test`（已在 head） | 903 passed, 1 skipped，耗时 17 分 35 秒；跳过项需 `TEST_SNAPSHOT_DATABASE_URL` |
| Ruff | `ruff check` / `ruff format --check app migrations tests` | 通过；243 个文件已格式化 |
| 迁移 head | `.venv/bin/alembic heads` | `0030_global_footprint_caches`，唯一 |
| 前端单元测试 | `pnpm test` | 51 文件 331 项通过（改动前） |
| 类型检查 | `pnpm check` | 1139 个文件，0 错误 0 警告（改动前） |
| Stylelint | `pnpm lint:style` | 退出码 0（不在 CI 中） |
| Prettier | `prettier --check "src/**/*.{ts,svelte}"` | 162 个文件未格式化（按约定渐进采用，不是失败） |

## 3. 问题清单

优先级：P0 可被利用的安全/数据错误；P1 让缺陷无法被及时发现、或让 Agent 反复犯同类错的问题；P2 已知技术债，有明确修法；P3 文档与整洁。

### P0

本轮没有发现 P0。以下几项按“实际行为”核对过，不只是静态阅读：

- 归属：所有登录后、按 ID 访问的路由都有“他人 ID 返回 404 且数据不变”的集成测试（活动类由本轮新增的 `test_cross_user_access.py` 覆盖，其余为既有测试）；把 `owned_activity` 的 owner 过滤临时删掉后，新测试在 `DELETE /api/v1/activities/{id}` 上返回 200 并失败，说明它真的能拦住越权。
- 写操作：除登录/注册外，每个非 GET 路由都依赖 `require_write` 或 `require_admin_write`（CSRF + Origin）；注册接口固定返回 403。
- 公开接口：132 个操作中有 55 个无需登录；其中公开数据路由的响应模型不含邮箱、备注、文件名、身心健康字段；只有登录/注册（返回本人账号）含 `email`，属预期。
- 分享：旧版摘要分享在 SQL 中约束 `visibility == "public"`，链接分享约束 `public/unlisted` 且未撤销、未过期；既有测试覆盖撤销、过期与并发转私密。

### P1

| # | 问题 | 风险 | 复现 / 证据 | 状态 |
| --- | --- | --- | --- | --- |
| P1-1 | AGENTS.md 的大部分规则只有自然语言，没有可执行检查（路由/模型注册、时钟、StrictInput、匿名路由、公开字段、迁移降级等） | 新会话的 Agent 不记得规则就会违反，直到人工审查才发现 | 改动前 `grep -rn test_architecture backend/tests` 无结果 | **已修复**：`backend/tests/unit/test_architecture.py`（21 项）与 `frontend/tests/unit/architecture.test.ts`（6 项） |
| P1-2 | 前端 `lib/api/*` 的类型全部手写，与后端 schema 没有任何机械联系；`docs/openapi-phase-one.json` 只有 3 个路径，早已过期 | 后端改名或删字段后，前端编译仍然通过，错误只在浏览器里出现 | 契约断言首次运行即发现 7 处不一致（见 P2-2） | **已修复**：`app/contract/typescript.py` 生成 `frontend/src/lib/api/generated/api.ts`；后端测试防过期，`pnpm check` 防类型漂移，vitest 检查路径与查询参数 |
| P1-3 | 没有统一的验证入口；本机与 CI 跑的命令靠记忆对齐 | Agent 只跑一部分检查就宣称完成 | — | **已修复**：`scripts/verify.py`，复用 CI 的区域判定；`test_verify_script.py` 保证它包含 ci.yml 的每条检查命令 |
| P1-4 | 本机默认 Node 为 v22，而 `package.json` 与 CI 要求 24 | 本机结果与 CI 不一致（pnpm 每次都警告 Unsupported engine） | `node -v` → v22.23.5；`/opt/homebrew/opt/node@24` 已安装 | **已缓解**：`verify.py` 自动改用 Node 24，找不到就失败；系统默认版本未改 |
| P1-5 | 真实后端的浏览器 e2e（`playwright.config.ts`）7 个用例文件中 6 个依赖 `/register` 页面注册，而注册已关闭 | 地图加载、导入等真实链路没有可运行的浏览器回归；只能依赖合成 API | `grep -ln register frontend/tests/e2e/*.ts` 命中 6 个文件 | **已修复**（第二轮）：`playwright.config.ts` 自启后端与前端，只接受允许名单内且在 head 的 `_test` 库；站主由 `backend/tests/e2e_accounts.py` 离线预置，其余账号由站主经管理员接口按用例新建；第三方请求一律拒绝，未捕获页面错误即失败。7 个用例文件按当前界面重写，12 项通过（约 32 秒） |
| P1-6 | 集成测试本机耗时 17.5 分钟，大量用例的 teardown 各耗 7–9 秒 | Agent 的反馈回路过长，容易跳过集成测试 | `--durations=15` 显示 teardown 占前列（如 `test_sharing.py::test_public_matrix_and_revocation` 9.55s） | **已修复**（第二轮）：根因是全局足迹缓存填充的 PostGIS 语句无法被 worker 停止信号取消，关闭时要等语句跑完（最长 5 秒语句超时）。现在登记连接以便取消，并在每条耗时语句前检查停止信号（空闲连接收到的取消请求会丢失）。全量后端测试 17 分 35 秒 → 3 分 58 秒，最慢 teardown 1.8 秒。线上停服同样受益 |

| P1-7 | 全局足迹匹配对稠密轨迹极慢：测试库中 20 万点（仍在允许的点数预算内）的合成轨迹单条匹配约 27.5 秒，超过填充的 5 秒语句超时。一批中只要有一条就整批回滚，且候选按创建时间倒序，同一批活动每次扫描都会被重新选中，填充无法推进，其他用户的缓存也被挡住 | 一条长轨迹可让所有人的全局足迹缓存永久停滞；读接口对缺失行实时计算，该用户的全局足迹页也会超时 | 本机隔离库：`test_global_footprint_cache.py::test_worker_scan_fills_global_footprint_caches` 在库中存在 `test_province_performance.py` 留下的稠密轨迹时失败（原代码同样失败）；CI 用全新库且按字母顺序先跑该文件，所以碰不到 | **已修复**（第三轮）。实测更正：真实形态的稠密轨迹（4.2 万点马拉松式、20 万点超长轨迹）原本就在 0.2 秒内，27 秒只出现在“长边反复重叠”的退化轨迹上（异常或构造的上传）。两项修复：匹配前按 1e-4 度（约 11 米，远小于图集约 110 米到 1.6 公里的边界误差）简化轨迹，退化轨迹 33 秒 → 0.3 秒，三组样例判定结果不变；每个用户在独立保存点里匹配，超时只回滚该用户并在本次填充内跳过，其他用户照常写入 |

### P2

| # | 问题 | 复现 / 证据 | 建议 |
| --- | --- | --- | --- |
| P2-1 | **已修复**（第三轮：全部 JSON 路由已有类型化模型，未定型清单删除，只剩 5 个二进制路由）。原有 11 个无 `response_model` 的 JSON 路由，另有 10 个 showcase 操作用 `ApiResponse[dict]`（规则已扩展为同样视作未定型）。第二轮为删除结果、管理员归属、连续天数、省份汇总补了模型（基类 `ExactView`：未声明字段或类型不符直接报错，不会静默丢弃或转换），剩 10 个：活动路线、足迹、全球足迹（本人、管理员、showcase） | `test_architecture.py::UNTYPED_JSON_ROUTES` | 剩余均为 GeoJSON 大响应。实测 5 万点路线做坐标级校验只多约 7 ms（共 18 ms），数值不变，性能不是障碍；需先确认真实数据里的几何类型范围（`geometry_view` 兼容 `GeometryCollection`） |
| P2-2 | **已修复**（第三轮：`temporal_quality`、`visibility` 改为与 CHECK 约束一致的 `Literal`；坐标改为定长元组，生成器支持 `prefixItems`；路线组 `shape`、一起跑动态几何改为线串模型。保留 3 处有理由的 `Narrowed`：趋势周期、空路线起止点、带版本号的 AI 快照）。原问题：后端 schema 比前端解析器宽松：`temporal_quality`、`visibility`、分享 `status` 声明为 `str`；`stats_snapshot` 为 `dict`；路线 `shape`、动态 `geometry` 为嵌套列表；趋势 `period` 后端多一个 `year` | `frontend/tests/contract/api-types.ts` 中的 `Narrowed<...>` | 把后端字段收紧为 `Literal`/具体模型，再删掉对应的 `Narrowed` |
| P2-3 | `lib/api/sharing.ts` 中 `readProfile`、`readPublicCalendar`、`readPublicList` 没有调用方；`readShares` 直接 `as` 断言，没有运行时校验 | `grep -rn "readProfile\|readPublicCalendar\|readPublicList" frontend/src` 只命中定义 | 删除死代码（需确认不再规划公开主页），为 `readShares` 补解析器 |
| P2-4 | 迁移 0002–0006 的 `downgrade()` 无条件删表 | `test_architecture.py::LEGACY_DESTRUCTIVE_DOWNGRADES` | 历史版本不改；新迁移已由测试强制要求带 `RuntimeError` 守护 |
| P2-5 | Python 没有类型检查器（无 mypy/pyright） | `backend/pyproject.toml` | 先在 `app/core`、`app/contract` 小范围启用，再按目录扩大 |
| P2-6 | Stylelint 本机通过但不在 CI 中；Prettier 162 个文件未格式化 | 第 2 节 | Stylelint 加入 CI 前端任务；Prettier 继续按约定渐进 |
| P2-7 | `0001_enable_postgis.py` 的 revision 是 `0001_postgis`，与文件名不一致 | `test_architecture.py::LEGACY_REVISION_IDS` | 不改（已部署库记录了该 id），仅登记为例外 |

### P3

- `docs/04-rest-api.md` 仍写 `page`/`page_size`（AGENTS.md 已注明过时）；`docs/openapi-phase-one.json` 已被生成契约取代，可在确认后删除或标注“历史快照”。
- `gpx/metrics.py::haversine` 只被单元测试用作 PostGIS 距离的独立参照，不是生产重复实现；保留，但不要在业务代码中调用。
- `ai_reports/__init__.py` 含一行文档字符串；模块包规则已放宽为“只允许文档字符串”。

## 4. 本轮落地的确定性约束

| 守护 | 位置 | 拦住什么 | 运行于 |
| --- | --- | --- | --- |
| 后端架构规则 | `backend/tests/unit/test_architecture.py` | 未注册的 router/模型；业务代码直接取系统时间；`relationship()`；重复定义 `envelope`；`exclude_none`；错误码格式；`details` 键被静默丢弃；wellbeing 被其他模块导入或调用 `lock_owner`；新增匿名路由；写操作缺 CSRF；管理员路由缺 `require_admin`；按 ID 访问本人资源的路由没有登记跨用户测试；请求体不是 `StrictInput`；新增无 `response_model` 的路由；新增 `async def` 端点；公开响应出现私密字段或 wellbeing 模型；迁移命名、序号、链断裂；删表/删列的降级没有守护 | CI backend 任务（单元测试） |
| 契约生成与防过期 | `backend/app/contract/typescript.py`、`backend/tests/unit/test_api_contract.py` | 后端 schema 改了但没重新生成前端契约；遇到不支持的 JSON Schema 结构时直接报错，不会悄悄退化为 `unknown` | CI backend 任务 |
| 前端类型契约 | `frontend/tests/contract/api-types.ts` | 前端解析器承诺的类型与后端实际返回不一致（字段改名、删除、变宽） | `pnpm check`（CI frontend 任务） |
| 路径与查询参数 | `frontend/tests/unit/api-contract.test.ts` | 前端或合成 API（`ui-api.mjs`）调用了后端不存在的路径或查询参数 | `pnpm test` |
| 前端架构规则 | `frontend/tests/unit/architecture.test.ts` | `$app/stores`、svelte store、`createEventDispatcher`、`$lib` 导入、顶层导入 maplibre/echarts/three、`map.setStyle`、客户端导入 `lib/server` | `pnpm test` |
| 跨用户行为 | `backend/tests/integration/test_cross_user_access.py` | 自动发现全部 `/api/v1/activities/{identifier}…` 路由：他人 ID 必须 404、不泄露标题、数据不变；新路由没登记请求体就失败 | CI backend 任务（集成） |
| 验证入口与 CI 一致 | `scripts/verify.py`、`infra/native/tests/test_verify_script.py` | ci.yml 新增检查而本地入口没跟上 | CI infra 任务 |

例外清单（匿名路由、未定型路由、历史降级等）都是“冻结的现状”：新增违规会失败，清单中已经修好的条目也会失败，因此清单只能缩小。

### 守护确实会失败（故意破坏验证，均已恢复）

| 破坏方式 | 结果 |
| --- | --- |
| 在生成的 `api.ts` 中把 `PublicActivity.title` 改名 | `pnpm check` 报 `Property 'title' is missing … PublicActivity`；`app.contract.typescript --check` 退出码 1 |
| 去掉 `/statistics/streaks` 的身份依赖并改用 `datetime.now()` | `test_only_listed_routes_are_reachable_without_a_session`、`test_business_code_reads_time_from_the_app_clock` 失败 |
| 给 `PublicAuthor` 加 `email` 字段 | `test_public_responses_never_carry_private_fields` 失败，并且契约测试报文件过期 |
| 删除 `owned_activity` 的 owner 过滤 | `test_cross_user_access.py` 在跨用户 `DELETE` 返回 200 处失败 |
| 从 `verify.py` 的计划中去掉 `pnpm build` | `test_verify_script.py` 报 “ci.yml job 'frontend' runs `pnpm build`; add it to verify.py” |

## 5. 使用方式

```bash
python3 scripts/verify.py                          # 按改动区域快速检查
python3 scripts/verify.py --full                   # 全部区域 + 构建 + 合成 API 浏览器测试
python3 scripts/verify.py --test-db <名字>_test     # 追加集成测试（只接受 _test 库）
cd backend && .venv/bin/python -m app.contract.typescript   # 后端 schema 变化后重新生成契约
```

## 6. 验证记录

见文末“本轮验证记录”，记录实际执行的命令与输出摘要。

## 7. 后续顺序建议

1. 把真实后端 e2e 加入 CI（需要 PostgreSQL + Chrome 的任务，只能在 PR 上验证）。
2. 本机测试库长期积累（约 1.3 万用户、5.3 万活动），会拖慢全局扫描并让依赖全库数据的测试结果取决于顺序；可定期重建测试库（CI 每次都是新库）。
4. P2-3、P2-6、P2-5。

## 本轮验证记录

本机 macOS，Node 24（`verify.py` 自动选用 `/opt/homebrew/opt/node@24/bin`），Python 3.14，隔离测试库 `running_note_phase_one_test`（已在 head）。

- `python3 scripts/verify.py --full`：10/10 步通过。后端单元测试 531 passed（原 506 项 + 架构 21 项 + 契约 4 项）；Ruff 检查与格式检查通过；契约 `--check` 通过；vitest 53 文件 340 项通过；`pnpm check` 0 错误；`pnpm build` 成功（仍有已知的大 chunk 警告）；合成 API 浏览器测试（`playwright.ui.config.ts`）340 passed，耗时 10.4 分钟；ops 单元测试与 shellcheck 通过。
- 后端全量集成测试（新增文件之前）：903 passed、1 skipped，17 分 35 秒。
- 新增集成测试单独运行：`tests/integration/test_cross_user_access.py` 1 passed。
- 前端新增测试格式化后复跑：`api-contract.test.ts` 与 `architecture.test.ts` 9 项通过，`svelte-check` 0 错误。

未运行：加入新增跨用户测试之后的完整集成套件（只单独跑了新测试）；真实后端浏览器 e2e（见 P1-5，目前无法运行）；`*-e2e.config.ts` 与其它 Playwright 特性配置；部署/备份演练脚本（只在 CI 中运行）；GitHub 上的 CI（尚未推送）。

## 第二轮验证记录（e2e、teardown、响应模型）

- `python3 scripts/verify.py --full --test-db running_note_phase_one_test`：11/11 步通过。后端单元加集成 930 passed、1 skipped（需 `TEST_SNAPSHOT_DATABASE_URL`），4 分 57 秒；vitest 340 项；`pnpm check` 0 错误；生产构建成功；合成 API 浏览器测试 340 passed（10.7 分钟）；真实后端 e2e 12 passed（30.5 秒）；ops 单元测试与 shellcheck 通过。
- 先写失败测试再修：`test_stopping_the_worker_cancels_a_running_global_fill_statement` 修复前因“stop did not cancel the running statement”失败，修复后通过。
- e2e 故意破坏：从 SSR 代理请求头白名单中去掉 `x-csrf-token` 后，e2e 以 `CSRF_FAILED` 失败；已恢复。
- 未运行：部署/备份演练（只在 CI 中运行）；GitHub 上的 CI（尚未推送）；真实后端 e2e 尚未接入 CI。

## 第三轮：注释与压制

- 盘点：TODO/FIXME/HACK/XXX 为 0；后端 `noqa` 170 处，其中 F811/F401 共约 157 处源于测试从 `tests.conftest` 显式导入夹具（pytest 本可自动发现），每个测试都要压制“重复定义”。
- 根治：删除对 `clients` 的导入；跨模块共享的 `site`、`ai_clients` 登记到 `tests/integration/conftest.py`；唯一的 E731 改写为函数。后端 `app`、`migrations`、`tests` 中 `noqa` 注释 170 → 1（`app/main.py` 注册 ORM 元数据的副作用导入，写明了原因）。批量清理时自动修复曾误删这行导入，已恢复，并在 `test_architecture.py` 中加了守护。
- 约束：Ruff 启用 `RUF100`（多余的 `noqa` 报错）；`test_architecture.py`、`architecture.test.ts`、`test_shell_style.py` 要求 TODO 等标记关联 issue、压制注释写明原因，前端禁止 `@ts-ignore` 与 `eslint-disable`（项目没有 ESLint，生成文件里的 `eslint-disable` 已删除）。缺原因的 2 处 `svelte-ignore` 与 2 处 `shellcheck disable` 已补写原因。三条检查均做过故意破坏验证。
- 未处理：`infra/` 下 Python 文件仍有 14 处 `noqa`，CI 不对它们运行 Ruff，这些注释实际不起作用。
