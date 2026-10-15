# 全站 Liquid Glass 按钮实施计划

依据用户明确要求的全站按钮效果及指定开源项目，在当前工作区最小修改；保留已有未提交工作，不提交、不启动开发后端、不操作数据库。

- [x] 固定并本地保存用户指定仓库的核心引擎及 MIT 许可证，附来源、提交、哈希和浏览器限制；不引入运行时 CDN。
- [x] 在 `frontend/src/lib/styles/liquid-glass.ts` 新增客户端 Svelte action，保留原生按钮，为动态编辑/删除弹窗接入背景折射，并释放移除元素/组件的实例；支持减少透明度与强制颜色回退。
- [x] 在 `frontend/src/app.css` 的全站令牌与 `lib/styles/liquid-glass.css` 中提供材质、语义填色、状态与兼容回退；保留日历数据底色、地图图标及选中标记。
- [x] `+layout.svelte` 接入 action；在 `ActivityExplorer.svelte` 移除重复圆形按钮材质，保留尺寸、居中、边框定位和行为。
- [x] 新增真实 Chrome 引擎生命周期用例；已确认旧 CSS 版本缺少折射时失败，接入后验证原生键盘提交、动态按钮创建/销毁、强制颜色切换及日历轻量材质。
- [x] 修正现有主题测试的颜色解析，使用浏览器 canvas 解码 CSS4 颜色并合成祖先透明底色。
- [x] 执行 `pnpm check`、`pnpm build` 与覆盖全部 `tests/ui/*.spec.ts` 的合成 Chrome 回归；实际 94 项通过。
- [x] 临时真实 Chrome 检查主按钮、删除按钮、文件选择、地图控件和日期，复核深浅色、320/390/1440px 布局与箭头居中；条纹对照确认折射实际生效。
- [x] 更新 `docs/35-liquid-glass-buttons.md`，记录文件职责、真实通过项、未运行项及兼容限制；`git diff --check` 通过。
