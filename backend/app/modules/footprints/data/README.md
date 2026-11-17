# 省级地图边界

来源：阿里云 DataV 公共地图数据，https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json ，下载日期 2026-10-14。保留源文件中 34 个省级区域和单独的海域轮廓。

仅用于运动足迹可视化估算，并非测绘或精确地址判定；近边界结果可能存在误差。海域轮廓不计入省级区域分母。前端 `src/lib/data/china-provinces.json` 为同一数据生成的 SVG 路径（圆整到 0.01 显示单位后，再经 `frontend/scripts/simplify-province-paths.py` 以 0.3 显示单位的容差抽稀并保留一位小数，仅用于显示），离散南海岛屿与海域轮廓置于附图。

下载和使用不向地图提供方传输用户数据，运行时没有第三方地图/定位请求。

# 全球行政区与城市足迹边界

为支持全球版足迹地图，通过 `scripts/build-global-footprint-atlas.py` 生成以下离线压缩数据：

- `world-regions.json.gz`：4,555 个全球一级行政区（省/州/直辖市/特别行政区）简化边界。中国境内（含台湾省 `CN-710000`、香港、澳门共 34 个省级区域）直接沿用上述阿里云 DataV 权威边界，其余国家与地区来自公开领域 Natural Earth `ne_10m_admin_1_states_provinces`；南极洲与争议岛屿条目已过滤，台湾省统一归属 `CHN`（中国）。
- `world-cities.json.gz`：中国大陆及港澳保留 `frontend/src/lib/data/china-cities.json` 中的 369 个精确市级多边形区域，台湾省（25 个城市，归属 `CN-710000` / `CHN`）及全球其余国家与地区采用 Natural Earth `ne_10m_populated_places`（6,883 个城市点，构建期已与所属一级行政区关联）。
- 前端 `frontend/src/lib/data/world-base.json`：轻量全球基础轮廓（将 Natural Earth 50m 国家边界中的 `TWN` 并入 `CHN`，并以中国 34 个省级行政区替代），用于在外部底图加载前或离线状态下立即呈现全球及中国省级轮廓。

以上数据仅在服务端本地做运动足迹估算，不向任何外部地理编码或地图服务发送轨迹或坐标。
