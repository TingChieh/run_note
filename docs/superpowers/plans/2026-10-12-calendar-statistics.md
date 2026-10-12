# 年度日历、基础统计与地图底图实施计划

目标：沿用私人活动表，交付可回顾历史的仪表盘和有署名的可降级道路底图。用户已要求直接实施，无提交、迁移或env变更。

- [x] 地图：核对OpenStreetMap标准栅格瓦片政策；HTTPS正式端点、可见署名、正常浏览器缓存/Referer、不预取下载；底图故障移除栅格层，轨迹独立保留，允许手动重试。
- [x] 可见仪表盘：年度日历按周一排列365/366日、年份1900–2100、距离/次数色阶及可访问日期按钮、点击读本人当天分页记录；ECharts周/月趋势与空状态。
- [x] 后端：statistics/calendar、summary、trends，按已有activity_date快照聚合，不转换UTC或随账户时区迁移；summary可无日期表示本人累计，也支持显式左闭右开范围。年份默认用用户时区当前年。自然周一/自然月，截短桶明确partial，空桶补齐；范围最长5年。
- [x] 统计口径：distance/count/distinct date；已知耗时子集求和并返回known/missing覆盖量，无已知耗时NULL；pace仅正距离/正已知耗时且complete/manual记录的sum(elapsed)/sum(distance)，非简单平均；空集合配速NULL，不持久化统计。
- [x] 验证：独立既有测试库造同日多次/闰年/跨年/未知耗时/用户隔离样本，已有开发记录只读对照；frontend test/check/build、后端相关测试、真实Chrome日历点击/年份维度/趋势/底图成功及阻断降级；独立审查。
- [x] 记录实际结果与限制，停止，不开发分享/AI/空间热力图。

文件边界：后端modules/statistics/{schema,service,router}.py与main.py；activities列表增加activity_date可选过滤；前端lib/api/statistics.ts、CalendarGrid/TrendChart组件、dashboard页面；地图单独RouteMap和map-style helper；集成/单元测试与验收文档。复用Cookie/CSRF和身份保护，不新增全局私人缓存。

实际结果：后端220项、前端27项、check/build/Ruff通过；Chrome底图成功/故障降级、日历点击/趋势/刷新/身份复查恢复、匿名及两用户隔离通过。详见 ../../12-calendar-statistics-map-acceptance.md。
