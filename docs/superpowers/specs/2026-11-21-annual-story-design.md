# RunNote 工作项 19：跑步年度故事（Annual Running Story）设计提案

> **日期**：2026-11-21 · **代码基线**：`origin/main`（`9f51937429fa9b7066f54d4213291fbc91defc93`，v1.5.0）  
> **阶段边界**：Phase 1 设计探索与可交互原型（仅 `docs/` 文档与原型资产，**未修改任何生产路由、后端 API、数据库 Schema、鉴权逻辑或全局导航**）。

---

## 一、背景与定位：为什么“年度故事”不是另一个 #15 回顾页

工作项 15（月度/年度跑步回顾 v1.5.0，PR #123 已合入 `main`）通过「跑道年鉴（Editorial Monolith）」四章节布局与三款 9:16 分享图（A 特刊 / B 环道 / C 存根），很好地解决了“按月或按年盘点统计趋势”的需求：它聚焦**服务端周期聚合数字**（总里程、次数、天数、用时、均配速）以及**月/周维度的里程地形、出勤圆环与配速折线**，完全不涉及单条跑步记录、具体路线轨迹或城市地理信息。

**工作项 19（跑步年度故事）** 是与之互补、绝不重复的 **个人年度运动回忆录（Personal Sports Memoir）**：

| 对比维度 | 工作项 15 · 跑步回顾（已上线 v1.5.0） | 工作项 19 · 跑步年度故事（本提案） |
| --- | --- | --- |
| **核心心智** | 周期统计特刊（月度 / 年度） | 年度个人运动回忆录（仅按年） |
| **内容主体** | 聚合指标 + 分桶分布（里程地形、出勤矩阵、配速走势） | 具象记忆事件 + 空间足迹（首跑、最长、最佳、探索城市、最常跑、年度足迹动画） |
| **数据来源** | 仅 `/statistics/report` + `/statistics/trends` | 整合 `activities`、`statistics/records`、`footprints/global`、`footprints/exploration`、`route_groups` 与轻量年度轨迹序列 |
| **入口关系** | `/workspace/records/recap`（由个人记录页周期报告卡进入） | 建议 `/workspace/records/story?year=YYYY`（由个人记录页年度报告卡与 `#15` 年度回顾页预留槽位进入，**不新增一级全局导航**） |
| **隐私边界** | 私有工作区；9:16 海报白名单无地名/无坐标 | Phase 1 严格限定私有工作区；海报默认抽象无坐标轮廓，并提供“隐藏城市名 / 隐藏路线名”脱敏开关；绝不读取 `wellbeing` |

---

## 二、六个必选故事节拍的数据盘点、口径与降级策略

基于 `9f51937` 仓库后端代码的只读审计（`activities`、`statistics`、`footprints`、`route_groups`、`shoes`），六大故事节拍的真实数据现状与 Phase 2 实施契约建议如下：

