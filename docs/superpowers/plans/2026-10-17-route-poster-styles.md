# 分享图四种样式实施计划

> 执行方式：当前会话顺序实施，遵守已确认设计及工作区保护规则，不提交或推送。

**目标：** 为分享图增加经典足迹、极简画廊、运动海报、足迹手账四种排版，切换只本地重绘同一组路线，并删除底部说明。

**架构：** 复用现有 PosterData、主题色和 Blob 导出流程。在 `route-poster-render.ts` 中公开样式列表/类型，第三个可选参数选择渲染布局；共享文字、面板、路线网格和品牌绘制。`RoutePosterDialog.svelte` 使用原生 radio 和 SVG 构图示意，选择后调用已有 repaint。沿用生成期/分享期禁用、appearance版本、单调令牌和清理。

**技术：** Svelte 5、TypeScript、Canvas、现有 Playwright 合成 API 和真实 Chrome。

## 约束

- 当前已获授权的同一工作区继续实施，保留所有既有脏文件，不创建涉及其他功能的分支提交或复制真实数据。
- 单张1080×1920 PNG，最多120条随机有轨迹记录，不改抽样、统计、后端、权限或数据库。
- 四种排版只用当前 RunNote Token、系统字体与R字标，无新依赖、外部素材或颜色编辑器。
- 不新增持久化设置；关闭再打开保留本组件样式选择。预览、下载和分享指向同一Blob。
- 所有布局都不绘制已删除的小字；半马指标保留距离类比语义，抽样K/N保留。

## 任务1：浏览器契约先失败

文件：`frontend/tests/ui/route-poster.spec.ts`。

- [x] 新增浅/深色两项浏览器测试。每项从经典足迹生成，依次选另外三种；每次等待Blob URL变化，实际下载PNG、校验1080×1920、四种内容哈希不同、底部留白，不增加接口请求。
- [x] 新增生成期间禁用radio、取消后恢复、范围变化/关闭保留样式的测试；新增320/390px原生radio键盘选择、无溢出与单轨迹导出检查。
- [x] 运行并观察缺少radio的预期失败：`pnpm exec playwright test --config playwright.route-poster.config.ts --grep 'four poster layouts|poster style controls|sparse poster layouts' --reporter=dot`。

契约：`getByRole('radio', {name:'极简画廊',exact:true}).check()`；切换前后`state.urls.length`相同。导出PNG用`readFile`和`createHash('sha256')`核对实际不同文件。

## 任务2：渲染与样式选择

文件：`frontend/src/lib/share/route-poster-render.ts`、`frontend/src/lib/components/RoutePosterDialog.svelte`。

- [x] 导出`posterStyles`含`classic/gallery/sport/journal`及名称说明，`PosterStyle`由列表推导；保持`renderPoster(data, palette, style: PosterStyle = 'classic'): Promise<Blob>`兼容旧调用。
- [x] 路线绘制提取为当前文件内部函数：按可用区域、动态列数/行数与固定上限排布，末行居中；手账卡片旋转范围与内边距确保不跨格。品牌、指标与路线来自同一PosterData，不访问网络。
- [x] 实现四种独立布局：经典保留旧构图；画廊去外框/加强留白；运动用primary大页头和横向统计；手账用编号卡片和微错落。
- [x] 新增`let style = $state<PosterStyle>('classic')`，原生fieldset/radio+内联SVG示意，选中态用primary/border/token；`onchange={() => void repaint()}`；`disabled={busy || sharing}`。
- [x] `createImage`调用`renderPoster(data, posterPalette(dialog), style)`，沿用appearance循环、取消令牌、Blob释放和canShare兜底。没有结果时选择样式不触发生成。
- [x] 运行任务1与既有分享图Chrome测试，修复本次引入的问题。

## 任务3：视觉核对、回归与文档

- [x] `pnpm check`、`pnpm test`、`pnpm build`、分享图完整Chrome套件、`git diff --check`实际执行并记录输出。
- [x] 实际查看四种浅/深色PNG，以及单轨迹/最多120条、桌面/窄屏选择器截图；若文字、卡片或路线重叠则在本模块修复并重跑相关测试。
- [x] 更新Design System领域组件描述（保留该目录其他未提交内容）；新增`docs/58-route-poster-styles.md`，包含使用方式、接口与隐私、命令结果、未验证边界；更新旧文档指向新能力。
- [x] 最终确认仅本功能文件有新增差异，不提交、推送、部署或操作数据库。

实际结果：预期RED为4 failed；实现后分享图Chrome 15 passed（22.8s），前端28文件/168项单测通过，类型0 errors/0 warnings，生产build通过，diff检查通过；浅深色、单轨迹和桌面/手机人工核对完成，独立复查无可操作问题。详见docs/58-route-poster-styles.md。
