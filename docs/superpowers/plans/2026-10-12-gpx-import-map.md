# GPX 导入到地图的完整流程

本轮用户明确授权实现已有冻结规则与模型，不重复设计认证，不提交或推送，不修改.env、不清库、不重置限流、不使用Docker。本轮不需要结构迁移。

## 最小范围与分工

- S2-04：安全GPX1.0/1.1解析；10MiB/50000源点/1000源段；拒绝DTD/实体；原属性校验；macOS spawn子进程15秒预算与每worker单任务。
- S2-05：保留源段及异常断点；geography批量边距判断12m/s/300秒阈值；连续段ST_Length权威距离；完整/不完整/无效时间、日期、三位half-even指标；Haversine独立对照与canonical-v1冻结序列化。
- S2-06：当前用户鉴权/CSRF/来源、11MiB请求限额；每用户PostgreSQL advisory lock；raw/canonical本人去重；四表原子批量写及用户版本+1；本人列表/详情/路线查询。他人/不存在404。
- S2-07必要前端及提前的阶段三查询/地图：GPX文件上传、标题/时区/补录日期、错误提示、本人列表、详情指标/质量、MapLibre路线与起终点。地图本地样式无需外部瓦片，保护隐私且能离线展示；不做筛选/编辑/删除/日历/热力/分享/AI。

## 固定前后端契约

统一 `{data,error,meta.request_id}`。

`POST /api/v1/gpx-imports` multipart单个file，title/timezone/activity_date可选，未知字段拒绝；201 `data={activity: ActivityView, import_id, warnings:string[], point_count, segment_count, metrics_version}`。日期补录/冲突422；坏XML400；超限413/422；重复409（details仅本人existing_activity_id/duplicate_kind）；并发429；解析超时503。

ActivityView：`id,title,activity_date,timezone,started_at,ended_at,distance_m,elapsed_seconds,avg_pace_seconds_per_km,temporal_quality,quality_summary,metrics_version,has_route,created_at`。numeric字段JSON数字或数值字符串，缺失指标null。

`GET /api/v1/activities?limit=20&offset=0` 返回 `{items:ActivityView[],total,limit,offset}`；limit最大100，按date/id降序，仅本人。

`GET /api/v1/activities/{id}` 返回ActivityView；`GET /api/v1/activities/{id}/route` 返回 `{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString'|'Point',coordinates:...},properties:{segment_index,point_count}}],start:[lon,lat],end:[lon,lat]}`。单点段Point，多点段LineString；不拼接源段。仅通过活动归属检查查询，不返回原文/用户ID/会话信息。

## 执行和验收

1. 写并观察解析/指标黄金样本与安全反例失败，再实现纯函数和受限worker。
2. 在现有独立_test库只读确认0003，不运行迁移；写API/DB测试后实现原子导入、本人列表详情路线。
3. 前端按固定契约实现并测试；后端与前端可在各自目录独立推进，之后联合审查。
4. 运行单元/真实PostGIS/API归属/回滚/重复/并发测试，前端test/check/build；保留必要故障边界，不重跑已完成的迁移或基础设施验收。
5. 明确核对8001进程后只重启本项目API以载入新路由，保留密钥/来源/开发库；真实Chrome随机账号上传合成GPX，验证指标、路线、刷新、匿名及他人拒绝、坏文件提示和数据库原文/点/几何。
6. 独立代码审查，修复安全或完整性问题；记录实际计数、变更文件、可访问地址及未验证范围。
