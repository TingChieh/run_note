# 深色外观改为暖炭灰设计

日期：2026-10-30。状态：设计已确认（方案 E），已完成本地实现；验证结果与剩余事项见 `docs/77-dark-theme-warm-charcoal.md` 与 `docs/78-top-navigation.md`。

## 背景与目标

现在的深色外观是偏绿的深森林色：背景 `#101a16`、卡片 `#1b2922`、边框 `#405348`，所有表面都带绿调，和薄荷绿强调色混在一起，层次糊。用户要求不要这种深绿，并给了两张 macOS 参考（Apple Music、系统设置）。

目标：把深色的表面、边框、文字和悬浮玻璃换成中性偏暖的炭灰，薄荷绿与黄色只留给强调；层次靠「越悬浮越浅」，而不是靠绿调或粗边框。

## 参考取样（来自用户提供的截图）

| 位置 | 色值 |
| --- | --- |
| 内容区背景 | `#282726`（Apple Music）、`#2b2827`（系统设置） |
| 卡片 | `#302e2d`（只比背景亮一两档） |
| 分隔线 | `#3a3837` |
| 当前项底色 | `#4d4644` |
| 悬浮玻璃（播放条、返回按钮） | `#444342`、`#474544` |
| 进度条轨道 | `#423f3e` |

结论：背景是 `#28~#2b` 的暖炭灰而不是近黑；卡片和背景差别很小；越浮越浅；界面只有一个高饱和强调色（Apple 用红或蓝，我们保留薄荷绿）。

## 不在范围内

- 浅色外观的任何颜色（唯一例外：顶部条里玻璃按钮的中性化，见下节，它在浅色下也会生效）。
- 数据颜色：日历热力的绿色色阶 `--calendar-1..4`、轨迹区分色、`--chart-series`、身心健康小组件色、状态色（error / success / warning 的前景与边框）。它们各有含义，不随底色变。
- 外部底图（OpenFreeMap 的 `dark` 样式）自己的配色。
- 接口、权限、数据、迁移。

## 令牌变更（深色）

只改 `frontend/src/app.css` 里深色令牌块（`:root[data-theme="dark"]` 与 `[data-poster-theme="dark"]` 共用的那一块；路线海报的深色主题因此一并换色）。

| 令牌 | 原值 | 新值 |
| --- | --- | --- |
| `--background` | `#101a16` | `#292725` |
| `--surface` | `#1b2922` | `#33312f` |
| `--foreground` | `#e4eee7` | `#f2f0ee` |
| `--muted` | `#26362d` | `#3e3b39` |
| `--muted-foreground` | `#b1c3b6` | `#b1aca6` |
| `--border` | `#405348` | `#46433f` |
| `--control-hover-border` | `#8da996` | `#8b8680` |
| `--primary-soft` | `#233e30` | `#2c3a32` |
| `--success-soft` | `#203d2c` | `#24392d` |
| `--sport-sidebar` | `#173c2b` | `#34322f` |
| `--sport-nav-active` | `#2a5138` | `#4d4644` |
| `--sport-nav-active-ink` | `#daf3c8` | `#f2f0ee` |
| `--sport-yellow` | `#58471e` | `#54451d` |
| `--calendar-0` | `#26342c` | `#3e3b39` |
| `--calendar-ring` / `--calendar-label` | `#e4eee7` | `#f2f0ee` |
| `--route-thumbnail` | `#273d2b` | `#2c3a31` |
| `--province-unvisited` | `#354a3d` | `#45423e` |
| `--province-sea` | `#749781` | `#6f7a74` |
| `--glass-fill-base` | `#263e32` | `#474544` |
| `--glass-surface` | `#263e3266` | `#47454466` |
| `--glass-surface-hover` | `#35544099` | `#47454499` |
| `--glass-action-foreground` | `#e4eee7` | `#f2f0ee` |

保持不变：`--primary`（`#77d4ac`）、`--primary-hover`、`--primary-foreground`、`--ring`、状态色前景与边框、`--sport-heading-ink`、`--sport-detail-ink`、`--sport-heading-border`、`--calendar-1..4`、`--chart-series`、`--well-*`、`--glass-edge`、`--glass-sheen`、`--glass-reflection`、`--glass-rim`、`--glass-shadow`、`--glass-tint-sheen`、`--glass-preview-*`。

