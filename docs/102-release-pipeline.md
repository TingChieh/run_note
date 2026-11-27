# 版本管理与自动化发布流水线

本文档说明 RunNote 的统一版本来源、语义化版本（SemVer）规范、Android 单调 `versionCode` 规则、`CHANGELOG.md` 维护要求、GitHub Secrets 签名配置与 `v*` 标签自动发布流水线，以及非 Docker 原生部署的协同流程。

---

## 1. 起始版本决策与依据

在建立本套发布流水线之前，仓库现状审计如下：

- **Git 标签与 GitHub Release**：仓库中**没有任何历史 Git tag 或 GitHub Release**（不补造或伪造旧版本标签与 Release）。
- **既有版本号基线**：
  - `backend/pyproject.toml`、`frontend/package.json`、`android/native/app/build.gradle` 停留在 `2.6.0`（PR #152，commit `0212004`，`versionCode = 20600`）。
  - `android/package.json` 发生漂移，仍停留在 `2.5.0`。
- **`2.6.0` 之后已合入 `main` 的真实变更**：
  - `#155`：修复移动端隐藏底栏页面时的底部安全区适配。
  - `#156`：新增移动端 Bearer Token 认证、`/api/v1/client/capabilities` 能力协商与数据库迁移 `0035_mobile_sessions`。
  - `#157`：新增移动端离线静态包构建（`pnpm build:mobile`）、Android 原生 `RunNoteTransport` 插件、APK 权限白名单审计与 Android CI。
  - `#158`：Web 端 Editorial Receipt Design Phase 1（基础样式与数据汇总页改造）。
  - 本次流水线建设：统一版本源 `VERSION`、预发布 SemVer 支持、`CHANGELOG.md` 与 `v*` 自动发布工作流。

**结论**：下一目标正式版本定为 **`2.7.0`**（Android `versionCode = 20700999`）：

1. `2.6.0`（`20600`）已作为旧版构建基线使用；其后合入多项向后兼容的新功能与一次新迁移，按 SemVer 规则应递增次版本号至 `2.7.0`。
2. `20700999 > 20600`，保证已安装旧版 `2.6.0` APK 的设备在使用同一正式签名证书时可原地覆盖升级。
3. 本次变更**不创建任何 Git tag 或 GitHub Release**；`CHANGELOG.md` 将上述变更保留在 `## [Unreleased]` 中，待维护者配置完成 Secrets 并明确授权后再发布首个正式标签 `v2.7.0`。

---

## 2. 统一版本源与 SemVer 规则

### 2.1 唯一事实源与同步清单

仓库根目录 [`VERSION`](../VERSION) 是 Web、Backend 与 Android 的唯一版本源，由 [`scripts/version.py`](../scripts/version.py) 统一读写与校验：

| 文件 | 角色 | 校验机制 |
| --- | --- | --- |
| `VERSION` | 唯一事实源（单行 SemVer） | `scripts/version.py check` |
| `backend/pyproject.toml` | 后端打包与运行时读取来源（`/api/v1/admin/version`、`/api/v1/client/capabilities`） | `backend/tests/unit/test_version.py` + `scripts/version.py check` |
| `frontend/package.json` | Web 与移动端离线包构建版本（`vite.mobile.config.ts` 注入 `__RUNNOTE_APP_VERSION__`） | `backend/tests/unit/test_version.py` + `scripts/version.py check` |
| `android/package.json` | Capacitor Android 工程包版本 | `backend/tests/unit/test_version.py` + `scripts/version.py check` |
| `android/native/app/build.gradle` | Android `versionName` 与单调 `versionCode` | `ServerUrlPolicyTest.kt` + `test_version.py` + `scripts/version.py check` |

同时 `infra/native/ops/build-release.sh` 会把 `VERSION` 写入原生服务端发布包根目录的 `RELEASE` 文件（`version=<semver>`）。

### 2.2 支持的 SemVer 格式与单调 Android `versionCode`

- **允许格式**：
  - 正式版：`MAJOR.MINOR.PATCH`（例：`2.7.0`、`2.7.1`）
  - 预发布：`MAJOR.MINOR.PATCH-(alpha|beta|rc).N`（例：`2.8.0-alpha.1`、`2.8.0-beta.2`、`2.8.0-rc.1`）
- **数值边界**（确保不超过 Android / Google Play `2,100,000,000` 上限）：
  - `0 <= MAJOR <= 209`、`0 <= MINOR <= 99`、`0 <= PATCH <= 99`、`1 <= N <= 99`（不允许前导零与 `.0`）。
- **单调递增 `versionCode` 公式**：

