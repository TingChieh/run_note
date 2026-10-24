<div align="center">

<img src="docs/assets/hero.png" alt="RunNote" width="100%">

# RunNote

**跑步数据管理与可视化分析系统**
把 GPX / TCX / 小米运动健康的跑步记录，变成日历、趋势、足迹地图和可分享的海报。

[![CI](https://github.com/TingChieh/run_note/actions/workflows/ci.yml/badge.svg)](https://github.com/TingChieh/run_note/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-3-FF3E00?logo=svelte&logoColor=white)
![PostGIS](https://img.shields.io/badge/PostgreSQL-18%20%2B%20PostGIS-336791?logo=postgresql&logoColor=white)

**简体中文** · [English](README.en.md) · [在线站点](https://run.aisaka.cc)

</div>

## 功能

- **多源导入**：GPX、TCX、小米运动健康，支持批量导入；文件哈希与指纹去重，质量问题会给出提示。
- **服务端权威指标**：距离、用时、配速全部由后端计算与聚合，前端只负责呈现，数据口径始终一致。
- **数据汇总**：年度日历、周/月趋势、周/月/年目标、连续记录，一页看完全年的跑步。
- **足迹地图**：全部轨迹叠加、运动热力图、省份点亮；底图来自 OpenFreeMap，失败时自动降级为本地背景，轨迹不会发给任何第三方。
- **常跑路线与足迹墙**：自动归并重复路线；足迹墙以卡片展示每一次跑步。
- **分享海报**：单次跑步与路线墙可生成路线大图、运动海报、跑步票根、大字里程等样式，导出 PNG。
- **自动命名**：按轨迹附近的湖、河、海、公园、操场，把默认标题改成“湖边跑步”等（地物数据取自 OpenStreetMap，全程在本机 PostGIS 内计算）。
- **AI 跑步分析**：基于统计摘要生成总结与下周建议，需主动触发；不会向模型发送坐标、GPX、邮箱或备注，未配置时功能显示为不可用。
- **站主展示 + 受管账号**：访客无需登录即可浏览站主内容；管理员可为其他用户开启 `/p/{username}` 个人展示，注册关闭。
- **深浅色与响应式**：跟随系统，可手动切换；桌面与手机布局一致，Chromium 上启用液态玻璃折射效果。

## 截图

<table>
  <tr>
    <td width="50%"><img src="docs/assets/dashboard-light.png" alt="数据汇总（浅色）"></td>
    <td width="50%"><img src="docs/assets/dashboard-dark.png" alt="数据汇总（深色）"></td>
  </tr>
  <tr>
    <td align="center">数据汇总</td>
    <td align="center">深色模式</td>
  </tr>
  <tr>
    <td><img src="docs/assets/activity-light.png" alt="跑步详情"></td>
    <td><img src="docs/assets/activities-light.png" alt="跑步记录列表"></td>
  </tr>
  <tr>
    <td align="center">跑步详情与路线</td>
    <td align="center">跑步记录</td>
  </tr>
  <tr>
    <td><img src="docs/assets/footprints-light.png" alt="足迹"></td>
    <td><img src="docs/assets/footprints-dark.png" alt="足迹 dark"></td>
  </tr>
  <tr>
    <td align="center">个人足迹</td>
    <td align="center">深色足迹</td>
  </tr>
</table>

<p align="center">
  <img src="docs/assets/poster-sport.png" alt="运动海报" height="380">
  &nbsp;
  <img src="docs/assets/poster-ticket.png" alt="跑步票根" height="380">
  &nbsp;
  <img src="docs/assets/wall-classic.png" alt="足迹墙 · 经典足迹" height="380">
  &nbsp;
  <img src="docs/assets/wall-sport.png" alt="足迹墙 · 运动海报" height="380">
  &nbsp;
  <img src="docs/assets/phone-activity.png" alt="手机端" height="380">
</p>

> 截图使用合成数据生成，不包含真实轨迹或个人信息。

## 在线站点

**<https://run.aisaka.cc>**：站主的真实展示站点，访客无需登录即可浏览数据汇总、跑步记录、足迹与 AI 分析。

## 技术栈与架构

```text
浏览器 ──► Caddy (HTTPS) ─┬─ /api/*  ──► FastAPI (Uvicorn)  ──► PostgreSQL 18 + PostGIS 3.6
                          └─ 其他    ──► SvelteKit (Node)   ──► 同源 /api 代理 ──┘
```

| 层 | 技术 |
| --- | --- |
| 前端 | SvelteKit 3、Svelte 5（runes）、TypeScript、Tailwind 4、MapLibre GL、ECharts |
| 后端 | Python 3.12、FastAPI、Pydantic 2、SQLAlchemy 2（同步）、Alembic、GeoAlchemy2、gpxpy |
| 数据库 | PostgreSQL 18 + PostGIS 3.6，唯一持久化中心 |
| 部署 | 原生安装（systemd + Caddy），**不使用 Docker**；脚本化发布、迁移、备份与恢复演练 |

后端是模块化单体：每个功能模块（activities、footprints、gpx、tcx、mifitness、statistics、ai_reports、sharing、showcase……）按 `router / service / schema / model` 组织，响应统一为 `{data, error, meta.request_id}`。

## 快速开始

环境：macOS 或 Linux、PostgreSQL 18 + PostGIS 3.6、Python 3.12、Node.js 22.17+ 或 24、pnpm 11.25.0。

```bash
# 1. 配置（编辑 .env，填入数据库连接串等）
cp .env.example .env

# 2. 数据库：创建库并启用 PostGIS，然后迁移
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/alembic upgrade head
cd ..

# 3. 初始化站主账号并启动后端（默认 8000）
backend/.venv/bin/python scripts/site-owner.py create   # 离线创建站主账号（SITE_OWNER_EMAIL）
backend/.venv/bin/python scripts/local-auth.py init
backend/.venv/bin/python scripts/local-auth.py serve

# 4. 启动前端（另一终端）
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://127.0.0.1:5173>，管理入口为 `/admin`。完整的本地环境、测试库、生产部署与运维说明见 [`docs/`](docs/)，其中生产部署见 [66 生产部署](docs/66-production-deployment.md)，站主与受管账号见 [55](docs/55-single-owner-showcase.md) / [56](docs/56-admin-users-personal-showcase.md)，早期的详细环境说明保留在 [旧版 README](docs/00-legacy-readme.md)。

## 测试

```bash
# 后端
cd backend && .venv/bin/pytest tests/unit -q && .venv/bin/ruff check app migrations tests

# 前端
cd frontend && pnpm test && pnpm check && pnpm build
```

后端集成测试和 e2e 需要独立的 `_test` PostGIS 测试库，不会触碰开发库；未配置时会被跳过。

## 隐私

- 邮箱、文件名、备注、原始 GPX/TCX 不会出现在公开响应中。
- 轨迹 GeoJSON 始终留在浏览器内，底图只请求公开样式与当前视口瓦片。
- AI 分析只发送统计摘要。

## 文档

设计、验收与运维记录在 [`docs/`](docs/)；UI 规范在 [`docs/design-system/`](docs/design-system/README.md)；给 AI 编码 Agent 的工作指南在 [`AGENTS.md`](AGENTS.md)。

## 许可证

[MIT](LICENSE) © 2026 TingChieh
