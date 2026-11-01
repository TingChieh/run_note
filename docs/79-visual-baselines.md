# 关键页面视觉回归基线

## 使用方式

`frontend/tests/ui/visual-baseline.spec.ts` 覆盖数据汇总和身心健康日记各自的浅色、深色及桌面、390px 手机视图，共八张全页截图。使用合成 API、固定日期和时区；禁用动画、减少动态效果并隐藏光标，遮罩 canvas 和 MapLibre 地图。像素差异比例容限为 0.2%，遮罩区域不验证地图与图表内容。该测试使用与现有 UI 套件相同的 Chrome 通道；日记为空记录，数据汇总使用合成数据，不涉及真实账号或数据库。

常规检查在 `frontend/` 运行：

```bash
pnpm exec playwright test visual-baseline.spec.ts --config playwright.ui.config.ts --reporter=list
```

CI 的 `frontend-ui` 任务运行该 spec；失败时 `playwright-ui-results` artifact 包含 `test-results` 中的预期图、实际图和差异图。基线路径为 `frontend/tests/ui/__screenshots__/visual-baseline.spec.ts/`，文件名不含操作系统，正式基线以 Ubuntu 24.04 CI 环境的截图为准。Chrome、系统字体、渲染环境升级也可能造成差异，应核对内容后更新，不要机械接受。

## 更新流程

1. 在 GitHub Actions 手动运行 **Update visual baselines**，选择含待审代码的分支。它与 UI CI 使用相同的 Ubuntu 24.04、Node 22、pnpm、系统 Chrome 和 Noto CJK 字体，使用 `--update-snapshots` 生成图片，不推送代码。
2. 下载 `visual-baselines-linux` artifact，将其中八张 PNG 复制到上述基线目录。逐张对照旧图、实际页面与变更意图，检查主题和手机布局；确认无意外后将图片随代码变更提交评审。
3. 重新运行 UI CI，确认使用新基线的检查通过。失败时查看对比 artifact；更新工作流失败时也会上传 `visual-baseline-results`。

本地可用上述命令加 `--update-snapshots` 调试，但不同 Linux 发行版、Chrome 和字体版本的渲染可能不同。本次仓库内初始 PNG 在 Debian Linux 生成，尚需手动工作流产物替换并经 CI 验证。