| 故事节拍 | 现有后端能力（`9f51937`） | 现存差距 | 建议权威口径与排序规则 | 异常 / 边界降级方案 |
| --- | --- | --- | --- | --- |
| **1. 年度第一跑** | `activities` 含 `activity_date`、`started_at`、`title`、`distance_m`、`timer_seconds`/`elapsed_seconds`、`avg_pace_seconds_per_km`；`activity_segments` 存轨迹；`activity_global_footprint_caches` 存城市码。 | 现有 `GET /api/v1/activities` 按日期倒序且仅支持按日/月筛选，不返回简化轨迹缩略线。 | 在 `[YYYY-01-01, min(YYYY+1-01-01, today+1))` 内按 `activity_date ASC, started_at ASC NULLS LAST, id ASC` 取第 1 条，并附简化轨迹（若存在）。 | 缺 `started_at` 时隐藏具体时刻；缺用时/配速显示 `—`；无 GPS 轨迹时降级为纯排版纪念卡（无轨迹缩略图）。 |
| **2. 最长路线** | 同上（`activities.distance_m` 为 `Numeric(12,3)`；`shoes` 模块 v1.3.0 可关联 `shoe_id` 跑鞋名称）。 | 现有接口无按年取最大里程单次活动及简化轨迹的查询。 | 年度内 `distance_m > 0` 按 `distance_m DESC, activity_date ASC, id ASC` 取第 1 条（并列时标注 `tied_count`）；同时返回 `has_track` 与简化轨迹。 | 若全年仅 1 条记录，与“年度第一跑”合并提示而不机械重复；无 GPS 轨迹时用里程标尺与全马比例替代轨迹图。 |
| **3. 最佳表现** | `statistics/records.py` 已有权威 `eligible_expression()`、`pace_seconds_per_km`（`ROUND_HALF_EVEN`）与 `DISTANCE_BANDS`（3km / 5km / 10km / 半马 / 全马）。 | `GET /api/v1/statistics/records` 仅计算**全部历史** 5km / 10km 最佳，未按年过滤。 | 在目标年份内对满足 `eligible_expression()` 的记录按标准距离组（优先展示达成的最主流组别 10km / 半马 / 5km / 全马，并标记 `is_all_time_pb` 与较当年首跑提速值）；辅以其余标准组小卡。 | 无标准距离组记录时，退回年度 `distance_m >= 1000m` 最快合格配速；若 `pace_eligible_count == 0`（全部缺有效用时），降级为“年度坚持表现”（最长单次里程或年度最长连续周数）。 |
| **4. 探索城市** | v1.4.0 已完备：`GET /api/v1/footprints/global?year=YYYY` 返回国家/区域/城市列表、里程与次数；`exploration.py` 已按年/月计算 100m 探索网格（`new_cells` / `cumulative_cells`）。 | `global` 摘要未直接标注哪些城市是“**今年历史上首次点亮**”的新城。 | 复用 `activity_global_footprint_caches`，对目标年命中的 `city_codes` 与历史 `< YYYY` 年求差集得出 `is_new_city`，并汇总当年每城次数、里程与新增 100m 网格数。 | `located_activity_count == 0`（全室内/手动记录）→ 展示“室内与无定位记录年度”降级卡片；仅 1 座城 → 自动转为“深耕一座城”叙事，突出新增 100m 网格与季节足迹；缓存回填 `pending` 时局部提示且不阻断其余章节。 |
| **5. 最常跑路线** | `route_groups` 模块已按 `route_fingerprints` 聚合 `MIN_RUNS = 2` 的重复路线，返回简化 `shape`、中位距离、最佳/均配速。 | `route_groups/queries.py` 目前为全部历史聚合，未支持按 `year` 过滤，且未返回可读路线名称。 | 在 SQL 中对 `route_group_members JOIN activities` 增加年度日期过滤，`HAVING count(*) >= 2` 按 `run_count DESC, last_date DESC` 取第 1 组；名称取组内当年最常见活动标题（优先已命名/OSM `place_titles`），附当年首跑与最佳配速对比及月度打卡分布。 | `building == true` 时显示构建中状态；全年无重复 ≥ 2 次的户外路线时，转化为正向叙事降级：**「每一次都是新出发」**，不呈现冰冷空态。 |
| **6. 年度足迹动画** | `GET /api/v1/footprints?date_from=...&date_to=...&mode=tracks` 返回轨迹，但受 `MAX_POINTS = 250000` / `MAX_SEGMENTS = 10000` 限制，高频跑者全年易触发 422 `FOOTPRINT_LIMIT` 且原始点过重。 | 缺少面向年度时间轴回放的轻量化、按日期排序的轨迹序列。 | 新增轻量年度回放载荷：复用已存在的 `route_fingerprints.geom`（或 `ST_Simplify` 抽稀至每条 30–80 顶点，delta 编码），按 `activity_date ASC, started_at ASC` 排序，仅携带日期、距离、城市码、里程碑标签与抽稀折线（全年约 40–150 KB gzip）。完全离线本地渲染（无外部瓦片依赖），且 `prefers-reduced-motion` 下默认静帧完结态支持手动拖拽。 | 全年无 GPS 轨迹（室内跑者）→ 自动降级为 **365 天/12 个月节律脉冲圆环动画**，依然可按时间轴播放、暂停、拖拽与倍速重温全年出勤节奏。 |

> **后端接口策略建议（供 Phase 2 参考）**：建议新增单一私有聚合接口 `GET /api/v1/statistics/annual-story?year=YYYY`（返回 `StoryOverview`、五大故事节拍结构及轻量 `footprint_timeline[]`），严守 `get_read_identity` 本人鉴权、`Cache-Control: private, no-store` 与 `StrictInput`/白名单模型，避免前端并发拼装 6+ 个接口导致状态撕裂或超时。

