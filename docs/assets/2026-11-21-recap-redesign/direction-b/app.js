import { buildViewModel, formatDurationHM, formatKm, formatPace, initTheme, monthDay } from '../shared/data.js';
import { renderPosterB } from './poster.js';

const params = new URLSearchParams(window.location.search);
let currentScenario = params.get('scenario') || 'year-2025';
let vm = buildViewModel(currentScenario);
let focusedIndex = -1; // -1 means full period total
let posterTheme = 'light';
let posterFollowsPage = true;

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  beacon: document.getElementById('status-beacon'),
  statusCode: document.getElementById('status-code'),
  title: document.getElementById('recap-title'),
  scenarioSelect: document.getElementById('scenario-select'),
  periodButtons: [...document.querySelectorAll('[data-period]')],
  dialModeLabel: document.getElementById('dial-mode-label'),
  resetFocus: document.getElementById('reset-focus'),
  dialWrap: document.getElementById('dial-wrap'),
  chronoContext: document.getElementById('chrono-context'),
  lapsPill: document.getElementById('laps-pill'),
  chronoMetrics: document.getElementById('chrono-metrics'),
  paceRangeText: document.getElementById('pace-range-text'),
  paceGauge: document.getElementById('pace-gauge'),
  peakCallout: document.getElementById('peak-callout'),
  activeCallout: document.getElementById('active-callout'),
  coverageNote: document.getElementById('coverage-note'),
  splitsList: document.getElementById('splits-list'),
  tableBody: document.querySelector('#data-table tbody'),
  miniPosterImg: document.getElementById('mini-poster-img'),
  miniPosterTrigger: document.getElementById('mini-poster-trigger'),
  flipPosterTheme: document.getElementById('flip-poster-theme'),
  openShare: document.getElementById('open-share'),
  openShareBottom: document.getElementById('open-share-bottom'),
  dialog: document.getElementById('share-dialog'),
  closeShare: document.getElementById('close-share'),
  sharePreviewImg: document.getElementById('share-preview-img'),
  downloadPoster: document.getElementById('download-poster'),
  posterThemeBtns: [...document.querySelectorAll('[data-poster-theme-btn]')],
};