```text
versionCode = MAJOR * 10_000_000 + MINOR * 100_000 + PATCH * 1_000 + STAGE_CODE

STAGE_CODE:
  alpha.N -> 100 + N  (101..199)
  beta.N  -> 200 + N  (201..299)
  rc.N    -> 300 + N  (301..399)
  final   -> 999
```

典型升级链路（严格单调递增，覆盖历史 `20600`）：

| SemVer | Android `versionName` | Android `versionCode` | GitHub Release 类型 |
| --- | --- | --- | --- |
| `2.6.0`（历史旧规则） | `2.6.0` | `20600` | （未建 Release） |
| `2.7.0-alpha.1` | `2.7.0-alpha.1` | `20700101` | Prerelease |
| `2.7.0-beta.1` | `2.7.0-beta.1` | `20700201` | Prerelease |
| `2.7.0-rc.1` | `2.7.0-rc.1` | `20700301` | Prerelease |
| `2.7.0` | `2.7.0` | `20700999` | Latest Release |
| `2.7.1-rc.1` | `2.7.1-rc.1` | `20701301` | Prerelease |
| `2.7.1` | `2.7.1` | `20701999` | Latest Release |

### 2.3 常用版本命令

```bash
python3 scripts/version.py show                    # 查看当前版本、tag、versionCode 与 APK 文件名
python3 scripts/version.py check                   # 漂移检查（任意一处不一致或低于 MIN_MOBILE_APP_VERSION 即退出 1）
python3 scripts/version.py sync                    # 按根目录 VERSION 同步其余 4 处声明
python3 scripts/version.py set 2.8.0-rc.1          # 设置指定版本并同步全部文件
python3 scripts/version.py bump patch              # 2.7.0 -> 2.7.1
python3 scripts/version.py bump minor              # 2.7.0 -> 2.8.0
python3 scripts/version.py bump alpha --base 2.8.0 # 2.7.0 -> 2.8.0-alpha.1
python3 scripts/version.py bump rc                 # 2.8.0-alpha.1 -> 2.8.0-rc.1
python3 scripts/version.py bump final              # 2.8.0-rc.1 -> 2.8.0
python3 scripts/version.py validate-tag v2.7.0     # 发布前本地校验 tag + VERSION + CHANGELOG.md
```

---

## 3. 发布治理原则（强制）

1. **日常开发永不自动发布正式版本**：普通分支推送与 PR 合入只运行 `.github/workflows/ci.yml` 检查，绝不会创建 Git tag 或 GitHub Release。
2. **创建正式标签与发布必须由维护者显式授权**：AI Agent 与自动化脚本不得擅自执行 `git tag`、推送 `v*` 标签或创建 GitHub Release。
3. **已发布版本与产物不可覆盖**：不得删除重推已发布的 `v*` 标签，也不得覆盖已发布的 GitHub Release 或 APK 资产；任何发布后问题必须通过**新的补丁版本（如 `2.7.1`）**修复。`.github/workflows/release.yml` 在 `validate` 与 `publish-release` 两个阶段均会检测目标标签是否已存在 Release 并拒绝覆盖。
4. **失败即阻断，禁止半成品正式发布**：`release.yml` 只有在全部校验（tag/版本/CHANGELOG/分支祖先）、后端/前端/运维/Android 质量门禁、签名构建、`aapt2` 元数据核对、最小权限审计、`apksigner verify` 与 `sha256sum -c` 全部通过后，才会先创建 `--draft` Release 上传全部资产，校验资产完整非空后再切换为正式发布（`--draft=false`）。
5. **保持非 Docker 原生部署架构**：Web 与后端生产部署继续沿用 `infra/native/ops/ship.py` + `build-release.sh` + systemd + Caddy + 原生 PostgreSQL/PostGIS（详见 [`docs/66-production-deployment.md`](66-production-deployment.md)），不引入 Docker 或额外包注册中心。

---

## 4. 维护者一次性手动配置指南（签名 / Secrets / 权限）

> **安全红线**：绝不将 `.jks` / `.keystore` / `.p12` / `keystore.properties` / base64 文本提交进仓库或贴入 PR/日志。根目录 `.gitignore` 与 `android/.gitignore` 已阻断相关文件模式，仍需妥善离线备份正式 Keystore。

### 4.1 准备稳定复用的 Android Release Keystore

如果尚未拥有正式签名密钥（若此前已为 `com.tingchieh.runnote` 生成过正式 keystore，**必须继续复用同一 keystore**，否则已安装设备无法覆盖升级）：