---

## 三、三个独立设计方向详述

全部三个方向均严格遵循 [Design System](../../design-system/README.md) 与 [Tokens](../../design-system/tokens.md)（暖浅 `#f6f7f4` / 暖炭 `#292725`、品牌绿 `#17745c` / `#77d4ac`、规范字重 `400/500/600/700`、`tabular-nums`、原生 `<dialog>`、完整浅/深色双主题与 `prefers-reduced-motion` 支持），但在**叙事模型、空间隐喻、交互范式、动效语言与海报形态**上彻底区分。

---

### 方向 A · 《时空长卷 · 时序回忆录》（Chronicle Scroll）— **推荐方向**

- **核心隐喻**：一部从 1 月 1 日展开到年末的 **个人运动纪实长卷（Magazine Scrollytelling + Sticky Cartographic Stage）**。
- **叙事弧线**：`序章定调（年度规模）` → `01 第一跑（启程）` → `02 最长路线（远征）` → `03 最佳表现（巅峰）` → `04 探索城市（版图）` → `05 最常跑路线（日常与沉淀）` → `06 年度足迹动画（全局合流）` → `封存卷轴海报`。
- **章节与布局结构**：
  - **序章卡**：复用 RunNote 标志性淡奶油黄页头（`--header-tint`；深色模式下为中性炭灰），展示年份、进行中徽标、一句话真实数据结论、4 列发丝线核心概览条与 6 枚章节快捷锚点。
  - **桌面双栏滚动联动（≥1024px）**：左栏依次呈现 01–05 叙事卡片，右栏为常驻吸顶的 **同步地理/路线舞台（Sticky Stage）**；滚动经过或点击任意章节（或点击第 04 章的城市列表项），右侧画布平滑切换至对应单线特写、城市拓扑或常跑叠影。
  - **平板/手机（<1024px）**：同步舞台收敛置顶在章节流之前，与 01–05 快捷切点联动，零横溢、零卡顿。
  - **终章全宽放映台（Chapter 06）**：16:9（窄屏 4:3）全宽年度足迹动画舞台，顶栏实时跳动当前日期、累计里程、累计出发与已点亮城市数，底栏提供播放/暂停、重头、1x/2x/4x 倍速与 12 个月刻度进度条。
- **排版与色彩**：完全沿用 RunNote 暖浅纸面与暖炭深色体系，正文克制舒展，关键数字使用 `--primary` 与 `tabular-nums`，舞台轨迹以品牌绿为主色，最长路线以 `--sport-yellow-accent` 金色、PB 以 `--sport-coral` 珊瑚红点睛。
- **动效语言**：平滑滚动同步 + 路径生长 + 柔和缓动 `cubic-bezier(0.22, 0.61, 0.36, 1)`；`prefers-reduced-motion` 下关闭位移过渡、动画默认落在完整终帧并允许手动拖拽卡尺。
- **分享 / 海报行为**：页尾配有暖底封存台（实时微缩预览）与原生 `<dialog>` 导出 **9:16「纪实卷轴海报（Memoir Folio）」**（1080×1920）：上半幅为深森抽象全轨迹画框与总里程，下半幅为 5 枚核心记忆印记，支持浅/深色切换及“隐藏具体城市名 / 隐藏具体路线名”隐私脱敏。
- **可行性与风险**：
  - *可行性*：高。与现有 SvelteKit 文档流、顶部悬浮导航及 `/workspace/records/recap` 架构最契合，可完全复用既有无障碍与响应式规范。
  - *风险*：桌面低高度屏幕（如 `1280×720`）下吸顶舞台需约束 `aspect-ratio` 以避免遮挡底部标注；`IntersectionObserver` 阈值需做防抖，避免快速滚动时舞台频繁抖动。

---

### 方向 B · 《足迹放映室 · 沉浸式七幕剧场》（Footprint Cinema）

