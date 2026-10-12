# S2-03 本地认证验收

日期：2026-10-12。本轮止于 S2-03；认证前端仅提前接入必要部分，不代表 S2-07 整体完成。

## 配置与服务

- 只读确认开发库 `127.0.0.1:5432/running_note`、独立库 `running_note_phase_one_test` 均在 `0003_gpx_storage`。无迁移、DDL、清空、删除或重建数据库；浏览器仅新增随机合成用户/会话，过期注入仅修改自身测试会话的 expires_at。测试数据保留。
- 密钥用途：限流邮箱/IP标识的 HMAC-SHA256，SecretStr，UTF-8至少32字节，无强制hex/base64格式；不是密码或会话签名密钥。缺失时认证503，health不受影响。
- `scripts/local-auth.py` 首次创建独立 `.env.auth-rate.key`：48随机字节URL-safe编码（64字符）、权限600、Git忽略；检查文件类型/属主/权限，复用已有密钥，显式进程环境值优先。不打印密钥、不覆盖 `.env`、不迁移。跨worker/重启保持一致；轮换影响旧限流桶，不以轮换绕过配额。
- 原始 `.env` SHA-256：`2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab`。
- 首次监听检查无8000/5173。工作期间外部终端启动现有RunNote：8000（Uvicorn reload父进程23006）、5173（Vite23050）。核实工作目录、ready200、认证503后保留，未向其发送停止/重启命令。
- 本轮可用开发实例：API8001 / Vite5183，精确 `SITE_ORIGIN=http://127.0.0.1:5183`，开发库；启动方法见README。开发库本轮注册限流桶9次尝试，含重复邮箱，限制每IP每小时10次，未重置。
- 最终构建验收：API8002 / Node5184，现有独立测试库、同一本地密钥、精确5184来源。测试进程也通过环境提供该独立库DSN，过期注入触及其自身会话。验收后停止8002/5184；保留8001/5183供使用。

## 已实现

- `/register`、`/login` 调用既有FastAPI接口；注册即登录，成功后整页加载新身份。next仅允许安全站内路径。
- 头部展示登录身份/退出；`/settings`展示本人白名单资料。资料编辑、修改密码前端不在本轮范围，后端相关契约仍有集成测试。
- 请求级SSR `locals` 查询Cookie身份；保护 `/activities`、`/dashboard`、`/settings` 含子路径/data请求，匿名303登录、依赖故障503；页面/load no-store并Vary:Cookie。活动/统计业务仍为占位。
- dev和Node构建共用SvelteKit同源代理，固定内部目标，保留Cookie/Origin/Referer/CSRF/Set-Cookie；不伪造来源或信任客户端转发IP。凭据same-origin、no-store；每次写取当前CSRF，无全局Token缓存、不自动重试写请求。
- 密码/资料/凭据不写localStorage。表单明确POST、水合前按钮禁用、无JS提示，避免默认GET把输入带入URL。首次浏览器测试发现并修复此问题，测试输入仅为合成数据。
- 身份变更整页导航；BroadcastChannel仅传复核信号，不传Token或资料。焦点、页面恢复、可见性和60秒轮询复核；期间隐藏私人内容，依赖故障保持隐藏。busy保护当前标签退出导航。
- 独立审查发现旧身份响应延迟时丢跨标签事件的P1；真实Chrome失败测试复现后修复：pending排队复核，过时响应不能解除隐藏，disposed防止卸载后重跑。独立复核无遗留P1/P2。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 后端unit + auth integration | **92 passed**，4.86s，64单元+28真实DB认证，0 skip；独立库，显式无迁移模式仅只读确认0003 |
| Ruff check / format --check | All checks passed；51 files already formatted |
| 前端pnpm test | **10 passed**，health5+auth5；覆盖凭据/CSRF、失败不重试、401/503区分、429等待、坏响应、next |
| 前端pnpm check | **0 errors / 0 warnings** |
| 前端pnpm build | adapter-node成功；仅既有NO_COLOR/FORCE_COLOR提示 |
| 开发库Chrome联调 | 注册、登录、刷新、退出、重复邮箱/错密码、Cookie/CSRF/Origin、真实过期通过；跨标签初步修复单项通过 |
| 最终Node构建Chrome全套 | **7 passed**，4.3s；真实注册/登录/刷新/退出及错误、匿名SSR保护、双用户/双上下文/SSR、跨标签延迟旧响应、真实会话过期、无JS安全、健康及故障展示 |
| 独立只读审查 | 发现P1后修复，复核无新增P1/P2 |
| 最终配置/数据库复核 | `.env` SHA-256与原始值一致；密钥文件权限600且Git忽略；开发/测试库版本仍为0003，用户数分别8/53，合成数据未清理 |
| 最终运行复核 | 5183登录页200、8001 ready200、匿名session401（认证已启用）；lsof确认8002/5184无监听，原8000/5173及本轮8001/5183保留 |

本轮没有重跑历史130项后端全量：另38项DB/迁移测试的fixtures会调用迁移，与本轮约束冲突；历史130通过不能写成新鲜全量回归。认证fixture新增 `RUNNOTE_TEST_NO_MIGRATIONS=1`，默认行为保留，独立目标安全守卫仍生效。

后端本轮可复现命令（backend目录，不打印DSN）：

```bash
.venv/bin/python - <<'PY'
import os, subprocess
from app.core.config import Settings
from sqlalchemy.engine import make_url
url = make_url(Settings().database_url).set(database='running_note_phase_one_test')
env = {**os.environ,
       'TEST_DATABASE_URL': url.render_as_string(hide_password=False),
       'TEST_DATABASE_ALLOWED_TARGETS': f'{url.host}:{url.port or 5432}/{url.database}',
       'RUNNOTE_TEST_NO_MIGRATIONS': '1'}
raise SystemExit(subprocess.run(['.venv/bin/pytest', 'tests/unit',
    'tests/integration/test_auth.py', '-q', '--tb=short'], env=env).returncode)
PY
```

开发浏览器命令（真实限流、合成数据会保留；配额不足勿反复执行）：

```bash
INTERNAL_API_BASE_URL=http://127.0.0.1:8001 RUNNOTE_E2E_BASE_URL=http://127.0.0.1:5183 PLAYWRIGHT_CHANNEL=chrome pnpm --dir frontend test:e2e
```

最终7项实际针对5184 Node产物和8002独立测试库API，而非上面开发命令。临时测试实例显式独立目标、已有schema，未启动临时数据库或迁移。

## 关闭与未验证

**S2-03可正式关闭：后端契约与本地浏览器可用性PASS。** 未验证HTTPS生产Cookie、真实反向代理、Linux/systemd/Caddy、远程CI、生产负载、Safari/Firefox及等待真实7日绝对/24小时闲置期限。期限/撤销边界由后端可控时钟测试覆盖；浏览器真实过期通过自身会话expires_at注入，不冒称真实等待了期限。

限流桶后台清理仍未实现。未来私人活动/统计业务未实现，隔离证据限于当前资料、会话、SSR和页面状态，不代表未来业务已验收。无Docker、自动提交或推送，保留已有未提交工作；停止本轮，不开始下一阶段。