```bash
mkdir -p "$HOME/.local/share/runnote-android/keystore"
chmod 700 "$HOME/.local/share/runnote-android/keystore"

keytool -genkeypair -v \
  -keystore "$HOME/.local/share/runnote-android/keystore/runnote-release.jks" \
  -storetype PKCS12 \
  -alias runnote \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -dname "CN=RunNote, OU=Mobile, O=RunNote, C=CN"

chmod 600 "$HOME/.local/share/runnote-android/keystore/runnote-release.jks"
```

记录证书指纹（用于日后核对 APK 签名，不含私钥，可安全归档）：

```bash
keytool -list -v \
  -keystore "$HOME/.local/share/runnote-android/keystore/runnote-release.jks" \
  -alias runnote | grep -E "Alias name:|SHA256:"
```

生成单行 Base64（直接写入剪贴板或临时受限文件，完成后删除临时文件，勿留在仓库目录）：

```bash
# Linux
base64 -w 0 "$HOME/.local/share/runnote-android/keystore/runnote-release.jks"
# macOS
base64 -i "$HOME/.local/share/runnote-android/keystore/runnote-release.jks" | tr -d '\n'
```

请将 `runnote-release.jks` 与对应口令加密备份到密码管理器和至少一处离线加密介质；一旦丢失，现有设备无法在不卸载的情况下升级。

### 4.2 配置 GitHub Repository Secrets

在 GitHub 仓库页面打开 **Settings → Secrets and variables → Actions → Repository secrets**，新增以下 5 项 Secrets：

| Secret 名称 | 必填 | 说明 |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 是 | 上一步生成的 `runnote-release.jks` Base64 字符串 |
| `ANDROID_KEYSTORE_PASSWORD` | 是 | Keystore 存储口令（`storePassword`） |
| `ANDROID_KEY_ALIAS` | 是 | 签名密钥别名（如 `runnote`） |
| `ANDROID_KEY_PASSWORD` | 是 | 密钥口令（`keyPassword`；PKCS12 通常与存储口令相同） |
| `ANDROID_RELEASE_SERVER_URL` | 是 | Android Release APK 绑定的生产服务 HTTPS 地址（如 `https://your-runnote-domain.example`，不含尾部 `/`、不得为 `http://` 或环回地址；使用 Secret 避免在公开仓库暴露个人域名） |

### 4.3 GitHub Actions 权限与标签保护建议

1. **Workflow 权限**：无需手动创建 PAT。`.github/workflows/release.yml` 顶层声明 `permissions: contents: read`，仅最后一个 `publish-release` 作业使用内置 `GITHUB_TOKEN` 的 `permissions: contents: write` 发布 Release。
   - 在 **Settings → Actions → General → Workflow permissions** 保持默认的 `Read repository contents and packages permissions` 即可（workflow 内的显式 `permissions` 会按需授予 `publish-release` 写权限；若组织策略禁用 workflow 提升权限，则需改为允许 Actions 写入 contents）。
2. **标签保护规则（强烈推荐）**：在 **Settings → Rules → Rulesets** 为 `refs/tags/v*` 添加规则，仅允许仓库维护者创建 `v*` 标签，并禁止删除或强推已存在的 `v*` 标签，从平台层加固“不可覆盖已发布版本”。

---

## 5. 发布前检查清单（Pre-Release Checklist）

维护者在授权创建 `vX.Y.Z`（或预发布 `vX.Y.Z-rc.N`）前，逐项确认：

- [ ] **版本号一致**：`python3 scripts/version.py check` 通过，`VERSION`、`backend/pyproject.toml`、`frontend/package.json`、`android/package.json`、`android/native/app/build.gradle`（`versionName` 与 `versionCode`）完全一致。
- [ ] **CHANGELOG 就绪**：`CHANGELOG.md` 已将 `## [Unreleased]` 中本次发布内容移入精确格式标题 `## [X.Y.Z] - YYYY-MM-DD`，覆盖 `Added / Changed / Fixed / Breaking / Upgrade notes`（无空节、无占位符），并保留空的 `## [Unreleased]` 供后续开发使用。
- [ ] **本地标签校验通过**：`python3 scripts/version.py validate-tag vX.Y.Z` 返回 `OK`。
- [ ] **测试与门禁全绿**：目标提交在 `main` 上 `.github/workflows/ci.yml` 全部通过（后端 unit+integration、前端 unit/check/build/UI、Android unit/debug APK/权限审计、infra 演练）。
- [ ] **数据库迁移兼容性**：核对 `backend/migrations/versions/` 是否存在新迁移；确认 `alembic heads` 唯一且降级保护完整；若有新迁移，上线命令必须使用 `--migrate` 并提前完成备份与恢复演练。
- [ ] **API 与客户端兼容性**：确认 `backend/.venv/bin/python -m app.contract.typescript --check` 与 `frontend` 契约检查通过；核对 `backend/app/modules/mobile_auth/service.py` 中的 `MOBILE_API_VERSION`、`MIN_MOBILE_APP_VERSION` 与 `CAPABILITY_FEATURES` 是否需调整；新版本服务需兼容已发布客户端或在 Upgrade notes 中明示最低版本要求。
- [ ] **配置兼容性**：核对 `.env.example` 与 `infra/native/env/*.env.example`、`backend/app/core/config.py` 是否新增必填环境变量，如有新增须先更新生产 `/etc/run-note-production/*.env` 再切换发布。
- [ ] **产物与签名配置**：确认 5 项 GitHub Secrets 已配置且指向正确的稳定生产 keystore 与生产 HTTPS 域名；确认目标标签 `vX.Y.Z` 尚未存在对应 tag 或 GitHub Release。