- **核心隐喻**：一场 **7 幕交互式年度故事剧场（Full-Viewport Story Deck）**，借鉴年度音乐/运动回顾的分幕仪式感，但保持 RunNote 的克制运动气质与键盘友好性。
- **叙事弧线**：`Act 01 序幕` → `Act 02 第一跑` → `Act 03 最长路线` → `Act 04 最佳表现` → `Act 05 探索城市` → `Act 06 最常跑` → `Act 07 年度足迹电影`。
- **章节与布局结构**：
  - 顶部为 7 段式细进度条（宽屏带幕名、手机收为极简分段轨），支持点击跳转及键盘 `← / →` 翻幕、`Space` 在第 7 幕控制播放。
  - 中央为全视口剧场主框：桌面端左文右画（第 7 幕自动扩宽画布比例至 `1.45:1`），平板与手机端画布在上、大字读数在下，底部配有“上一幕 / 分享单幕剧照 / 导出全景胶片 / 下一幕”固定操作栏。
- **排版与色彩**：高对比剧场语言——浅色模式下舞台采用深森绿渐变（`--recap-forest` → `--recap-forest-deep`）配金黄标尺与薄荷轨迹；深色模式下沉入暖炭黑曜画布，保持极高视觉聚焦度。
- **动效语言**：幕间淡入推进 + 发光跑者光点沿全年轨迹逐日巡航 + 实时数字跃动；`prefers-reduced-motion` 下瞬切无位移。
- **分享 / 海报行为**：同时支持 **「全景胶片长卷（两侧胶片齿孔 + 全年足迹 + 4 格关键帧）」** 与 **「单幕高光剧照（仅导出某一幕，如最长路线）」** 双模式 1080×1920 PNG 导出，同样内置明暗切换与地名/路线脱敏开关。
- **可行性与风险**：
  - *可行性*：中高。需维护 7 幕状态机、触摸滑动手势（移动端）、键盘焦点迁移与单幕/全景两套海报渲染器。
  - *风险*：桌面大屏下全屏分幕割裂了用户同时纵览多个故事节拍的自由度；若用户在手机窄屏上内容略长（如多座城市胶囊），单幕内仍可能产生轻微滚动，需严格控制每幕信息密度。

---

### 方向 C · 《跑者手账册 · 地图档案与邮戳页》（Atlas Almanac）

- **核心隐喻**：一本摊开在桌面的 **户外勘测手账与跑者护照（Tactile Cartographic Field Book & Specimen Atlas）**。
- **叙事弧线**：**地图先行、非线性双向探索**——一进入页面即直面完整的 **年度足迹主画布（Specimen 00）** 与时间卡尺，下方铺开 6 张实体标本与邮戳卡片，点击任意一张卡片或某枚城市邮戳，上方主画布立刻切换镜头高亮聚焦。
- **章节与布局结构**：
  - **手账页眉**：方格勘测底纹 + 复古双环圆形年度骑缝章（总次数 + 总里程）。
  - **首屏主画布工作台（Specimen 00）**：顶部 6 枚镜头切换胶囊（全年动画 / 首跑 / 最长 / 最佳 / 城市 / 常跑叠影）+ 宽幅地图画布 + 悬浮 HUD 读数条 + 12 个月刻度播放卡尺。
  - **下方标本与护照网格**：桌面上排 3 列（`NO.01 首跑日历签`、`NO.02 最长路线勘测卡`、`NO.03 最佳成绩计时章`，顶边分别以 `--sport-green` / `--sport-yellow-accent` / `--sport-coral` 标识）、中段通栏 **「NO.04 探索城市邮戳护照」**（微倾斜的实体邮戳卡片，新点亮城市加盖珊瑚红边框与“新点亮”印记）、下排左 2 列 **「NO.05 最常跑路线复写页（12 月打卡格）」** + 右 1 列 **「NO.06 跑者护照封存台」**。
