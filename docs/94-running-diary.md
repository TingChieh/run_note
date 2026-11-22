# 跑步日记与身体感受

登录后打开自己的跑步详情，在「跑步日记」记录心情、主观疲劳（RPE 1–10）、天气和备注。各项均可留空，也可单独添加照片。心情按五档记录，天气选当次主导条件（晴、阴或多云、雨、雪、大风、其他）。备注至多 5000 字。

每份日记可保存六张照片。支持单张不超过 5 MiB 的 PNG、JPEG 或 WebP。服务端解码和方向校正，保留比例，输出最长边 1100 像素的无元数据 PNG。原始文件名、EXIF、GPS、ICC 及原始文件不保存。照片存于 PostgreSQL 的 `bytea`，纳入既有数据库备份。日记、活动或账号删除时在数据库事务内级联删除图片内容。保留的历史备份仍受既有访问限制与保留期约束。

## 接口与隐私

私人跑步详情独立读取 `/api/v1/me/activities/{identifier}/diary`。GET 返回日记与照片元数据，PUT 替换可编辑字段，DELETE 删除日记及其照片。POST `/diary/photos` 上传单个 multipart `file`，图片内容的 GET 和 DELETE 使用 `/diary/photos/{photo_id}`。每次访问均检查登录和活动归属，跨账号返回 404，写入校验 CSRF，图片响应使用 `private, no-store`。公开展示、摘要分享、海报及 AI 上下文与供应商请求均不读取日记。

## 后续分析接口

预留口径为 `GET /api/v1/me/running-diary/performance?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&group_by=weather|time_of_day|rpe`。日期范围左闭右开，以 `activities.activity_date` 筛选，并用活动 ID 和用户 ID 联结本人日记。返回各组 `key`、总样本数、有效配速样本数、总距离（米）、有效样本的加权配速（秒/公里）。

- 天气按记录的枚举值分组，空值单列为未知。
- 时段以该活动 `timezone` 将 `started_at` 转成本地小时，分为 00–05、06–11、12–17、18–23 点。开始时间缺失或时区无效归为未知。
- 疲劳分 1–3、4–6、7–8、9–10，空值单列为未知。
- 全部日记纳入总样本数。配速仅采用距离、时长均为正，且包含设备用时或时间质量为 `complete`、`manual` 的记录。时长取 `COALESCE(timer_seconds, elapsed_seconds)`，组配速为有效时长总和除以有效距离总和（公里）。无有效样本时返回空值。

该接口为后续实现约定。本期保存原始分组值和已有的活动时间与表现指标。

## 迁移与验证

工作项 23 的迁移 spike（`c662ac2`）提供复合归属外键、唯一日记约束和级联。产品迁移 `0032_running_diary` 将照片路径替换为数据库内容，收紧心情与天气约束，登记两个 ORM 模型。已有活动无需回填。有日记数据后，降级会拒绝删除表，需要独立的保留或导出决策。

验证覆盖跨账号访问、公开与 AI 响应、RPE 和枚举边界、图片方向及元数据、上传限制、级联和迁移降级保护。浏览器专项使用 `pnpm exec playwright test --config playwright.running-diary.config.ts`，真实代理链路通过 `pnpm test:e2e running-diary.spec.ts` 在隔离测试库运行。
