# 足迹 Coverflow 实施计划

**目标：** 保留现有设计与记录切换行为，为右侧卡片增加双侧 3D 空间、弹簧切换、中央指针反馈与多种输入。

**架构：** `ActivityWallPreview` 保留数据职责，`coverflow.ts` 负责几何、共享进度弹簧与输入 action，`WallCard/card-tilt` 负责中央卡片内部反馈。沿用既有 `createSpring` 的计算能力，不引入材质/依赖。

**约束：** Svelte 5 runes；只改前端；不改接口/DB/密钥/路由语义；保留 dirty 状态；不提交或推送。按用户已明确的设计和实施授权，在当前会话连续完成。

## 任务 1：空间布局与协调运动

文件：新增 `frontend/src/lib/styles/coverflow.ts`、`frontend/tests/unit/coverflow.test.ts`；修改 `ActivityWallPreview.svelte`、`tests/ui/footprint-card-deck.spec.ts`。

接口：`coverflowGeometry(viewportWidth, cardWidth)` 产出 radius/step/compact；`coverflowPosition(offset, geometry)` 产出 x/z/rotation/scale/opacity；`coverflow(node, options)` 管理所有 slot 的共享 spring。

- [x] 写独立断言：主卡中心、两侧符号相反、距离增加时更小更远、有限视口收敛、旧布局没有侧卡旋转；运行专项看见预期失败。
- [x] 保持 9rem 基础宽度，用 grid 叠放 slot，主卡位置 `translateX(0) translateZ(0) rotateY(0) scale(1)`；侧卡使用相对索引和实际视口，半径最大 3。
- [x] 将读取窗口改为以当前记录居中并增加一张缓冲，限制在真实记录边界；保留旧窗口直至弹簧结束，连续切换接续同一进度。
- [x] 运行 unit 与 Chrome 专项，检查截图和主卡/侧卡/箭头的真实边界。

## 任务 2：中央倾斜、高光、视差与导航

文件：修改 `card-tilt.ts`、`WallCard.svelte`、`coverflow.ts`、`ActivityWallPreview.svelte`、专项 UI 测试。

接口：保留 `cardTilt(node, enabled)`；新增导航 action，通过 `onstep(direction, focusCard)` 复用现有 select。

- [x] 先补失败测试：中央高光、双向倾斜与回弹、路线/文字不同位移；侧卡无指针反馈；方向键和触摸横滑切换整条记录。
- [x] 用现有标量弹簧驱动局部 CSS 变量，限制 6°/2px，只有中央启用，离开平滑恢复；动态偏好变化和卸载停止动画并清理。
- [x] 增加区域方向键与触摸横滑，保留纵向滚动和点击语义；减少动态效果立即定位，窄屏降低 3D。
- [x] 验证动画进行中再次切换的最终 ID/URL/中央位置一致，失败/401/分页/返回来源不回归。

## 任务 3：验收与文档

文件：新增编号验收文档，修改 `docs/design-system/components.md` 的业务组件说明。

- [x] 执行卡片、活动管理/分享、列表/墙返回和运动详情相关 Chrome 回归；人工查看桌面和手机截图，不操作真实数据。
- [x] UI 完成后依次执行 `pnpm check`、`pnpm test`、`pnpm build`，记录真实结果；执行 owned scope 与全仓 diff 检查，区分并行工作区问题。
- [x] 进行代码审查，修复确定问题；文档说明使用方式、接口与隐私、结果及未验证事项。保留原有历史验收。

完成证据见 `docs/53-footprint-coverflow.md`。扩展 Chrome 回归为 81 passed / 1 failed，失败用例单独复测通过；不将原扩展运行改记为全绿。

## 后续增量：点击懒加载与九卡

- [x] 检查既有读取路径：切换等待路线、侧卡视口自动读取；沿用既有 token 和请求边界。
- [x] 添加并运行失败断言：宽屏仍为 7 张（期望 9），纯几何仍半径 3（期望 4）。
- [x] 增大宽屏上限，新增默认关闭的缩略图 deferred 选项，详情切换提交后独立读取路线。
- [x] 执行相关 Chrome 回归、单测、类型检查、构建；审查路线竞态并追加验收记录。
# 增量实施：拖动与有界缓存

- [x] 在 `frontend/tests/ui/footprint-card-deck.spec.ts` 新增真实鼠标拖动、触控板突发/反向、纵向滚动、跨四页淘汰后重读与近页命中用例，先运行看到缺失行为红灯。
- [x] `coverflow.ts` 的导航 action 接受鼠标主键横拖；保留手势阈值和误点击抑制；横向 wheel 累计 48px 后切换一次，以 180ms 间隔区分手势，不拦截纵向或缩放输入，卸载移除监听。
- [x] `ActivityWallPreview.svelte` 的页缓存命中更新顺序，插入后移除最早项直到最多三页。`readWindow` 从 `Promise.all` 结果映射页码装配卡片。过渡窗口保留实际可见位置、上一目标窗口与新窗口之间的已读路径卡片，避免快速跨卡中间缺卡；结束后清理。
- [x] 运行专项 Chrome、关联回归、`pnpm test`、`pnpm check`、`pnpm build`，人工检查桌面与手机截图，更新 `docs/53-footprint-coverflow.md` 和组件目录。只用合成 API，不操作数据库或提交。


## 修正：滑动只浏览

1. 更新桌面/触屏用例，断言滑动后卡片位置变化，但标题、URL、指标和详情请求数不变；先执行红灯。
2. ActivityWallPreview 拆分 browseIndex/selectedIndex，浏览函数只 readWindow/applyWindow；选中后才 onswitch 并更新 selectedIndex。重试区分浏览和选择，resize 使用浏览位置。导航 action 的手势/方向键改为 onbrowse，WallCard 的中心倾斜与选中语义独立。
3. 补充跨页仅浏览、中央卡点击、箭头确认、浏览失败重试、选中卡回中测试，运行专项、关联回归和前端检查/构建；更新验收文档，不改后端或数据库。

## 追加实施：等大与连续横滑

- [x] 更新几何单测和Chrome断言，先复现侧卡宽度差72px、手机step=0，以及连续wheel仅前进一步。
- [x] coverflow.ts取消侧卡缩放/旋转/纵深，按等大卡片计算水平间距与容量；手机单卡仍有水平行程。增加侧卡点击中心可见约束，防止统一尺寸后前卡遮挡点击位置。
- [x] 手势按距离推进，wheel按累计距离连续浏览；ActivityWallPreview合并在途浏览意图并串行读取，保留原列表20×3上限和错误/鉴权清理。
- [x] Chrome新增慢页加载时接收后续浏览意图且该页只读一次；31项卡片专项通过。最终关联回归、类型/单测/构建与截图证据记录到53号文档。
