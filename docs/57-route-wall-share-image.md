# 足迹墙随机轨迹分享图片

日期：2026-10-16。

## 使用方式

在站主 `/activities/wall`、具名 `/p/{username}/activities/wall` 或本人 `/workspace/activities/wall` 页点击「生成分享图」。选择全部记录或指定月份，点击「生成预览」，再「保存 PNG」。浏览器支持文件分享时还可调出系统分享面板；系统分享不支持或能力检测失败时，PNG下载仍可用。

输出一张1080×1920图片。仅有轨迹的记录参与抽样，完整扫描所选范围后等概率随机选最多120条，显示顺序也打乱。无轨迹记录不占位，不输出「无轨迹」，不再分多张；「换一组轨迹」会重新抽选。少于120条则显示全部轨迹。范围里均没有轨迹时提示更换范围，不生成空海报。

海报使用RunNote现有背景、表面、绿色主色、黄色页头、圆角与R字标，随实际系统/手动主题变化；已生成的图片仅本地重绘同一组路线，不再读取接口或重新抽样。网站布局、其他页面主题和全局样式不改。

顶部距离、底部活动次数/天数为所选范围的服务端全量统计，包括没有轨迹的活动；路线区单独注明「随机展示 K/N 条轨迹」。半马使用21.0975公里进行等距折算，不代表真实完赛次数。

## 改动范围

- 前端 `src/lib/share/route-poster-data.ts`：日期范围、全列表扫描、水塘抽样和洗牌、最多4并发读取抽中路线，立即转为本地抽象路径，前后统计一致性检测。
- 前端 `src/lib/share/route-poster-render.ts`：复用实际语义Token，Canvas绘图并输出PNG，释放临时canvas。
- 前端 `src/lib/components/RoutePosterDialog.svelte`：原生dialog、请求令牌/AbortController、进度/取消、范围与主题失效处理、Blob预览和保存/分享、关闭焦点恢复。
- 共享 `src/routes/activities/wall/+page.svelte`：加入入口，三个视图复用。
- 测试：`tests/unit/route-poster.test.ts`、`tests/ui/route-poster.spec.ts`、`playwright.route-poster.config.ts`；文档：设计、实施计划与本验收记录。Design System目录属于工作区既有未提交内容，本次不将其整体纳入发布。
- 后端、数据库、接口、依赖和环境配置均无修改；未为海报引入独立色板或新增通用组件。

## 接口与隐私

复用既有活动列表/路线、statistics summary，以及useViewContext对根、具名、工作区的同源映射。月份按活动当地日期、左闭右开，复用readRange。仅主动生成时读数据，扫描列表每次最多100条，只有抽中的最多120条读取路线；不会读取全部历史完整路线。

无数据库或配置写入，不调用AI/地图/截图服务，不上传轨迹或海报。图片仅包含像素，不写入坐标元数据、邮箱、用户名、备注、源文件名或活动ID；不绘制精确起终点标识。路线形状仍可能被辨认，预览提示用户确认再分享。Blob URL只驻留当前页面内存，关闭/范围切换/卸载释放。

取消、关闭、切换范围、卸载会中止旧fetch，保留原有单请求超时；单调令牌阻止旧响应或PNG覆盖当前状态。401清除预览并跳转现有管理登录入口。单条路线失败会阻止导出，允许重试。可选canShare异常只隐藏系统分享入口，不销毁成功的PNG；share直接从按钮点击发起，保留用户激活。

## 验证记录

本次命令在`frontend/`执行，Chrome使用8191合成API + 5191 Vite，与真实后端/数据库隔离。

