# Liquid Glass 核心引擎

- 来源：https://github.com/gentpan/liquidglass
- 文档：https://liquidglass.dev/docs/
- 版本：源码标识 v1.0.0
- 固定提交：`068ad226f53e1ca62d857f78bdc32f58f3c5fce7`
- 原始文件：`lib/liquid-glass.js`，完整保留，未修改。
- SHA-256：`92a62e5b80cfa7e03912b13bdc53aff1c0ae367a5f296de1327e0f62f0579210`
- 许可：同目录 `LICENSE`（MIT，Copyright 2026 gentpan）。

采用零依赖核心模块，不注册自定义元素组件或加载示例图片。
`src/lib/styles/liquid-glass.ts` 参照同一提交 `lib/components.js` 的
`Surface` / `LgButton` / `pressSpring`，为已有原生控件适配独立玻璃、染色、阴影层与按压几何。
官方组件源码 SHA-256：`968d5372ad45bf4b2e70afe42144c23ed60f97d4d365f8df14be3ec86ab195ff`；
该适配同样遵循所附 MIT 许可，未改写上游核心引擎。
`liquid-glass.d.ts` 是 RunNote 对实际使用 API 的类型声明。
上层 Svelte action 客户端动态导入，SSR 不执行浏览器代码。
普通控件模式为 `backdrop`：Chrome 支持真实背景折射，其他引擎使用官方磨砂回退。
开发预览明确标记的 CSS 底纹采用本地背景副本模式，可在各引擎折射；不复制私人 DOM、地图或轨迹。
源码审查：只创建本地 canvas PNG / SVG 滤镜，没有 fetch 或额外网络请求。
运行时无 CDN 依赖，不向第三方发送运动数据。
