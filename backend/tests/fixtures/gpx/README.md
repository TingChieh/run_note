# GPX 黄金样本与冻结规则（S2-01）

版本 `gpx-golden-v1`，日期 2026-10-12。所有坐标、时间、账号情景均为合成数据，无真实用户路线或住址。静态文件只做测试输入，不提供公开地图或外部链接；恶意文件中的 URI 指向不存在的合成资源，禁止解析器访问它。

`manifest.json` 包含 41 个静态 GPX、7 个大输入生成配方和17个后续验收情景。sha256 是样本字节的完整性清单，不是已经实现的业务去重功能。`expected` 是人工按固定规则制定的预期，未运行后续解析/认证/事务实现，不能当作测试已通过。未指定的 expected 字段不意味着 0 或 NULL。

## 规则版本与优先级

以 docs/08 第二阶段计划及本文冻结细则为依据：parser=`gpx-parser-v1`（gpxpy 1.6.2）、metrics=`gpx-v1`、fingerprint=`canonical-v1`。冻结版本是后续实现目标，本步没有编写解析器、Haversine、会话或导入服务。依赖版本与验收记录见 docs/09。

涉及业务规则变更时先更新本文件、manifest 和对应设计文档，再修改业务实现；不默默让新预期覆盖旧版本。在后续写数据库前，须同步 docs/03 中较早的重复点描述：缺失时间不构成可信的相邻重复采样；跨 NULL 的可信时间倒退仍为 invalid。

## 距离、时间、日期和异常

- 一文件一活动；按源 trk/trkseg/trkpt 顺序遍历，源段/原轨迹边界始终不连线，不按时间重排。
- lat/lon 缺失、坏文本、NaN/Infinity、超范围：不保存该点，前后断段，不以0代替；空源段计数但不建空数据库段。
- 相邻且合法坐标、可解释时间、高程均相同的点去重，不跨源段去重。时间缺失或无法解释的重复坐标点保留；同位置不同时间保留以表达停留。
- 缺/坏高程为 NULL，不插补、不计入距离。缺/坏/无时区偏移的时间为 NULL，不假设服务器时区。
- 可信源时间倒退或正位移零时间差为 invalid；缺时间为 incomplete；优先级 invalid > incomplete > complete。跨缺时间也比较前后可信时间以识别倒退，不插补时间/位置。
- 源段内相邻 dt>300s 或 speed>12m/s 断空间边；等于阈值不拒绝。正位移dt=0、时间倒退也断边；保留两侧有效点。速度/长gap警告不自行让可靠时间 invalid。
- 权威距离是所有有效非空段 ST_Length(geom::geography) 之和，WGS84椭球、二维米。点序 `[longitude,latitude]`，单点段 geom=NULL、距离0，停留形成的零长线允许保存。
- Haversine 为独立球面对照，R=6371008.8m；不混入入库距离，不以 geometry/Shapely 的度数 length 充当米。
- complete 时 elapsed=最后有效点UTC−首有效点UTC，含暂停与段间间隔；incomplete/invalid 时 elapsed、配速为 NULL。首点可靠时间才构成 started_at，invalid 的 ended_at=NULL。
- 正距离、正耗时才计算 elapsed/(distance/1000)，秒/公里；0或未知不除零。pause/moving_seconds 不生成估计值。跨日整次归开始日，timezone 保存快照，无可靠 started_at 要明确补录日期。
- 源点时间保留解析器支持的精度（PG最多微秒），先验证时序；耗时/指标最终按 Decimal ROUND_HALF_EVEN 三位小数，不逐边舍入。配速由内部总耗时/总距离计算后最终舍入，日常数值可能有合法的末位舍入差异。

## canonical-v1 精确序列化规则

1. raw_sha256 直接来自上传字节；不先重写 XML。
2. canonical 只在所有源轨迹点经纬度和时间合法、时间完整可信时生成；非法坐标/缺或坏时间/无偏移/倒退/正位移零时间差时为 NULL。空间 speed/gap 警告不排除时间仍完整的文件。
3. 使用清洗前的源点：保留源 tracks、segments（包括空数组）、点顺序及重复点；忽略文件名、GPX 1.0/1.1标签版本、元数据、XML缩进、描述和高程。
4. 负零变0；经纬度 Decimal 按 ROUND_HALF_EVEN 到7位小数，序列化为固定7位字符串。UTC时间保留解析精度后到最近毫秒（half-even，跨秒/日进位），输出固定3位小数的 `YYYY-MM-DDTHH:mm:ss.sssZ`。不使用本地时区字符串作为身份。
5. payload固定为 `{"tracks":[[ [point1,point2], [point3] ], ...]}`：tracks数组内每项是segments数组，segment内每项是 `[longitude_string, latitude_string, utc_string]`。不存在随机UUID或上传时间。
6. UTF-8 JSON，唯一根键 tracks，紧凑分隔符 `,`/`:`、无多余空白，前缀字节为 `canonical-v1` 加一个 LF，再 SHA-256。本文定义序列化契约，不提供实现代码。
7. 用户内两种 UNIQUE 是最终防线，不能只先查再插；相同文件跨用户可导入。量化可合并亚厘米/亚毫秒差异，重采样/重分段不承诺相同指纹。版本切换必须有旧数据兼容方案。

