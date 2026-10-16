# 路线墙分享图片实施计划

按用户已确认且随后调整的设计，在当前会话顺序实施；保留既有未提交修改。实施阶段不提交或创建远端变更；后续用户明确要求推送GitHub，授权仅发布本功能相关文件。

目标：足迹墙本地生成单张1080×1920 PNG，从全范围随机抽取最多120条有轨迹记录，配色沿用当前UI。

架构：`lib/share/route-poster-data.ts`负责范围、全列表扫描、等概率抽样与有界路线加载；`route-poster-render.ts`负责主题Token和PNG绘制；`RoutePosterDialog.svelte`负责原生dialog、取消、预览、保存与系统分享。共享足迹墙路由供根/具名/工作区复用。无需后端改动或新依赖。

## 约束

不改后端、数据库、鉴权、SSR代理、公开字段和旧分享链接；不读取密钥；不上传轨迹/图片或写持久化。列表每次最多100条，遍历完整范围，路线仅加载抽中最多120条且4并发。无轨迹不占格；汇总仍覆盖全范围并注明。取消中止请求且令牌作废旧响应，释放Blob。保留开发服务、工作区、接口和数据。

## 任务1：抽样与数据加载

文件：`frontend/src/lib/share/route-poster-data.ts`、`frontend/tests/unit/route-poster.test.ts`。

- [x] 先写并观察失败：跨页全范围抽样/排除无轨迹/更换随机流、月份跨年/闰月、4并发/取消、路线失败、摘要漂移与空范围。
- [x] 实现`posterMonthRange`、`posterStats`、`loadPoster({month,fetcher,random,cancelled,onprogress})`，输出仅含抽象路径和白名单统计的`PosterData`。水塘抽样最多120个候选ID，洗牌后读路线，前后比较服务端摘要。
- [x] 运行`pnpm exec vitest run tests/unit/route-poster.test.ts`。

关键预期：2024-02为[2024-02-01,2024-03-01)；251条其中1条无路线时，扫描100+100+51，只读取120条抽中路线，有轨迹计数250；候选尾部可被抽到。

## 任务2：主题PNG与预览

文件：`frontend/src/lib/share/route-poster-render.ts`、`frontend/src/lib/components/RoutePosterDialog.svelte`、共享足迹墙页、专用UI配置和spec。

- [x] 先写Chrome用例并观察缺失行为失败：入口、单张随机海报、真实PNG尺寸/内容、月份、空/错/401、取消、上下文隔离。
- [x] 画当前主题下的海报，复用background/surface/foreground/primary/sport-yellow等Token和R字标。watchSystemTheme本地重绘相同抽样。
- [x] 验证PNG下载、系统文件分享用户激活/取消、canShare抛错时下载仍可用，生成取消中止旧请求。
- [x] 人工查看导出PNG与桌面、手机、浅/深色截图。

## 任务3：回归与交付

- [x] `pnpm check`、前端Vitest、`pnpm build`、受影响足迹墙/活动/主题回归、`git diff --check`。
- [x] 独立审查并修复可操作问题；按现场最大文档编号新增验收文档，说明使用方式、接口与隐私、实际命令数量、未验证边界。
- [x] 不以合成API验收冒充真实账户/真机/生产验收。后续按用户明确授权提交、推送本功能，不部署。

结果：10项新单测、全量前端168项单测、新功能11项Chrome、类型检查和构建通过；既有35项UI回归33通过/2失败，两项均在移除分享入口的临时基线重现。未改相关旧行为，详见docs/57-route-wall-share-image.md。
