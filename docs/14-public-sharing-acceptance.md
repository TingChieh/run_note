# 个人公开主页与跑步摘要分享验收

日期：2026-10-13（Asia/Shanghai）。本轮范围：**IMPLEMENTED / 本地 TECHNICAL_PASS**。沿用用户、认证、活动、统计及GPX架构，保留上一轮未提交足迹改动，不开发AI。

## 入口与运行环境

- 设置入口：http://127.0.0.1:5183/settings ，编辑昵称、500字以内简介、公开主页开关。
- 公开主页：`/u/{username}`；合成验收示例 http://127.0.0.1:5183/u/sharing_1013?year=2024 。显示公开记录总数、总距离、运动天数、年度日历，支持公开日历日期下钻、列表分页和单条详情。
- 分享入口：本人 `/activities/{id}` 的“公开与分享”面板。先保存“仅链接可见”或“公开”，再创建/复制/预览/撤销链接。默认有效30天，可主动选择永久，每条活动最多20条有效链接；API可设置未来365天内自定义到期时间。
- 单条公开页：`/public/activities/{id}`；随机链接页：`/shared/{token}`，不要求登录。
- 本轮8001后端/5183前端已加载最终代码，ready和匿名样例API实际成功，连接 **runnote_sharing_20261013_test 隔离测试库**，保留运行供查看。不要将其误认为开发库数据。开发库 `running_note` 仍是0003，本轮不对其迁移；连接新版服务前须另行备份并应用0004迁移。

## 实际权限与隐私机制

private：只允许本人原有接口，匿名公开ID404，不能创建分享（409）。unlisted：仅有效随机token可匿名读摘要，公开ID404，不进入主页。public：可匿名读单条摘要，只有主页开启时进入主页列表/统计/日历。开启主页不改变任何历史记录的私人状态；新账号/GPX仍默认private且轨迹共享关闭。

**本轮完全不公开坐标**：摘要仅含id、标题、活动日期、距离、用时、配速、作者username/display_name和has_shared_route=false。无精确起止时间、坐标、起终点标记、轨迹缩略图、原始GPX、邮箱、备注、原始文件名、内部owner或质量细节。公开/分享route端点始终404；本人路线接口匿名401。未实施可公开轨迹及端点裁剪，未来如支持，需单独授权与遮蔽验收。

公开统计与日历复用现有摘要聚合，SQL增加owner和visibility=public过滤；私人及unlisted都排除。不会开放本人足迹、热力图或本人统计给匿名访问。

256位随机令牌（43字符URL-safe）只在创建时返回完整URL；数据库仅存SHA256。管理列表返回link_id、时间及active/expired/revoked，不返回令牌/URL。所有写操作复用认证、CSRF、owner校验；分享和隐私修改先锁同一users行，串行化并发写入。改private在同事务撤销所有链接、关闭共享轨迹、递增数据版本，再公开不恢复旧链接。链接撤销逻辑保留，删除活动的数据库FK级联删除分享。

**关闭主页只关闭该主页的资料、公开统计、日历、列表接口，立即404；独立已公开活动和分享链接仍按自身权限存在。撤销链接只关闭该token，public按ID访问需另设为私人/unlisted。**这是既有设计边界，设置与详情页都有明确说明，不把关闭主页描述成一键撤回所有分享。

每次匿名读取实时校验当前数据库可见性、主页开关、token撤销及到期；no-store，无公开数据缓存。公开页及API使用no-referrer、noindex/nofollow；Uvicorn与HTTP客户端日志脱敏/shared/token，保留Uvicorn格式化需要的参数。外部反向代理尚未部署，需另行保证访问日志不存完整token路径。匿名页面返回前台/恢复历史页时重新读取、先清空旧数据；迟到请求序号防止覆盖新结果。已被他人保存的摘要不能收回。

## 数据库验收

最小迁移0004_public_sharing：users.bio默认空、长度限制；activity_share_links及CASCADE FK/过期约束/token唯一约束/activity索引；visibility=public活动局部索引。既有visibility/allow_shared_route/profile_is_public字段复用，不重建业务表。

三个本机独立数据库由原生PostgreSQL创建，预装已有PostGIS（普通业务角色无安装扩展权限）：

- runnote_sharing_20261013_test：从零执行0001–0004，跑所有后端回归和真实浏览器验收。
- runnote_sharing_final_20261013_test：审查修正约束命名后，用最终脚本从零升级0001–0004并执行最终完整回归。原两库保留，未重建。
- runnote_sharing_upgrade_20261013_test：先升级0003，插入合成历史用户/私人记录，再升级0004，核实默认private、allow_shared_route=false、profile_is_public=false、原距离1234米保留、bio为空。重复升级数据库对象摘要一致，alembic check无待生成操作。另验证legacy_sentinel保留。

只读核对开发库前后均为running_note / 0003_gpx_storage；public对象OID/名称摘要均86b1627f3741206c5772399dc5314c4c。未删除/重建开发库，未对其迁移。没有清理测试业务数据，权限测试使用唯一账号，部分约束测试仅在自身事务中回滚。旧迁移测试原来断言全库只有自身数据，改为按自身user/segment过滤，可在含旧合成数据的隔离库重复跑。

