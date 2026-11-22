/**
 * Offline 1080×1920 (9:16) Annual Story Poster Renderer (Canvas 2D)
 *
 * Styles:
 * - 'chronicle'     (Direction A: Editorial Memoir Folio)
 * - 'cinema'        (Direction B: Annual Footprint Film Strip)
 * - 'cinema-scene'  (Direction B: Single-Act Highlight Card)
 * - 'almanac'       (Direction C: Runner's Passport Sheet)
 *
 * Strict privacy whitelist:
 * - Renders ONLY generic RunNote brand, year, aggregate numbers, abstract normalized silhouettes
 *   (zero real street map, zero exact lat/lon, zero start/end pins), and optional city/route names
 *   controlled by explicit user privacy toggles.
 */

(function (global) {
  'use strict';

  const W = 1080;
  const H = 1920;
  const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
  const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

  function palette(theme) {
    const dark = theme === 'dark';
    return dark
      ? {
          dark: true,
          bg: '#23211f',
          surface: '#312f2c',
          paper: '#2b2926',
          forest: '#1b221f',
          forestDeep: '#121715',
          ink: '#f2f0ee',
          muted: '#b1aca6',
          primary: '#77d4ac',
          gold: '#f5d36c',
          coral: '#f06373',
          blue: '#7cc7f2',
          line: '#46433f',
          brandBg: '#f2f0ee',
          brandInk: '#1d1c1a',
          chipBg: 'rgba(119,212,172,0.14)',
        }
      : {
          dark: false,
          bg: '#f6f7f4',
          surface: '#ffffff',
          paper: '#fcfcf7',
          forest: '#124e3d',
          forestDeep: '#0b3529',
          ink: '#202d23',
          muted: '#5c695e',
          primary: '#17745c',
          gold: '#d89b00',
          coral: '#d9485b',
          blue: '#228bb5',
          line: '#dce3d6',
          brandBg: '#218538',
          brandInk: '#ffffff',
          chipBg: '#e8f6df',
        };
  }

  function fitText(ctx, text, x, y, size, weight, color, maxWidth, align = 'left', family = FONT) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    const m = ctx.measureText(text).width;
    if (m > maxWidth && m > 0) {
      s = Math.max(16, Math.floor((size * maxWidth) / m));
      ctx.font = `${weight} ${s}px ${family}`;
    }
    ctx.fillText(text, x, y, maxWidth);
    ctx.restore();
  }

  function drawBrandMark(ctx, x, y, p, inverted = false) {
    ctx.save();
    ctx.fillStyle = inverted ? '#f6f7f4' : p.brandBg;
    ctx.beginPath();
    ctx.roundRect(x, y, 48, 48, 13);
    ctx.fill();
    ctx.fillStyle = inverted ? '#0b3529' : p.brandInk;
    ctx.font = `italic 700 28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', x + 24, y + 25);
    ctx.restore();
  }

  function drawAbstractTracks(ctx, box, tracks, colorDim, colorHighlight, colorGold) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, box.r || 24);
    ctx.clip();

    if (!tracks || !tracks.length || !tracks.some((t) => t.points && t.points.length > 1)) {
      // Calendar rhythm fallback graphic
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rad = Math.min(box.w, box.h) * 0.34;
      ctx.strokeStyle = colorDim;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
        const hit = tracks.some((t) => t.month === i + 1);
        ctx.strokeStyle = hit ? colorHighlight : colorDim;
        ctx.lineWidth = hit ? 14 : 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (rad - 10), cy + Math.sin(a) * (rad - 10));
        ctx.lineTo(cx + Math.cos(a) * (rad + (hit ? 46 : 12)), cy + Math.sin(a) * (rad + (hit ? 46 : 12)));
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    const proj = ([x, y]) => [
      box.x + 48 + ((x - 0.08) / 0.84) * (box.w - 96),
      box.y + 48 + ((y - 0.1) / 0.78) * (box.h - 96),
    ];

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of tracks) {
      if (!t.points || t.points.length < 2) continue;
      ctx.strokeStyle = t.milestone === 'longest' ? colorGold : t.milestone ? colorHighlight : colorDim;
      ctx.lineWidth = t.milestone ? 4.5 : 2.2;
      ctx.beginPath();
      const p0 = proj(t.points[0]);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < t.points.length; i++) {
        const pt = proj(t.points[i]);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function cityText(scenario, opts) {
    if (opts.hideCities) {
      return scenario.exploredCities.totalCities > 0
        ? `跨越 ${scenario.exploredCities.totalCities} 座城`
        : '室内无定位记录';
    }
    const names = scenario.exploredCities.items.map((c) => c.name);
    if (!names.length) return '室内与无定位记录';
    return names.slice(0, 4).join(' · ') + (names.length > 4 ? ` 等 ${names.length} 城` : '');
  }

  function routeLabel(text, fallback, opts) {
    return opts.hideRouteNames ? fallback : text;
  }

  function drawChroniclePoster(ctx, scenario, p, opts) {
    const D = global.STORY_DATA;
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, W, H);

    // Top warm editorial header band
    ctx.fillStyle = p.dark ? '#34312e' : '#fbf0bd';
    ctx.fillRect(0, 0, W, 240);

    drawBrandMark(ctx, 72, 64, p, false);
    fitText(ctx, 'RUNNOTE · ANNUAL STORY', 140, 88, 22, 600, p.dark ? p.muted : '#5a5628', 600, 'left', MONO);
    fitText(ctx, `${scenario.year} 跑步年度故事`, 140, 128, 38, 700, p.dark ? p.ink : '#2a2a12', 680);
    fitText(ctx, scenario.dateRangeText, 72, 200, 24, 500, p.dark ? p.muted : '#5a5628', 900, 'left', MONO);

    // Abstract footprint art canvas
    const artBox = { x: 72, y: 280, w: W - 144, h: 660, r: 32 };
    const grad = ctx.createLinearGradient(artBox.x, artBox.y, artBox.x + artBox.w, artBox.y + artBox.h);
    grad.addColorStop(0, p.forest);
    grad.addColorStop(1, p.forestDeep);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(artBox.x, artBox.y, artBox.w, artBox.h, artBox.r);
    ctx.fill();

    drawAbstractTracks(
      ctx,
      artBox,
      scenario.tracks,
      'rgba(156,228,195,0.28)',
      '#9ce4c3',
      '#f5c519',
    );

    // Headline distance inside bottom-left of art frame
    fitText(
      ctx,
      `${D.formatKm(scenario.summary.totalDistanceM)} km`,
      artBox.x + 48,
      artBox.y + artBox.h - 86,
      82,
      700,
      '#ffffff',
      640,
    );
    fitText(
      ctx,
      `${scenario.summary.activityCount} 次出发 · ${scenario.summary.activityDays} 天在路上 · 均配 ${D.formatPace(scenario.summary.avgPaceSeconds)}/km`,
      artBox.x + 48,
      artBox.y + artBox.h - 38,
      26,
      500,
      '#b7d7cb',
      artBox.w - 96,
    );

    // 5 Memoir Beats Ledger
    const beats = [
      {
        tag: '01 年度第一跑',
        main: `${D.formatShortDate(scenario.firstRun.date)} · ${D.formatKm(scenario.firstRun.distanceM)} km`,
        sub: routeLabel(scenario.firstRun.title, '开年首跑记录', opts),
      },
      {
        tag: '02 年度最长路线',
        main: `${D.formatKm(scenario.longestRoute.distanceM)} km`,
        sub: `${D.formatShortDate(scenario.longestRoute.date)} · ${routeLabel(scenario.longestRoute.title, '单次最长里程', opts)}`,
      },
      {
        tag: '03 最佳表现',
        main: `${scenario.bestPerformance.category} · ${D.formatPace(scenario.bestPerformance.paceSeconds)}/km`,
        sub: scenario.bestPerformance.baselineText,
      },
      {
        tag: '04 探索城市',
        main:
          scenario.exploredCities.totalCities > 0
            ? `${scenario.exploredCities.totalCities} 座城 · +${scenario.exploredCities.totalNewCells} 新格`
            : '室内无定位',
        sub: cityText(scenario, opts),
      },
      {
        tag: '05 最常跑路线',
        main: scenario.frequentRoute.available ? `${scenario.frequentRoute.runCount} 次重逢` : '每次都是新路',
        sub: scenario.frequentRoute.available
          ? `${routeLabel(scenario.frequentRoute.name, '年度常跑路线', opts)} · 提速 ${scenario.frequentRoute.paceImprovementSec}"/km`
          : '全年未重复同一户外轨迹',
      },
    ];

    let y = 995;
    for (const b of beats) {
      ctx.fillStyle = p.surface;
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(72, y, W - 144, 144, 24);
      ctx.fill();
      ctx.stroke();

      fitText(ctx, b.tag, 108, y + 48, 22, 600, p.primary, 360);
      fitText(ctx, b.main, 108, y + 104, 40, 700, p.ink, 520);
      fitText(ctx, b.sub, W - 108, y + 98, 24, 500, p.muted, 390, 'right');
      y += 162;
    }

    // Footer colophon
    fitText(
      ctx,
      'RunNote · 抽象足迹示意，不含精确坐标与起终点',
      W / 2,
      H - 52,
      22,
      500,
      p.muted,
      W - 144,
      'center',
    );
  }

  function drawCinemaPoster(ctx, scenario, p, opts) {
    const D = global.STORY_DATA;
    const isSingle = opts.style === 'cinema-scene';
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, p.forest);
    grad.addColorStop(1, p.forestDeep);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle film sprocket holes along left & right rails
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 76; y < H - 60; y += 92) {
      ctx.beginPath();
      ctx.roundRect(22, y, 22, 42, 6);
      ctx.roundRect(W - 44, y, 22, 42, 6);
      ctx.fill();
    }

    drawBrandMark(ctx, 84, 72, p, true);
    fitText(
      ctx,
      isSingle ? `ACT HIGHLIGHT · ${scenario.year}` : `FOOTPRINT CINEMA · ${scenario.year}`,
      152,
      98,
      22,
      600,
      '#b7d7cb',
      660,
      'left',
      MONO,
    );
    fitText(
      ctx,
      isSingle ? '年度故事 · 单幕剧照' : `${scenario.year} 足迹放映室`,
      152,
      138,
      36,
      700,
      '#f6f7f4',
      720,
    );

    const frame = { x: 84, y: 210, w: W - 168, h: isSingle ? 980 : 780, r: 28 };
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(frame.x, frame.y, frame.w, frame.h, frame.r);
    ctx.fill();
    ctx.stroke();

    const sceneTracks = isSingle
      ? [{ ...scenario.longestRoute, milestone: 'longest' }]
      : scenario.tracks;
    drawAbstractTracks(ctx, frame, sceneTracks, 'rgba(156,228,195,0.26)', '#9ce4c3', '#f5d36c');

    if (isSingle) {
      fitText(ctx, 'ACT 03 · THE LONG HORIZON', 84, 1270, 24, 600, '#f5d36c', 860, 'left', MONO);
      fitText(ctx, `${D.formatKm(scenario.longestRoute.distanceM)} km`, 84, 1396, 118, 700, '#ffffff', 912);
      fitText(
        ctx,
        `${D.formatMonthDay(scenario.longestRoute.date)} · ${routeLabel(scenario.longestRoute.title, '年度最长路线', opts)}`,
        84,
        1476,
        36,
        600,
        '#f6f7f4',
        912,
      );
      fitText(
        ctx,
        `用时 ${D.formatDuration(scenario.longestRoute.durationSeconds)} · 配速 ${D.formatPace(scenario.longestRoute.paceSeconds)}/km`,
        84,
        1540,
        28,
        500,
        '#b7d7cb',
        912,
      );
    } else {
      // Total hero band
      const distStr = D.formatKm(scenario.summary.totalDistanceM);
      ctx.save();
      ctx.font = `700 116px ${FONT}`;
      const distW = Math.min(720, ctx.measureText(distStr).width);
      ctx.restore();
      fitText(ctx, distStr, 84, 1138, 116, 700, '#ffffff', 720);
      fitText(ctx, 'KM', 84 + distW + 18, 1138, 42, 700, '#f5d36c', 160);
      fitText(
        ctx,
        `${scenario.summary.activityCount} 场奔跑 · ${scenario.exploredCities.totalCities} 座城 · 均配 ${D.formatPace(scenario.summary.avgPaceSeconds)}/km`,
        84,
        1202,
        28,
        500,
        '#b7d7cb',
        912,
      );

      // 2x2 Keyframes strip
      const cards = [
        { k: 'FIRST SPARK', v: `${D.formatShortDate(scenario.firstRun.date)} · ${D.formatKm(scenario.firstRun.distanceM, 1)} km` },
        { k: 'LONGEST', v: `${D.formatKm(scenario.longestRoute.distanceM)} km` },
        { k: 'PEAK PACE', v: `${scenario.bestPerformance.category} · ${D.formatPace(scenario.bestPerformance.paceSeconds)}` },
        {
          k: 'RITUAL LOOP',
          v: scenario.frequentRoute.available ? `${scenario.frequentRoute.runCount} 次同路` : '每次新出发',
        },
      ];
      cards.forEach((c, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const cx = 84 + col * 468;
        const cy = 1265 + row * 212;
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx, cy, 444, 184, 24);
        ctx.fill();
        ctx.stroke();

        fitText(ctx, c.k, cx + 32, cy + 56, 20, 600, '#f5d36c', 380, 'left', MONO);
        fitText(ctx, c.v, cx + 32, cy + 128, 44, 700, '#ffffff', 380);
      });
    }

    fitText(
      ctx,
      `RUNNOTE ${scenario.year} · 隐私白名单抽象轨迹`,
      W / 2,
      H - 60,
      22,
      500,
      '#b7d7cb',
      880,
      'center',
      MONO,
    );
  }

  function drawAlmanacPoster(ctx, scenario, p, opts) {
    const D = global.STORY_DATA;
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, W, H);

    // Fine field-book grid lines
    ctx.strokeStyle = p.dark ? 'rgba(255,255,255,0.045)' : 'rgba(32,45,35,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 48; x < W; x += 48) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 48; y < H; y += 48) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    // Outer double archival border
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 3;
    ctx.strokeRect(42, 42, W - 84, H - 84);

    // Header masthead
    drawBrandMark(ctx, 84, 84, p, false);
    fitText(ctx, `FIELD ALMANAC NO.${scenario.year}`, 152, 108, 22, 600, p.muted, 540, 'left', MONO);
    fitText(ctx, `${scenario.year} 跑者年度手账`, 152, 148, 38, 700, p.ink, 580);

    // Circular archival stamp on top right
    ctx.save();
    ctx.translate(W - 170, 140);
    ctx.rotate(-0.16);
    ctx.strokeStyle = p.primary;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 56, 0, Math.PI * 2);
    ctx.stroke();
    fitText(ctx, `${scenario.summary.activityCount} RUNS`, 0, -4, 22, 700, p.primary, 100, 'center', MONO);
    fitText(ctx, `${scenario.year}`, 0, 26, 22, 700, p.primary, 100, 'center', MONO);
    ctx.restore();

    // Map specimen box
    const mapBox = { x: 84, y: 224, w: W - 168, h: 610, r: 24 };
    ctx.fillStyle = p.surface;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(mapBox.x, mapBox.y, mapBox.w, mapBox.h, mapBox.r);
    ctx.fill();
    ctx.stroke();

    drawAbstractTracks(
      ctx,
      mapBox,
      scenario.tracks,
      p.dark ? 'rgba(119,212,172,0.32)' : 'rgba(23,116,92,0.28)',
      p.primary,
      p.gold,
    );

    fitText(ctx, 'SPECIMEN 00 · ANNUAL FOOTPRINT ATLAS', mapBox.x + 32, mapBox.y + 46, 20, 600, p.muted, 600, 'left', MONO);

    // Big ledger row
    fitText(ctx, `${D.formatKm(scenario.summary.totalDistanceM)} km`, 84, 944, 88, 700, p.primary, 620);
    fitText(
      ctx,
      `${scenario.summary.activityDays} 天 · 均配 ${D.formatPace(scenario.summary.avgPaceSeconds)}/km`,
      W - 84,
      934,
      28,
      600,
      p.muted,
      400,
      'right',
    );

    // Passport City Stamps Strip
    ctx.fillStyle = p.surface;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(84, 990, W - 168, 252, 24);
    ctx.fill();
    ctx.stroke();
    fitText(ctx, 'CITY PASSPORT · 探索城市邮戳', 116, 1040, 22, 600, p.muted, 640, 'left', MONO);

    if (scenario.exploredCities.items.length === 0) {
      fitText(ctx, '室内与无定位记录 · 全部 9 次沉淀于跑步机与手动记录', 116, 1144, 30, 600, p.ink, 820);
    } else {
      const items = scenario.exploredCities.items.slice(0, 4);
      items.forEach((c, idx) => {
        const sx = 186 + idx * 212;
        const sy = 1140;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((idx % 2 === 0 ? -1 : 1) * 0.08);
        ctx.strokeStyle = c.isNew ? p.coral : p.primary;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-84, -56, 168, 112, 16);
        ctx.stroke();
        fitText(ctx, opts.hideCities ? `城 #${idx + 1}` : c.name, 0, -4, 30, 700, p.ink, 148, 'center');
        fitText(ctx, `${c.activityCount}次 · ${(c.distanceM / 1000).toFixed(0)}km`, 0, 32, 20, 500, p.muted, 148, 'center', MONO);
        ctx.restore();
      });
    }

    // 3 Specimen Cards (First, Longest, Best + Frequent)
    const specs = [
      { label: 'NO.01 首跑', val: `${D.formatShortDate(scenario.firstRun.date)}`, sub: `${D.formatKm(scenario.firstRun.distanceM)} km` },
      { label: 'NO.02 最长', val: `${D.formatKm(scenario.longestRoute.distanceM)} km`, sub: `${D.formatDuration(scenario.longestRoute.durationSeconds)}` },
      { label: 'NO.03 最佳', val: `${D.formatPace(scenario.bestPerformance.paceSeconds)}`, sub: `${scenario.bestPerformance.category} · /km` },
    ];
    specs.forEach((sp, i) => {
      const sx = 84 + i * 312;
      const sy = 1280;
      ctx.fillStyle = p.surface;
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(sx, sy, 288, 220, 24);
      ctx.fill();
      ctx.stroke();
      fitText(ctx, sp.label, sx + 28, sy + 52, 22, 600, p.primary, 232, 'left', MONO);
      fitText(ctx, sp.val, sx + 28, sy + 126, 46, 700, p.ink, 232);
      fitText(ctx, sp.sub, sx + 28, sy + 178, 24, 500, p.muted, 232);
    });

    // Frequent Route Ribbon
    ctx.fillStyle = p.surface;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(84, 1536, W - 168, 210, 24);
    ctx.fill();
    ctx.stroke();
    fitText(ctx, 'NO.04 RITUAL ROUTE · 最常跑路线', 116, 1588, 22, 600, p.muted, 600, 'left', MONO);
    if (scenario.frequentRoute.available) {
      fitText(
        ctx,
        `${routeLabel(scenario.frequentRoute.name, '年度常跑路线', opts)} · ${scenario.frequentRoute.runCount} 次`,
        116,
        1654,
        40,
        700,
        p.ink,
        840,
      );
      fitText(
        ctx,
        `从 ${D.formatPace(scenario.frequentRoute.firstPaceSeconds)} 到 ${D.formatPace(scenario.frequentRoute.bestPaceSeconds)} /km · 全年占比 ${scenario.frequentRoute.sharePct}%`,
        116,
        1708,
        26,
        500,
        p.primary,
        840,
      );
    } else {
      fitText(ctx, '每一次都是新出发', 116, 1656, 40, 700, p.ink, 840);
      fitText(ctx, '今年没有重复跑过同一条户外路线', 116, 1708, 26, 500, p.muted, 840);
    }

    fitText(ctx, 'RUNNOTE ARCHIVE · 离线本地渲染 · 无真实坐标', W / 2, H - 86, 22, 500, p.muted, 880, 'center', MONO);
  }

  function renderPoster(canvas, scenario, options = {}) {
    const opts = {
      style: options.style || 'chronicle',
      theme: options.theme || (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
      hideCities: Boolean(options.hideCities),
      hideRouteNames: Boolean(options.hideRouteNames),
    };
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const p = palette(opts.theme);

    if (opts.style === 'cinema' || opts.style === 'cinema-scene') {
      drawCinemaPoster(ctx, scenario, p, opts);
    } else if (opts.style === 'almanac') {
      drawAlmanacPoster(ctx, scenario, p, opts);
    } else {
      drawChroniclePoster(ctx, scenario, p, opts);
    }
    return canvas;
  }

  global.STORY_POSTER = {
    W,
    H,
    renderPoster,
  };
})(window);
