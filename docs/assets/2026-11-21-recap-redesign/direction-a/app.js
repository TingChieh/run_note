import { animateNumber, buildViewModel, formatDurationHM, formatKm, formatPace, initTheme, monthDay } from '../shared/data.js';
import { renderPosterA } from './poster.js';

const params = new URLSearchParams(window.location.search);
let currentScenario = params.get('scenario') || 'year-2025';
let vm = buildViewModel(currentScenario);
let selectedBucketIndex = -1;
let posterTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
let posterFollowsPage = true;

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  title: document.getElementById('recap-title'),
  status: document.getElementById('recap-status'),
  range: document.getElementById('recap-range'),
  issueTag: document.getElementById('issue-tag'),
  heroDistance: document.getElementById('hero-distance'),
  heroScaleFacts: document.getElementById('hero-scale-facts'),
  heroPeakBar: document.getElementById('hero-peak-bar'),
  heroPeakCaption: document.getElementById('hero-peak-caption'),
  heroActiveCaption: document.getElementById('hero-active-caption'),
  heroMetrics: document.getElementById('hero-metrics'),
  coverageNote: document.getElementById('coverage-note'),
  terrainInspector: document.getElementById('terrain-inspector'),
  terrainStage: document.getElementById('terrain-stage'),
  tableBody: document.querySelector('#data-table tbody'),
  attendanceSummary: document.getElementById('attendance-summary'),
  attendanceGrid: document.getElementById('attendance-grid'),
  paceSummary: document.getElementById('pace-summary'),
  paceStage: document.getElementById('pace-stage'),
  scenarioSelect: document.getElementById('scenario-select'),
  periodButtons: [...document.querySelectorAll('[data-period]')],
  dockPosterImg: document.getElementById('dock-poster-img'),
  dockPosterBtn: document.getElementById('dock-poster-btn'),
  toggleDockPosterTheme: document.getElementById('toggle-dock-poster-theme'),
  openShareTop: document.getElementById('open-share-top'),
  openShareDock: document.getElementById('open-share-dock'),
  dialog: document.getElementById('share-dialog'),
  closeShare: document.getElementById('close-share'),
  sharePreviewImg: document.getElementById('share-preview-img'),
  downloadPoster: document.getElementById('download-poster'),
  posterThemeBtns: [...document.querySelectorAll('[data-poster-theme-btn]')],
};

initTheme(els.themeToggle);
posterTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function defaultSelectedIndex(model) {
  const peakIdx = model.buckets.findIndex((b) => b.isPeak);
  if (peakIdx >= 0) return peakIdx;
  const lastObs = model.buckets.findLastIndex((b) => !b.isFuture);
  return Math.max(0, lastObs);
}

function updatePosterPreview() {
  const canvas = renderPosterA(vm, posterTheme);
  const dataUrl = canvas.toDataURL('image/png');
  els.dockPosterImg.src = dataUrl;
  els.sharePreviewImg.src = dataUrl;
  els.downloadPoster.href = dataUrl;
  els.downloadPoster.download = vm.filename;
  els.posterThemeBtns.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.posterThemeBtn === posterTheme));
  });
}

function renderInspector() {
  const b = vm.buckets[selectedBucketIndex];
  if (!b || b.isFuture) {
    els.terrainInspector.innerHTML = `<span>${b ? b.rangeShort : ''}</span><span class="ed-inspector-sep">|</span><span>尚未到达</span>`;
    return;
  }
  els.terrainInspector.innerHTML = `
    <strong>${b.rangeShort}${b.isPeak ? ' · 峰值' : ''}</strong>
    <span class="ed-inspector-sep">|</span>
    <span>里程 <strong>${formatKm(b.distance, 1)} km</strong></span>
    <span class="ed-inspector-sep">|</span>
    <span>${b.activity_count} 次 · ${b.activity_days} 天</span>
    <span class="ed-inspector-sep">|</span>
    <span>均配 ${formatPace(b.avg_pace_seconds_per_km)}</span>
  `;
}