- **排版与色彩**：在 RunNote 暖底色上叠加细方格勘测纹理与 `--recap-paper` 手账纸面（深色模式下为深炭勘测纸），辅以等宽档案编号（`FIELD ALMANAC · NO.2025`）与虚线分隔，材质温暖且有极强收藏欲。
- **动效语言**：触觉回弹与盖章微动（卡片悬停轻抬、邮戳点击摆正并同步主画布镜头）；足迹动画如钢笔墨线在勘测网格上按日期逐笔绘出。
- **分享 / 海报行为**：导出 **9:16「跑者年度护照折页（Runner's Passport Sheet）」**（1080×1920）：方格纸面 + 档案双框线 + 右上角倾斜圆章 + 抽象全轨迹图 + 4 枚倾斜城市邮戳 + 3 枚标本徽章 + 最常跑路线条。
- **可行性与风险**：
  - *可行性*：中。状态模型简单清晰（单一主画布 `lens` 状态 + 静态网格卡片），组件拆分自然。
  - *风险*：方格背景与多色邮戳属于站内较新的装饰纹理，需克制密度以免在深色或小屏下显得花哨；首屏直接呈现全部足迹画布少了一点“从头到尾拆开一封年终信”的渐进悬念感。

---

## 四、三方向横向对比与推荐结论

| 对比维度 | 方向 A · 时空长卷（Chronicle Scroll） | 方向 B · 足迹放映室（Footprint Cinema） | 方向 C · 跑者手账册（Atlas Almanac） |
| --- | --- | --- | --- |
| **交互与阅读心智** | 滚动叙事 + 吸顶同步舞台（线性回忆录） | 7 幕全屏分幕剧场（单幕沉浸推进） | 足迹主画布置顶 + 标本/邮戳双向联动（自由探索） |
| **与 #15 回顾页区分度** | 极高（事件 + 地理叙事，零统计柱图重复） | 最高（完全独立的全屏剧场形态） | 极高（空间画布优先 + 护照邮戳隐喻） |
| **与 RunNote 设计体系融合度** | **★★★★★**（原生页头、卡片流与语义令牌浑然一体） | ★★★☆☆（深森强剧场独立感强，略脱离日常页面流） | ★★★★☆（延续暖纸面与运动色，新增方格/邮戳肌理） |
| **桌面端体验** | **★★★★★**（双栏图文同步联动，阅读最流畅） | ★★★☆☆（大屏单幕信息密度偏疏，对比需来回翻幕） | ★★★★☆（一屏掌控画布，下方标本卡纵览效率高） |
| **移动端体验** | ★★★★☆（线性顺滑，舞台收纳清晰） | **★★★★★**（单手翻幕与分享感极佳） | ★★★★☆（自上而下卡片流清晰，交互点明确） |
| **年度足迹动画舞台感** | ★★★★☆（终章 16:9 压轴高潮） | **★★★★★**（第 7 幕全屏电影感最强） | ★★★★★（首屏即见即玩，支持 6 镜头随时切换） |
| **分享海报记忆点** | ★★★★☆（纪实长卷，稳重大气耐看） | ★★★★★（胶片齿孔 + 单幕/全景双模式） | **★★★★★**（跑者护照邮戳页，差异化收藏感最强） |
| **工程复杂度与维护成本** | **中（最可控）** | 中高（手势/键盘状态机 + 双海报模板） | 中（主画布镜头切换 + 标本卡片网格） |
| **无轨迹 / 稀疏年降级表现** | ★★★★★（文字回忆录依然丰满，终章平滑切日历脉冲） | ★★★★☆（第 5/6 幕略显空旷） | ★★★★☆（邮戳页在 0 城时视觉亮点减弱） |

### 明确推荐

**推荐主方案：方向 A · 《时空长卷 · 时序回忆录》（Chronicle Scroll）**

**核心理由**：
1. **叙事连贯性与降级韧性最佳**：无论用户是全年跑了 5 座城的资深跑者（`2025`），还是仅在 1 座城深耕（`2026`），抑或是只有 9 次室内跑步机记录的新手（`2024`），线性回忆录结构都能保持完整的起承转合，不会因为缺少城市或重复路线而让某几幕显得突兀空洞。
2. **与 RunNote 整体产品气质无缝统一**：暖浅/暖炭底色、淡奶油黄序章带、克制的留白与清晰的数据层级，既让人一眼认出“这是 RunNote 的年度故事”，又在空间叙事和交互舞台上与 `#15` 统计回顾页拉开了本质差距。
3. **工程落地风险最低且扩展性最好**：可复用既有 Canvas 2D / MapLibre 离线渲染架构与原生 `<dialog>` 导出链路；若负责人同时喜欢方向 B 的「胶片长卷」或方向 C 的「跑者护照」海报风格，Phase 2 实施时完全可以沿用 `#15` 的成功经验，**以方向 A 为主页面架构，在海报导出弹窗内提供 A 纪实卷轴 / B 胶片长卷 / C 跑者护照三款 9:16 皮肤切换**，兼顾最佳阅读体验与最强分享欲。