可读性底线（测试里断言）：`--foreground` 对 `--background` 与 `--surface`、`--muted-foreground` 对 `--surface` 的对比度均 ≥ 4.5；`--primary` 对 `--surface` ≥ 4.5。

## 同时修复：顶部条里的玻璃按钮不再泛绿

`liquid-glass.css` 里 `.sport-theme :is(.app-sidebar, .mobile-bar)` 用 `--sport-sidebar`（旧的绿色侧栏色）给玻璃按钮调色。顶部条改成浅色玻璃条后这条规则还在，所以按钮仍是绿玻璃（浅色下不明显，深色下很明显）。处理：

- 桌面（≥800px，Task 4c 之前是 1024px）`.app-shell .app-sidebar` 内的玻璃按钮改用中性玻璃令牌：`--button-glass-fill: var(--glass-surface)`、`--button-glass-hover: var(--glass-surface-hover)`、`--button-glass-sheen: var(--glass-sheen)`、`--button-glass-fallback: var(--surface)`。浅色下按钮也会随之变成中性白玻璃，这是预期变化。
- 移动栏与移动菜单（<800px）原本保持旧规则（Task 4c 之前），`--sport-sidebar` 在深色下是中性暖灰。**Task 4c 之后已改**：该旧规则整个删除，手机栏与菜单改用 `--surface` 底、`--border` 边、`--foreground` 文字，里面的玻璃按钮与桌面一致走中性玻璃令牌，桌面块里的覆盖随之删除。`--sport-sidebar` 不再给移动栏上色（只剩站点设置预览使用）。
- Logo 方块不能再借用 `--sport-sidebar`：新增 `--sport-brand`（浅色 `#218538`，深色 `#1f5a3a`），用于桌面顶部条的 Logo 底色与公开页顶部导航的 Logo 底色（`app.css` 里原用 `--sport-sidebar` 的两处）。移动栏的 Logo 同样改用 `--sport-brand` 底加白字（Task 4c）。

## 地图本地背景

`lib/api/map-style.ts` 里本地路线地图的深色背景 `#19271f`（偏绿）改为 `#302e2c`（与 `--surface` 同一暖灰族）；路线线条与点的薄荷绿 `#77d4ac` 不变；浅色 `#edf3ef` 不变。外部底图的 `dark` 样式不动。`applyMapTheme` 与 `createRouteMapStyle` 两处一起改，并提取为同一个常量，避免两处不一致。

## 设计系统文档

- `docs/design-system/README.md`：视觉不变量里「绿色系深色外观」改为「暖炭灰深色外观（强调色仍是薄荷绿）」。
- `docs/design-system/tokens.md`：深色列换成新值；`--sport-sidebar` 用途改为「仅站点设置预览（`.preview-side`、`.preview-mark`）；导航（顶部条、手机栏与菜单）已统一走 `--surface` / `--border` / `--foreground`」（Task 4c 之后；原先写的是「移动栏与移动菜单；深色下是中性暖灰」）；新增 `--sport-brand`；说明「深色里数据色不变」。
- `docs/design-system/ui-audit.md` 是历史审计记录，不改。

## 测试

- `frontend/tests/ui/design-system.spec.ts:101`：深色卡片背景 `rgb(27, 41, 34)` 改为 `rgb(51, 49, 47)`。
- 新增断言（放在 `theme.spec.ts` 或 `design-system.spec.ts`，实现时选更贴近的一个）：深色下 `--background`/`--surface` 的 R、G、B 三通道最大差 ≤ 8（保证不带绿调）、对比度底线、顶部条里玻璃按钮的背景不含绿色（G 通道不显著大于 R）。
- 像素基线（`design-system.config.ts`）会变，必须先审阅差异图再更新，不得盲目 `--update-snapshots`。
- 其余 UI 规格里如有写死的深色 `rgb(...)`，按新值更新，保持原意。

## 风险

- 路线海报、活动海报的深色主题共用同一令牌块，导出的海报深色版会一起变；要在两个海报对话框里各看一眼。
- 外部底图的 `dark` 样式是灰黑色，与本地背景 `#302e2c` 切换时可能有轻微色差，接受。
- 站点设置里的「预览」小面板（`.preview-side`）模仿旧绿色侧栏，深色下会变成暖灰；它本来就不是真实导航，本次不改，记入后续事项。

## 验证记录

待实现后补充，要求给出实际执行的命令、结果与截图（浅色不变、深色新配色、顶部条玻璃按钮、移动栏深色、两个海报对话框）。
