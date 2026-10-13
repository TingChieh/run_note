# AI 阶段工程基线与安全升级方案

检查日期：2026-10-13（Asia/Shanghai）。本文件记录开工工程检查与安全升级方案；后续AI实施及验收见[AI验收记录](16-ai-running-analysis-acceptance.md)。

## Git 与敏感文件

- 开始工作区干净，无已跟踪修改或未跟踪文件。分支 main，HEAD 3c3f21b；相对本地 origin/main ahead 3。本轮未 fetch，不能据此声称远端实时状态。
- 三个本地提交：5ef7fb3 存储基线；c74292c 私人运动流程；3c3f21b 足迹及隐私分享。
- .env 和 .env.auth-rate.key 被忽略且没有跟踪；备份、密钥格式、缓存、浏览器证据及运行产物均在忽略规则内。.env.example 允许跟踪。
- 已跟踪文本常见 API token、私钥头、带密码数据库 URL 的模式扫描，只命中 test_health.py、test_security.py、test_test_database_safety.py 中的固定假测试凭据；未发现这些模式对应的真实密钥。模式扫描不等于所有秘密检测的完备证明。
- .env 当前权限0644，认证密钥文件0600。建议用户另行将 .env 权限收紧到0600；本轮不修改文件或权限。
- .env SHA256：2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab，用于结束时复核，不记录内容。

建议在完成验收后人工分两次提交：

1. `feat: add private AI running analysis`：AI 模块、0005迁移、服务端配置及示例变量、页面、对应自动化测试与设计/计划。
2. `docs: record AI acceptance and safe database upgrade`：工程基线、实测验收、README和进度记录。

每次明确选择文件，不使用无审查的 git add -A；排除 .env、真实密钥、数据库归档、合成账号密码及临时浏览器证据。当前没有待归档的旧修改；不得重复提交已有分享功能。本轮不自动提交或推送。

## 当前数据库与备份

只读连接 127.0.0.1:5432/running_note，业务角色 run_note。实际 revision 唯一为0003_gpx_storage。实际行数：users 17、activities 14、gpx_imports 14、activity_points 63、activity_segments 22。未读取或输出私人记录明细。

开工时代码唯一 head：0004_public_sharing（本轮新增后为0005_ai_reports）。该升级仅新增 users.bio及长度约束、activity_share_links和索引，不重建既有活动/GPX表。当前开发库不能直接运行依赖bio等字段的新版完整业务。

已找到 `/Users/tingchieh/Backups/RunNote/20261012T192819+0800/running_note.dump`：25206字节、0600，SHA256 8bc92010e5b92246774f220d5e308efddae19df869d9029504344280de74b920；pg_restore --list退出0，包含表、数据、约束及索引目录。此前实际恢复验证记于09进度文档。本轮不重复恢复基础设施验收。

**该旧备份生成时业务表为空，不能证明覆盖当前17用户/14活动。当前数据的最新完整备份尚未确认。**

## 安全升级方案（仅方案，未执行）

1. 最终代码head为0005_ai_reports，唯一父链0003→0004→0005；0005仅新增ai_reports表与约束/索引，隔离库0004→0005及ORM一致性已验证。升级前仍需审查目标，不在日常开发库运行测试迁移或downgrade。
2. 暂停应用业务写入，记录当前数据库identity/revision、各表行数和必要的数据摘要；避免备份完成后又有未保护的新写入。
3. 在项目外新建0700备份目录，用当前服务端Settings将密码只注入pg_dump子进程PGPASSWORD，禁止写入命令行或日志；使用原生PostgreSQL18的pg_dump -Fc对running_note做完整一致备份，归档0600。不得覆盖上述旧备份。
4. 对新归档执行pg_restore --list并保存校验和。若需要验证当前业务数据的可恢复性，只恢复到全新隔离数据库；核对revision、用户/活动归属、原始GPX哈希、点/段计数与指标，不覆盖running_note。旧空库恢复验收不能代替当前业务数据备份。
5. 经用户明确授权后，在固定running_note目标执行审查后的Alembic升级（预计0003→0004→0005），先配置足够statement/lock timeout。升级失败停止并调查，不盲目downgrade或删除新增表。
6. 只读复核迁移head、历史数据完整性和私人默认，执行本人历史访问抽查，再恢复应用写入。AI供应商是否配置不应成为核心健康依赖。
7. 恢复方案使用新数据库恢复并核实，再决定应用连接切换；不把向当前数据库直接pg_restore --clean当作默认回滚。

上述开发库备份、恢复和迁移操作均未在本轮执行。仅为AI验收新建了独立55445实例及_test数据库，并验证其迁移；开发库迁移是用户保留的后续动作。结束时开发库revision、上述行数、public对象摘要86b1627f3741206c5772399dc5314c4c均不变；.env及认证密钥SHA256也与开工一致，HEAD仍3c3f21b。