- PASS：`pnpm exec vitest run tests/unit/route-poster.test.ts`，10 passed；覆盖跨页抽样（251条/250条有轨迹，扫描100+100+51，仅120条路线读取）、候选尾部被选中、更换随机流、无轨迹排除、月份边界、4并发/取消、失败和统计漂移。
- PASS：`pnpm test`，28个文件、168 passed，无失败或跳过。
- PASS：`pnpm check`，0 errors / 0 warnings。
- PASS：`pnpm build`，adapter-node构建完成；保留既有大体积chunk提示。
- PASS：`pnpm exec playwright test --config playwright.route-poster.config.ts --reporter=dot`，11 passed（9.1s）。实际下载并检查PNG签名、1080×1920尺寸和轨迹像素；验证单张/换一组、无占位、月度、空范围、路线失败重试、401、三种视图上下文、取消请求的ERR_ABORTED、手机390px浅/深色、无溢出、Escape与焦点恢复。系统分享用合成能力注入验证File与点击用户激活、取消和能力检测抛错回退；不声称真机系统面板通过。

- FAIL（既有回归）：`pnpm exec playwright test --config playwright.ui.config.ts milestones.spec.ts theme.spec.ts activities.spec.ts --reporter=dot`，33 passed / 2 failed（57.4s），无跳过。失败为activities.spec.ts:167侧栏摘要请求预期1次/实际2次，以及milestones.spec.ts:331退出后预期跳到管理登录/实际保留公开墙URL。
- 基线核对：在`/private/tmp/runnote-poster-baseline-bqlag6_b/frontend`复制前端源码/合成fixture（不复制密钥），移除本次共享墙页的组件导入和入口，直接以现有Node Playwright运行时运行`node node_modules/@playwright/test/cli.js test --config playwright.ui.config.ts activities.spec.ts milestones.spec.ts --grep 'successful imports update the persistent|wall fills every row' --reporter=dot`。2项均在相同断言复现，说明失败不依赖本次分享入口；未更改对应既有业务逻辑/断言。
- PASS：`git diff --check`，无空白错误。

推送前另以`git archive HEAD frontend`加本功能7个前端文件构造独立副本（不复制环境文件），检查发布内容无需工作区其他改动：

- PASS：`node node_modules/vitest/vitest.mjs run`，25个文件、160 passed。数量少于工作区168项，是因为未纳入其他未提交功能及其测试。
- PASS：`node node_modules/vite/bin/vite.js build`，adapter-node构建完成，保留既有chunk提示。
- PASS：`node node_modules/svelte-check/bin/svelte-check --tsconfig ./tsconfig.json`，0 errors / 0 warnings；最初共享依赖链接造成生成类型路径错误，改为副本内的$app配置后通过。
- BLOCKED：独立副本`node node_modules/@playwright/test/cli.js test --config playwright.route-poster.config.ts --reporter=dot`未进入测试，Vite webServer就绪等待60000ms超时；依赖链接与独立依赖副本均复现。前述工作区11项Chrome通过仍是功能UI证据，不将独立副本启动失败计为测试通过。临时副本的pnpm脚本尝试自动安装被安全拒绝，以上验证使用已有Node运行时直调工具，无安装或依赖变更。

人工查看浅/深色导出PNG、桌面与手机预览：文字与网格无重叠，使用实际UI颜色，无轨迹占位与图片分页均已移除。临时合成证据保存在`/private/tmp/runnote-route-poster-20261016/`，不加入Git。

独立代码审查的canShare异常问题已通过先失败后通过的浏览器用例修复。最终复审未发现可操作问题。

## 未验证事项与剩余边界

- NOT VERIFIED：真实账户数据端到端、真实iOS/Android系统分享与相册保存、Safari/Firefox和生产环境。本次未操作或重启开发服务，未部署。
- NOT RUN：后端测试、数据库集成和完整前端UI总集；本次没有后端变更，前端按受影响范围回归。
- 全列表扫描成本随记录数量线性增加，可取消；沿用既有offset上限1000000，超过可查询范围时要求按月份生成，不静默丢失候选。
- 现有接口没有跨请求事务快照；可检测总数、重复、月份和摘要变化，但不保证并发编辑时的严格快照一致性。
- 未修改既有活动卡片/分页、导入、认证、权限、旧分享链接和数据库；保留工作区既有未提交修改；后续用户明确授权本功能提交与推送，部署不在授权范围。
