# 个人足迹全量快照实施计划

**目标：** 全量轨迹与热图读取持久化快照，导入后自动更新并安全替换旧整合结果。

**设计：** 采用已确认的 `2026-10-15-footprints-all-records-snapshot-design.md`。单活动缓存复用空间算法，用户级快照两模式原子发布；60 秒扫描、24 小时刷新。前后端以以下契约独立实施，最终联合验证。

**约束：** 不提交或推送、不迁移开发库、不读密钥、不修改既有未提交工作的业务含义。原生 PostgreSQL，仅合成 `_test` 数据。沿用同步服务与线程卸载、当前用户隔离、活动版本号。无需新依赖。

## 接口契约

`GET /api/v1/footprints/all?mode=tracks|heatmap` 返回既有信封，data 为：

```json
{"status":"ready","generated_at":"2026-10-15T00:00:00Z","refreshing":false,"refresh_failed":false,"result":{"scope":"all","type":"FeatureCollection","mode":"tracks","features":[],"activity_count":0,"visible_activity_count":0,"unsupported_segment_count":0,"grid_size_m":100,"grid_crs":"EPSG:3857","count_basis":"distinct_activity_per_cell","max_count":0}}
```

`status` 为 pending/ready/failed；非 ready 的 result 为 null；从未成功的 generated_at 为 null。ready 可附 refreshing=true 表示不改变源版本的定期重建中；失败后的同版本成功结果可以继续 ready。`refresh_failed` 表示定期刷新失败但仍有源版本一致的有效结果。新 collection 没有 date_from/date_to。未知查询参数 422，匿名 401。

## 任务 1：后端派生与读取

- [x] 先新增单元测试，确认全量接口不存在、状态/版本逻辑尚未实现而失败。
- [x] 新建 `footprints/model.py`、`schema.py`、`snapshot.py`、`worker.py` 及 `0010_footprint_snapshots.py`；注册模型并将后台任务接入 `main.py` lifespan。
- [x] 在 `snapshot.py` 复用 `service.py` 既有空间 SQL，仅将日期条件替换为本人单活动条件；原服务无需修改，新单活动计算不沿用账户总点数限制。
- [x] 实现版本核对、单活动缓存、持久失败/重试、用户任务锁、短锁原子发布、级联清理和退出流程。GET 仅读取。
- [x] 测试模型归属、响应状态、超时失败、任务周期；运行 unit 与 Ruff。

## 任务 2：前端全量展示

- [x] 为 `lib/api/footprints.ts` 的全量解析、读取及页面生成状态补失败测试。
- [x] 修改足迹页面，去除日期筛选、保留 mode URL，显示全部记录/生成时间；pending 5 秒轮询，停止与卸载清理，401 清空数据跳转。
- [x] `FootprintMap.svelte` 保留交互与主题，只扩展必要数据类型；原日期查询辅助函数继续兼容现有调用者。
- [x] 合成 API 和足迹 UI 测试同步适配，验证跨年不筛选、两模式、状态、重试、401、键盘与小屏。
- [x] 执行相关 Vitest、Chrome UI、`pnpm check` 和 `pnpm build`。

## 任务 3：联合数据库、空间与性能回归

- [x] 原生独立实例或明确现有 `_test` 目标，注入测试 DSN 与允许目标，不改 `.env`。
- [x] 更新既有动态 head 校验；迁移仅独立 `_test` 数据库。
- [x] 新建 `test_footprint_snapshots.py`：匿名/双用户、跨年、导入/编辑/单条及批量删除、旧快照不返回、空集合、级联、周期刷新/旧版替换、版本竞态、重复 worker 与失败恢复。
- [x] 与既有实时空间结果对照；合成超过 25 万个几何顶点（未创建等量原始点行），测量快照读取 SQL 数量和重复读取无空间计算，新增活动仅补自己的缓存。
- [x] 运行原足迹、导入与迁移回归；记录通过/失败/跳过，隔离实例用后停止。

## 任务 4：审查与交付

- [x] 审查并修复正确性、并发、隐私、后台生命周期及既有脏文件保护。
- [x] 更新设计状态，按 docs 现场最大编号新增中文特性记录，记录使用方式、接口与隐私、真实验证结果及未验证边界。
- [x] 最终检查类型、构建、Ruff、diff；与基线核对非任务文件未被覆盖。未授权开发迁移与服务验收明确保留为未运行。

## 完成记录

代码与验证已完成，详见 `docs/46-footprints-all-records-snapshots.md`。另按实施中追加请求将 AI 页统一为已有日期选择器，见 `docs/47-ai-shared-date-picker.md`。未执行开发库迁移、开发后端重启或 Git 提交。