---

## 五、可交互原型与浏览器 Visual QA 验证记录

### 1. 交互原型入口（零依赖静态 HTML/CSS/JS，全部虚构合成数据）

全部资产位于 `docs/assets/2026-11-21-annual-story/`，不接入任何生产路由，且零外部字体/图片/地图网络请求：

- **三方向对比总览页**：[index.html](../../assets/2026-11-21-annual-story/index.html)
- **方向 A · 时空长卷原型**：[direction-a/index.html](../../assets/2026-11-21-annual-story/direction-a/index.html)
- **方向 B · 足迹放映室原型**：[direction-b/index.html](../../assets/2026-11-21-annual-story/direction-b/index.html)
- **方向 C · 跑者手账册原型**：[direction-c/index.html](../../assets/2026-11-21-annual-story/direction-c/index.html)

所有原型顶部均内置：
- **三组虚构合成场景切换**：`2025`（完整年 · 5 座虚构城市：青岬市 / 桐溪市 / 杉港市 / 鹿鸣谷 / 白沙洲）、`2026 进行中`（截至 11.21 · 单城深耕 + 用时覆盖率提示）、`2024 降级`（9 次室内无 GPS 记录 · 展示全套无轨迹/无城市/无重复路线降级）。
- **浅色 / 深色主题即时切换**（同步重绘 Canvas 画布与海报预览）。
- **年度足迹动画控制台**（播放/暂停、重头、1x/2x/4x 倍速、时间轴进度条拖拽）。
- **真实 1080×1920（9:16）Canvas 2D 海报导出弹窗**（含浅/深色海报主题、隐私脱敏开关与本地 PNG 下载）。

### 2. Chrome Headless 实测 Visual QA 报告

通过本地临时静态服务器 + `/usr/bin/google-chrome --headless=new`（CDP 协议实测）覆盖全部 3 个方向 × 3 个视口（`1440×900` / `768×1024` / `390×844`）× 明暗双主题 + 足迹动画三关键帧（22% / 62% / 100%）+ 9:16 海报预览弹窗（浅/深色）+ `2026`/`2024` 降级场景验证：

- **控制台错误（Console Errors）**：`0`（首轮捕获 1 例 `/favicon.ico` 404，补充内联 SVG icon 后复测清零）
- **未捕获页面异常（Page Exceptions）**：`0`
- **外部第三方网络请求（External Requests）**：`0`
- **横向布局溢出（Horizontal Overflow `scrollWidth > innerWidth`）**：`0`（全部视口与降级场景均严格无溢出）
- **首轮视觉走查修正项**：
  1. 补充 `[hidden] { display: none !important; }`，修复完成态年份偶现 `进行中` 胶囊与方向 B 非终幕显示播放条的 CSS 优先级覆盖；
  2. 紧凑化方向 C 桌面端主画布高度与移动端顶栏排布，使 `1440×900` 首屏完整呈现主画布与播放卡尺，`390×844` 首屏内容占比显著提升；
  3. 修正方向 B 全景胶片海报中总里程数字与 `KM` 单位的动态间距计算。

### 3. 全量实测截图索引（共 33 张）

#### 桌面 `1440×900` / 平板 `768×1024` / 手机 `390×844`（浅色 & 深色）

| 方向 | 1440×900 浅 / 深 | 768×1024 浅 / 深 | 390×844 浅 / 深 |
| --- | --- | --- | --- |
| **A · 时空长卷（推荐）** | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-a-1440x900-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-a-1440x900-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-a-768x1024-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-a-768x1024-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-a-390x844-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-a-390x844-dark.png) |
| **B · 足迹放映室** | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-b-1440x900-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-b-1440x900-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-b-768x1024-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-b-768x1024-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-b-390x844-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-b-390x844-dark.png) |
| **C · 跑者手账册** | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-c-1440x900-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-c-1440x900-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-c-768x1024-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-c-768x1024-dark.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-c-390x844-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-c-390x844-dark.png) |

