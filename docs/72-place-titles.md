# 72 按附近地物自动命名跑步

日期：2026-10-24。设计与计划见 `docs/superpowers/specs/2026-10-23-place-titles-design.md` 与 `docs/superpowers/plans/2026-10-23-place-titles.md`。

本功能把没有用户标题的跑步（默认标题 `跑步 · {日期}`）按轨迹附近的地物改名为“海边跑步”“湖边跑步”“河边跑步”“公园跑步”“操场跑步”。地物数据来自操作者自行下载并导入的 OpenStreetMap 区域文件，计算全部在本机 PostGIS 内完成。

## 使用方式

### 一次性准备地物数据

1. 安装 `osmium-tool`（macOS：`brew install osmium-tool`）。
2. 下载自己跑步所在省份的 OSM 区域文件（`.osm.pbf`）。
3. 在仓库根目录运行（交互式，需要在终端中输入数据库名确认；不会打印连接串）：

   ```bash
   backend/.venv/bin/python scripts/osm-places.py <文件.osm.pbf> --region <标签>
   ```

   - 脚本用 `osmium tags-filter` 与 `osmium export` 取出湖、水库、河流/运河、海岸线、海湾、公园/自然保护区、体育场与标注了跑步的田径跑道，只保存类别与简化后的几何。
   - 同一 `--region` 标签整体替换（在一个事务内先删后写，失败则回滚，原有数据保留）；可用不同标签导入多个省份。
   - 结束时打印各类别写入数量，以及跳过数量与原因：`too_large`（原始顶点数超过 200,000）、`collapsed`（简化后塌缩）、`invalid`（几何无效或数据错误）、`too_small`（湖面积 < 10,000 m²、公园 < 5,000 m²）。
   - 熔断：已处理至少 100 个要素且无效比例超过 50% 时中止并回滚，避免把损坏的文件写进库。连接中断、超时等系统性错误不会被当作“无效要素”吞掉，而是中止并回滚。

### 在生产服务器上运行

两个脚本随每个发布包交付，位于 `current/scripts/`（与 `site-owner.py` 同处，由 `verify-release.sh` 检查存在、可执行、语法正确），不需要手工拷贝到暂存目录或建符号链接。运行方式与 `site-owner.py` 相同，从发布包根目录用服务账号并注入后端环境变量：

```bash
cd /opt/run-note-production/current && runuser -u run_note -- backend/.venv/bin/python ops/envfile.py exec /etc/run-note-production/backend.env -- backend/.venv/bin/python scripts/osm-places.py <文件.osm.pbf> --region <标签>
```

`backfill-place-titles.py` 同理。需要先在服务器安装 `osmium-tool`；`--apply` 前先备份。

### 新导入的跑步

- GPX/TCX/小米运动健康导入时，如果没有用户标题，活动在导入事务内进入命名队列；后台 worker 在足迹快照和常跑路线归类之后给它改名。
- 规则（常量在 `backend/app/modules/place_titles/rules.py`，算法版本 `place-titles-v1`）：沿轨迹约每 200 m 取一个采样点（最多 500 个，超过则均匀抽稀），统计落在地物 100 m 范围内的采样点占比；某类别占比不低于 0.4 即命中；多个类别同时命中时优先级为 海 > 湖 > 河 > 公园 > 操场；距离不足 1 km 的跑步不命名。
- 只改默认标题：用户改过标题的活动永不覆盖。地物表为空时队列保持 pending，不会误标为已处理。

### 已有跑步的补全

```bash
backend/.venv/bin/python scripts/backfill-place-titles.py              # 默认只预览
backend/.venv/bin/python scripts/backfill-place-titles.py --apply      # 写入（交互，需输入数据库名确认）
backend/.venv/bin/python scripts/backfill-place-titles.py --revert <日志>
```

