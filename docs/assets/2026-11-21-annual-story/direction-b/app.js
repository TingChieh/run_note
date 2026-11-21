(function () {
  'use strict';

  const D = window.STORY_DATA;
  const FE = window.FOOTPRINT_ENGINE;
  const PR = window.STORY_POSTER;

  let currentScenarioId = D.getInitialScenarioId();
  let currentTheme = D.applyTheme(D.getTheme());
  let currentAct = 0; // 0..6
  let selectedCityCode = null;
  let posterMode = 'cinema';
  let posterTheme = currentTheme;

  const canvas = document.getElementById('cinema-canvas');
  const posterCanvas = document.getElementById('poster-canvas');
  const posterDialog = document.getElementById('poster-dialog');

  const stage = new FE.FootprintStage(canvas, {
    variant: 'cinema',
    scenario: D.SCENARIOS[currentScenarioId],
    mode: 'annual',
    initialProgress: 1,
    onFrame: updateFilmState,
  });

  function scenario() {
    return D.SCENARIOS[currentScenarioId];
  }

  function updateFilmState(snap) {
    if (currentAct !== 6) return;
    document.getElementById('cinema-scrubber').value = String(Math.round(snap.progress * 1000));
    const btn = document.getElementById('cinema-play');
    btn.textContent = snap.playing ? '暂停放映' : snap.progress >= 0.999 ? '重新放映' : '播放电影';
    if (snap.run) {
      document.getElementById('canvas-corner-badge').textContent = snap.run.milestoneLabel
        ? `${snap.run.date} · ${snap.run.milestoneLabel}`
        : `${snap.run.date} · ${snap.run.cityName}`;
      const liveKm = document.getElementById('act7-live-km');
      const liveMeta = document.getElementById('act7-live-meta');
      if (liveKm) liveKm.innerHTML = `${D.formatKm(snap.run.cumulativeM)}<small>km</small>`;
      if (liveMeta) {
        liveMeta.innerHTML = `
          <div class="act-stat-cell"><span>当前日期</span><strong>${snap.run.date}</strong></div>
          <div class="act-stat-cell"><span>累计出发</span><strong>${snap.index} / ${snap.total} 次</strong></div>
          <div class="act-stat-cell"><span>当前轨迹</span><strong>${snap.run.title}</strong></div>
          <div class="act-stat-cell"><span>点亮城市</span><strong>${scenario().hasTracks ? `${snap.citiesLit} 座` : '室内模式'}</strong></div>
        `;
      }
    }
  }

  function renderAct() {
    const s = scenario();
    const copyEl = document.getElementById('theater-copy');
    const gridEl = document.getElementById('theater-grid');
    const filmCtrl = document.getElementById('film-controls');
    const corner = document.getElementById('canvas-corner-badge');

    document.getElementById('act-code').textContent = `ACT 0${currentAct + 1} / 07`;
    document.getElementById('act-pill').textContent = s.isPartial
      ? `${s.year} · 进行中（截至 ${D.formatShortDate(s.cutoffDate)}）`
      : `${s.year} 年度故事`;

    document.querySelectorAll('#act-tabs button').forEach((btn, idx) => {
      btn.setAttribute('aria-selected', String(idx === currentAct));
      btn.classList.toggle('is-passed', idx < currentAct);
    });

    document.getElementById('prev-act').disabled = currentAct === 0;
    document.getElementById('next-act').disabled = currentAct === 6;
    gridEl.classList.toggle('is-film-act', currentAct === 6);
    filmCtrl.hidden = currentAct !== 6;

    if (currentAct !== 6) stage.pause();

    if (currentAct === 0) {
      // Act 01: Opening Title
      copyEl.innerHTML = `
        <span class="act-eyebrow">OPENING · ${s.year}</span>
        <h1 class="act-headline">这一年，你用双脚写下的故事</h1>
        <p class="act-giant-stat">${D.formatKm(s.summary.totalDistanceM)}<small>km</small></p>
        <p class="act-desc">${s.dateRangeText}。${s.coverageNote || `全年 ${s.summary.activityCount} 次出发，等效 ${s.summary.marathonsEq} 场全程马拉松。`}</p>
        <div class="act-stat-grid">
          <div class="act-stat-cell"><span>跑步次数 / 天数</span><strong>${s.summary.activityCount} 次 · ${s.summary.activityDays} 天</strong></div>
          <div class="act-stat-cell"><span>平均配速</span><strong>${D.formatPace(s.summary.avgPaceSeconds)} /km</strong></div>
          <div class="act-stat-cell"><span>总在途用时</span><strong>${D.formatDurationCn(s.summary.durationSeconds)}</strong></div>
          <div class="act-stat-cell"><span>探索城市</span><strong>${s.exploredCities.totalCities > 0 ? `${s.exploredCities.totalCities} 座城` : '室内记录'}</strong></div>
        </div>
      `;
      corner.textContent = `${s.year} 全年足迹缩略`;
      stage.setMode('annual', { progress: 1 });
    } else if (currentAct === 1) {
      // Act 02: First Run
      const f = s.firstRun;
      copyEl.innerHTML = `
        <span class="act-eyebrow">FIRST SPARK · ${f.date}</span>
        <h2 class="act-headline">年度第一跑</h2>
        <p class="act-giant-stat">${D.formatKm(f.distanceM)}<small>km</small></p>
        <p class="act-desc">「${f.title}」—— ${f.note}</p>
        <div class="act-stat-grid">
          <div class="act-stat-cell"><span>起跑时间</span><strong>${f.date} ${f.time}</strong></div>
          <div class="act-stat-cell"><span>用时 / 配速</span><strong>${D.formatDuration(f.durationSeconds)} · ${D.formatPace(f.paceSeconds)}</strong></div>
          <div class="act-stat-cell"><span>起点城市</span><strong>${f.cityName || '室内无定位'}</strong></div>
          <div class="act-stat-cell"><span>轨迹状态</span><strong>${f.hasTrack ? '完整 GPS 轨迹' : '无轨迹降级卡片'}</strong></div>
        </div>
      `;
      corner.textContent = `首跑 · ${f.date}`;
      stage.setMode('single', { focusKey: 'first', progress: 1 });
    } else if (currentAct === 2) {
      // Act 03: Longest Route
      const l = s.longestRoute;
      copyEl.innerHTML = `
        <span class="act-eyebrow">THE LONG HORIZON · ${l.date}</span>
        <h2 class="act-headline">最远的一次出发</h2>
        <p class="act-giant-stat">${D.formatKm(l.distanceM)}<small>km</small></p>
        <p class="act-desc">「${l.title}」· ${l.comparedToAvg}。${l.note}</p>
        <div class="act-stat-grid">
          <div class="act-stat-cell"><span>总用时</span><strong>${D.formatDuration(l.durationSeconds)}</strong></div>
          <div class="act-stat-cell"><span>平均配速</span><strong>${D.formatPace(l.paceSeconds)} /km</strong></div>
          <div class="act-stat-cell"><span>所在城市</span><strong>${l.cityName || '室内无定位'}</strong></div>
          <div class="act-stat-cell"><span>陪跑跑鞋</span><strong>${l.shoeName || '未关联跑鞋'}</strong></div>
        </div>
      `;
      corner.textContent = `最长 · ${D.formatKm(l.distanceM)} km`;
      stage.setMode('single', { focusKey: 'longest', progress: 1 });
    } else if (currentAct === 3) {
      // Act 04: Best Performance
      const bp = s.bestPerformance;
      copyEl.innerHTML = `
        <span class="act-eyebrow">PEAK VELOCITY · ${bp.category.toUpperCase()}</span>
        <h2 class="act-headline">${bp.isAllTimePB ? '刷新历史 PB 的瞬间' : '年度最佳速度表现'}</h2>
        <p class="act-giant-stat">${D.formatPace(bp.paceSeconds)}<small>/km</small></p>
        <p class="act-desc">「${bp.title}」于 ${bp.date} 达成 ${D.formatDuration(bp.durationSeconds)}，${bp.baselineText}。</p>
        <div class="act-stat-grid">
          <div class="act-stat-cell"><span>成绩组别</span><strong>${bp.category}（${D.formatKm(bp.distanceM)} km）</strong></div>
          <div class="act-stat-cell"><span>提速幅度</span><strong>快了 ${bp.gainSecondsPerKm}"/km</strong></div>
          ${bp.otherBests
            .map(
              (o) =>
                `<div class="act-stat-cell"><span>${o.category} 年度最佳</span><strong>${D.formatPace(o.paceSeconds)}/km</strong></div>`,
            )
            .join('')}
        </div>
      `;
      corner.textContent = `${bp.category} 最佳 · ${D.formatPace(bp.paceSeconds)}/km`;
      stage.setMode('single', { focusKey: 'best', progress: 1 });
    } else if (currentAct === 4) {
      // Act 05: Explored Cities
      const ec = s.exploredCities;
      if (ec.totalCities === 0) {
        copyEl.innerHTML = `
          <span class="act-eyebrow">CITY ATLAS · FALLBACK</span>
          <h2 class="act-headline">室内沉淀的一年</h2>
          <p class="act-giant-stat">${ec.unlocatedCount}<small>次无定位记录</small></p>
          <p class="act-desc">今年全部记录均未附带户外 GPS 坐标。开启户外定位记录后，这一幕会以星图逐城点亮你的脚步。</p>
        `;
        corner.textContent = '无定位降级模式';
        stage.setMode('cities', { selectedCityCode: null, progress: 1 });
      } else {
        const headline = ec.totalCities === 1 ? `深耕一座城：${ec.items[0].name}` : `脚步跨越 ${ec.totalCities} 座城`;
        copyEl.innerHTML = `
          <span class="act-eyebrow">CITY ATLAS · ${ec.totalRegions} REGIONS</span>
          <h2 class="act-headline">${headline}</h2>
          <p class="act-giant-stat">+${ec.totalNewCells}<small>个新探索格</small></p>
          <p class="act-desc">${ec.newCitiesCount > 0 ? `今年首次点亮 ${ec.newCitiesCount} 座新城市（标 ★）。` : '在熟悉的城市里继续拓宽边界。'}点击下方城市胶囊切换聚焦：</p>
          <div class="cinema-city-pills" id="cinema-city-pills">
            ${ec.items
              .map(
                (c) =>
                  `<button type="button" class="cinema-city-pill" data-city="${c.code}" aria-pressed="${selectedCityCode === c.code}">${c.name}${c.isNew ? ' ★' : ''} · ${D.formatKm(c.distanceM, 0)}km</button>`,
              )
              .join('')}
          </div>
        `;
        corner.textContent = `${ec.totalCities} 座城 · +${ec.totalNewCells} 格`;
        stage.setMode('cities', { selectedCityCode, progress: 1 });

        document.querySelectorAll('#cinema-city-pills button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const code = btn.dataset.city;
            selectedCityCode = selectedCityCode === code ? null : code;
            stage.setMode('cities', { selectedCityCode, progress: 1 });
            document.querySelectorAll('#cinema-city-pills button').forEach((el) => {
              el.setAttribute('aria-pressed', String(el.dataset.city === selectedCityCode));
            });
          });
        });
      }
    } else if (currentAct === 5) {
      // Act 06: Most Frequent Route
      const fr = s.frequentRoute;
      if (!fr.available) {
        copyEl.innerHTML = `
          <span class="act-eyebrow">THE RITUAL LOOP · FALLBACK</span>
          <h2 class="act-headline">每一次都是新出发</h2>
          <p class="act-giant-stat">${s.summary.activityCount}<small>次不重样</small></p>
          <p class="act-desc">${fr.reason}。不重复的轨迹本身也是一种探索。</p>
        `;
        corner.textContent = '无重复路线';
        stage.setMode('frequent', { progress: 1 });
      } else {
        copyEl.innerHTML = `
          <span class="act-eyebrow">THE RITUAL LOOP · ${fr.cityName}</span>
          <h2 class="act-headline">反复重逢的路</h2>
          <p class="act-giant-stat">${fr.runCount}<small>次 · 占全年 ${fr.sharePct}%</small></p>
          <p class="act-desc">「${fr.name}」承载了你今年最稳定的习惯——29 层轨迹叠影见证了从 ${D.formatPace(fr.firstPaceSeconds)} 到 ${D.formatPace(fr.bestPaceSeconds)}/km 的变快。</p>
          <div class="act-stat-grid">
            <div class="act-stat-cell"><span>中位距离</span><strong>${D.formatKm(fr.medianDistanceM)} km</strong></div>
            <div class="act-stat-cell"><span>同路提速</span><strong>快了 ${fr.paceImprovementSec}"/km</strong></div>
            <div class="act-stat-cell"><span>首次打卡</span><strong>${fr.firstDate}</strong></div>
            <div class="act-stat-cell"><span>末次打卡</span><strong>${fr.lastDate}</strong></div>
          </div>
        `;
        corner.textContent = `${fr.name} · ${fr.runCount} 层叠影`;
        stage.setMode('frequent', { progress: 1 });
      }
    } else {
      // Act 07: Annual Footprint Film
      copyEl.innerHTML = `
        <span class="act-eyebrow">THE ANNUAL FILM · ${s.year}</span>
        <h2 class="act-headline">年度足迹电影</h2>
        <p class="act-giant-stat" id="act7-live-km">${D.formatKm(s.summary.totalDistanceM)}<small>km</small></p>
        <p class="act-desc">按下播放或拖动下方时间轴，逐日重走 ${s.year} 年的每一道弧光与里程碑。</p>
        <div class="act-stat-grid" id="act7-live-meta"></div>
      `;
      stage.setMode('annual', { progress: stage.progress });
      updateFilmState(stage.getSnapshot());
    }
  }

  function goToAct(idx) {
    currentAct = Math.max(0, Math.min(6, idx));
    renderAct();
  }

  function updateThemeUI() {
    document.getElementById('theme-toggle').textContent = currentTheme === 'dark' ? '浅色' : '深色';
    posterTheme = currentTheme;
    syncPosterControls();
    stage.render();
    if (posterDialog.open) renderPoster();
  }

  function syncPosterControls() {
    document.querySelectorAll('#poster-mode-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.pmode === posterMode));
    });
    document.querySelectorAll('#poster-theme-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.ptheme === posterTheme));
    });
  }

  function renderPoster() {
    PR.renderPoster(posterCanvas, scenario(), {
      style: posterMode,
      theme: posterTheme,
      hideCities: document.getElementById('opt-hide-cities').checked,
      hideRouteNames: document.getElementById('opt-hide-routes').checked,
    });
  }

  function openPoster(mode) {
    if (mode) posterMode = mode;
    posterTheme = currentTheme;
    syncPosterControls();
    renderPoster();
    posterDialog.showModal();
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
    renderAct();
    if (posterDialog.open) renderPoster();
  }

  // Event Bindings
  document.getElementById('theme-toggle').addEventListener('click', () => {
    currentTheme = D.applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    updateThemeUI();
  });

  document.querySelectorAll('#year-switch button').forEach((btn) => {
    btn.addEventListener('click', () => loadScenario(btn.dataset.year));
  });

  document.querySelectorAll('#act-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => goToAct(Number(btn.dataset.act)));
  });

  document.getElementById('prev-act').addEventListener('click', () => goToAct(currentAct - 1));
  document.getElementById('next-act').addEventListener('click', () => goToAct(currentAct + 1));

  window.addEventListener('keydown', (e) => {
    if (posterDialog.open) return;
    if (e.key === 'ArrowRight') goToAct(currentAct + 1);
    else if (e.key === 'ArrowLeft') goToAct(currentAct - 1);
    else if (e.key === ' ' && currentAct === 6 && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      stage.toggle();
    }
  });

  // Film playback controls
  document.getElementById('cinema-play').addEventListener('click', () => stage.toggle());
  document.getElementById('cinema-replay').addEventListener('click', () => {
    stage.setProgress(0);
    stage.play();
  });
  document.querySelectorAll('#cinema-speed button').forEach((btn) => {
    btn.addEventListener('click', () => {
      stage.setSpeed(Number(btn.dataset.speed));
      document.querySelectorAll('#cinema-speed button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
    });
  });
  document.getElementById('cinema-scrubber').addEventListener('input', (e) => {
    stage.pause();
    stage.setProgress(Number(e.target.value) / 1000);
  });

  // Poster dialog
  document.getElementById('open-poster-top').addEventListener('click', () => openPoster('cinema'));
  document.getElementById('share-film-btn').addEventListener('click', () => openPoster('cinema'));
  document.getElementById('share-scene-btn').addEventListener('click', () => openPoster('cinema-scene'));
  document.getElementById('close-poster-dialog').addEventListener('click', () => posterDialog.close());
  document.getElementById('download-poster-btn').addEventListener('click', () => {
    renderPoster();
    const a = document.createElement('a');
    a.download = `runnote-annual-story-b-${posterMode}-${scenario().year}-${posterTheme}.png`;
    a.href = posterCanvas.toDataURL('image/png');
    a.click();
  });

  document.querySelectorAll('#poster-mode-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      posterMode = btn.dataset.pmode;
      syncPosterControls();
      renderPoster();
    });
  });
  document.querySelectorAll('#poster-theme-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      posterTheme = btn.dataset.ptheme;
      syncPosterControls();
      renderPoster();
    });
  });
  document.getElementById('opt-hide-cities').addEventListener('change', renderPoster);
  document.getElementById('opt-hide-routes').addEventListener('change', renderPoster);

  // Deterministic QA hooks
  window.__PROTO_API__ = {
    setTheme: (t) => {
      currentTheme = D.applyTheme(t);
      updateThemeUI();
    },
    setYear: (y) => loadScenario(String(y)),
    goToAct: (idx) => goToAct(idx),
    setAnimationProgress: (p) => {
      goToAct(6);
      stage.pause();
      stage.setProgress(p);
    },
    openPoster: (opts = {}) => {
      if (opts.mode) posterMode = opts.mode;
      if (opts.theme) posterTheme = opts.theme;
      syncPosterControls();
      renderPoster();
      if (!posterDialog.open) posterDialog.showModal();
    },
    closePoster: () => {
      if (posterDialog.open) posterDialog.close();
    },
  };

  loadScenario(currentScenarioId);
  updateThemeUI();
})();
