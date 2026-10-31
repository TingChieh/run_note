# 按官方 lg-button 修正按钮与照片预览

## 使用方式

普通操作按钮采用官方参考中的胶囊轮廓、独立玻璃 / 染色 / 阴影层及弹簧按压。按下时只有装饰玻璃左右各扩 5px、上下各缩 2px，文字、图标、点击范围和页面布局不缩放。地图工具、日历日期和运动卡片继续保留专用形状；相邻分段组共用轻阴影。

开发前端右下角的“玻璃调节”可查看普通、染色、浅色三个按钮及照片折射。用户提供的照片替换了条纹底纹：原 PNG 为 5564×3709、34,850,221 字节，以 `cwebp -q 78 -m 6 -metadata none -resize 1200 0` 压缩成 1200×800 WebP、123,328 字节（约 123 KB，减少约 99.65%），原大图未复制入仓库。压缩资产在 `frontend/src/lib/assets/glass-debug-background.webp`，仅由开发调节组件导入。

当前默认透明度 88%、折射 14px、光学模糊 2px、高光 0.7。旧的本地预览偏好会保留，点击“恢复默认”使用新默认值。系统减少动态效果时关闭挤压；减少透明度 / 强制颜色优先，玻璃装饰被清理，使用原生实色与焦点。

## 来源、差异与实现

现场查阅 [官网文档](https://liquidglass.dev/docs/)、官网 `lib/components.js` 和 [GitHub 固定提交](https://github.com/gentpan/liquidglass/blob/068ad226f53e1ca62d857f78bdc32f58f3c5fce7/lib/components.js)。官网与固定提交的文件逐字节一致，SHA-256 为 `968d5372ad45bf4b2e70afe42144c23ed60f97d4d365f8df14be3ec86ab195ff`。`LgButton`、`Surface` 和 `pressSpring` 确认了分层、12px 扩展空间、stiffness 600 / damping 36 的弹簧与三种染色方式。

此前只接入核心引擎并在按钮自身叠加渐变 / 阴影，缺少完整的组件结构与按压反馈。当前按官方结构为现有原生按钮做适配，没有注册或直接替换为 `<lg-button>`，以保留 Svelte 事件、表单提交与键盘语义。

| 文件 | 作用 |
| --- | --- |
| `frontend/src/lib/styles/liquid-glass.ts` | 独立装饰层、官方弹簧与几何、明确标记的预览背景副本、观察器与销毁清理 |
| `frontend/src/lib/styles/liquid-glass.css` / `frontend/src/app.css` | 胶囊、染色、轻阴影及浅色语义令牌，移除宿主重复滤镜 / 渐变 |
| `frontend/src/lib/styles/liquid-glass-settings.ts` | 新默认值，沿用现有范围和开发存储契约 |
| `frontend/src/lib/components/LiquidGlassTuner.svelte` | 用户压缩照片、三种材质与原有滑块 / 预设 |
| `frontend/src/lib/vendor/liquidglass/liquid-glass.d.ts` / `README.md` | 补充真实使用的几何 / spring 类型及组件源代码归属 |
| `frontend/tests/ui/liquid-glass.spec.ts` | 原生点击范围、鼠标 / 键盘按压、减少动态效果、背景副本、兼容回退及既有生命周期验证 |

扩展装饰在视口边缘按可用空间裁剪，避免贴边箭头的 12px 装饰撑宽手机页面。背景副本与文字分离，按钮标签和图标节点不移动；移除按钮、关闭面板、卸载页面时清理滤镜、弹簧、事件和背景观察计数。

## 接口与隐私

没有新增接口、数据库字段、运行时 CDN 或外部上传；没有复制私人 DOM、运动坐标、轨迹、地图或真实账户资料。仅开发预览中显式标记的本地照片 CSS 背景生成装饰副本。照片不带原图元数据。

普通页面任意背景仍采用 Chrome 背景折射；Safari / Firefox 使用官方 16px 磨砂回退，加上滑块的光学模糊增量。照片预览采用官方背景副本 / 内容滤镜方式，可跨引擎折射，但本轮没有 Safari / Firefox 实机结果。上游核心 JS 保持原 SHA-256 `92a62e5b80cfa7e03912b13bdc53aff1c0ae367a5f296de1327e0f62f0579210`，遵守现有 MIT 许可。

生产构建不加载开发调节组件或照片；当前 59 个生产 JS / CSS 文件均无面板文案、开发存储键或照片引用，输出中无照片 WebP。

## 验证记录

2026-10-15，Node 22，真实 Chrome + 合成 API 8191 / 隔离 Vite 5191。

- 新按压用例首先因缺少独立装饰层失败；实现后验证装饰宽度增长、恢复、点击范围固定及鼠标 / Space 操作。
- 独立代码审查发现零光学模糊会让非 Blink 回退也成为 `blur(0px)`；新增分支用例先复现失败，修正为官方 16px 基准，并验证调节后为 24px。该用例在 Chrome 中模拟引擎识别分支，不等于真实 Firefox 验收。
- `pnpm check`：0 errors / 0 warnings。
- `pnpm exec vitest run tests/unit/liquid-glass-settings.test.ts`：1 个文件、2 项通过。
- `pnpm build`：成功，保留既有大 chunk 警告。
- 初步相关 UI：32 passed（41.0s）；随后完整合成 UI：97 passed（1.8m）。
- 修正审查指出的兼容回退后，`pnpm exec playwright test -c .cache/liquid-glass-ui.config.ts --reporter=dot`：最终 98 passed（1.9m），包含新增兼容分支验证；合成服务已随测试结束关闭。
- 最终照片截图复核：浅深色，1440 / 390 / 320px，页面与面板均无横向溢出，照片副本与原图对齐；截图在忽略目录 `frontend/.cache/photo-preview-final-*.png`。

未运行真实后端 / 数据库 e2e，未启动或重启开发后端，未改 `.env`、数据库、认证和业务接口，未提交、推送或部署。