- 预览逐行打印 `日期 · 当前标题 → 新标题`，并按原因汇总：命中 / 附近无地物 / 太短 / 标题已被改过 / 测量超时 / 测量出错，不写库。超时与出错的跑步不会被记录，之后可重试；`--apply` 只改命中的，其余只计数。
- `--apply` 前必须先备份。还原日志默认写到仓库之外的 `~/.local/state/run_note/place-titles/`（遵循 `XDG_STATE_HOME`，目录权限 700，日志文件权限 600，写入时 fsync），`place-titles-*.json*` 另被 `.gitignore` 忽略。日志含真实活动 ID 与标题，请妥善保管。`--log-dir` 指向仓库工作区内时只打印警告，不报错。
- 结束时打印中文汇总（已改名 / 期间已被修改 / 失败 / 未命中），有失败时以非零状态退出；`--revert` 同理（已还原 / 已跳过 / 失败）。日志写入在已改库后失败时会停止并报出已完成计数与最后改名的活动 ID。
- `--revert <日志>` 把仍是该标题的活动还原为默认标题；还原按“活动 ID + 标题”更新，不带用户过滤，因此还原日志是受信任的本地输入，请勿使用来源不明的文件。`--revert` 不能与 `--limit`、`--log-dir` 同用。还原后队列行为 skipped，该活动之后会再次出现在预览的候选中。
- 导入新的区域后可重新运行：此前未匹配的跑步会被重试。
- 本助手不会运行 `--apply`。对开发库或生产库写数据，以及升级到 `0016_place_titles`，都需要站主明确授权，并按“备份 → 恢复演练 → 受控单次升级 → 复核”的顺序进行。

## 接口与隐私

- 没有新增 HTTP 接口，既有响应结构不变；命名只是改写活动已有的 `title` 并像其他修改一样递增 `activity_data_version`。
- 全程在本地 PostGIS 计算，不向任何第三方发请求，轨迹与坐标不会离开服务器。
- 新增两张表（迁移 `0016_place_titles`）：
  - `place_features`：`id`、`category`、`geom`、`region`、`imported_at`。只存类别和简化几何，不存 OSM 名称与标签。
  - `activity_place_names`：命名队列与结果（状态 pending/done/skipped、命中类别、占比、写入的标题、算法版本）。
- 标题只含类别词（如“公园跑步”），不含具体地名。
- 数据来源与许可：© OpenStreetMap contributors，ODbL。仓库中不包含任何真实 OSM 数据；测试使用合成几何。

## 验证记录

测试库为 `running_note_phase_one_test`（已在 `0016_place_titles`，由 Task 3 在用户授权下升级一次）。本次未运行 alembic，环境变量只在 Python 子进程中注入，未修改 `.env`，未触碰开发库 `running_note`。每次集成运行后检查 `pg_stat_activity` 与 `ps`，无残留后端。

### 实际运行（2026-10-24）

| 命令 | 结果 |
| --- | --- |
| 后端 `.venv/bin/pytest tests/unit -q` | 404 passed（评审修复后） |
| 后端 `.venv/bin/ruff check app migrations tests ../scripts/backfill-place-titles.py ../scripts/osm-places.py` | All checks passed |
| 后端 `.venv/bin/ruff format --check`（同上范围） | 202 files already formatted |
| 后端 `.venv/bin/alembic heads`（只读） | `0016_place_titles (head)`，唯一 head |
| 集成（测试库）`test_place_titles.py`、`test_route_groups.py`、`test_gpx_import.py`、`test_mifitness_import.py`、`test_footprint_snapshots.py`、`test_province_cache.py`、`test_showcase.py`（评审修复**之前**） | 136 passed，0 failed，0 skipped，81.34 s |
| 集成（测试库）整个 `tests/integration` 一次（评审修复**之前**） | 304 passed，1 skipped，0 failed，178.16 s |
| 集成（测试库）整个 `tests/integration` 一次（评审修复**之后**，由控制会话在 `3b97841` 上运行，20 分钟超时保护，运行前后检查无残留后端） | 310 passed，1 skipped，0 failed，137.11 s |
| `scripts/osm-places.py --help`、`scripts/backfill-place-titles.py --help` | 均正常打印用法 |

评审修复后另跑：`test_place_titles.py` 32 passed，`test_route_groups.py`、`test_gpx_import.py`、`test_mifitness_import.py`、`test_footprint_snapshots.py` 合计 99 passed，均 0 failed、0 skipped，运行后无残留后端。`--apply --revert`、`--revert` 与 `--limit`/`--log-dir` 同用、无 tty 的 `--apply` 均在访问数据库前以 1 退出。

上一行整目录的 1 个 skipped 是 `tests/integration/test_migrations.py` 中依赖 `TEST_SNAPSHOT_DATABASE_URL` 的用例（变量未设置），与本功能无关。开发期间还按任务记录过 `PATH` 中没有 osmium 时脚本打印中文提示并以 1 退出、`--apply` 在无 tty 或与 `--revert` 同用时在访问数据库前报错。

### 发布包打包验证（2026-10-24）

