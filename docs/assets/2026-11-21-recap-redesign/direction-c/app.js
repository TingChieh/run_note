import { buildViewModel, formatDurationHM, formatKm, formatPace, initTheme, monthDay } from '../shared/data.js';
import { renderPosterC } from './poster.js';

const params = new URLSearchParams(window.location.search);
let currentScenario = params.get('scenario') || 'year-2025';
let vm = buildViewModel(currentScenario);
let selectedIndex = 0;
let posterTheme = 'light';
let posterFollowsPage = true;

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  title: document.getElementById('recap-title'),
  scenarioSelect: document.getElementById('scenario-select'),
  periodButtons: [...document.querySelectorAll('[data-period]')],
  ticketIssue: document.getElementById('ticket-issue'),
  ticketRange: document.getElementById('ticket-range'),
  ticketDistance: document.getElementById('ticket-distance'),
  ticketEq: document.getElementById('ticket-eq'),
  stampTop: document.getElementById('stamp-top'),
  stampMid: document.getElementById('stamp-mid'),
  stampBot: document.getElementById('stamp-bot'),
  ticketMetrics: document.getElementById('ticket-metrics'),
  coverageNote: document.getElementById('coverage-note'),
  punchPeakTag: document.getElementById('punch-peak-tag'),
  punchBoard: document.getElementById('punch-board'),
  slipDetail: document.getElementById('slip-detail'),
  fastestTag: document.getElementById('fastest-tag'),
  ledgerRows: document.getElementById('ledger-rows'),
  mileageBarcode: document.getElementById('mileage-barcode'),
  barcodeSummary: document.getElementById('barcode-summary'),
  tableBody: document.querySelector('#data-table tbody'),
  railPosterImg: document.getElementById('rail-poster-img'),
  railPosterBtn: document.getElementById('rail-poster-btn'),
  flipPosterTheme: document.getElementById('flip-poster-theme'),
  openShareRail: document.getElementById('open-share-rail'),
  openShareMobile: document.getElementById('open-share-mobile'),
  dialog: document.getElementById('share-dialog'),
  closeShare: document.getElementById('close-share'),
  sharePreviewImg: document.getElementById('share-preview-img'),
  downloadPoster: document.getElementById('download-poster'),
  posterThemeBtns: [...document.querySelectorAll('[data-poster-theme-btn]')],
};

initTheme(els.themeToggle);
posterTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function defaultIdx(model) {
  const peak = model.buckets.findIndex((b) => b.isPeak);
  return peak >= 0 ? peak : 0;
}

function updatePoster() {
  const url = renderPosterC(vm, posterTheme).toDataURL('image/png');
  els.railPosterImg.src = url;
  els.sharePreviewImg.src = url;
  els.downloadPoster.href = url;
  els.downloadPoster.download = vm.filename;
  els.posterThemeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.posterThemeBtn === posterTheme)));
}

function renderSlipDetail() {
  const b = vm.buckets[selectedIndex];
  if (!b || b.isFuture) {
    els.slipDetail.innerHTML = `<span>${b ? b.label : ''}</span><span>尚未开始</span>`;
    return;
  }
  els.slipDetail.innerHTML = `
    <span><strong>${b.label}</strong>（${b.start} 至 ${b.last}）${b.isPeak ? ' · 峰值' : ''}</span>
    <span>里程 <strong>${formatKm(b.distance, 1)} km</strong> · ${b.activity_count} 次 · ${b.activity_days} 天 · 均配 ${formatPace(b.avg_pace_seconds_per_km)}</span>
  `;
}

function renderPunchBoard() {
  const maxD = Math.max(vm.maxDist, 1000);
  const maxBlocks = 9;
  els.punchBoard.style.setProperty('--cols', String(vm.buckets.length));
  els.punchPeakTag.textContent = `PEAK · ${vm.derived.peakLabel} ${vm.derived.peakKmText}`;

  els.punchBoard.innerHTML = vm.buckets
    .map((b, i) => {
      const sel = i === selectedIndex;
      let blocks = '';
      if (b.distance !== null && b.distance > 0) {
        const count = Math.max(1, Math.round((b.distance / maxD) * maxBlocks));
        for (let k = 0; k < count; k++) blocks += '<span class="rc-block"></span>';
      } else {
        blocks = '<span class="rc-block-empty"></span>';
      }
      return `
        <button type="button" class="rc-punch-col ${b.isPeak ? 'is-peak' : ''}" data-idx="${i}" aria-pressed="${sel}" aria-label="${b.rangeShort}，${b.distance === null ? '未到' : `${formatKm(b.distance, 1)} 公里`}">
          <span class="rc-punch-stack" aria-hidden="true">${blocks}</span>
          <span class="rc-punch-label">${b.shortLabel}</span>
        </button>
      `;
    })
    .join('');

  els.punchBoard.querySelectorAll('.rc-punch-col').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedIndex = Number(btn.dataset.idx);
      renderPunchBoard();
      renderSlipDetail();
    });
  });
}

