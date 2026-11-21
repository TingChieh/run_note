(function () {
  'use strict';

  const D = window.STORY_DATA;
  const FE = window.FOOTPRINT_ENGINE;
  const PR = window.STORY_POSTER;

  let currentScenarioId = D.getInitialScenarioId();
  let currentTheme = D.applyTheme(D.getTheme());
  let currentLens = 'annual';
  let selectedCityCode = null;
  let posterTheme = currentTheme;

  const atlasCanvas = document.getElementById('almanac-canvas');
  const miniPosterCanvas = document.getElementById('almanac-mini-poster');
  const posterCanvas = document.getElementById('poster-canvas');
  const posterDialog = document.getElementById('poster-dialog');

  const stage = new FE.FootprintStage(atlasCanvas, {
    variant: 'almanac',
    scenario: D.SCENARIOS[currentScenarioId],
    mode: 'annual',
    initialProgress: 1,
    onFrame: updateAtlasHud,
  });

  function scenario() {
    return D.SCENARIOS[currentScenarioId];
  }

  function updateAtlasHud(snap) {
    if (currentLens !== 'annual') return;
    document.getElementById('atlas-scrubber').value = String(Math.round(snap.progress * 1000));
    const playBtn = document.getElementById('atlas-play');
    playBtn.textContent = snap.playing ? '暂停' : snap.progress >= 0.999 ? '重放足迹' : '播放足迹';
    if (!snap.run) return;
    document.getElementById('hud-date').textContent = snap.run.date;
    document.getElementById('hud-km').textContent = `${D.formatKm(snap.run.cumulativeM)} km`;
    document.getElementById('hud-title').textContent = snap.run.milestoneLabel
      ? `${snap.run.milestoneLabel} · ${snap.run.title}`
      : `${snap.run.cityName} · ${snap.run.title}`;
  }

  function setLens(lens, extra = {}) {
    currentLens = lens;
    const s = scenario();

    document.querySelectorAll('#lens-tabs button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lens === lens));
    });
    document.querySelectorAll('.specimen-card[data-focus]').forEach((card) => {
      card.classList.toggle('is-active', card.dataset.focus === lens);
    });

    document.getElementById('caliper-bar').hidden = lens !== 'annual';
    if (lens !== 'annual') stage.pause();

    if (lens === 'annual') {
      stage.setMode('annual', { progress: extra.progress !== undefined ? extra.progress : stage.progress });
      updateAtlasHud(stage.getSnapshot());
    } else if (lens === 'first') {
      stage.setMode('single', { focusKey: 'first', progress: 1 });
      document.getElementById('hud-date').textContent = s.firstRun.date;
      document.getElementById('hud-km').textContent = `${D.formatKm(s.firstRun.distanceM)} km`;
      document.getElementById('hud-title').textContent = `首跑标本 · ${s.firstRun.title}`;
    } else if (lens === 'longest') {
      stage.setMode('single', { focusKey: 'longest', progress: 1 });
      document.getElementById('hud-date').textContent = s.longestRoute.date;
      document.getElementById('hud-km').textContent = `${D.formatKm(s.longestRoute.distanceM)} km`;
      document.getElementById('hud-title').textContent = `最长路线 · ${s.longestRoute.title}`;
    } else if (lens === 'best') {
      stage.setMode('single', { focusKey: 'best', progress: 1 });
      document.getElementById('hud-date').textContent = s.bestPerformance.date;
      document.getElementById('hud-km').textContent = `${D.formatPace(s.bestPerformance.paceSeconds)} /km`;
      document.getElementById('hud-title').textContent = `最佳表现 · ${s.bestPerformance.category} · ${s.bestPerformance.title}`;
    } else if (lens === 'cities') {
      stage.setMode('cities', { selectedCityCode, progress: 1 });
      const city = selectedCityCode && s.exploredCities.items.find((c) => c.code === selectedCityCode);
      document.getElementById('hud-date').textContent = city ? city.region : `${s.exploredCities.totalCities} 座城`;
      document.getElementById('hud-km').textContent = city
        ? `${D.formatKm(city.distanceM, 1)} km`
        : `+${s.exploredCities.totalNewCells} 新格`;
      document.getElementById('hud-title').textContent = city
        ? `${city.name} · ${city.tagline}`
        : s.exploredCities.totalCities > 0
          ? '城市邮戳全景拓扑'
          : '无户外定位记录（室内模式）';
    } else if (lens === 'frequent') {
      stage.setMode('frequent', { progress: 1 });
      const fr = s.frequentRoute;
      document.getElementById('hud-date').textContent = fr.available ? `${fr.runCount} 次叠影` : '无重复路线';
      document.getElementById('hud-km').textContent = fr.available ? `中位 ${D.formatKm(fr.medianDistanceM)} km` : '—';
      document.getElementById('hud-title').textContent = fr.available ? fr.name : '今年每一次出发都是新路';
    }
  }

  function renderAll() {
    const s = scenario();

    document.getElementById('folio-serial').textContent = `FIELD ALMANAC · NO.${s.year}`;
    document.getElementById('almanac-title').textContent = `${s.year} 跑者年度手账册`;
    document.getElementById('masthead-sub').textContent = `${s.dateRangeText} · ${s.summary.activityCount} 次出发 · ${s.summary.activityDays} 天在路上 · 均配 ${D.formatPace(s.summary.avgPaceSeconds)}/km`;
    document.getElementById('stamp-runs').textContent = `${s.summary.activityCount} RUNS`;
    document.getElementById('stamp-km').textContent = D.formatKm(s.summary.totalDistanceM, 1);

    const partial = document.getElementById('folio-partial');
    if (s.isPartial) {
      partial.hidden = false;
      partial.textContent = `进行中 · 截至 ${D.formatShortDate(s.cutoffDate)}`;
    } else {
      partial.hidden = true;
    }

    const cov = document.getElementById('almanac-coverage');
    if (s.coverageNote) {
      cov.hidden = false;
      cov.textContent = s.coverageNote;
    } else {
      cov.hidden = true;
    }

    // Spec 01: First Run
    document.getElementById('spec-first').innerHTML = `
      <p class="spec-big">${D.formatKm(s.firstRun.distanceM)}<small>km</small></p>
      <p class="spec-sub">${s.firstRun.title}</p>
      <p class="spec-note">${s.firstRun.note}</p>
      <div class="spec-divider-row">
        <span>日期 <strong>${s.firstRun.date}</strong></span>
        <span>起跑 <strong>${s.firstRun.time}</strong></span>
        <span>配速 <strong>${D.formatPace(s.firstRun.paceSeconds)}</strong></span>
      </div>
    `;

    // Spec 02: Longest Route
    document.getElementById('spec-longest').innerHTML = `
      <p class="spec-big">${D.formatKm(s.longestRoute.distanceM)}<small>km</small></p>
      <p class="spec-sub">${s.longestRoute.title}</p>
      <p class="spec-note">${s.longestRoute.comparedToAvg}。${s.longestRoute.note}</p>
      <div class="spec-divider-row">
        <span>日期 <strong>${s.longestRoute.date}</strong></span>
        <span>用时 <strong>${D.formatDuration(s.longestRoute.durationSeconds)}</strong></span>
        ${s.longestRoute.shoeName ? `<span>跑鞋 <strong>${s.longestRoute.shoeName}</strong></span>` : ''}
      </div>
    `;

    // Spec 03: Best Performance
    const bp = s.bestPerformance;
    document.getElementById('spec-best').innerHTML = `
      <p class="spec-big">${D.formatPace(bp.paceSeconds)}<small>/km · ${bp.category}</small></p>
      <p class="spec-sub">${bp.title}${bp.isAllTimePB ? ' · 历史 PB' : ''}</p>
      <p class="spec-note">${bp.baselineText}，用时 ${D.formatDuration(bp.durationSeconds)}。</p>
      <div class="spec-divider-row">
        <span>日期 <strong>${bp.date}</strong></span>
        <span>提速 <strong>-${bp.gainSecondsPerKm}"/km</strong></span>
      </div>
    `;

    // Spec 04: City Passport
    const ec = s.exploredCities;
    if (ec.totalCities === 0) {
      document.getElementById('spec-cities').innerHTML = `
        <p class="spec-note">本年度 ${ec.unlocatedCount} 次记录均无户外 GPS 坐标，护照邮戳页暂未盖章。上传带定位的户外 GPX/TCX 后自动点亮。</p>
      `;
    } else {
      const lead =
        ec.totalCities === 1
          ? `全年深耕 <strong>${ec.items[0].name}</strong>，新探索 <strong>+${ec.totalNewCells}</strong> 个 100m 网格。`
          : `共收集 <strong>${ec.totalCities}</strong> 枚城市邮戳（含 <strong>${ec.newCitiesCount}</strong> 枚今年新点亮），新增探索网格 <strong>+${ec.totalNewCells}</strong> 格。`;
      document.getElementById('spec-cities').innerHTML = `
        <p class="spec-note">${lead}</p>
        <div class="passport-stamps" id="passport-stamps">
          ${ec.items
            .map(
              (c) => `
              <button type="button" class="city-stamp-btn ${c.isNew ? 'is-new' : ''}" data-city="${c.code}" aria-pressed="${selectedCityCode === c.code}">
                <span class="stamp-head-row">
                  <span class="stamp-city-name">${c.name}</span>
                  ${c.isNew ? '<span class="stamp-new-pill">新点亮</span>' : ''}
                </span>
                <span class="stamp-region">${c.region} · 首跑 ${D.formatShortDate(c.firstDate)}</span>
                <span class="stamp-metrics">${c.activityCount} 次 · ${D.formatKm(c.distanceM, 1)} km · +${c.newCells} 格</span>
              </button>
            `,
            )
            .join('')}
        </div>
      `;

      document.querySelectorAll('#passport-stamps .city-stamp-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = btn.dataset.city;
          selectedCityCode = selectedCityCode === code ? null : code;
          setLens('cities');
          document.querySelectorAll('#passport-stamps .city-stamp-btn').forEach((el) => {
            el.setAttribute('aria-pressed', String(el.dataset.city === selectedCityCode));
          });
        });
      });
    }

    // Spec 05: Frequent Route
    const fr = s.frequentRoute;
    if (!fr.available) {
      document.getElementById('spec-frequent').innerHTML = `
        <p class="spec-sub">每一次都是新出发</p>
        <p class="spec-note">${fr.reason}。没有固定重复回路，每条足迹都独立成章。</p>
      `;
    } else {
      document.getElementById('spec-frequent').innerHTML = `
        <div class="carbon-summary-row">
          <p class="spec-big">${fr.runCount}<small>次重逢 · 占全年 ${fr.sharePct}%</small></p>
          <span class="spec-note">${fr.name}（${fr.cityName} · 中位 ${D.formatKm(fr.medianDistanceM)} km）</span>
        </div>
        <p class="spec-note">从年初 ${D.formatPace(fr.firstPaceSeconds)}/km 进步到最佳 ${D.formatPace(fr.bestPaceSeconds)}/km，全年同路提速 ${fr.paceImprovementSec}"/km。</p>
        <div class="carbon-dots" aria-label="各月打卡次数">
          ${fr.monthlyHits
            .map(
              (h, idx) => `
              <div class="carbon-month-cell ${h === 0 ? 'is-empty' : ''}">
                <strong>${h > 0 ? `${h}次` : '—'}</strong>
                <span>${idx + 1}月</span>
              </div>
            `,
            )
            .join('')}
        </div>
      `;
    }
  }

  function syncPosterTheme() {
    document.querySelectorAll('#poster-theme-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.ptheme === posterTheme));
    });
  }

  function renderMiniPoster() {
    PR.renderPoster(miniPosterCanvas, scenario(), {
      style: 'almanac',
      theme: currentTheme,
      hideCities: false,
      hideRouteNames: false,
    });
  }

  function renderFullPoster() {
    PR.renderPoster(posterCanvas, scenario(), {
      style: 'almanac',
      theme: posterTheme,
      hideCities: document.getElementById('opt-hide-cities').checked,
      hideRouteNames: document.getElementById('opt-hide-routes').checked,
    });
  }

  function updateThemeUI() {
    document.getElementById('theme-toggle').textContent = currentTheme === 'dark' ? '浅色' : '深色';
    posterTheme = currentTheme;
    syncPosterTheme();
    stage.render();
    renderMiniPoster();
    if (posterDialog.open) renderFullPoster();
  }

  function loadScenario(id) {
    currentScenarioId = id;
    selectedCityCode = null;
    document.querySelectorAll('#year-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.year === id));
    });
    stage.pause();
    stage.setScenario(scenario());
    stage.setProgress(1);
    renderAll();
    setLens('annual', { progress: 1 });
    renderMiniPoster();
    if (posterDialog.open) renderFullPoster();
  }

  // Event Bindings
  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = D.applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    updateThemeUI();
  });

  document.querySelectorAll('#year-switch button').forEach((btn) => {
    btn.addEventListener('click', () => loadScenario(btn.dataset.year));
  });

  document.querySelectorAll('#lens-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => setLens(btn.dataset.lens));
  });

  document.querySelectorAll('.specimen-card[data-focus]').forEach((card) => {
    card.addEventListener('click', () => {
      setLens(card.dataset.focus);
      document.querySelector('.atlas-bench').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setLens(card.dataset.focus);
      }
    });
  });

  // Playback Controls
  document.getElementById('atlas-play').addEventListener('click', () => {
    if (currentLens !== 'annual') setLens('annual');
    stage.toggle();
  });
  document.getElementById('atlas-replay').addEventListener('click', () => {
    setLens('annual', { progress: 0 });
    stage.play();
  });
  document.querySelectorAll('#atlas-speed button').forEach((btn) => {
    btn.addEventListener('click', () => {
      stage.setSpeed(Number(btn.dataset.speed));
      document.querySelectorAll('#atlas-speed button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
    });
  });
  document.getElementById('atlas-scrubber').addEventListener('input', (e) => {
    if (currentLens !== 'annual') setLens('annual');
    stage.pause();
    stage.setProgress(Number(e.target.value) / 1000);
  });

  // Poster Dialog
  function openPoster() {
    posterTheme = currentTheme;
    syncPosterTheme();
    renderFullPoster();
    posterDialog.showModal();
  }
  document.getElementById('open-poster-top').addEventListener('click', openPoster);
  document.getElementById('open-poster-card').addEventListener('click', openPoster);
  document.getElementById('close-poster-dialog').addEventListener('click', () => posterDialog.close());
  document.getElementById('download-poster-btn').addEventListener('click', () => {
    renderFullPoster();
    const a = document.createElement('a');
    a.download = `runnote-annual-story-c-${scenario().year}-${posterTheme}.png`;
    a.href = posterCanvas.toDataURL('image/png');
    a.click();
  });
  document.querySelectorAll('#poster-theme-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      posterTheme = btn.dataset.ptheme;
      syncPosterTheme();
      renderFullPoster();
    });
  });
  document.getElementById('opt-hide-cities').addEventListener('change', renderFullPoster);
  document.getElementById('opt-hide-routes').addEventListener('change', renderFullPoster);

  // Deterministic QA hooks
  window.__PROTO_API__ = {
    setTheme: (t) => {
      currentTheme = D.applyTheme(t);
      updateThemeUI();
    },
    setYear: (y) => loadScenario(String(y)),
    setLens: (l) => setLens(l),
    setAnimationProgress: (p) => {
      setLens('annual', { progress: p });
      stage.pause();
      stage.setProgress(p);
    },
    openPoster: (opts = {}) => {
      if (opts.theme) posterTheme = opts.theme;
      syncPosterTheme();
      renderFullPoster();
      if (!posterDialog.open) posterDialog.showModal();
    },
    closePoster: () => {
      if (posterDialog.open) posterDialog.close();
    },
  };

  loadScenario(currentScenarioId);
  updateThemeUI();
})();
