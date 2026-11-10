# 城市定位显示边界

来源：阿里云 DataV 公共可视化边界 https://geo.datav.aliyun.com/areas_v3/bound/100000_full_city.json ，下载于 2026-10-16。源文件 SHA-256：`a268d74d3fba89bcc35f9febd8843a9cb77792a3690044dc8b26f21e8acf1bcd`。

`frontend/scripts/generate-city-atlas.py` 将直辖市和港澳的区合并为城市分组，保留地级市、自治州及地区。排除省级台湾轮廓和海域轮廓，避免把省当城市。结果包含 369 个可视化区域；台湾及境外等未覆盖几何通过“未识别区域”定位。

生成命令（输入为公开边界文件，不接受用户轨迹）：

```sh
python3 frontend/scripts/generate-city-atlas.py /private/tmp/run-note-city-atlas.json
```

边界按 0.002 度容差简化并圆整到四位小数，再以 1/10000 度为单位存成逐点差分整数（`{scale, regions}`，每个环是扁平的 `[dx, dy, …]`，由 `src/lib/map/city-atlas.ts` 解码）。这一步无损：解码后的坐标与四位小数结果逐位相同，文件从 2.8 MB（gzip 829 KB）降到 1.25 MB（gzip 484 KB）。数据仅用于有记录城市入口的估算，不用于精确地址、行政归属、活动数量或运动指标；边界附近可能误判，热区网格与简化轨迹也可能使两种模式的识别略有不同。

足迹页与一起跑步页的两个 Worker 不再各自内嵌这份数据，而是从同源的带哈希静态文件读取，浏览器只下载、缓存一次。下载失败时 Worker 报错，页面显示“城市识别暂不可用”并可重试。运行时不向 DataV 请求边界，不向外部地理编码服务发送轨迹或坐标。城市识别失败不阻断地图，仍可回到全部足迹并重试识别。