---

## 6. 标准发布操作步骤

### 6.1 准备发布提交（合入 `main`）

1. 在发布准备分支上确定目标版本（如 `2.7.0`），确保 `VERSION` 与各端清单已同步：
   ```bash
   python3 scripts/version.py set 2.7.0
   ```
2. 编辑 `CHANGELOG.md`：将 `## [Unreleased]` 下属于本次发布的内容移至 `## [2.7.0] - YYYY-MM-DD`，并保留新的空 `## [Unreleased]` 节。
3. 本地预检：
   ```bash
   python3 scripts/version.py validate-tag v2.7.0
   python3 scripts/verify.py
   ```
4. 开 PR 合入 `main`，等待 `main` 上 `.github/workflows/ci.yml` 全绿。

### 6.2 可选：发布前 Dry-Run 演练（不创建 Release）

在 GitHub Actions → **Release** → **Run workflow** 中填入 `tag = v2.7.0` 触发一次 `workflow_dispatch`：
- 该模式会执行 `validate`、全部 4 个质量门禁与 `android-release` 构建校验（若尚未配置 Secrets 会使用临时一次性测试证书演练）；
- `publish-release` 作业会被跳过，**绝不创建任何 GitHub Release**。

### 6.3 维护者授权后创建并推送 `v*` 标签

确认 `main` 处于目标提交且 CI 全绿后，由维护者手动创建附注标签并推送：

```bash
git checkout main
git pull --ff-only origin main
python3 scripts/version.py validate-tag v2.7.0

git tag -a v2.7.0 -m "Release v2.7.0"
git push origin v2.7.0
```

### 6.4 跟踪工作流与验收产物

1. 在 GitHub Actions 观察 **Release** 工作流完成：
   `validate` → (`gate-backend` / `gate-frontend` / `gate-infra-and-server-bundle` / `gate-android-unit`) → `android-release` → `publish-release`。
2. 在 GitHub Releases 页面核对已发布版本 `RunNote v2.7.0`：
   - 预发布标签自动标记为 **Pre-release**，正式版自动标记为 **Latest**；
   - Release 正文与 `CHANGELOG.md` 对应章节一致；
   - 附件包含：
     - `runnote-android-v2.7.0-vc20700999.apk`
     - `runnote-android-v2.7.0-vc20700999.apk.sha256`
3. 下载后本地校验校验和与签名：
   ```bash
   sha256sum -c runnote-android-v2.7.0-vc20700999.apk.sha256
   apksigner verify --verbose --print-certs runnote-android-v2.7.0-vc20700999.apk
   ```

### 6.5 部署 Web 与后端（非 Docker 原生部署）

GitHub Release 发布完成后，服务端仍按 [`docs/66-production-deployment.md`](66-production-deployment.md) 的受控原生部署流程升级（先备份与恢复演练，含新迁移时显式传 `--migrate`）：

```bash
infra/native/ops/ship.py --dry-run
# 确认无误并获授权后执行（本版本含 0035_mobile_sessions 迁移时加 --migrate）：
infra/native/ops/ship.py --migrate
```

上线后在站点「设置 → 站点设置」核对版本信息卡片显示 `v2.7.0` 及对应构建提交号。

---

## 7. 验证记录与未验证项

详见本 PR 的交付说明与 CI 运行结果。需要特别强调：

- **本地/PR 可验证**：统一版本脚本、漂移测试、SemVer 预发布前后端解析与比较、原生服务端发布包构建与自包含检查、workflow 静态语法/结构校验、本地一次性测试 keystore 生成。
- **须维护者配置 Secrets 后才能在真实环境验证**：使用真实生产 GitHub Secrets 的签名构建，以及由真实 `v*` 标签触发并实际发布 GitHub Release 的完整端到端链路。