initTheme(els.themeToggle);
posterTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function polar(cx, cy, r, angleRad) {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

function sectorPath(cx, cy, rIn, rOut, a0, a1) {
  const [x0, y0] = polar(cx, cy, rOut, a0);
  const [x1, y1] = polar(cx, cy, rOut, a1);
  const [x2, y2] = polar(cx, cy, rIn, a1);
  const [x3, y3] = polar(cx, cy, rIn, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rOut} ${rOut} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} A ${rIn} ${rIn} 0 ${large} 0 ${x3.toFixed(1)} ${y3.toFixed(1)} Z`;
}

function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function updatePoster() {
  const url = renderPosterB(vm, posterTheme).toDataURL('image/png');
  els.miniPosterImg.src = url;
  els.sharePreviewImg.src = url;
  els.downloadPoster.href = url;
  els.downloadPoster.download = vm.filename;
  els.posterThemeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.posterThemeBtn === posterTheme)));
}

function renderDial() {
  const S = 420;
  const cx = S / 2;
  const cy = S / 2;
  const focus = focusedIndex >= 0 ? vm.buckets[focusedIndex] : null;
  els.resetFocus.hidden = !focus;
  els.dialModeLabel.textContent =
    vm.period === 'year' ? 'TRACK DIAL · 12 MONTHS' : `STADIUM LANES · ${vm.buckets.length} WEEKS`;

  let graphics = '';

  if (vm.period === 'year') {
    const maxD = Math.max(vm.maxDist, 1000);
    const rIn = 96;
    const rMax = 178;
    const step = (Math.PI * 2) / 12;

    const rings = [96, 126, 154, 182]
      .map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="1" />`)
      .join('');

    const sectors = vm.buckets
      .map((b, i) => {
        const mid = -Math.PI / 2 + i * step;
        const a0 = mid - step * 0.36;
        const a1 = mid + step * 0.36;
        const isSel = i === focusedIndex;
        const dimmed = focusedIndex >= 0 && !isSel;
        const [lx, ly] = polar(cx, cy, 196, mid);

        let shape = '';
        if (b.distance !== null && b.distance > 0) {
          const rOut = rIn + 14 + (b.distance / maxD) * (rMax - rIn - 14);
          const fill = b.isPeak ? 'var(--sport-yellow)' : 'var(--primary)';
          shape = `<path class="st-dial-stroke" d="${sectorPath(cx, cy, rIn, rOut, a0, a1)}" fill="${fill}" opacity="${dimmed ? 0.28 : isSel || b.isPeak ? 1 : 0.78}" stroke="${isSel ? 'var(--foreground)' : 'none'}" stroke-width="2" />`;
        } else {
          shape = `<path d="${arcPath(cx, cy, rIn + 8, a0, a1)}" fill="none" stroke="var(--border)" stroke-width="4" stroke-linecap="round" />`;
        }

        return `
          <g class="st-dial-arc" tabindex="0" role="button" data-idx="${i}" aria-label="${b.rangeShort}，${b.distance === null ? '未到' : `${formatKm(b.distance, 1)} 公里`}" aria-pressed="${isSel}">
            ${shape}
            <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="${isSel || b.isPeak ? 700 : 500}" fill="${isSel || b.isPeak ? 'var(--foreground)' : 'var(--muted-foreground)'}">${b.shortLabel}</text>
          </g>
        `;
      })
      .join('');

    graphics = rings + sectors;
  } else {
    // Monthly concentric lanes
    const maxD = Math.max(vm.maxDist, 1000);
    const startA = Math.PI * 0.76;
    const sweepMax = Math.PI * 1.48;
    const outerR = 178;
    const laneGap = 17;

    graphics = vm.buckets
      .map((b, i) => {
        const r = outerR - i * laneGap;
        const isSel = i === focusedIndex;
        const dimmed = focusedIndex >= 0 && !isSel;
        const [lx, ly] = polar(cx, cy, r, startA - 0.13);
        const sweep = b.distance ? Math.max(0.14, (b.distance / maxD) * sweepMax) : 0;
        const strokeColor = b.isPeak ? 'var(--sport-yellow)' : 'var(--primary)';
        return `
          <g class="st-dial-arc" tabindex="0" role="button" data-idx="${i}" aria-label="${b.label}（${b.rangeShort}），${b.distance === null ? '未到' : `${formatKm(b.distance, 1)} 公里`}" aria-pressed="${isSel}">
            <path d="${arcPath(cx, cy, r, startA, startA + sweepMax)}" fill="none" stroke="var(--border)" stroke-width="11" stroke-linecap="round" opacity="0.65" />
            ${
              sweep > 0
                ? `<path class="st-dial-stroke" d="${arcPath(cx, cy, r, startA, startA + sweep)}" fill="none" stroke="${strokeColor}" stroke-width="${isSel ? 13 : 11}" stroke-linecap="round" opacity="${dimmed ? 0.28 : 1}" />`
                : ''
            }
            <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${isSel || b.isPeak ? 'var(--foreground)' : 'var(--muted-foreground)'}">${b.shortLabel}</text>
          </g>
        `;
      })
      .join('');
  }

  const centerKicker = focus ? `${focus.label} · ${focus.rangeShort}` : 'TOTAL DISTANCE';
  const centerValue = focus ? (focus.distance === null ? '未到' : formatKm(focus.distance, 1)) : vm.distanceText;
  const centerSub = focus
    ? focus.distance === null
      ? '尚未开始'
      : `${focus.activity_count} 次 · 均配 ${formatPace(focus.avg_pace_seconds_per_km)}`
    : `等效 ${vm.derived.marathonsText}`;

  els.dialWrap.innerHTML = `
    <svg class="st-dial-svg tabular" viewBox="0 0 ${S} ${S}" role="img" aria-label="${vm.title}环道里程仪表">
      ${graphics}
      <circle cx="${cx}" cy="${cy}" r="84" fill="var(--background)" stroke="var(--border)" stroke-width="1.5" />
      <text x="${cx}" y="${cy - 30}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--muted-foreground)">${centerKicker}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="38" font-weight="700" fill="var(--primary)">${centerValue}</text>
      <text x="${cx}" y="${cy + 36}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--foreground)">${focus && focus.distance === null ? '' : 'km'}</text>
      <text x="${cx}" y="${cy + 58}" text-anchor="middle" font-size="10.5" fill="var(--muted-foreground)">${centerSub}</text>
    </svg>
  `;

  els.dialWrap.querySelectorAll('.st-dial-arc').forEach((node) => {
    const idx = Number(node.dataset.idx);
    const toggle = () => {
      focusedIndex = focusedIndex === idx ? -1 : idx;
      renderDial();
      renderChrono();
      renderSplits();
    };
    node.addEventListener('click', toggle);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function renderChrono() {
  const focus = focusedIndex >= 0 && !vm.buckets[focusedIndex].isFuture ? vm.buckets[focusedIndex] : null;
  const accents = ['var(--primary)', 'var(--sport-green)', 'var(--sport-blue)', 'var(--sport-yellow)'];

  if (focus) {
    els.chronoContext.textContent = `${focus.label}（${focus.start} 至 ${focus.last}）`;
    els.lapsPill.textContent = `${Math.round(focus.distance / 400).toLocaleString('zh-CN')} 圈 · 400m`;
  } else {
    els.chronoContext.textContent = '全周期服务端聚合';
    els.lapsPill.textContent = `${vm.derived.trackLapsText} · 400m`;
  }

  const cells = focus
    ? [
        { label: '跑步次数', value: String(focus.activity_count), unit: '次' },
        { label: '跑步天数', value: String(focus.activity_days), unit: '天' },
        { label: '总用时', value: formatDurationHM(focus.duration_sum_seconds), unit: '时:分' },
        { label: '平均配速', value: formatPace(focus.avg_pace_seconds_per_km), unit: '/km' },
      ]
    : vm.metrics;

  els.chronoMetrics.innerHTML = cells
    .map(
      (m, i) => `
      <div class="st-chrono-cell" style="--cell-accent:${accents[i]}">
        <dt>${m.label}</dt>
        <dd><strong>${m.value}</strong>${m.unit ? `<span>${m.unit}</span>` : ''}</dd>
      </div>
    `,
    )
    .join('');

  // Pace caliper bar
  if (vm.fastestPace !== null && vm.slowestPace !== null) {
    els.paceRangeText.textContent = `最快 ${formatPace(vm.fastestPace)} · 均 ${vm.avgPaceText} · 最慢 ${formatPace(vm.slowestPace)}`;
    const span = Math.max(10, vm.slowestPace - vm.fastestPace);
    const dots = vm.buckets
      .filter((b) => !b.isFuture && b.avg_pace_seconds_per_km !== null)
      .map((b) => {
        // left = faster, right = slower
        const pct = 8 + ((b.avg_pace_seconds_per_km - vm.fastestPace) / span) * 84;
        const color = b.isFastest ? 'var(--sport-yellow)' : 'var(--primary)';
        const size = b.isFastest ? 12 : 8;
        return `<span title="${b.rangeShort} 均配 ${formatPace(b.avg_pace_seconds_per_km)}" style="position:absolute;top:50%;left:${pct.toFixed(1)}%;width:${size}px;height:${size}px;transform:translate(-50%,-50%);border-radius:999px;background:${color};border:2px solid var(--surface);"></span>`;
      })
      .join('');
    const avgPct = 8 + ((vm.avgPaceSeconds - vm.fastestPace) / span) * 84;
    els.paceGauge.innerHTML = `
      <span style="position:absolute;top:0;bottom:0;left:${avgPct.toFixed(1)}%;width:2px;background:var(--foreground);opacity:0.35;"></span>
      ${dots}
    `;
  } else {
    els.paceRangeText.textContent = '暂无可用配速';
    els.paceGauge.innerHTML = '';
  }

  els.peakCallout.textContent = `峰值 ${vm.derived.peakLabel} · ${vm.derived.peakKmText}`;
  els.activeCallout.textContent = vm.derived.activeRatioText;

  if (vm.coverageText) {
    els.coverageNote.hidden = false;
    els.coverageNote.textContent = `数据覆盖提示：${vm.coverageText}`;
  } else {
    els.coverageNote.hidden = true;
  }
}

function renderSplits() {
  const maxD = Math.max(vm.maxDist, 1000);
  els.splitsList.innerHTML = vm.buckets
    .map((b, i) => {
      const pct = b.distance ? Math.max(4, (b.distance / maxD) * 100) : 0;
      const isAct = i === focusedIndex;
      return `
        <div class="st-split-row tabular ${isAct ? 'is-active' : ''} ${b.isFuture ? 'is-future' : ''}" role="listitem" data-split-idx="${i}">
          <span class="st-split-name">
            ${b.label}
            ${b.isPeak ? '<i class="st-dot st-dot-peak" title="峰值里程"></i>' : ''}
            ${b.isFastest ? '<i class="st-dot st-dot-fast" title="最快均配"></i>' : ''}
          </span>
          <div class="st-split-track" aria-hidden="true">
            <div class="st-split-fill ${b.isPeak ? 'is-peak' : ''}" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <span class="st-split-km">${b.isFuture ? '未到' : `${formatKm(b.distance, 1)} km`}</span>
          <span class="st-split-freq">${b.isFuture ? '—' : `${b.activity_count}次 · ${b.activity_days}天`}</span>
          <span class="st-split-pace ${b.isFastest ? 'is-fast' : ''}">${b.isFuture ? '—' : formatPace(b.avg_pace_seconds_per_km)}</span>
        </div>
      `;
    })
    .join('');

  els.splitsList.querySelectorAll('[data-split-idx]').forEach((row) => {
    const idx = Number(row.dataset.splitIdx);
    if (vm.buckets[idx].isFuture) return;
    row.addEventListener('click', () => {
      focusedIndex = focusedIndex === idx ? -1 : idx;
      renderDial();
      renderChrono();
      renderSplits();
    });
  });
}

function renderTable() {
  els.tableBody.innerHTML = vm.buckets
    .map(
      (b) => `
      <tr class="${b.isPeak ? 'is-peak' : ''}">
        <th scope="row">${b.label}${b.isPeak ? ' ★' : ''}</th>
        <td>${b.start} 至 ${b.last}</td>
        <td class="num">${b.isFuture ? '未到' : formatKm(b.distance, 2)}</td>
        <td class="num">${b.isFuture ? '—' : b.activity_count}</td>
        <td class="num">${b.isFuture ? '—' : b.activity_days}</td>
        <td class="num">${b.isFuture ? '—' : formatPace(b.avg_pace_seconds_per_km)}</td>
      </tr>
    `,
    )
    .join('');
}

function renderAll() {
  vm = buildViewModel(currentScenario);
  focusedIndex = -1;
  els.scenarioSelect.value = vm.id;
  els.periodButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === vm.period)));

  els.title.textContent = vm.title;
  els.beacon.classList.toggle('is-live', Boolean(vm.cutoff));
  els.statusCode.textContent = vm.cutoff
    ? `LIVE · 进行中 · 截至 ${monthDay(vm.cutoff)} · ${vm.rangeText}`
    : `SEALED · ${vm.rangeText}`;

  renderDial();
  renderChrono();
  renderSplits();
  renderTable();
  updatePoster();
}

