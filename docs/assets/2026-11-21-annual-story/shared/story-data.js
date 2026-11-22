/**
 * Deterministic Fictional Fixture Data for RunNote Item 19 (Annual Running Story)
 *
 * STRICT PRIVACY GUARANTEE:
 * - Zero real user data, zero real GPS coordinates, zero real place names.
 * - Uses RunNote's established synthetic fictional geography (青岬市 / 杉港市 / 桐溪市 / 鹿鸣谷 / 白沙洲).
 * - Coordinates live inside normalized synthetic cartographic space [0..1, 0..1].
 */

(function (global) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatDuration(sec) {
    if (sec === null || sec === undefined) return '—';
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDurationCn(sec) {
    if (sec === null || sec === undefined) return '—';
    const total = Math.round(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
  }

  function formatPace(secPerKm) {
    if (secPerKm === null || secPerKm === undefined) return '—';
    const total = Math.round(secPerKm);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}'${String(s).padStart(2, '0')}"`;
  }

  function formatKm(meters, digits = 2) {
    return (meters / 1000).toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatMonthDay(iso) {
    const [, m, d] = iso.split('-');
    return `${Number(m)} 月 ${Number(d)} 日`;
  }

  function formatShortDate(iso) {
    return iso.slice(5).replace('-', '.');
  }

  // Generate an organic loop or coastal out-and-back polyline around a synthetic hub (cx, cy)
  function makeSyntheticTrack(cx, cy, radiusX, radiusY, pointsCount, seed, style = 'loop', jitter = 0) {
    const rand = mulberry32(seed);
    const pts = [];
    const phase = rand() * Math.PI * 2;
    const lobeA = 2 + Math.floor(rand() * 2);
    const lobeB = 3 + Math.floor(rand() * 3);
    const ampA = 0.14 + rand() * 0.14;
    const ampB = 0.06 + rand() * 0.08;

    if (style === 'coastal') {
      const startAngle = phase;
      const sweep = Math.PI * (0.9 + rand() * 0.55);
      for (let i = 0; i < pointsCount; i++) {
        const t = i / (pointsCount - 1);
        const a = startAngle + t * sweep;
        const wave = Math.sin(t * Math.PI * 3.5) * 0.18 + Math.cos(t * Math.PI * 5) * 0.07;
        const r = 0.72 + wave;
        const x = cx + Math.cos(a) * radiusX * r + (rand() - 0.5) * jitter;
        const y = cy + Math.sin(a) * radiusY * r + (rand() - 0.5) * jitter;
        pts.push([Number(x.toFixed(4)), Number(y.toFixed(4))]);
      }
      return pts;
    }

    if (style === 'long-river') {
      // Sweeping scenic half-marathon river loop
      for (let i = 0; i < pointsCount; i++) {
        const t = i / (pointsCount - 1);
        const theta = t * Math.PI * 2;
        const r =
          0.82 +
          0.22 * Math.sin(theta * 2 + 0.4) +
          0.11 * Math.cos(theta * 3 - 0.7) +
          0.06 * Math.sin(theta * 5);
        const x = cx + Math.cos(theta) * radiusX * r * 1.25 + (rand() - 0.5) * jitter;
        const y = cy + Math.sin(theta) * radiusY * r * 0.85 + (rand() - 0.5) * jitter;
        pts.push([Number(x.toFixed(4)), Number(y.toFixed(4))]);
      }
      return pts;
    }

    // Closed park/lake loop
    for (let i = 0; i < pointsCount; i++) {
      const t = i / (pointsCount - 1);
      const theta = phase + t * Math.PI * 2;
      const r = 0.85 + ampA * Math.sin(theta * lobeA + phase) + ampB * Math.cos(theta * lobeB);
      const x = cx + Math.cos(theta) * radiusX * r + (rand() - 0.5) * jitter;
      const y = cy + Math.sin(theta) * radiusY * r + (rand() - 0.5) * jitter;
      pts.push([Number(x.toFixed(4)), Number(y.toFixed(4))]);
    }
    return pts;
  }

  // Synthetic coastline & topographic contours (completely fictional geography)
  const SYNTHETIC_TOPO = {
    coastline: [
      [0.02, 0.84], [0.14, 0.78], [0.27, 0.81], [0.39, 0.72], [0.51, 0.67],
      [0.64, 0.71], [0.78, 0.63], [0.89, 0.54], [0.98, 0.48],
    ],
    river: [
      [0.12, 0.14], [0.24, 0.25], [0.35, 0.36], [0.46, 0.42], [0.58, 0.48],
      [0.67, 0.58], [0.74, 0.66],
    ],
    contours: [
      [[0.08, 0.22], [0.19, 0.16], [0.32, 0.20], [0.41, 0.28], [0.34, 0.39], [0.18, 0.37], [0.08, 0.22]],
      [[0.58, 0.16], [0.73, 0.12], [0.88, 0.20], [0.84, 0.34], [0.68, 0.36], [0.55, 0.27], [0.58, 0.16]],
      [[0.15, 0.54], [0.30, 0.49], [0.45, 0.56], [0.38, 0.68], [0.20, 0.66], [0.15, 0.54]],
    ],
  };

  // Build 2025 full story fixture (118 runs, 5 fictional cities, rich story beats)
  function build2025Scenario() {
    const cities = [
      {
        code: 'C-QINGJIA',
        name: '青岬市',
        region: '岚海州',
        isNew: false,
        firstDate: '2025-01-01',
        lastDate: '2025-12-28',
        activityCount: 74,
        distanceM: 648200,
        newCells: 294,
        hub: [0.32, 0.56],
        color: '#17745c',
        tagline: '清晨海风与松风湖的主场',
      },
      {
        code: 'C-TONGXI',
        name: '桐溪市',
        region: '云岭州',
        isNew: true,
        firstDate: '2025-04-05',
        lastDate: '2025-10-19',
        activityCount: 18,
        distanceM: 176400,
        newCells: 142,
        hub: [0.66, 0.34],
        color: '#4bb6df',
        tagline: '春游首抵，秋日完成年度最长半马',
      },
      {
        code: 'C-SHANGANG',
        name: '杉港市',
        region: '岚海州',
        isNew: false,
        firstDate: '2025-03-15',
        lastDate: '2025-11-29',
        activityCount: 12,
        distanceM: 98680,
        newCells: 64,
        hub: [0.21, 0.72],
        color: '#86a912',
        tagline: '沿着杉港海堤吹风的周末路线',
      },
      {
        code: 'C-LUMING',
        name: '鹿鸣谷',
        region: '云岭州',
        isNew: true,
        firstDate: '2025-07-19',
        lastDate: '2025-08-10',
        activityCount: 8,
        distanceM: 71800,
        newCells: 68,
        hub: [0.52, 0.20],
        color: '#f5c519',
        tagline: '盛夏避暑的山谷林荫慢跑',
      },
      {
        code: 'C-BAISHA',
        name: '白沙洲',
        region: '晴澜州',
        isNew: true,
        firstDate: '2025-09-14',
        lastDate: '2025-09-21',
        activityCount: 6,
        distanceM: 47600,
        newCells: 44,
        hub: [0.81, 0.62],
        color: '#f06373',
        tagline: '跨海桥与落日沙滩的异地惊喜',
      },
    ];

    const cityByCode = Object.fromEntries(cities.map((c) => [c.code, c]));

    // Frequent route base shape (Songfeng Lake 6K Loop in Qingjia)
    const frequentBase = makeSyntheticTrack(0.32, 0.56, 0.068, 0.052, 42, 202599, 'loop', 0);
    const frequentVariants = [];
    for (let i = 0; i < 29; i++) {
      frequentVariants.push(
        makeSyntheticTrack(
          0.32 + Math.sin(i * 1.7) * 0.0022,
          0.56 + Math.cos(i * 1.3) * 0.0022,
          0.068,
          0.052,
          42,
          202599,
          'loop',
          0.0045,
        ),
      );
    }

    const firstRunTrack = makeSyntheticTrack(0.30, 0.60, 0.064, 0.044, 38, 20250101, 'coastal', 0.001);
    const longestRunTrack = makeSyntheticTrack(0.66, 0.34, 0.115, 0.078, 56, 20251019, 'long-river', 0.0012);
    const bestRunTrack = makeSyntheticTrack(0.35, 0.53, 0.082, 0.058, 46, 20251108, 'loop', 0.001);

    // Deterministic chronological sequence of 118 runs across Jan 1 - Dec 28, 2025
    const rand = mulberry32(20251121);
    const monthlyCounts = [9, 8, 10, 11, 10, 9, 10, 11, 10, 12, 10, 8]; // sum = 118
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const tracks = [];
    let frequentIdx = 0;
    let totalDistanceAcc = 0;

    // Schedule key milestone runs on exact dates
    const milestoneMap = new Map([
      [
        '2025-01-01',
        {
          id: 'run-2025-first',
          title: '青岬海湾迎新慢跑',
          cityCode: 'C-QINGJIA',
          distanceM: 6240,
          durationSec: 2148,
          paceSec: 344,
          timeStr: '07:12',
          milestone: 'first',
          milestoneLabel: '年度第一跑',
          points: firstRunTrack,
        },
      ],
      [
        '2025-04-05',
        {
          id: 'run-2025-city-tongxi',
          title: '桐溪古桥春晨跑',
          cityCode: 'C-TONGXI',
          distanceM: 8450,
          durationSec: 2746,
          paceSec: 325,
          timeStr: '06:54',
          milestone: 'new_city',
          milestoneLabel: '点亮桐溪市',
          points: makeSyntheticTrack(0.66, 0.34, 0.06, 0.048, 34, 405, 'loop', 0.002),
        },
      ],
      [
        '2025-07-19',
        {
          id: 'run-2025-city-luming',
          title: '鹿鸣谷林荫晨跑',
          cityCode: 'C-LUMING',
          distanceM: 9120,
          durationSec: 3064,
          paceSec: 336,
          timeStr: '06:30',
          milestone: 'new_city',
          milestoneLabel: '点亮鹿鸣谷',
          points: makeSyntheticTrack(0.52, 0.20, 0.056, 0.042, 34, 719, 'coastal', 0.002),
        },
      ],
      [
        '2025-09-14',
        {
          id: 'run-2025-city-baisha',
          title: '白沙洲落日跨海道',
          cityCode: 'C-BAISHA',
          distanceM: 8860,
          durationSec: 2820,
          paceSec: 318,
          timeStr: '17:42',
          milestone: 'new_city',
          milestoneLabel: '点亮白沙洲',
          points: makeSyntheticTrack(0.81, 0.62, 0.062, 0.045, 34, 914, 'coastal', 0.002),
        },
      ],
      [
        '2025-10-19',
        {
          id: 'run-2025-longest',
          title: '桐溪秋日河滨半程挑战',
          cityCode: 'C-TONGXI',
          distanceM: 21420,
          durationSec: 6492,
          paceSec: 303,
          timeStr: '06:45',
          milestone: 'longest',
          milestoneLabel: '年度最长路线',
          points: longestRunTrack,
        },
      ],
      [
        '2025-11-08',
        {
          id: 'run-2025-best',
          title: '松风湖竞速 10K',
          cityCode: 'C-QINGJIA',
          distanceM: 10040,
          durationSec: 2658,
          paceSec: 265,
          timeStr: '07:05',
          milestone: 'best',
          milestoneLabel: '10km 最佳 PB',
          points: bestRunTrack,
        },
      ],
    ]);

    const titlesByCity = {
      'C-QINGJIA': ['松风湖环湖 6K 绿道', '北岸灯塔有氧跑', '青岬海湾晚风跑', '南湾公园节奏跑'],
      'C-TONGXI': ['桐溪河滨绿道', '古桥环线有氧', '溪畔晨间慢跑'],
      'C-SHANGANG': ['杉港海堤晨跑', '木栈道折返跑'],
      'C-LUMING': ['鹿鸣谷林荫道', '山谷观景台慢跑'],
      'C-BAISHA': ['白沙洲滨海道', '跨海大桥折返'],
    };

    for (let m = 0; m < 12; m++) {
      const count = monthlyCounts[m];
      const maxDay = daysInMonth[m];
      const monthStr = String(m + 1).padStart(2, '0');
      const usedDays = new Set();

      // Include any milestones in this month first
      for (const [dateStr] of milestoneMap) {
        if (dateStr.startsWith(`2025-${monthStr}-`)) {
          usedDays.add(Number(dateStr.slice(8, 10)));
        }
      }

      while (usedDays.size < count) {
        const d = 1 + Math.floor(rand() * (m === 11 ? 28 : maxDay));
        usedDays.add(d);
      }

      const sortedDays = Array.from(usedDays).sort((a, b) => a - b);
      for (const day of sortedDays) {
        const dateStr = `2025-${monthStr}-${String(day).padStart(2, '0')}`;
        if (milestoneMap.has(dateStr)) {
          const ms = milestoneMap.get(dateStr);
          totalDistanceAcc += ms.distanceM;
          tracks.push({
            ...ms,
            date: dateStr,
            month: m + 1,
            cityName: cityByCode[ms.cityCode].name,
            cumulativeM: totalDistanceAcc,
          });
          continue;
        }

        // Assign city realistically by season
        let cityCode = 'C-QINGJIA';
        if (m === 3 && rand() < 0.45) cityCode = 'C-TONGXI';
        else if (m === 9 && rand() < 0.45) cityCode = 'C-TONGXI';
        else if ((m === 6 || m === 7) && rand() < 0.35) cityCode = 'C-LUMING';
        else if (m === 8 && rand() < 0.4) cityCode = 'C-BAISHA';
        else if (rand() < 0.14) cityCode = 'C-SHANGANG';

        const city = cityByCode[cityCode];
        const isFrequent = cityCode === 'C-QINGJIA' && frequentIdx < 29 && rand() < 0.42;
        const distanceM = isFrequent
          ? Math.round(5950 + rand() * 350)
          : Math.round(5200 + rand() * 8800);
        const paceSec = Math.round(338 - m * 2.2 + (rand() - 0.5) * 24);
        const durationSec = Math.round((distanceM / 1000) * paceSec);
        const points = isFrequent
          ? frequentVariants[frequentIdx++]
          : makeSyntheticTrack(
              city.hub[0] + (rand() - 0.5) * 0.045,
              city.hub[1] + (rand() - 0.5) * 0.038,
              0.036 + rand() * 0.035,
              0.028 + rand() * 0.026,
              28,
              m * 1000 + day * 31 + Math.floor(rand() * 999),
              rand() < 0.4 ? 'coastal' : 'loop',
              0.0018,
            );
        const pool = titlesByCity[cityCode];
        const title = isFrequent ? '松风湖环湖 6K 绿道' : pool[Math.floor(rand() * pool.length)];

        totalDistanceAcc += distanceM;
        tracks.push({
          id: `run-2025-${monthStr}-${String(day).padStart(2, '0')}`,
          date: dateStr,
          month: m + 1,
          title,
          cityCode,
          cityName: city.name,
          distanceM,
          durationSec,
          paceSec,
          timeStr: rand() < 0.62 ? '06:48' : '19:35',
          milestone: isFrequent && frequentIdx === 29 ? 'frequent' : null,
          milestoneLabel: isFrequent && frequentIdx === 29 ? '常跑第 29 次' : null,
          points,
          cumulativeM: totalDistanceAcc,
        });
      }
    }

    // Scale totalDistanceM smoothly to 1,042,680 m for exact headline consistency
    const rawTotal = tracks[tracks.length - 1].cumulativeM;
    const scale = 1042680 / rawTotal;
    let runningCum = 0;
    for (const t of tracks) {
      runningCum += t.milestone ? t.distanceM : Math.round(t.distanceM * scale);
      t.cumulativeM = runningCum;
    }
    tracks[tracks.length - 1].cumulativeM = 1042680;

    return {
      id: '2025',
      label: '2025 · 完整年度（5 城样板）',
      year: 2025,
      isPartial: false,
      cutoffDate: null,
      dateRangeText: '2025.01.01 — 2025.12.31',
      hasTracks: true,
      coverageNote: '',
      summary: {
        totalDistanceM: 1042680,
        activityCount: 118,
        activityDays: 104,
        durationSeconds: 329040, // 91h 24m
        avgPaceSeconds: 316, // 5'16"
        longestStreakDays: 6,
        longestStreakWeeks: 19,
        newGridCells: 612,
        marathonsEq: 24.7,
        morningPct: 64,
      },
      firstRun: {
        activityId: 'run-2025-first',
        date: '2025-01-01',
        time: '07:12',
        title: '青岬海湾迎新慢跑',
        cityName: '青岬市',
        distanceM: 6240,
        durationSeconds: 2148,
        paceSeconds: 344,
        hasTrack: true,
        points: firstRunTrack,
        note: '元旦清晨七点十二分，海湾气温 6°C，全年第一串脚印从北岸出发。',
      },
      longestRoute: {
        activityId: 'run-2025-longest',
        date: '2025-10-19',
        time: '06:45',
        title: '桐溪秋日河滨半程挑战',
        cityName: '桐溪市',
        distanceM: 21420,
        durationSeconds: 6492,
        paceSeconds: 303,
        shoeName: '轻云 3 代',
        hasTrack: true,
        points: longestRunTrack,
        comparedToAvg: '是全年单次均距（8.8 km）的 2.4 倍',
        note: '在桐溪市沿河一路向西折返，穿过三座石桥完成年度唯一一次半马距离。',
      },
      bestPerformance: {
        activityId: 'run-2025-best',
        category: '10km',
        isAllTimePB: true,
        date: '2025-11-08',
        time: '07:05',
        title: '松风湖竞速 10K',
        cityName: '青岬市',
        distanceM: 10040,
        durationSeconds: 2658,
        paceSeconds: 265, // 4'25"
        gainSecondsPerKm: 38,
        baselineText: '较年初首次 10K 快了 38"/km',
        hasTrack: true,
        points: bestRunTrack,
        otherBests: [
          { category: '5km', paceSeconds: 253, durationSeconds: 1265, date: '2025-10-04' },
          { category: '半马', paceSeconds: 303, durationSeconds: 6492, date: '2025-10-19' },
        ],
      },
      exploredCities: {
        totalCities: 5,
        newCitiesCount: 3,
        totalRegions: 3,
        locatedCount: 115,
        unlocatedCount: 3,
        totalNewCells: 612,
        items: cities,
      },
      frequentRoute: {
        available: true,
        groupId: 'rg-songfeng-6k',
        name: '松风湖环湖 6K 绿道',
        cityName: '青岬市',
        runCount: 29,
        sharePct: 25,
        medianDistanceM: 6120,
        firstDate: '2025-01-11',
        lastDate: '2025-12-22',
        firstPaceSeconds: 339, // 5'39"
        bestPaceSeconds: 289, // 4'49"
        avgPaceSeconds: 312, // 5'12"
        paceImprovementSec: 50,
        basePoints: frequentBase,
        overlayVariants: frequentVariants,
        monthlyHits: [2, 2, 3, 2, 3, 2, 2, 2, 3, 3, 3, 2],
      },
      tracks,
      monthlySummary: [
        { month: 1, km: 72.4, runs: 9 },
        { month: 2, km: 64.8, runs: 8 },
        { month: 3, km: 88.2, runs: 10 },
        { month: 4, km: 96.5, runs: 11 },
        { month: 5, km: 91.0, runs: 10 },
        { month: 6, km: 76.4, runs: 9 },
        { month: 7, km: 84.6, runs: 10 },
        { month: 8, km: 94.2, runs: 11 },
        { month: 9, km: 89.5, runs: 10 },
        { month: 10, km: 124.8, runs: 12 },
        { month: 11, km: 93.1, runs: 10 },
        { month: 12, km: 67.2, runs: 8 },
      ],
    };
  }

  // Scenario 2: 2026 Partial Year + Single-City Deep Dive + Partial Duration Coverage
  function build2026PartialScenario() {
    const city = {
      code: 'C-QINGJIA',
      name: '青岬市',
      region: '岚海州',
      isNew: false,
      firstDate: '2026-01-03',
      lastDate: '2026-11-19',
      activityCount: 74,
      distanceM: 672100,
      newCells: 186,
      hub: [0.48, 0.52],
      color: '#17745c',
      tagline: '全年深耕一座城，新点亮 186 个百米网格',
    };
    const frequentBase = makeSyntheticTrack(0.48, 0.52, 0.14, 0.11, 42, 202688, 'loop', 0);
    const frequentVariants = Array.from({ length: 22 }, (_, i) =>
      makeSyntheticTrack(
        0.48 + Math.sin(i) * 0.004,
        0.52 + Math.cos(i) * 0.004,
        0.14,
        0.11,
        42,
        202688,
        'loop',
        0.007,
      ),
    );
    const firstTrack = makeSyntheticTrack(0.44, 0.56, 0.12, 0.09, 36, 20260103, 'coastal', 0.002);
    const longestTrack = makeSyntheticTrack(0.50, 0.50, 0.21, 0.15, 52, 20260926, 'long-river', 0.002);
    const bestTrack = makeSyntheticTrack(0.46, 0.48, 0.13, 0.10, 40, 20261018, 'loop', 0.002);

    const rand = mulberry32(20261121);
    const tracks = [];
    let cum = 0;
    const months = [7, 6, 7, 8, 7, 6, 7, 7, 8, 8, 5]; // 76 runs up to Nov 21
    for (let m = 0; m < 11; m++) {
      const n = months[m];
      const maxD = m === 10 ? 21 : 28;
      for (let k = 0; k < n; k++) {
        const d = Math.min(maxD, Math.max(1, Math.round(((k + 0.5) / n) * maxD)));
        const dateStr = `2026-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isFirst = m === 0 && k === 0;
        const isLongest = m === 8 && k === 6;
        const isBest = m === 9 && k === 5;
        const dist = isFirst ? 5120 : isLongest ? 16480 : isBest ? 5060 : Math.round(6200 + rand() * 5200);
        const pace = isBest ? 248 : Math.round(325 - m * 1.5 + (rand() - 0.5) * 20);
        cum += dist;
        tracks.push({
          id: `run-2026-${m + 1}-${k}`,
          date: dateStr,
          month: m + 1,
          title: isFirst
            ? '青岬冬日启程跑'
            : isLongest
              ? '岚海西岸长距离拉练'
              : isBest
                ? '北岸 5K 节奏测试'
                : '松风湖环湖 6K 绿道',
          cityCode: 'C-QINGJIA',
          cityName: '青岬市',
          distanceM: dist,
          durationSec: Math.round((dist / 1000) * pace),
          paceSec: pace,
          timeStr: '07:02',
          milestone: isFirst ? 'first' : isLongest ? 'longest' : isBest ? 'best' : null,
          milestoneLabel: isFirst ? '年度第一跑' : isLongest ? '年度最长路线' : isBest ? '5km 最佳' : null,
          points: isFirst
            ? firstTrack
            : isLongest
              ? longestTrack
              : isBest
                ? bestTrack
                : makeSyntheticTrack(
                    0.48 + (rand() - 0.5) * 0.14,
                    0.52 + (rand() - 0.5) * 0.12,
                    0.08 + rand() * 0.08,
                    0.06 + rand() * 0.06,
                    28,
                    202600 + m * 50 + k,
                    'loop',
                    0.003,
                  ),
          cumulativeM: cum,
        });
      }
    }
    tracks[tracks.length - 1].cumulativeM = 684500;

    return {
      id: '2026',
      label: '2026 · 进行中（单城深耕）',
      year: 2026,
      isPartial: true,
      cutoffDate: '2026-11-21',
      dateRangeText: '2026.01.01 — 2026.11.21（进行中）',
      hasTracks: true,
      coverageNote: '用时覆盖 73/76 次 · 配速覆盖 73/76 次（3 次手动补录未计配速）',
      summary: {
        totalDistanceM: 684500,
        activityCount: 76,
        activityDays: 70,
        durationSeconds: 210900,
        avgPaceSeconds: 311,
        longestStreakDays: 5,
        longestStreakWeeks: 14,
        newGridCells: 186,
        marathonsEq: 16.2,
        morningPct: 71,
      },
      firstRun: {
        activityId: 'run-2026-first',
        date: '2026-01-03',
        time: '07:25',
        title: '青岬冬日启程跑',
        cityName: '青岬市',
        distanceM: 5120,
        durationSeconds: 1715,
        paceSeconds: 335,
        hasTrack: true,
        points: firstTrack,
        note: '新年第三个清晨出发，依然从熟悉的青岬海湾起跑。',
      },
      longestRoute: {
        activityId: 'run-2026-longest',
        date: '2026-09-26',
        time: '06:38',
        title: '岚海西岸长距离拉练',
        cityName: '青岬市',
        distanceM: 16480,
        durationSeconds: 5191,
        paceSeconds: 315,
        shoeName: '疾风 Carbon 2',
        hasTrack: true,
        points: longestTrack,
        comparedToAvg: '比今年单次均距（9.0 km）多跑 7.5 km',
        note: '绕青岬西岸延伸到从未跑过的旧港区，一口气点亮 24 个新网格。',
      },
      bestPerformance: {
        activityId: 'run-2026-best',
        category: '5km',
        isAllTimePB: false,
        date: '2026-10-18',
        time: '07:10',
        title: '北岸 5K 节奏测试',
        cityName: '青岬市',
        distanceM: 5060,
        durationSeconds: 1255,
        paceSeconds: 248,
        gainSecondsPerKm: 24,
        baselineText: '较今年首次 5K 快了 24"/km',
        hasTrack: true,
        points: bestTrack,
        otherBests: [{ category: '10km', paceSeconds: 282, durationSeconds: 2820, date: '2026-10-03' }],
      },
      exploredCities: {
        totalCities: 1,
        newCitiesCount: 0,
        totalRegions: 1,
        locatedCount: 74,
        unlocatedCount: 2,
        totalNewCells: 186,
        items: [city],
      },
      frequentRoute: {
        available: true,
        groupId: 'rg-songfeng-6k-2026',
        name: '松风湖环湖 6K 绿道',
        cityName: '青岬市',
        runCount: 22,
        sharePct: 29,
        medianDistanceM: 6080,
        firstDate: '2026-01-12',
        lastDate: '2026-11-15',
        firstPaceSeconds: 332,
        bestPaceSeconds: 294,
        avgPaceSeconds: 310,
        paceImprovementSec: 38,
        basePoints: frequentBase,
        overlayVariants: frequentVariants,
        monthlyHits: [2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 1, 0],
      },
      tracks,
      monthlySummary: [
        { month: 1, km: 56.2, runs: 7 },
        { month: 2, km: 49.0, runs: 6 },
        { month: 3, km: 62.4, runs: 7 },
        { month: 4, km: 71.8, runs: 8 },
        { month: 5, km: 65.0, runs: 7 },
        { month: 6, km: 52.1, runs: 6 },
        { month: 7, km: 61.5, runs: 7 },
        { month: 8, km: 64.2, runs: 7 },
        { month: 9, km: 78.6, runs: 8 },
        { month: 10, km: 76.4, runs: 8 },
        { month: 11, km: 47.3, runs: 5 },
        { month: 12, km: 0, runs: 0 },
      ],
    };
  }

  // Scenario 3: 2024 Sparse / Indoor-Only Fallback Demo (proves every fallback works cleanly)
  function build2024FallbackScenario() {
    const indoorRuns = [
      { id: 'r24-1', date: '2024-03-10', month: 3, title: '跑步机初体验', distanceM: 3200, durationSec: 1248, paceSec: 390, timeStr: '20:15', milestone: 'first', milestoneLabel: '年度第一跑', cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 3200 },
      { id: 'r24-2', date: '2024-04-02', month: 4, title: '室内慢跑', distanceM: 4100, durationSec: 1558, paceSec: 380, timeStr: '19:40', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 7300 },
      { id: 'r24-3', date: '2024-05-18', month: 5, title: '雨天跑步机 5K', distanceM: 5050, durationSec: 1868, paceSec: 370, timeStr: '20:05', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 12350 },
      { id: 'r24-4', date: '2024-06-22', month: 6, title: '晚间有氧', distanceM: 5400, durationSec: 1944, paceSec: 360, timeStr: '21:00', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 17750 },
      { id: 'r24-5', date: '2024-08-09', month: 8, title: '仲夏夜跑机', distanceM: 5800, durationSec: 2059, paceSec: 355, timeStr: '20:30', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 23550 },
      { id: 'r24-6', date: '2024-09-15', month: 9, title: '秋夜耐力跑', distanceM: 6450, durationSec: 2258, paceSec: 350, timeStr: '19:50', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 30000 },
      { id: 'r24-7', date: '2024-10-12', month: 10, title: '室内 5K 提速', distanceM: 5100, durationSec: 1683, paceSec: 330, timeStr: '19:20', milestone: 'best', milestoneLabel: '5km 最佳', cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 35100 },
      { id: 'r24-8', date: '2024-11-09', month: 11, title: '年度最远一次室内跑', distanceM: 8100, durationSec: 2819, paceSec: 348, timeStr: '18:55', milestone: 'longest', milestoneLabel: '年度最长记录', cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 43200 },
      { id: 'r24-9', date: '2024-12-08', month: 12, title: '冬夜收官跑', distanceM: 5000, durationSec: 1750, paceSec: 350, timeStr: '20:10', milestone: null, milestoneLabel: null, cityCode: null, cityName: '无定位记录', points: [], cumulativeM: 48200 },
    ];

    return {
      id: '2024',
      label: '2024 · 稀疏/无轨迹降级',
      year: 2024,
      isPartial: false,
      cutoffDate: null,
      dateRangeText: '2024.01.01 — 2024.12.31',
      hasTracks: false,
      coverageNote: '全部 9 次记录均无 GPS 轨迹，自动启用日历节律回放与文字里程碑模式',
      summary: {
        totalDistanceM: 48200,
        activityCount: 9,
        activityDays: 9,
        durationSeconds: 17187,
        avgPaceSeconds: 357,
        longestStreakDays: 1,
        longestStreakWeeks: 2,
        newGridCells: 0,
        marathonsEq: 1.1,
        morningPct: 11,
      },
      firstRun: {
        activityId: 'r24-1',
        date: '2024-03-10',
        time: '20:15',
        title: '跑步机初体验',
        cityName: null,
        distanceM: 3200,
        durationSeconds: 1248,
        paceSeconds: 390,
        hasTrack: false,
        points: [],
        note: '虽然没有户外 GPS 轨迹，但这是重新系上跑鞋鞋带的起点。',
      },
      longestRoute: {
        activityId: 'r24-8',
        date: '2024-11-09',
        time: '18:55',
        title: '年度最远一次室内跑',
        cityName: null,
        distanceM: 8100,
        durationSeconds: 2819,
        paceSeconds: 348,
        shoeName: null,
        hasTrack: false,
        points: [],
        comparedToAvg: '比全年单次均距（5.4 km）多跑 2.7 km',
        note: '无 GPS 轨迹记录：以里程标尺呈现年度最长单次坚持。',
      },
      bestPerformance: {
        activityId: 'r24-7',
        category: '5km',
        isAllTimePB: false,
        date: '2024-10-12',
        time: '19:20',
        title: '室内 5K 提速',
        cityName: null,
        distanceM: 5100,
        durationSeconds: 1683,
        paceSeconds: 330,
        gainSecondsPerKm: 40,
        baselineText: '较 5 月首次 5K 快了 40"/km',
        hasTrack: false,
        points: [],
        otherBests: [],
      },
      exploredCities: {
        totalCities: 0,
        newCitiesCount: 0,
        totalRegions: 0,
        locatedCount: 0,
        unlocatedCount: 9,
        totalNewCells: 0,
        items: [],
      },
      frequentRoute: {
        available: false,
        reason: '无重复户外路线（全年 9 次记录均无 GPS 轨迹或未重复 ≥ 2 次）',
      },
      tracks: indoorRuns,
      monthlySummary: [
        { month: 1, km: 0, runs: 0 },
        { month: 2, km: 0, runs: 0 },
        { month: 3, km: 3.2, runs: 1 },
        { month: 4, km: 4.1, runs: 1 },
        { month: 5, km: 5.05, runs: 1 },
        { month: 6, km: 5.4, runs: 1 },
        { month: 7, km: 0, runs: 0 },
        { month: 8, km: 5.8, runs: 1 },
        { month: 9, km: 6.45, runs: 1 },
        { month: 10, km: 5.1, runs: 1 },
        { month: 11, km: 8.1, runs: 1 },
        { month: 12, km: 5.0, runs: 1 },
      ],
    };
  }

  const SCENARIOS = {
    '2025': build2025Scenario(),
    '2026': build2026PartialScenario(),
    '2024': build2024FallbackScenario(),
  };

  function getTheme() {
    const param = new URLSearchParams(window.location.search).get('theme');
    if (param === 'dark' || param === 'light') return param;
    const saved = window.localStorage.getItem('runnote-story-proto-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem('runnote-story-proto-theme', next);
    } catch {
      // Ignore storage failures in sandboxed contexts
    }
    return next;
  }

  function getInitialScenarioId() {
    const param = new URLSearchParams(window.location.search).get('year');
    return param && SCENARIOS[param] ? param : '2025';
  }

  global.STORY_DATA = {
    SCENARIOS,
    SYNTHETIC_TOPO,
    formatDuration,
    formatDurationCn,
    formatPace,
    formatKm,
    formatMonthDay,
    formatShortDate,
    getTheme,
    applyTheme,
    getInitialScenarioId,
  };
})(window);