在隔离工作树用 `build-release.sh --allow-dirty` 构建发布包，`verify-release.sh` 通过；解压后 `scripts/` 下三个脚本均为可执行，从解压目录运行 `osm-places.py --help`、`backfill-place-titles.py --help` 正常打印用法，`backfill-place-titles.py --apply --revert x` 在访问数据库前以 1 退出。`unittest discover -s infra/native/tests` 101 个测试通过；新增的缺失/不可执行/语法错误用例在旧版 `verify-release.sh` 上失败。`ops-e2e.sh` 用临时集群跑完全部步骤。没有在任何服务器上运行这两个脚本。

### 未运行

- 两个脚本的 `--apply`/确认提示/日志权限提示等交互路径从未在终端实际执行（只有函数级测试与参数错误路径）。
- 真实的 `osmium tags-filter` / `osmium export` 流水线：本机未安装 osmium。
- `scripts/osm-places.py` 与 `scripts/backfill-place-titles.py` 从未对任何数据库运行过（只运行了 `--help`）；两个脚本在终端中的确认提示没有自动化测试。
- 真实 OSM 数据与真实用户数据上的效果（阈值、要素丢弃率、命名是否合理）未验证。
- “简化后塌缩或无效”的路径没有测试：无法可靠构造出这样的多边形。
- 前端检查：本功能没有改动前端，未运行。
- 开发库未升级、未读写；升级前 `/api/health` 与 `/api/v1/health/ready` 因 revision 不匹配返回 503，升级需要站主明确授权。
- 并发删除与正在运行的 worker 竞争只做了模拟；写入步骤失败的路径只有部分覆盖。

### 评审中发现并已修复的问题

- 多段轨迹的采样上限被突破：每个线段至少产生一个采样点，约 2.5 万段的两点轨迹会超过 500。现在先生成再均匀抽稀，探测点数不超过 `MAX_SAMPLES`。
- 锁顺序与长事务：worker 先锁队列行、`delete_activity` 先锁 users 行，存在死锁风险，且整批在一个事务里持锁。现在测量在无锁只读事务内（带 `statement_timeout`），随后每条活动一个短写事务，先 `lock_owner` 再锁队列行。
- 导入脚本在 osmium 运行期间持有空闲事务，会被 idle-in-transaction 超时杀掉。现在本地检查、短会话核对 revision 和确认、osmium 运行、新会话导入依次进行，osmium 期间不占数据库连接。
- 宽泛的 `except` 把连接中断、超时等系统性错误当作“无效要素”吞掉。现在只跳过数据类错误（SQLSTATE 22 类与 XX000），其余向上抛出并回滚；另加无效比例熔断。

教训：针对用户轨迹或 OSM 几何的 SQL 必须是线性时间且有界，因为 `statement_timeout` 无法中断 GEOS 的计算（常跑路线中 `ST_SimplifyPreserveTopology` 曾让测试库长时间无响应，这里同样只用线性函数）；长批处理要拆成逐条的短事务，并统一先锁 users 行的顺序。

### 剩余风险与已知次要问题

- 阈值（200 m、100 m、0.4、1 km、面积下限）和类别映射只在合成样本上验证；真实地物数据可能漏标或误标。
- 熔断按已处理的前缀计算；XX000 也会覆盖真正的 PostGIS 缺陷；`sport=running;athletics` 已接受，`cycling` 拒绝。
- 补全脚本已修复（评审后）：日志改到仓库外并设 600 权限、有失败时非零退出并输出中文汇总、预览区分失败原因、日志 fsync 与写入失败处理、`--revert` 拒绝 `--limit/--log-dir`、队列 upsert 分支有测试。仍存在：`--revert` 读两遍日志。
- 导入脚本：引擎已加 `pool_pre_ping`，并在核对 revision 后立即 `dispose()`，osmium 运行期间不占连接。
- worker：测量阶段的瞬时错误（语句超时、`OperationalError`/连接失效、SQLSTATE 08 类、死锁 40P01）现在保持 pending 以便重试，其余错误仍标为 skipped。
- worker：应用步骤出错的行保持 pending 而非 skipped；提交在 try 之外；`_record` 无锁超时；短分段与长分段权重相同；补全使用同包私有函数 `service._measure`。
- 测试缺口：迁移单测的列检查只是子串匹配、CHECK 值断言不完整；`test_sampling_is_bounded` 只断言常量；未保护 counts > total。

## 未受影响的部分

没有新增或修改 HTTP 接口，响应结构不变；已有的标题、用户自改标题、足迹、省份缓存和常跑路线行为未改动；历史记录不会被后台自动改动（只有补全脚本的 `--apply` 会改，且需人工确认）；未改动 `ActivityPosterDialog.svelte` 或任何海报文件。