.env SHA256前后一致：2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab。无Docker、无新依赖、无Git提交/推送。

## 自动化与Chrome结果

最终完整后端：**271 passed / 0 skipped，50.52秒**（最终空隔离库与升级快照库）。此前日志修复后完整270项也通过；加入迁移命名测试后最终271项全部通过。

前端：pnpm test **9文件35项通过**；pnpm check **0 errors / 0 warnings**；pnpm build成功、adapter-node产物生成。仍有既有MapLibre/ECharts大chunk和NO_COLOR/FORCE_COLOR提示。

后端Ruff check及format --check通过（83文件）；git diff --check通过。

Chrome **155.0.8059.40**，正常账号认证、真实表单GPX导入，无浏览器身份绕过，18项主要流程通过：设置保存、匿名空主页、新GPX私人默认、私人ID/轨迹拒绝、unlisted链接创建/复制剪贴板、摘要白名单无坐标、public-only统计与闰年日历、日历下钻、public ID页面、撤销API立即404及失效页面、设private后统计归零/再公开不复活、混合私人历史过滤、B正常注册后的本人接口隔离、关闭主页三接口404但独立public仍有效、网络错误重试、390px无整页横向溢出、无pageerror。匿名401/404请求为预期，favicon缺失404是既有资源问题。

已人工查看公开主页与摘要截图，未发现布局遮挡。测试库合成示例ID：公开ef8b0ba4-a010-46c1-bfa1-774ef1c9d418、私人30c667ff-606f-4a15-a1ac-bb6cd478f467；不保存账号密码或有效token到交付文档。

证据位于忽略目录 frontend/test-results：sharing-chrome.cjs、sharing-chrome-result.json（18项）、sharing-migration.json、sharing-profile.png、sharing-summary.png、sharing-revoked.png、sharing-mobile.png、sharing-cli（正常注册快照）。初次CLI遇到HMR后ref变化，后续用已有Playwright运行时驱动安装Chrome完成可重复流程，全部浏览器会话在finally关闭。

实际前端命令（frontend目录）：

```sh
npm_config_manage_package_manager_versions=false pnpm test
npm_config_manage_package_manager_versions=false pnpm check
npm_config_manage_package_manager_versions=false pnpm build
```

实际后端最终运行器命令（backend目录）：

```sh
RUNNOTE_SHARING_TEST_DB=runnote_sharing_final_20261013_test .venv/bin/python /private/tmp/runnote-sharing-run.py -q --tb=short
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
```

临时运行器从Settings读取凭据，仅替换数据库名，设置精确TEST_DATABASE_ALLOWED_TARGETS（本次主测试库与升级快照库）；已有只读安全守卫确认库名/端口且拒绝开发库，无密码输出。完整后端包含unit/auth/GPX/statistics/footprints/sharing/database/migrations；涵盖匿名/本人/B、csrf、摘要过滤、到期、永久链接、跨活动link_id、撤销幂等、改private全撤销、并发private与create_share、令牌hash及日志脱敏、Uvicorn格式器兼容。

## 独立审查与修复

独立只读审查发现慢网络保存期间切换checkbox可造成“服务器开启但UI提示关闭”的P2隐私反馈竞态。先用真实Chrome延迟1500ms PATCH验证失败，再修复为保存期间禁用昵称/简介/checkbox，依据服务器返回User更新界面与成功文案。最终两项Chrome回归通过：保存中不能改输入；成功反馈及开关与持久化状态一致。结果 sharing-settings-race-result.json，脚本 sharing-settings-race.cjs。主要18项加专项2项共20项通过。

另修正0004 CheckConstraint双前缀命名：使用op.f，离线迁移测试先失败后通过；新增空隔离库验证最终脚本。末轮审查复核UI及离线upgrade/downgrade名称正确，无剩余重要问题。不宣称已执行数据破坏性的downgrade。

## 回归波动记录

最终迁移空库回归曾出现270通过/1失败：既有test_spawn_timeout_crash_reap_and_subsequent_success使用0.5秒截止，crash_target实际被判为超时，而期望崩溃。同期前端构建也在运行；停止并行构建后单项复查通过，未改动GPX业务或放宽测试断言。并行负载只是可能因素，未证明唯一原因；构建结束后完整复查 **271 passed，50.52秒**。此时限测试对机器调度敏感，后续如继续波动应单独诊断启动预算。

## 限制及下一步

没有验证生产部署、反向代理日志策略、大规模匿名流量/分享访问限流、真实手机或其他浏览器。暂无公开路线（本轮选择默认且始终不分享坐标）、头像、定制公开域名。旧已保存摘要不能回收。下一步先在授权后备份并升级开发库、验证正常用户历史；生产发布前补代理日志脱敏和匿名流量预算。无需提前开发AI。

最终Git HEAD仍为c74292c，保留原有main ahead 2及所有既有未提交足迹改动。最终.env哈希和开发库revision/对象摘要再次只读复核相同。
