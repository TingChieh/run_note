# REST API设计

## 1. 基本规范

前缀`/api/v1`。请求与响应JSON使用snake_case；文件导入使用multipart。浏览器同源调用，生产不开放跨域凭证访问。OpenAPI是契约来源，前端类型可由其生成；公开与本人响应使用不同Pydantic模型。

### 1.1 统一响应

成功示例（以活动创建为例，HTTP 201）：

```json
{
  "data": {
    "id": "34f2b4f5-742a-4cb6-9baa-c1b215be311f",
    "source": "manual",
    "activity_date": "2026-10-08",
    "distance_m": 5000.0,
    "elapsed_seconds": 1800.0,
    "avg_pace_seconds_per_km": 360.0,
    "visibility": "private"
  },
  "error": null,
  "meta": { "request_id": "6af1fc12e4be4d8a" }
}
```

失败示例（HTTP 422）：

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "距离必须为非负有限数值",
    "details": [{ "field": "distance_m", "reason": "out_of_range" }]
  },
  "meta": { "request_id": "6af1fc12e4be4d8a" }
}
```

HTTP状态反映真实结果，错误不统一塞进200。删除返回200与`data: {"deleted": true}`，不使用204，保证成功响应包一致。GeoJSON作为data内的对象，不改变HTTP外壳。所有响应附`X-Request-ID`，代理产生的413/502也应尽量采用同一错误格式；无法统一的网络/代理错误由前端请求层兜底。

未知字段拒绝，日期严格解析、UUID严格验证，指标使用有限数值。每次请求重新认证与授权。本人资源不存在或属于他人统一404，不能返回其owner或存在性。

### 1.2 分页、日期与单位

- 列表默认`page=1,page_size=20`，最大100；初期offset分页足够。默认`activity_date DESC,id DESC`稳定排序，返回total；不支持客户端任意SQL字段排序。
- 列表`data={items:[...]}`，`meta`附page/page_size/total；统计不伪造分页。
- `date_from`含当天、`date_to`不含当天，均是已保存的activity_date；`date_from < date_to`。
- 初期支持年份1900–2100；日历year同范围，闰年按真实历法。趋势范围最长5年，热力图最多366天，AI最多366天。
- 单位：distance_m米、elapsed_seconds秒、avg_pace_seconds_per_km秒/公里。前端只格式化分钟/公里，不再计算配速。
- 个人API、公开API和分享页都设`Cache-Control: no-store`；身份相关响应使用`private,no-store`。

### 1.3 错误码

| HTTP | 示例code | 语义 |
| --- | --- | --- |
| 400 | INVALID_REQUEST / GPX_XML_INVALID | 格式不合法 |
| 401 | AUTH_REQUIRED / INVALID_CREDENTIALS / SESSION_EXPIRED | 未认证或凭证无效 |
| 403 | CSRF_REJECTED / ORIGIN_REJECTED | 已知不允许的请求来源或CSRF |
| 404 | RESOURCE_NOT_FOUND | 不存在、不可见、分享过期或撤销 |
| 409 | EMAIL_EXISTS / USERNAME_EXISTS / GPX_DUPLICATE / AI_IN_PROGRESS / ACTIVITY_PRIVATE | 资源或状态冲突 |
| 413 | GPX_TOO_LARGE | 原文超过字节限额 |
| 422 | VALIDATION_ERROR / GPX_NO_VALID_POINTS / GPX_LIMIT_EXCEEDED / ACTIVITY_DATE_REQUIRED / ACTIVITY_DATE_CONFLICT / SPATIAL_LIMIT_EXCEEDED | 字段、内容或查询范围不符合规则 |
| 429 | RATE_LIMITED / IMPORT_BUSY / AI_QUOTA_EXCEEDED | 配额/并发超限，附Retry-After |
| 502 | AI_PROVIDER_ERROR / AI_OUTPUT_INVALID | 外部AI失败/输出无法验证 |
| 503 | AI_TIMEOUT / DEPENDENCY_UNAVAILABLE | 超时或依赖不可用 |
| 500 | INTERNAL_ERROR | 未预期错误，仅日志有堆栈 |

登录账号不存在和密码错误返回同一个提示。详情只含白名单字段和可展示原因，不输出SQL、文件路径、堆栈或供应商原文。当前邮箱注册冲突会透露是否注册，公网部署时需结合邮箱验证与注册限流评估。

## 2. 认证与用户接口（阶段二）

表中路径均省略`/api/v1`。除明确匿名接口外均要求有效登录会话；所有写接口要求Origin/Referer及CSRF检查。

| 方法 | 路径 | 请求 | 成功结果/说明 |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | 无 | 200 csrf_token；必要时设10分钟预认证Cookie；限流/no-store |
| POST | `/auth/register` | email,username,password,timezone可选 | 201 本人资料+新csrf_token；自动登录并轮换会话 |
| POST | `/auth/login` | email,password | 200 本人资料+新csrf_token；轮换会话 |
| POST | `/auth/logout` | 无 | 200 logged_out=true，撤销Cookie对应会话并清Cookie |
| GET | `/auth/session` | 无 | 200 authenticated=true及本人基本资料；预认证/过期返回401 |
| GET | `/me` | 无 | 200 本人资料，不返回password_hash |
| PATCH | `/me` | display_name,timezone,profile_is_public子集 | 200 更新资料；邮箱和username不允许通过此接口更改 |
| PATCH | `/me/password` | current_password,new_password | 200 password_changed=true；撤销全部原会话、清Cookie，重新登录 |

请求头示意：浏览器先取csrf，在写操作附`X-CSRF-Token`；原会话Cookie为HttpOnly，由浏览器自动附带。登录后的token替换旧值，多个标签页可再GET取新token。不得在localStorage保存会话令牌。

## 3. 运动记录接口（阶段二至三）

| 方法 | 路径 | 参数/请求 | 成功结果 |
| --- | --- | --- | --- |
| POST | `/gpx-imports` | multipart file,timezone可选,activity_date可选,title可选 | 201 活动摘要+import_id+质量警告；Location指向活动详情 |
| POST | `/activities` | 手动创建JSON，见下 | 201 本人活动详情 |
| GET | `/activities` | page,page_size,date_from,date_to,source,visibility | 200 本人摘要列表；不加载轨迹点/raw_gpx |
| GET | `/activities/{id}` | UUID | 200 本人详情、质量、has_route；不含原始GPX字节 |
| PATCH | `/activities/{id}` | 允许字段子集 | 200 更新后详情；服务端重新计算手动指标 |
| DELETE | `/activities/{id}` | UUID | 200 deleted=true；原文、段、点、分享链接级联清理 |
| GET | `/activities/{id}/route` | zoom可选，整数0–22 | 200 geojson、start_point、end_point、bounds、simplification元数据 |

### 3.1 导入细则

文件解析与后端算法见数据库文档。字段timezone默认本人配置；若没有可靠开始时刻，必须提供activity_date。存在可靠started_at时，activity_date可省略，若提供且与时区换算日期不一致则422 ACTIVITY_DATE_CONFLICT，不静默覆盖。

成功data包含activity、import_id、warnings、input_point_count、valid_point_count、derived_segment_count、metrics_version。重复返回409 GPX_DUPLICATE，details仅含本人existing_activity_id及duplicate_kind（raw/canonical）。不同用户可导入相同文件，响应不透露他人记录。

导入不是任意URL抓取，不接受URL或客户端owner_id。失败不生成活动。处理预算超时返回503 GPX_PROCESSING_TIMEOUT，点数/段数超限返回422，字节超限返回413。

### 3.2 手动创建与编辑

手动创建示例：

```json
{
  "title": "公园慢跑",
  "activity_date": "2026-10-08",
  "timezone": "Asia/Shanghai",
  "distance_m": 5000,
  "elapsed_seconds": 1800,
  "notes": "轻松跑"
}
```

不接受source、owner_id、avg_pace、原始坐标或创建时public设置，新记录一律private。GPX编辑允许title、notes、visibility、allow_shared_route；started_at为空才允许修正activity_date。手动编辑额外允许activity_date、distance_m、elapsed_seconds，缺失耗时可显式传null。

timezone保留快照，活动创建后MVP不修改；日期来自timestamp的GPX不任意改日期。其余只读字段提交会返回422。所有改变递增本人activity_data_version；隐私改为private时，同事务撤销链接并将allow_shared_route=false。

手动活动无route时返回200，geojson为null、has_route=false，前端展示“手动记录无轨迹”。这是已知状态，不作为系统错误。

## 4. 日历与统计接口（阶段四）

| 方法 | 路径 | 参数 | 成功结果 |
| --- | --- | --- | --- |
| GET | `/statistics/calendar` | year必填,metric=distance/count | 全年days、year、metric、总次数和距离 |
| GET | `/statistics/summary` | date_from,date_to必填 | 总次数、距离、可靠耗时、覆盖率与汇总配速 |
| GET | `/statistics/trends` | date_from,date_to,period=week/month/year | 连续时间桶、距离、次数、耗时、配速与覆盖率 |

日格返回date、activity_count、distance_m、duration_sum_seconds、known_duration_count、missing_duration_count。metric只决定推荐显示值；两种已聚合维度都来自后端。缺少活动的日格有0次和0米，但耗时为null、known_duration_count=0。

summary及每个趋势桶增加pace_eligible_count、pace_eligible_distance_m、avg_pace_seconds_per_km、quality_warning_count。总耗时为已知子集，界面同时显示“X/Y条有可靠耗时”，不能将其标题写为全部真实耗时。

趋势桶使用自然周/月/年边界，第一/末桶可能被请求范围截短，返回bucket_start、bucket_end及is_partial。空桶补齐，配速为null。响应附date_assignment=activity_local_date和week_start=monday，避免前端再按当前时区重新分桶。

## 5. 轨迹叠加与热力图（阶段五）

| 方法 | 路径 | 参数 | 成功结果 |
| --- | --- | --- | --- |
| GET | `/spatial/overlays` | date_from,date_to,bbox可选,zoom可选 | 最多200条本人的带活动ID路线FeatureCollection |
| GET | `/spatial/heatmap` | date_from,date_to,bbox必填,grid_size可选 | 网格GeoJSON、各格activity_count、范围和统计口径 |

bbox顺序为west,south,east,north，有限合法WGS84坐标；普通请求west<east，跨日期变更线viewport由客户端拆成两次请求且结果按cell_id去重。overlays输出总显示点初始上限50000，热力候选500条/最多20000格/366天。超限返回错误，不擅自丢活动。

热力图data含count_mode=distinct_activities_per_cell、grid_crs=EPSG:3857、grid_size、max_activity_count、matched_activity_count。ECharts/MapLibre仅根据这些值映射颜色；不将点样本数量重新作为频率。

本人全部历史空间接口不公开。公开主页不提供私人叠加、网格或聚合轨迹，防止从热力图恢复私人位置。

## 6. 公开主页与分享（阶段六）

### 6.1 权限模型

| 活动状态 | 本人接口 | 公开活动接口 | 公开主页列表 | 有效令牌接口 |
| --- | --- | --- | --- | --- |
| private | 可访问 | 404 | 不出现 | 404，且旧令牌已撤销 |
| unlisted | 可访问 | 404 | 不出现 | 可访问摘要 |
| public | 可访问 | 可访问摘要 | 仅主页开启时出现 | 可访问摘要 |

上述摘要可见不意味着轨迹可见，路线端点还要求allow_shared_route=true。主页关闭只关闭主页入口与其列表，不自动撤销已明确公开的单条活动或分享链接；UI必须说明该行为，不能暗示一键撤回全部分享。

### 6.2 接口

| 方法 | 路径 | 权限/参数 | 成功结果 |
| --- | --- | --- | --- |
| GET | `/public/users/{username}` | 匿名，主页须开启 | 显示名称、用户名、public活动统计；无邮箱 |
| GET | `/public/users/{username}/activities` | 匿名，同上，分页 | 只含public摘要 |
| GET | `/public/activities/{id}` | 匿名，visibility=public | PublicActivity模型 |
| GET | `/public/activities/{id}/route` | 匿名，public且allow_shared_route | 公开授权路线 |
| POST | `/activities/{id}/shares` | 本人；expires_at可选 | 201 link_id、share_url、expires_at；仅此时返回明文令牌 |
| GET | `/activities/{id}/shares` | 本人 | 链接管理ID、创建/到期/撤销状态，不返令牌 |
| DELETE | `/activities/{id}/shares/{link_id}` | 本人且link属于该活动 | 200 revoked=true；逻辑撤销便于确定旧链接永久无效 |
| GET | `/shared/{token}` | 匿名，有效token且活动非private | 摘要模型，不暴露owner内部ID |
| GET | `/shared/{token}/route` | 同上且allow_shared_route | 授权路线 |

创建链接前应通过PATCH主动设置unlisted/public，private时返回409 ACTIVITY_PRIVATE。创建请求本身不隐式公开活动。允许期限不超过365天，expires_at=null需用户主动选择；默认30天。

PublicActivity只含id、title、activity_date、distance_m、elapsed_seconds、avg_pace、泛化质量提示、作者username/display_name以及has_shared_route；不含notes、邮箱、原始文件名、精确起止时间、点和内部用户ID。共享页面不加载原始GPX，API无匿名原文下载入口。

分享页使用noindex和`Referrer-Policy: no-referrer`，token路径在Caddy和应用日志中脱敏，不接入会捕获该URL的分析系统。公开路线开启前明确提示可能暴露居住地；关闭轨迹后两个匿名route端点下次请求404。地图页面随状态变化清理已有图层，但无法回收别人已经保存的坐标。

## 7. AI分析（阶段七）

| 方法 | 路径 | 参数/请求 | 成功结果 |
| --- | --- | --- | --- |
| POST | `/ai-reports` | date_from,date_to,consent_to_send_summary=true；Idempotency-Key必填UUID | 新调用成功201报告；保留中的已完成请求重放200，不再次调用 |
| GET | `/ai-reports` | 分页 | 本人报告摘要与状态 |
| GET | `/ai-reports/{id}` | 本人 | 状态、统计事实、文本、生成配置、is_stale |
| DELETE | `/ai-reports/{id}` | 本人且非pending | 200 deleted=true |

同步调用，无后台队列或流式协议。处理流程：

1. 认证、CSRF、日期范围和明确同意检查。在短事务先锁用户行，处理超过期限的遗留pending，然后查询本人的Idempotency-Key：参数不同返回409 IDEMPOTENCY_CONFLICT；已删除返回409 REPORT_DELETED；pending返回409 AI_IN_PROGRESS；succeeded或failed均以200返回原报告状态，不再调用供应商。
2. 只有key不存在才检查每日最多5次尝试、当前无其他pending。在同一短事务内复用统计服务读取汇总和activity_data_version并创建pending。所有活动写入先取得相同用户行锁，因此版本和统计不会混合不同已提交状态；完成旧报告重放不受新额度或其他pending限制。
3. 提交事务后调用固定配置的供应商。仅发送日期范围、总量、时间桶、数据覆盖率和质量提示，不发送邮箱、用户名、标题、备注、坐标、GPX或分享链接。
4. 限制连接5秒、整体30秒、最多2000输出token，并由客户端/调用封装实际执行总deadline，不能把单次read timeout误认为总超时。
5. 请求结构化文字章节trend_summary、recommendations、limitations。兼容性不强制供应商JSON模式；可请求JSON文本并用Pydantic验证，文字总长度≤6000字符。事实面板始终使用stats_snapshot，AI段落不成为数值真源。
6. 保存succeeded或failed，失败返回502/503，details含本人report_id。用户主动重试创建新key与新尝试；不自动重试可能已计费请求。

每日额度按UTC自然日计所有尝试，删除报告不能返还额度。DELETE清空report_text与stats_snapshot（置空对象），设置deleted_at，正文不可恢复，列表/详情不再显示；最小调用元数据自deleted_at起保留30天用于额度与幂等，保留期间已删除key重用返回409 REPORT_DELETED。pending不可删除，返回409 AI_IN_PROGRESS。幂等保证只在调用记录保留期间有效，客户端每次主动新尝试生成新UUID，不复用清理后的旧key。

报告is_stale由source_data_version与当前用户版本比较。报告只允许本人访问，公开主页不能返回。渲染为纯文本或经过安全处理的Markdown，禁止直接执行HTML。即使格式正确也不能保证模型没有事实错误；事实对照与失败案例进入验收报告。

## 8. 健康检查（阶段一）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health/live` | 200仅说明应用进程工作，不访问外部AI |
| GET | `/health/ready` | DB与必要schema/PostGIS可用才200，否则503；不泄露版本凭证 |

生产readiness用于内部检查，公网不暴露详细依赖状态。API契约在各模块实施前更新OpenAPI并对照本文；文档不作为已经可调用的接口声明。