function renderTerrain() {
  const W = 980;
  const H = 270;
  const padL = 42;
  const padR = 42;
  const padT = 36;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = vm.buckets.length;
  const stepX = n > 1 ? plotW / (n - 1) : plotW;
  const maxDist = Math.max(vm.maxDist, 1000);
  const maxCum = Math.max(vm.totalDistanceM, 1000);

  const pts = vm.buckets.map((b, i) => {
    const x = n === 1 ? padL + plotW / 2 : padL + i * stepX;
    const y = b.distance === null ? null : padT + plotH - (b.distance / maxDist) * (plotH - 18);
    const cy = b.cumulative === null ? null : padT + plotH - (b.cumulative / maxCum) * (plotH - 10);
    return { x, y, cy, b, i };
  });

  const valid = pts.filter((p) => p.y !== null);
  let curveD = '';
  let areaD = '';
  let cumD = '';

  if (valid.length >= 2) {
    curveD = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
    for (let i = 0; i < valid.length - 1; i++) {
      const cx = ((valid[i].x + valid[i + 1].x) / 2).toFixed(1);
      curveD += ` C ${cx} ${valid[i].y.toFixed(1)}, ${cx} ${valid[i + 1].y.toFixed(1)}, ${valid[i + 1].x.toFixed(1)} ${valid[i + 1].y.toFixed(1)}`;
    }
    areaD = `${curveD} L ${valid[valid.length - 1].x.toFixed(1)} ${padT + plotH} L ${valid[0].x.toFixed(1)} ${padT + plotH} Z`;

    cumD = valid
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.cy.toFixed(1)}`)
      .join(' ');
  }

  const guides = [0, 0.5, 1]
    .map((ratio) => {
      const y = (padT + plotH - ratio * (plotH - 18)).toFixed(1);
      const val = Math.round((maxDist * ratio) / 1000);
      return `
        <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-width="1" />
        <text x="${padL - 10}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="var(--muted-foreground)">${val}</text>
      `;
    })
    .join('');

  const cols = pts
    .map((p) => {
      const isSel = p.i === selectedBucketIndex;
      const colW = n > 1 ? Math.min(68, stepX * 0.85) : 90;
      const dotR = p.b.isPeak ? 7.5 : isSel ? 6.5 : 4.5;
      const dotFill = p.b.isPeak ? 'var(--recap-gold)' : 'var(--primary)';
      const valueText =
        p.y !== null && (p.b.isPeak || isSel)
          ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 14).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="${p.b.isPeak ? 'var(--foreground)' : 'var(--primary)'}">${formatKm(p.b.distance, 1)}</text>`
          : '';
      return `
        <g class="ed-hit-col" tabindex="0" role="button" data-bucket-index="${p.i}" aria-label="${p.b.rangeShort}，${p.b.distance === null ? '尚未到达' : `里程 ${formatKm(p.b.distance, 1)} 公里，跑步 ${p.b.activity_count} 次`}" aria-pressed="${isSel}">
          <rect class="ed-col-focus" x="${(p.x - colW / 2).toFixed(1)}" y="${padT - 8}" width="${colW.toFixed(1)}" height="${plotH + 14}" rx="10" fill="${isSel ? 'var(--primary-soft)' : 'transparent'}" opacity="${isSel ? '0.65' : '0'}" />
          ${p.y !== null ? `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${padT + plotH}" stroke="${p.b.isPeak ? 'var(--recap-gold)' : isSel ? 'var(--primary)' : 'var(--border)'}" stroke-width="${p.b.isPeak || isSel ? 2.5 : 1}" stroke-dasharray="${p.b.isPeak || isSel ? '' : '3 3'}" />` : ''}
          ${p.y !== null ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dotR}" fill="${dotFill}" stroke="var(--surface)" stroke-width="2.5" />` : `<circle cx="${p.x.toFixed(1)}" cy="${padT + plotH}" r="3.5" fill="var(--border)" />`}
          ${valueText}
          <text x="${p.x.toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="12" font-weight="${isSel || p.b.isPeak ? 700 : 500}" fill="${isSel || p.b.isPeak ? 'var(--foreground)' : 'var(--muted-foreground)'}">${p.b.shortLabel}</text>
        </g>
      `;
    })
    .join('');

  els.terrainStage.innerHTML = `
    <svg class="ed-terrain-svg tabular" viewBox="0 0 ${W} ${H}" role="img" aria-label="${vm.title}里程地形与累计曲线">
      <defs>
        <linearGradient id="edAreaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.32" />
          <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <text x="${padL - 10}" y="${padT - 12}" text-anchor="end" font-size="11" fill="var(--muted-foreground)">km</text>
      ${guides}
      ${cumD ? `<path class="ed-cum-path" d="${cumD}" fill="none" stroke="var(--muted-foreground)" stroke-width="1.75" />` : ''}
      ${areaD ? `<path d="${areaD}" fill="url(#edAreaFill)" />` : ''}
      ${curveD ? `<path class="ed-terrain-path" d="${curveD}" fill="none" stroke="var(--primary)" stroke-width="3.5" stroke-linecap="round" />` : ''}
      ${cols}
    </svg>
  `;

  els.terrainStage.querySelectorAll('.ed-hit-col').forEach((node) => {
    const idx = Number(node.dataset.bucketIndex);
    const select = () => {
      if (selectedBucketIndex === idx) return;
      selectedBucketIndex = idx;
      renderInspector();
      renderTerrain();
      renderAttendance();
    };
    node.addEventListener('click', select);
    node.addEventListener('mouseenter', select);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectedBucketIndex = Math.min(vm.buckets.length - 1, idx + 1);
        renderInspector();
        renderTerrain();
        renderAttendance();
        els.terrainStage.querySelector(`[data-bucket-index="${selectedBucketIndex}"]`)?.focus();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectedBucketIndex = Math.max(0, idx - 1);
        renderInspector();
        renderTerrain();
        renderAttendance();
        els.terrainStage.querySelector(`[data-bucket-index="${selectedBucketIndex}"]`)?.focus();
      }
    });
  });
}

function renderAttendance() {
  const maxDays = Math.max(1, ...vm.buckets.map((b) => b.activity_days ?? 0));
  els.attendanceSummary.textContent = `${vm.activityDays} 天 · ${vm.activityCount} 次`;
  els.attendanceGrid.innerHTML = vm.buckets
    .map((b, i) => {
      const r = 18;
      const circ = 2 * Math.PI * r;
      const ratio = b.activity_days ? Math.min(1, b.activity_days / maxDays) : 0;
      const offset = circ * (1 - ratio);
      const sel = i === selectedBucketIndex;
      return `
        <div class="ed-ring-cell tabular ${sel ? 'is-selected' : ''} ${b.isFuture ? 'is-future' : ''}" role="listitem" data-ring-idx="${i}">
          <svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true">
            <circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--border)" stroke-width="4" />
            ${
              !b.isFuture && b.activity_days > 0
                ? `<circle cx="23" cy="23" r="${r}" fill="none" stroke="${b.isPeak ? 'var(--recap-gold)' : 'var(--primary)'}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" transform="rotate(-90 23 23)" />`
                : ''
            }
            <text x="23" y="27" text-anchor="middle" font-size="11" font-weight="700" fill="var(--foreground)">${b.isFuture ? '—' : b.activity_days}</text>
          </svg>
          <span class="ed-ring-label">${b.shortLabel}</span>
          <span class="ed-ring-sub">${b.isFuture ? '未到' : `${b.activity_count} 次`}</span>
        </div>
      `;
    })
    .join('');

  els.attendanceGrid.querySelectorAll('[data-ring-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      selectedBucketIndex = Number(el.dataset.ringIdx);
      renderInspector();
      renderTerrain();
      renderAttendance();
    });
  });
}

function renderPaceChart() {
  const paced = vm.buckets
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !b.isFuture && b.avg_pace_seconds_per_km !== null);

  els.paceSummary.textContent = vm.fastestPace
    ? `最快 ${vm.derived.fastestLabel} · ${vm.derived.fastestPaceText}`
    : '暂无配速数据';

  if (paced.length < 2) {
    els.paceStage.innerHTML = '<p class="ed-footnote">该周期可用配速时段不足，无法绘制走势。</p>';
    return;
  }

  const W = 500;
  const H = 205;
  const padL = 50;
  const padR = 24;
  const padT = 26;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const minP = vm.fastestPace - 8;
  const maxP = vm.slowestPace + 8;
  const span = Math.max(10, maxP - minP);
  const n = vm.buckets.length;
  const stepX = n > 1 ? plotW / (n - 1) : plotW;

  // Inverted Y: faster (smaller sec/km) sits higher
  const pts = vm.buckets.map((b, i) => {
    const x = n === 1 ? padL + plotW / 2 : padL + i * stepX;
    const p = b.avg_pace_seconds_per_km;
    const y = p === null ? null : padT + ((p - minP) / span) * plotH;
    return { x, y, b };
  });

  const valid = pts.filter((pt) => pt.y !== null);
  let pathD = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
  for (let i = 0; i < valid.length - 1; i++) {
    const cx = ((valid[i].x + valid[i + 1].x) / 2).toFixed(1);
    pathD += ` C ${cx} ${valid[i].y.toFixed(1)}, ${cx} ${valid[i + 1].y.toFixed(1)}, ${valid[i + 1].x.toFixed(1)} ${valid[i + 1].y.toFixed(1)}`;
  }

  const yAvg = padT + ((vm.avgPaceSeconds - minP) / span) * plotH;

  const nodes = pts
    .map((pt) => {
      if (pt.y === null) {
        return `<text x="${pt.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">${pt.b.shortLabel}</text>`;
      }
      return `
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${pt.b.isFastest ? 6 : 3.8}" fill="${pt.b.isFastest ? 'var(--recap-gold)' : 'var(--primary)'}" stroke="var(--surface)" stroke-width="2" />
        ${pt.b.isFastest ? `<text x="${pt.x.toFixed(1)}" y="${(pt.y - 11).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--foreground)">${formatPace(pt.b.avg_pace_seconds_per_km)}</text>` : ''}
        <text x="${pt.x.toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" font-weight="${pt.b.isFastest ? 700 : 400}" fill="${pt.b.isFastest ? 'var(--foreground)' : 'var(--muted-foreground)'}">${pt.b.shortLabel}</text>
      `;
    })
    .join('');

  els.paceStage.innerHTML = `
    <svg class="ed-terrain-svg tabular" viewBox="0 0 ${W} ${H}" role="img" aria-label="各时段加权平均配速走势图">
      <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--border)" stroke-width="1" />
      <line x1="${padL}" y1="${yAvg.toFixed(1)}" x2="${W - padR}" y2="${yAvg.toFixed(1)}" stroke="var(--primary)" stroke-opacity="0.45" stroke-dasharray="4 4" />
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
      <text x="${padL - 8}" y="${padT + 4}" text-anchor="end" font-size="11" fill="var(--muted-foreground)">${formatPace(minP)}</text>
      <text x="${padL - 8}" y="${yAvg + 4}" text-anchor="end" font-size="11" font-weight="600" fill="var(--primary)">均 ${vm.avgPaceText}</text>
      <text x="${padL - 8}" y="${padT + plotH + 4}" text-anchor="end" font-size="11" fill="var(--muted-foreground)">${formatPace(maxP)}</text>
      <path class="ed-terrain-path" d="${pathD}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" />
      ${nodes}
    </svg>
  `;
}

function renderTable() {
  els.tableBody.innerHTML = vm.buckets
    .map(
      (b) => `
      <tr class="${b.isPeak ? 'is-peak' : ''}">
        <th scope="row">${b.label}${b.isPeak ? ' ★' : ''}${b.isPartial && !b.isFuture ? '（截断）' : ''}</th>
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

