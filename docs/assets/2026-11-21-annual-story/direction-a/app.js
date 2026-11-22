(function () {
  'use strict';

  const D = window.STORY_DATA;
  const FE = window.FOOTPRINT_ENGINE;
  const PR = window.STORY_POSTER;

  let currentScenarioId = D.getInitialScenarioId();
  let currentTheme = D.applyTheme(D.getTheme());
  let activeChapter = 'first';
  let selectedCityCode = null;
  let posterTheme = currentTheme;

  const stickyCanvas = document.getElementById('sticky-canvas');
  const annualCanvas = document.getElementById('annual-canvas');
  const dockMiniCanvas = document.getElementById('dock-mini-poster');
  const posterCanvas = document.getElementById('poster-canvas');
  const posterDialog = document.getElementById('poster-dialog');

  const stickyStage = new FE.FootprintStage(stickyCanvas, {
    variant: 'chronicle',
    scenario: D.SCENARIOS[currentScenarioId],
    mode: 'single',
    focusKey: 'first',
    initialProgress: 1,
  });

  const annualStage = new FE.FootprintStage(annualCanvas, {
    variant: 'chronicle',
    scenario: D.SCENARIOS[currentScenarioId],
    mode: 'annual',
    initialProgress: 1,
    onFrame: updateFilmReadout,
  });

  function scenario() {
    return D.SCENARIOS[currentScenarioId];
  }

  function updateThemeUI() {
    const btn = document.getElementById('theme-toggle');
    btn.textContent = currentTheme === 'dark' ? '浅色' : '深色';
    posterTheme = currentTheme;
    syncPosterThemeButtons();
    stickyStage.render();
    annualStage.render();
    renderMiniPoster();
    if (posterDialog.open) renderFullPoster();
  }

  function syncPosterThemeButtons() {
    document.querySelectorAll('#poster-theme-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.ptheme === posterTheme));
    });
  }

  function renderPrologue() {
    const s = scenario();
    document.getElementById('story-kicker').textContent = `ANNUAL STORY · ${s.year}`;
    document.getElementById('story-title').textContent = `${s.year} 跑步年度故事`;
    document.getElementById('story-range').textContent = s.dateRangeText;

    const pill = document.getElementById('partial-pill');
    if (s.isPartial) {
      pill.hidden = false;
      pill.textContent = `进行中 · 截至 ${D.formatShortDate(s.cutoffDate)}`;
    } else {
      pill.hidden = true;
    }

    const lead = document.getElementById('story-lead-line');
    if (s.exploredCities.totalCities > 1) {
      lead.textContent = `从 ${D.formatMonthDay(s.firstRun.date)} 出发，全年跑过 ${s.exploredCities.totalCities} 座城、累计 ${D.formatKm(s.summary.totalDistanceM)} km，相当于 ${s.summary.marathonsEq} 场全马。`;
    } else if (s.exploredCities.totalCities === 1) {
      lead.textContent = `今年深耕${s.exploredCities.items[0].name}，新点亮 ${s.exploredCities.totalNewCells} 个百米探索格，截至 ${D.formatShortDate(s.cutoffDate)} 已奔跑 ${D.formatKm(s.summary.totalDistanceM)} km。`;
    } else {
      lead.textContent = `今年共记录 ${s.summary.activityCount} 次室内与无定位奔跑，累计 ${D.formatKm(s.summary.totalDistanceM)} km，每一次出发都在积累节律。`;
    }

    const metricsEl = document.getElementById('prologue-metrics');
    metricsEl.innerHTML = `
      <div class="prologue-metric-item">
        <dt>年度总里程</dt>
        <dd class="accent">${D.formatKm(s.summary.totalDistanceM)}<small>km</small></dd>
      </div>
      <div class="prologue-metric-item">
        <dt>跑步次数 / 天数</dt>
        <dd>${s.summary.activityCount}<small>次 · ${s.summary.activityDays} 天</small></dd>
      </div>
      <div class="prologue-metric-item">
        <dt>总用时 / 均配速</dt>
        <dd>${D.formatPace(s.summary.avgPaceSeconds)}<small>/km · ${D.formatDurationCn(s.summary.durationSeconds)}</small></dd>
      </div>
      <div class="prologue-metric-item">
        <dt>探索城市 / 新格</dt>
        <dd>${s.exploredCities.totalCities > 0 ? s.exploredCities.totalCities : '—'}<small>${s.exploredCities.totalCities > 0 ? `座 · +${s.exploredCities.totalNewCells} 格` : '无 GPS 定位'}</small></dd>
      </div>
    `;

    const cov = document.getElementById('coverage-banner');
    if (s.coverageNote) {
      cov.hidden = false;
      cov.textContent = s.coverageNote;
    } else {
      cov.hidden = true;
    }
  }

  function renderChapters() {
    const s = scenario();

    // 01 First Run
    document.getElementById('body-first').innerHTML = `
      <div class="beat-hero-row">
        <div class="beat-big-num">${D.formatKm(s.firstRun.distanceM)}<small>km</small></div>
        <span class="beat-date-pill">${s.firstRun.date} · ${s.firstRun.time}</span>
      </div>
      <p class="beat-run-title">${s.firstRun.title}</p>
      <p class="beat-narrative">${s.firstRun.note}</p>
      <div class="beat-facts">
        <div class="beat-fact-item"><span>用时</span><strong>${D.formatDuration(s.firstRun.durationSeconds)}</strong></div>
        <div class="beat-fact-item"><span>配速</span><strong>${D.formatPace(s.firstRun.paceSeconds)} /km</strong></div>
        <div class="beat-fact-item"><span>地点</span><strong>${s.firstRun.cityName || '无定位记录'}</strong></div>
      </div>
    `;

    // 02 Longest Route
    document.getElementById('body-longest').innerHTML = `
      <div class="beat-hero-row">
        <div class="beat-big-num">${D.formatKm(s.longestRoute.distanceM)}<small>km</small></div>
        <span class="beat-date-pill">${s.longestRoute.date} · ${s.longestRoute.time}</span>
      </div>
      <p class="beat-run-title">${s.longestRoute.title}</p>
      <p class="beat-narrative">${s.longestRoute.note}（${s.longestRoute.comparedToAvg}）</p>
      <div class="beat-facts">
        <div class="beat-fact-item"><span>用时</span><strong>${D.formatDuration(s.longestRoute.durationSeconds)}</strong></div>
        <div class="beat-fact-item"><span>均配速</span><strong>${D.formatPace(s.longestRoute.paceSeconds)} /km</strong></div>
        ${s.longestRoute.shoeName ? `<div class="beat-fact-item"><span>跑鞋</span><strong>${s.longestRoute.shoeName}</strong></div>` : ''}
      </div>
    `;

    // 03 Best Performance
    const bp = s.bestPerformance;
    document.getElementById('body-best').innerHTML = `
      <div class="beat-hero-row">
        <div class="beat-big-num">${D.formatPace(bp.paceSeconds)}<small>/km · ${bp.category}</small></div>
        ${bp.isAllTimePB ? '<span class="pb-badge">刷新历史 PB</span>' : `<span class="beat-date-pill">${bp.date}</span>`}
      </div>
      <p class="beat-run-title">${bp.title} · ${D.formatDuration(bp.durationSeconds)}</p>
      <p class="beat-narrative">${bp.baselineText}，完成于 ${bp.date}（${bp.cityName || '室内记录'}）。</p>
      ${
        bp.otherBests.length
          ? `<div class="sub-bests">${bp.otherBests
              .map(
                (o) =>
                  `<span class="sub-best-chip">${o.category} 最佳 · ${D.formatPace(o.paceSeconds)}/km（${D.formatDuration(o.durationSeconds)}）</span>`,
              )
              .join('')}</div>`
          : ''
      }
    `;

    // 04 Explored Cities
    const ec = s.exploredCities;
    if (ec.totalCities === 0) {
      document.getElementById('body-cities').innerHTML = `
        <div class="fallback-box">
          <strong>室内与无定位记录年度</strong>
          <p>全年 ${ec.unlocatedCount} 次跑步均未附带户外 GPS 坐标。当你开启户外轨迹记录后，这里会自动点亮跑过的每一座城与 100m 探索网格。</p>
        </div>
      `;
    } else {
      const singleNote =
        ec.totalCities === 1
          ? `今年把脚步全部留在 <strong>${ec.items[0].name}</strong>，新探索 ${ec.totalNewCells} 个百米网格。`
          : `跨越 <strong>${ec.totalRegions}</strong> 个区域、<strong>${ec.totalCities}</strong> 座城，其中 <strong>${ec.newCitiesCount}</strong> 座为 ${s.year} 年首次点亮。`;
      document.getElementById('body-cities').innerHTML = `
        <p class="beat-narrative">${singleNote} 点击任意城市可在右侧舞台聚焦。</p>
        <div class="city-list" id="city-list">
          ${ec.items
            .map(
              (c) => `
              <button type="button" class="city-row" data-city="${c.code}" aria-pressed="${selectedCityCode === c.code}">
                <span class="city-row-main">
                  <strong>${c.name}</strong>
                  <span style="font-size:0.75rem;color:var(--muted-foreground)">${c.region}</span>
                  ${c.isNew ? '<span class="city-new-tag">新点亮</span>' : ''}
                </span>
                <span class="city-row-stats">${c.activityCount} 次 · ${D.formatKm(c.distanceM, 1)} km · +${c.newCells} 格</span>
              </button>
            `,
            )
            .join('')}
        </div>
      `;

      document.querySelectorAll('#city-list .city-row').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const code = btn.dataset.city;
          selectedCityCode = selectedCityCode === code ? null : code;
          focusChapter('cities');
          document.querySelectorAll('#city-list .city-row').forEach((el) => {
            el.setAttribute('aria-pressed', String(el.dataset.city === selectedCityCode));
          });
        });
      });
    }

    // 05 Most Frequent Route
    const fr = s.frequentRoute;
    if (!fr.available) {
      document.getElementById('body-frequent').innerHTML = `
        <div class="fallback-box">
          <strong>每一次都是新出发</strong>
          <p>${fr.reason}。当你重复跑过同一条户外路线 ≥ 2 次时，系统会自动聚合叠影与提速曲线。</p>
        </div>
      `;
    } else {
      const maxHit = Math.max(1, ...fr.monthlyHits);
      document.getElementById('body-frequent').innerHTML = `
        <div class="beat-hero-row">
          <div class="beat-big-num">${fr.runCount}<small>次重逢 · 占全年 ${fr.sharePct}%</small></div>
          <span class="beat-date-pill">中位 ${D.formatKm(fr.medianDistanceM)} km</span>
        </div>
        <p class="beat-run-title">${fr.name}（${fr.cityName}）</p>
        <p class="beat-narrative">从 ${D.formatShortDate(fr.firstDate)} 的 ${D.formatPace(fr.firstPaceSeconds)}/km 到最佳 ${D.formatPace(fr.bestPaceSeconds)}/km，同一条路见证了 ${fr.paceImprovementSec}"/km 的提速。</p>
        <div class="freq-months" aria-label="最常跑路线按月打卡分布">
          ${fr.monthlyHits
            .map((h, i) => {
              const pct = h > 0 ? Math.max(18, Math.round((h / maxHit) * 100)) : 12;
              return `<div class="freq-bar-col"><div class="freq-bar ${h === 0 ? 'is-zero' : ''}" style="height:${Math.round(pct * 0.34)}px" title="${i + 1}月：${h}次"></div><span class="freq-bar-lbl">${i + 1}</span></div>`;
            })
            .join('')}
        </div>
      `;
    }
  }

  function focusChapter(key) {
    activeChapter = key;
    const s = scenario();

    document.querySelectorAll('.chapter-card').forEach((card) => {
      card.classList.toggle('is-focused', card.dataset.chapter === key);
    });
    document.querySelectorAll('#chapter-nav a').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.chapter === key);
    });
    document.querySelectorAll('#stage-dots button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.chapter === key));
    });

    const kicker = document.getElementById('stage-kicker');
    const title = document.getElementById('stage-title');
    const pill = document.getElementById('stage-mode-pill');
    const caption = document.getElementById('stage-caption');

    if (key === 'first') {
      kicker.textContent = 'STAGE · CHAPTER 01';
      title.textContent = s.firstRun.title;
      pill.textContent = s.firstRun.hasTrack ? '首跑轨迹' : '无轨迹降级';
      caption.textContent = `${s.firstRun.date} · ${D.formatKm(s.firstRun.distanceM)} km · 全年第一串脚印`;
      stickyStage.setMode('single', { focusKey: 'first', progress: 1 });
    } else if (key === 'longest') {
      kicker.textContent = 'STAGE · CHAPTER 02';
      title.textContent = s.longestRoute.title;
      pill.textContent = s.longestRoute.hasTrack ? '最长路线' : '里程标尺';
      caption.textContent = `${s.longestRoute.date} · ${D.formatKm(s.longestRoute.distanceM)} km · ${D.formatDuration(s.longestRoute.durationSeconds)}`;
      stickyStage.setMode('single', { focusKey: 'longest', progress: 1 });
    } else if (key === 'best') {
      kicker.textContent = 'STAGE · CHAPTER 03';
      title.textContent = `${s.bestPerformance.category} · ${s.bestPerformance.title}`;
      pill.textContent = s.bestPerformance.isAllTimePB ? 'PB 纪录' : '年度最佳';
      caption.textContent = `${D.formatPace(s.bestPerformance.paceSeconds)}/km · ${s.bestPerformance.baselineText}`;
      stickyStage.setMode('single', { focusKey: 'best', progress: 1 });
    } else if (key === 'cities') {
      kicker.textContent = 'STAGE · CHAPTER 04';
      const city = selectedCityCode && s.exploredCities.items.find((c) => c.code === selectedCityCode);
      title.textContent = city
        ? `${city.name} · ${city.region}`
        : s.exploredCities.totalCities > 0
          ? `${s.exploredCities.totalCities} 座探索城市星图`
          : '室内与无定位记录';
      pill.textContent = '城市拓扑';
      caption.textContent = city
        ? `${city.tagline}（${city.activityCount} 次 · ${D.formatKm(city.distanceM, 1)} km）`
        : s.exploredCities.totalCities > 0
          ? `共新探索 ${s.exploredCities.totalNewCells} 个百米网格，金色环代表今年新点亮城市。`
          : '无户外定位轨迹时自动切换为年度节律圆盘。';
      stickyStage.setMode('cities', { selectedCityCode, progress: 1 });
    } else if (key === 'frequent') {
      kicker.textContent = 'STAGE · CHAPTER 05';
      title.textContent = s.frequentRoute.available ? s.frequentRoute.name : '每一次都是新出发';
      pill.textContent = s.frequentRoute.available ? '记忆叠影' : '新路探索';
      caption.textContent = s.frequentRoute.available
        ? `叠加呈现 ${s.frequentRoute.runCount} 次同路轨迹，越亮处代表脚步重合最密。`
        : '本年度没有重复跑过 2 次以上的户外路线。';
      stickyStage.setMode('frequent', { progress: 1 });
    }
  }

  function updateFilmReadout(snap) {
    const s = scenario();
    const scrubber = document.getElementById('film-scrubber');
    scrubber.value = String(Math.round(snap.progress * 1000));

    const playBtn = document.getElementById('film-play');
    playBtn.textContent = snap.playing ? '暂停播放' : snap.progress >= 0.999 ? '重新播放' : '播放足迹';

    if (!snap.run) return;
    document.getElementById('film-date').textContent = snap.run.date;
    document.getElementById('film-km').textContent = `${D.formatKm(snap.run.cumulativeM)} km`;
    document.getElementById('film-runs').textContent = `${snap.index} / ${snap.total} 次`;
    document.getElementById('film-cities').textContent = s.hasTracks ? `${snap.citiesLit} 座` : '室内';
    document.getElementById('film-current-title').textContent = snap.run.milestoneLabel
      ? `${snap.run.date} · ${snap.run.milestoneLabel} · ${snap.run.title}`
      : `${snap.run.date} · ${snap.run.cityName} · ${snap.run.title}`;
  }

  function getPosterOpts() {
    return {
      style: 'chronicle',
      theme: posterTheme,
      hideCities: document.getElementById('opt-hide-cities').checked,
      hideRouteNames: document.getElementById('opt-hide-routes').checked,
    };
  }

  function renderMiniPoster() {
    PR.renderPoster(dockMiniCanvas, scenario(), {
      style: 'chronicle',
      theme: currentTheme,
      hideCities: false,
      hideRouteNames: false,
    });
  }

  function renderFullPoster() {
    PR.renderPoster(posterCanvas, scenario(), getPosterOpts());
  }

  function downloadPoster() {
    renderFullPoster();
    const link = document.createElement('a');
    link.download = `runnote-annual-story-a-${scenario().year}-${posterTheme}.png`;
    link.href = posterCanvas.toDataURL('image/png');
    link.click();
  }

  function loadScenario(id) {
    currentScenarioId = id;
    selectedCityCode = null;
    document.querySelectorAll('#year-switch button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.year === id));
    });
    const s = scenario();
    stickyStage.setScenario(s);
    annualStage.pause();
    annualStage.setScenario(s);
    annualStage.setProgress(1);
    renderPrologue();
    renderChapters();
    focusChapter('first');
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

  document.querySelectorAll('.chapter-card').forEach((card) => {
    card.addEventListener('click', () => focusChapter(card.dataset.chapter));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        focusChapter(card.dataset.chapter);
      }
    });
  });

  document.querySelectorAll('#stage-dots button').forEach((btn) => {
    btn.addEventListener('click', () => focusChapter(btn.dataset.chapter));
  });

  document.querySelectorAll('#chapter-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      const ch = link.dataset.chapter;
      if (ch && ch !== 'film') focusChapter(ch);
    });
  });

  // Scroll-linked stage sync on desktop
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const ch = entry.target.dataset.chapter;
            if (ch && ch !== activeChapter) focusChapter(ch);
          }
        }
      },
      { rootMargin: '-32% 0px -52% 0px', threshold: 0.1 },
    );
    document.querySelectorAll('.chapter-card').forEach((c) => observer.observe(c));
  }

  // Annual Footprint Animation Controls
  document.getElementById('film-play').addEventListener('click', () => annualStage.toggle());
  document.getElementById('film-replay').addEventListener('click', () => {
    annualStage.setProgress(0);
    annualStage.play();
  });
  document.querySelectorAll('#speed-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sp = Number(btn.dataset.speed);
      annualStage.setSpeed(sp);
      document.querySelectorAll('#speed-switch button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
    });
  });
  document.getElementById('film-scrubber').addEventListener('input', (e) => {
    annualStage.pause();
    annualStage.setProgress(Number(e.target.value) / 1000);
  });

  // Poster Dialog
  function openPosterDialog() {
    posterTheme = currentTheme;
    syncPosterThemeButtons();
    renderFullPoster();
    posterDialog.showModal();
  }
  document.getElementById('open-poster-top').addEventListener('click', openPosterDialog);
  document.getElementById('open-poster-dock').addEventListener('click', openPosterDialog);
  document.getElementById('quick-download-poster').addEventListener('click', downloadPoster);
  document.getElementById('close-poster-dialog').addEventListener('click', () => posterDialog.close());
  document.getElementById('download-poster-btn').addEventListener('click', downloadPoster);

  document.querySelectorAll('#poster-theme-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      posterTheme = btn.dataset.ptheme;
      syncPosterThemeButtons();
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
    focusChapter: (ch) => focusChapter(ch),
    setAnimationProgress: (p) => {
      annualStage.pause();
      annualStage.setProgress(p);
      document.getElementById('ch-film').scrollIntoView({ behavior: 'instant', block: 'center' });
    },
    openPoster: (opts = {}) => {
      if (opts.theme) posterTheme = opts.theme;
      syncPosterThemeButtons();
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