## 独立参考值与容差

赤道WGS84半长轴 a=6378137m，赤道长度为 a×经度弧度；0.01°为1113.1949079327358m。六点每120s采样，总600s，因此平均配速约538.989170秒/km。该期望来自椭球参数和数学关系，不由未来业务测距函数生成。

球面独立参考：R×0.01°弧度=1111.950802335329m。两者模型不同，不要求相等。权威距离误差≤max(1m,参考距离×0.1%)；球面数值误差≤max(0.001m,1e-9×参考距离)。时间误差≤0.001s，最终指标按三位小数比较。

manifest 的 distance/pace 参考值保留小数，未来业务测试用明确容差或最终3位舍入，不比较参考浮点字面量与数据库 numeric 的精确相等。多段例只算段内0.001°+0.001°，不算相隔10°的桥接。两点600s会因300s限制断边，不能拿它替代六点正常样本。

high-latitude 的独立参考为19.493267246415m，来自已安装的原生 PROJ geod：输入纬经度 `89 0 89 0.01`，执行 `geod -I -f %.12f -F %.12f +ellps=WGS84`，不调用未来业务函数产生期望。时间倒退、缺字段的部分 expected 专门省略未冻结为具体数值的空间结果，不代表输出空值。

## 样本与计划矩阵的覆盖

| 类别 | 数据/情景 |
| --- | --- |
| 正常、GPX1.0/1.1、赤道参考 | equator-six、equator-six-gpx10 |
| 多trk/段、单点、空段、停留 | multiple-tracks、single-point、empty-segment、stationary-pause、zero-length-line |
| 无效/缺/非有限坐标、断边 | invalid-middle-coordinate、missing-coordinate、missing-latitude、nonfinite-coordinate、speed-jump |
| 时间缺失、坏值、无偏移、倒退 | partial-time、bad-time、naive-time、time-reversal、reversal-across-null、cross-segment-reversal |
| 重复点、NULL重复、零dt、300s边界 | exact-duplicate-point、null-time-repeated-points、zero-time-movement、gap-at/over-limit；speed-exact-boundary scalar情景 |
| 高程缺失/坏值、日期和时区 | missing/bad-elevation、cross-midnight、dst-transition、date-conflict、date-required |
| 规范化语义/不重复 | format-equivalent、utc-offset-equivalent、different-date；raw/canonical/cross-user情景 |
| XML安全/无数据 | empty-file、malformed-xml、no-tracks、route/waypoint-only、external/internal-entity |
| ±180°、极区、球面极端输入 | dateline-crossing、high-latitude、haversine-edge-values情景 |
| 大文件、点/段上限、处理预算 | 下列7个recipe和parsed-time-budget故障注入情景 |
| 认证、CSRF、并发、归属、回滚、迁移、浏览器 | manifest.scenarios中的输入/故障/预期声明；不是本步已实现功能 |

## 大样本生成（仅测试数据，不生成业务代码）

`generate_limits.py` 从manifest的recipe构造边界输入，不把10MiB/50000点文件加入仓库。参数为 case_id 与输出文件；以排他创建模式拒绝覆盖已有文件。

```bash
# 在仓库根目录运行，生成产物存入已忽略的 .cache。
mkdir -p .cache/gpx-fixtures
backend/.venv/bin/python backend/tests/fixtures/gpx/generate_limits.py point-limit-exceeded .cache/gpx-fixtures/point-limit-exceeded.gpx
```

recipe：point-limit-exact/exceeded、segment-limit-exact/exceeded、byte-limit-exact/exceeded、deep-xml。输入计数在去重前校验；源空段也计入段上限。deep-xml只是病态输入，不能保证特定机器必然耗时15秒；确定的deadline测试使用控制的解析器耗时注入，未来断言超时后资源回收。

本步对生成器验证确实输出指定字节/源点/源段边界，不测试尚未存在的解析/指标服务。下游实施不得把fixture规范验证当作业务验收通过。