function renderAll(animate = true) {
  vm = buildViewModel(currentScenario);
  selectedBucketIndex = defaultSelectedIndex(vm);

  els.scenarioSelect.value = vm.id;
  els.periodButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.period === vm.period));
  });

  els.title.textContent = vm.title;
  els.range.textContent = vm.rangeText;
  els.issueTag.textContent = vm.issueTag;

  if (vm.cutoff) {
    els.status.hidden = false;
    els.status.textContent = `进行中 · 截至 ${monthDay(vm.cutoff)}`;
  } else {
    els.status.hidden = true;
  }

  if (animate) {
    animateNumber(els.heroDistance, vm.totalKm, (v) =>
      v.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    );
  } else {
    els.heroDistance.textContent = vm.distanceText;
  }

  els.heroScaleFacts.innerHTML = `
    <span>等效 <strong>${vm.derived.marathonsText}</strong></span>
    <span>单次均距 <strong>${vm.derived.avgRunKmText}</strong></span>
    <span>峰值 <strong>${vm.derived.peakLabel} · ${vm.derived.peakKmText}</strong></span>
  `;

  requestAnimationFrame(() => {
    els.heroPeakBar.style.width = `${Math.min(100, Math.max(12, vm.derived.peakSharePct * 2.1))}%`;
  });
  els.heroPeakCaption.textContent = `峰值占比 ${vm.derived.peakSharePct}%`;
  els.heroActiveCaption.textContent = vm.derived.activeRatioText;

  els.heroMetrics.innerHTML = vm.metrics
    .map(
      (m) => `
      <div class="ed-ledger-item">
        <dt>${m.label}</dt>
        <dd>
          <strong>${m.value}</strong>
          ${m.unit ? `<span>${m.unit}</span>` : ''}
          ${m.value === '—' ? '<span class="sr-only">（数据缺失）</span>' : ''}
        </dd>
      </div>
    `,
    )
    .join('');

  if (vm.coverageText) {
    els.coverageNote.hidden = false;
    els.coverageNote.textContent = `统计覆盖：${vm.coverageText}`;
  } else {
    els.coverageNote.hidden = true;
  }

  renderInspector();
  renderTerrain();
  renderAttendance();
  renderPaceChart();
  renderTable();
  updatePosterPreview();
}