#### 年度足迹动画关键帧 & 9:16 分享海报预览

| 方向 | 动画早期 (22%) | 动画中段 (62%) | 动画终帧 (100%) | 海报预览（浅 / 深） |
| --- | --- | --- | --- | --- |
| **A · 时空长卷** | [22%](../../assets/2026-11-21-annual-story/screenshots/direction-a-anim-early.png) | [62%](../../assets/2026-11-21-annual-story/screenshots/direction-a-anim-mid.png) | [100%](../../assets/2026-11-21-annual-story/screenshots/direction-a-anim-end.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-a-poster-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-a-poster-dark.png) |
| **B · 足迹放映室** | [22%](../../assets/2026-11-21-annual-story/screenshots/direction-b-anim-early.png) | [62%](../../assets/2026-11-21-annual-story/screenshots/direction-b-anim-mid.png) | [100%](../../assets/2026-11-21-annual-story/screenshots/direction-b-anim-end.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-b-poster-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-b-poster-dark.png) |
| **C · 跑者手账册** | [22%](../../assets/2026-11-21-annual-story/screenshots/direction-c-anim-early.png) | [62%](../../assets/2026-11-21-annual-story/screenshots/direction-c-anim-mid.png) | [100%](../../assets/2026-11-21-annual-story/screenshots/direction-c-anim-end.png) | [浅](../../assets/2026-11-21-annual-story/screenshots/direction-c-poster-light.png) / [深](../../assets/2026-11-21-annual-story/screenshots/direction-c-poster-dark.png) |

---

## 六、开放问题与待负责人确认的决策清单

在进入 Phase 2（后端聚合接口 + 生产 Svelte 页面实施）之前，请负责人确认以下 5 项决策：

| # | 待决策事项 | 推荐选项 | 备选方案与取舍 |
| --- | --- | --- | --- |
| **1** | **主页面设计方向选择（核心决策）** | **方向 A · 时空长卷（Chronicle Scroll）** | 选 **方向 B（足迹放映室）** 强化移动端全屏剧场感；选 **方向 C（跑者手账册）** 突出首屏地图画布与实体邮戳收藏感。 |
| **2** | **9:16 分享海报版式策略** | **首期提供 1 款对应所选方向的主版式**（或在弹窗内复刻 `#15` 模式提供 A 卷轴 / B 胶片 / C 护照三选一） | 三款都做可最大化分享欲，但会增加约 1.5–2 天渲染器与视觉回归维护量。 |
| **3** | **“最长路线”是否纳入无 GPS 手动记录** | **默认按全年最大 `distance_m` 选取（无轨迹时标记“无 GPS 轨迹”并降级为里程标尺）** | 也可严格限定仅统计含 GPS 轨迹的记录，避免跑步机手动录入占掉“最长路线”位置。 |
| **4** | **年度足迹动画底图模式** | **默认采用纯本地抽象地理与省/城轮廓（离线 60fps、零外部请求）**，可选叠加 OpenFreeMap 街道底图 | 直接依赖 MapLibre 矢量底图会在弱网/离线场景下增加首帧延迟，且需处理 OSM 署名排版。 |
| **5** | **可见范围（私有 vs 公开展示）** | **首期严格限定私有工作区 `/workspace/records/story`** | 若未来要开放给站主公开展示或 `/p/{username}/story`，需单独设计公开白名单、隐藏私人备注/低可见性活动并走独立安全验收。 |

---

## 七、剩余风险与未受影响范围

- **未受影响部分**：本次仅在 `docs/` 下新增设计文档、静态可交互原型与截图证据；生产前端路由、后端模块、数据库 Schema/迁移、版本号与部署脚本均保持原样。
- **Phase 2 需重点验证的工程风险**：
  1. 高频跑者（全年 300+ 条轨迹）在轻量年度足迹载荷中的抽稀精度与传输体积上限控制（建议服务端做硬上限保护与 `ST_Simplify` 抽稀）；
  2. `activity_global_footprint_caches` 与 `route_group_members` 异步后台回填尚未完成时的局部降级与轮询/重试体验；
  3. 跨经度 180°（国际日期变更线）或跨大洲旅行跑步时，年度足迹投影自动缩放与城市间连线的视口适配。