els.scenarioSelect.addEventListener('change', (e) => {
  currentScenario = e.target.value;
  renderAll();
});

els.periodButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = btn.dataset.period;
    if (p === vm.period) return;
    currentScenario = p === 'month' ? (vm.year === 2026 ? 'month-2026-11' : 'month-2025-10') : vm.year === 2026 ? 'year-2026' : 'year-2025';
    renderAll();
  });
});

els.resetFocus.addEventListener('click', () => {
  focusedIndex = -1;
  renderDial();
  renderChrono();
  renderSplits();
});

let lastTrigger = null;
const openDialog = (t) => {
  lastTrigger = t;
  updatePoster();
  els.dialog.showModal();
};
els.openShare.addEventListener('click', () => openDialog(els.openShare));
els.openShareBottom.addEventListener('click', () => openDialog(els.openShareBottom));
els.miniPosterTrigger.addEventListener('click', () => openDialog(els.miniPosterTrigger));
els.closeShare.addEventListener('click', () => els.dialog.close());
els.dialog.addEventListener('close', () => lastTrigger?.focus());

els.flipPosterTheme.addEventListener('click', () => {
  posterFollowsPage = false;
  posterTheme = posterTheme === 'light' ? 'dark' : 'light';
  updatePoster();
});

els.posterThemeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    posterFollowsPage = false;
    posterTheme = btn.dataset.posterThemeBtn;
    updatePoster();
  });
});

window.addEventListener('rn-theme-change', (e) => {
  if (posterFollowsPage) {
    posterTheme = e.detail.theme;
    updatePoster();
  }
});

window.__RN_RECAP__ = {
  setScenario(id) {
    currentScenario = id;
    renderAll();
  },
  renderPoster(theme) {
    return renderPosterB(vm, theme).toDataURL('image/png');
  },
};

renderAll();