// Event bindings
els.scenarioSelect.addEventListener('change', (e) => {
  currentScenario = e.target.value;
  renderAll(true);
});

els.periodButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetPeriod = btn.dataset.period;
    if (targetPeriod === vm.period) return;
    currentScenario =
      targetPeriod === 'month'
        ? vm.year === 2026
          ? 'month-2026-11'
          : 'month-2025-10'
        : vm.year === 2026
          ? 'year-2026'
          : 'year-2025';
    renderAll(true);
  });
});

let lastTrigger = null;
function openShare(trigger) {
  lastTrigger = trigger;
  updatePosterPreview();
  els.dialog.showModal();
}

els.openShareTop.addEventListener('click', () => openShare(els.openShareTop));
els.openShareDock.addEventListener('click', () => openShare(els.openShareDock));
els.dockPosterBtn.addEventListener('click', () => openShare(els.dockPosterBtn));

els.closeShare.addEventListener('click', () => els.dialog.close());
els.dialog.addEventListener('close', () => lastTrigger?.focus());

els.toggleDockPosterTheme.addEventListener('click', () => {
  posterFollowsPage = false;
  posterTheme = posterTheme === 'light' ? 'dark' : 'light';
  updatePosterPreview();
});

els.posterThemeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    posterFollowsPage = false;
    posterTheme = btn.dataset.posterThemeBtn;
    updatePosterPreview();
  });
});

window.addEventListener('rn-theme-change', (e) => {
  if (posterFollowsPage) {
    posterTheme = e.detail.theme;
    updatePosterPreview();
  }
});

// Expose hook for automated screenshot & poster capture
window.__RN_RECAP__ = {
  setScenario(id) {
    currentScenario = id;
    renderAll(false);
  },
  renderPoster(theme) {
    return renderPosterA(vm, theme).toDataURL('image/png');
  },
};

renderAll(true);