function renderLedgerAndBarcode() {
  const maxD = Math.max(vm.maxDist, 1000);
  els.fastestTag.textContent = `FASTEST ${vm.derived.fastestLabel} · ${vm.derived.fastestPaceText}`;

  els.ledgerRows.innerHTML = vm.buckets
    .map((b) => {
      const pct = b.distance ? Math.max(5, (b.distance / maxD) * 100) : 0;
      return `
        <div class="rc-ledger-row ${b.isPeak ? 'is-peak' : ''} ${b.isFastest ? 'is-fast' : ''}">
          <span>${b.label}</span>
          <div class="rc-ledger-bar-wrap" aria-hidden="true">
            <div class="rc-ledger-bar" style="width:${pct.toFixed(1)}%"></div>
          </div>
          <span class="rc-ledger-num">${b.isFuture ? '未到' : `${formatKm(b.distance, 1)} km`}</span>
          <span class="rc-ledger-num">${b.isFuture ? '—' : formatPace(b.avg_pace_seconds_per_km)}</span>
        </div>
      `;
    })
    .join('');

  // Decorative mileage fingerprint barcode
  const bars = 32;
  let html = '';
  for (let i = 0; i < bars; i++) {
    const b = vm.buckets[i % vm.buckets.length];
    const ratio = b.distance ? b.distance / maxD : 0.14;
    const h = Math.round(28 + ratio * 72);
    html += `<span style="height:${h}%"></span>`;
  }
  els.mileageBarcode.innerHTML = html;
  els.barcodeSummary.textContent = `${vm.activityCount} RUNS · ${vm.activityDays} DAYS`;
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
  selectedIndex = defaultIdx(vm);
  els.scenarioSelect.value = vm.id;
  els.periodButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === vm.period)));

  els.title.textContent = vm.title;
  els.ticketIssue.textContent =
    vm.period === 'year'
      ? `ANNUAL STUB · ${vm.year}`
      : `MONTHLY STUB · ${vm.year}.${String(vm.month).padStart(2, '0')}`;
  els.ticketRange.textContent = vm.cutoff
    ? `${vm.rangeText} · 进行中 截至 ${monthDay(vm.cutoff)}`
    : vm.rangeText;
  els.ticketDistance.textContent = vm.distanceText;
  els.ticketEq.textContent = `等效 ${vm.derived.marathonsText} · 单次均距 ${vm.derived.avgRunKmText}`;

  els.stampTop.textContent = vm.cutoff ? 'LIVE' : 'SEALED';
  els.stampMid.textContent = vm.derived.activeRatioShort.split(' ')[0];
  els.stampBot.textContent = vm.period === 'year' ? 'MONTHS' : 'WEEKS';

  els.ticketMetrics.innerHTML = vm.metrics
    .map(
      (m) => `
      <div class="rc-dotted-row">
        <dt>${m.label}</dt>
        <span class="rc-dotted-leader" aria-hidden="true"></span>
        <dd>${m.value}${m.unit ? `<span>${m.unit}</span>` : ''}</dd>
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

  renderPunchBoard();
  renderSlipDetail();
  renderLedgerAndBarcode();
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

let lastTrigger = null;
const openDialog = (t) => {
  lastTrigger = t;
  updatePoster();
  els.dialog.showModal();
};
els.openShareRail.addEventListener('click', () => openDialog(els.openShareRail));
els.openShareMobile.addEventListener('click', () => openDialog(els.openShareMobile));
els.railPosterBtn.addEventListener('click', () => openDialog(els.railPosterBtn));
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
    return renderPosterC(vm, theme).toDataURL('image/png');
  },
};

renderAll();
