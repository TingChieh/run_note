// RunNote Editorial Receipt prototypes: theme/page switching, icon sprite and deterministic synthetic data.
// Design-only. All numbers are synthetic and match the synthetic fixtures used in existing docs screenshots.
(function () {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;

  const ICONS = {
    home: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',
    records: 'M5 20V10 M12 20V4 M19 20v-7 M3 20h18',
    activities: 'M4 5h16v15H4z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h7',
    together: 'M3 20h18 M7 17l2-6 3 2 2-6 3 2 2 8 M13 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
    footprints: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
    routes: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5',
    ai: 'm12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',
    wellbeing: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z M9 12h2l1-2 1.5 4 1-2H17',
    plus: 'M12 5v14 M5 12h14',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    chevron: 'm6 9 6 6 6-6',
    left: 'm15 18-6-6 6-6',
    right: 'm9 6 6 6-6 6',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    back: 'M19 12H5 M11 18l-6-6 6-6',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
    layers: 'm12 3 9 5-9 5-9-5z M3 13l9 5 9-5',
    play: 'M7 4v16l13-8z',
    pause: 'M8 5v14 M16 5v14',
    lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3',
    check: 'm5 12 5 5 9-10',
    alert: 'M12 3 2 21h20z M12 10v5 M12 18h.01',
    cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z',
    offline: 'M3 3l18 18 M8.5 8.6A5 5 0 0 0 7 18h10 M12 6.1A6 6 0 0 1 19 10a4 4 0 0 1 1.5 7.2',
    share: 'M12 15V3 M7 8l5-5 5 5 M5 13v7h14v-7',
    edit: 'M4 20h4L19 9l-4-4L4 16z',
    close: 'M6 6l12 12 M18 6 6 18',
    today: 'M3 10 12 3l9 7v10H3z M9 20v-7h6v7',
    explore: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',
    me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
    gps: 'M12 2v3 M12 19v3 M2 12h3 M19 12h3 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    shoe: 'M3 16h18v3H3z M3 16l1-8 5 2 3 3 6 1 3 2',
    replay: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  };
  window.icon = (name, size) =>
    `<svg viewBox="0 0 24 24" width="${size || 18}" height="${size || 18}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

  // Seeded PRNG so screenshots are reproducible.
  let seed = 20261126;
  window.rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // Year heatmap: 53 columns x 7 rows; level 0–4 ≈ run count/day (synthetic).
  window.heatmap = (weeks, density, until) => {
    let html = '';
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const idx = w * 7 + d;
        if (until !== undefined && idx > until) { html += '<i class="x"></i>'; continue; }
        const r = rand();
        let l = 0;
        if (r < density) l = r < density * 0.15 ? 4 : r < density * 0.4 ? 3 : r < density * 0.75 ? 2 : 1;
        html += `<i class="${l ? 'l' + l : ''}"></i>`;
      }
    }
    return html;
  };

  // Punch-card columns: values in km, peak index highlighted, null = no data.
  window.punch = (labels, values, blocks) => {
    const max = Math.max(...values.filter((v) => v !== null));
    const peak = values.indexOf(max);
    return labels
      .map((lbl, i) => {
        const v = values[i];
        const n = v ? Math.max(1, Math.round((v / max) * blocks)) : 1;
        const cls = v ? (i === peak ? 'col peak' : 'col') : 'col empty';
        return `<div class="${cls}" title="${lbl} ${v === null ? '无数据' : v + ' km'}"><div class="stack">${'<i class="blk"></i>'.repeat(n)}</div><span class="lbl">${lbl}</span></div>`;
      })
      .join('');
  };

  // Synthetic route shapes (normalised 0..100 coordinates).
  window.ROUTES = {
    interval: 'M14 22 L40 22 L52 21 L66 30 L74 34 L90 34 L90 58 L96 64 L104 66 L108 82 L118 82 L114 64 L104 52 L108 48 L116 44 L110 30',
    park: 'M20 70 C 18 50, 30 30, 52 26 C 70 22, 84 34, 82 50 C 80 66, 64 78, 46 80 C 34 82, 24 80, 20 70 Z',
    river: 'M10 80 C 24 70, 30 56, 44 52 S 70 40, 76 26 S 92 10, 96 12',
    loop5k: 'M30 74 L28 40 C 28 28, 40 20, 54 22 L74 26 C 84 28, 86 40, 80 48 L66 62 C 58 70, 46 76, 30 74 Z',
  };


  // Local map paper: grid + synthetic roads/water + route. Used when the basemap is off / failed (the default fallback look).
  let mapId = 0;
  window.mapSVG = (route, opt = {}) => {
    const id = 'mg' + mapId++;
    const w = opt.w || 130, h = opt.h || 100;
    const markers = opt.markers === false ? '' : (() => {
      const m = ROUTES[route].match(/M\s*([\d.]+)[ ,]([\d.]+)/);
      const nums = ROUTES[route].match(/[\d.]+/g).map(Number);
      const ex = nums[nums.length - 2], ey = nums[nums.length - 1];
      const closed = /Z\s*$/.test(ROUTES[route]);
      return `<circle cx="${m[1]}" cy="${m[2]}" r="1.5" style="fill:var(--primary);stroke:var(--paper);stroke-width:0.7"/>` +
        (closed ? '' : `<rect x="${ex - 1.3}" y="${ey - 1.3}" width="2.6" height="2.6" style="fill:var(--foreground);stroke:var(--paper);stroke-width:0.7"/>`);
    })();
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" style="stroke:var(--map-grid)" stroke-width="0.35"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#${id})"/>
      <path d="M${w * 0.78} 0 C ${w * 0.7} 30, ${w * 0.86} 60, ${w * 0.8} ${h} L ${w} ${h} L ${w} 0 Z" style="fill:var(--map-water)"/>
      <g style="stroke:var(--map-road)" stroke-width="2.2" fill="none" stroke-linecap="round">
        <path d="M0 ${h * 0.3} L ${w} ${h * 0.22}"/><path d="M${w * 0.25} 0 L ${w * 0.32} ${h}"/>
        <path d="M0 ${h * 0.72} C ${w * 0.3} ${h * 0.66}, ${w * 0.5} ${h * 0.8}, ${w} ${h * 0.7}"/><path d="M${w * 0.58} 0 L ${w * 0.52} ${h}"/>
      </g>
      <path d="${ROUTES[route]}" fill="none" style="stroke:var(--paper)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <path d="${ROUTES[route]}" fill="none" style="stroke:var(--route)" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${markers}
    </svg>`;
  };
  window.thumbSVG = (route) =>
    `<svg viewBox="0 0 130 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${ROUTES[route]}" fill="none" style="stroke:var(--route)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;

  // 9:16 receipt share poster, laid out in container units (1cqw = 10.8 poster px) so it scales to any preview width.
  // Mirrors drawReceipt() in frontend/src/lib/share/recap-render.ts (style C 存根).
  window.posterHTML = () => {
    const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    const km = [72.4, 61.8, 88.2, 95.6, 102.3, 76.5, 58.9, 69.4, 98.7, 126.4, 104.1, 88.38];
    let bars = '';
    for (let i = 0; i < 36; i++) { const r = km[i % 12] / 126.4; bars += `<i style="height:${(2.2 + r * 4.8).toFixed(2)}cqw;width:${(0.9 + r * 0.9).toFixed(2)}cqw"></i>`; }
    return `<div class="poster" role="img" aria-label="2025 年度跑步回顾分享图预览：1,042.68 公里，118 次，104 天，平均配速 5 分 16 秒每公里">
      <div class="p-sheet">
        <div class="p-cap"><span class="p-brand"><b>R</b>RunNote</span><span>ANNUAL RECEIPT · 2025</span></div>
        <div class="p-body">
          <div class="p-title">2025 跑步年度回顾</div>
          <div class="p-range">2025.01.01 — 2025.12.31</div>
          <div class="p-stamp"><span>SEALED</span><strong>12/12</strong><span>ACTIVE MOS</span></div>
          <div class="p-kicker">TOTAL MILEAGE · 核销里程</div>
          <div class="p-hero">1,042.68<em>KM</em></div>
          <div class="p-eq">等效 24.7 场全马 · 单次均距 8.84 km</div>
          <div class="p-perf"></div>
          <div class="p-row"><span class="p-kicker">02 · PUNCH-CARD RHYTHM</span><span class="p-tagr">PEAK · 10月 126.4 km</span></div>
          <div class="p-well"><div class="punch">${punch(months, km, 10)}</div></div>
          <div class="p-perf"></div>
          <div class="p-row"><span class="p-kicker">03 · VERIFIED SUMMARY</span><span class="p-tagr muted">FASTEST 10月 · 4:25/km</span></div>
          <ul class="p-ledger">
            <li><span>跑步次数</span><i></i><b>118 次</b></li>
            <li><span>活动天数</span><i></i><b>104 天</b></li>
            <li><span>总用时</span><i></i><b>91 h 24 m</b></li>
            <li><span>平均配速</span><i></i><b>5:16 /km</b></li>
          </ul>
          <div class="p-print">${bars}</div>
          <div class="p-row p-foot"><span>MILEAGE FINGERPRINT · RUNNOTE</span><span>118 RUNS · 104 DAYS</span></div>
        </div>
      </div>
    </div>`;
  };

  // The poster has its own appearance (浅色纸面 / 深色暖炭), independent of the page; the preview shows the selected one.
  window.syncPosterTheme = (frameId) => {
    const frame = document.getElementById(frameId);
    frame.dataset.theme = theme;
    const group = frame.parentElement.querySelector('[aria-label="海报外观"]');
    if (group) group.querySelectorAll('label').forEach((l, i) => l.setAttribute('aria-checked', String((i === 1) === (theme === 'dark'))));
  };

  document.addEventListener('DOMContentLoaded', () => {
    // Fill [data-icon] placeholders.
    document.querySelectorAll('[data-icon]').forEach((el) => {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.dataset.size));
    });
    // Page / screen switching (?page= for web, ?screen= for mobile).
    const key = params.get('page') || params.get('screen');
    const pages = document.querySelectorAll('[data-page]');
    if (pages.length) {
      const fallback = pages[0].dataset.page;
      const want = key && document.querySelector(`[data-page="${key}"]`) ? key : fallback;
      pages.forEach((p) => (p.hidden = p.dataset.page !== want));
      document.querySelectorAll('[data-nav]').forEach((a) => {
        if (a.dataset.nav === want || (a.dataset.navAlso || '').split(' ').includes(want)) a.setAttribute('aria-current', 'page');
      });
      document.body.dataset.current = want;
    }
    // Theme toggle keeps the current page.
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const next = new URLSearchParams(location.search);
        next.set('theme', theme === 'dark' ? 'light' : 'dark');
        location.search = next.toString();
      });
    });
    // Links keep theme.
    document.querySelectorAll('a[data-keep]').forEach((a) => {
      const u = new URL(a.getAttribute('href'), location.href);
      u.searchParams.set('theme', theme);
      a.setAttribute('href', u.pathname.split('/').pop() + u.search);
    });
  });
})();
